import asyncio
import json
import math
import time
from typing import Callable, TypedDict

import httpx
from pydantic import ValidationError

from .response_schema import GoalStrategy, formats
from .errors import APIError
from .transport import request_json, TRANSIENT_CODES, TRANSIENT_HTTP
from .config import Config
from .context import CONTRACT, js_json
from .protocol import MODEL_ACTIONS, Observation, Plan, EngineFacts

from . import goal_context
class PlannerResult(TypedDict):
    plan: Plan
    latencyMs: int
    usage: dict
    model: str
    disposition: str
    transportTimings: dict


class DecisionResult(TypedDict):
    action: str
    latencyMs: int
    usage: dict
    model: str
    probabilities: dict
    confidence: float


CHOICE_INSTRUCTIONS = CONTRACT["goalDecisionInstructions"]


def public_text(data):
    text = ''.join((c.get('text', '') for item in data.get('output', []) if item.get('type') == 'message' for c in item.get('content', []) if c.get('type') == 'output_text'))
    return text or data.get('output_text', '')


def response_context(body):
    """Read our text-only request input for auditing, including split cached input."""
    value = body.get('input', '{}')
    if isinstance(value, str):
        return json.loads(value)
    return {key: value for message in value for block in message['content'] for key, value in json.loads(block['text']).items()}


def planner_messages(value, cache=False):
    stable_keys = ('task', 'actionMechanics', 'runtime', 'physics', 'map', 'executionObservationFields')
    stable = {key: value[key] for key in stable_keys}
    current = {key: item for key, item in value.items() if key not in stable_keys}
    return [{'role': 'user', 'content': [{
        'type': 'input_text',
        'text': js_json(stable),
        **({'prompt_cache_breakpoint': {'mode': 'explicit'}} if cache else {}),
    }, {'type': 'input_text', 'text': js_json(current)}]}]


def public_json(result, label):
    data = result['data']
    if data.get('status') and data['status'] != 'completed':
        reason = (data.get('incomplete_details') or {}).get('reason')
        raise APIError(f"{label} response {data['status']}" + (f': {reason}' if reason else ''))
    if any((c.get('type') == 'refusal' for item in data.get('output', []) if item.get('type') == 'message' for c in item.get('content', []))):
        raise APIError(f'{label} refused the request')
    text = public_text(data)
    if not isinstance(text, str) or not text:
        raise APIError(f'{label} returned no output_text')
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        raise APIError(f'{label} returned invalid JSON') from None


class OpenRouter:
    name = "OpenRouter"
    def __init__(self, config: Config, audit: Callable, client: httpx.AsyncClient, *, shared_planner_context=False):
        self.config, self.audit, self.client = (config, audit, client)
        self.shared_planner_context = shared_planner_context

    def request_endpoint(self, path):
        key = self.config.OPENROUTER_API_KEY.get_secret_value().strip()
        if not key:
            raise APIError('Add OPENROUTER_API_KEY to .env and restart the lab.')
        return (self.config.OPENROUTER_BASE_URL.rstrip('/') + path, {
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
            'HTTP-Referer': self.config.OPENROUTER_SITE_URL,
            'X-Title': self.config.OPENROUTER_APP_NAME,
        })

    async def post(self, path, body, timeout_ms):
        url, headers = self.request_endpoint(path)
        purpose = response_context(body).get("purpose") if path == "/v1/responses" else None
        data, transport_timing = await request_json(self.client, url, path, body, headers,
            timeout_ms, self.audit, provider_name=self.name, purpose=purpose)
        latency = transport_timing["elapsedMs"]
        text = public_text(data)
        event = dict(kind="response", path=path, purpose=purpose, latencyMs=latency, apiProvider=self.name,
                     status=data.get("status"), incompleteDetails=data.get("incomplete_details"),
                     usage=data.get("usage"), model=data.get("model"), transportTimings=transport_timing)
        if text:
            event.update(publicOutputText=text, outputTextDiagnostics={"length": len(text), "trimmedLength": len(text.strip()), "start": text[:240], "end": text[-240:]})
        self.audit(event)  # Exclude private reasoning; transport timings contain only allowlisted headers.
        if data.get("error"):
            raise APIError(f"{self.name} returned an API error", data.get("usage"), retryable=isinstance(data["error"], dict) and data["error"].get("code") in TRANSIENT_CODES | TRANSIENT_HTTP, code=data["error"].get("code") if isinstance(data["error"], dict) else None)
        return dict(data=data, latencyMs=latency, transportTimings=transport_timing, usage=data.get("usage") or {}, model=data.get("model") or body["model"])

    def route_body(self, o, previous=None, reason=None, execution_history=None, review_application=None):
        current = previous is not None
        timing = {
            'initialSetup': not current,
            'elapsedExecutionSeconds': o.simTime,
            'explanation': 'Existing control continues while reviewing this snapshot.' if current else 'Initial setup is outside the mission clock. Elapsed execution time starts after the initial route and guidance are ready. There is no mission time limit.',
        }
        value = {
            'purpose': 'review route and guidance' if current else 'initial route and guidance',
            **goal_context.planner_input(o, previous, reason, execution_history, review_application),
            'decisionTiming': goal_context.decision_timing(self.config),
            'setupTiming': timing,
        }
        return self.response_body(value)

    def response_body(self, value):
        return {
            'model': self.config.PLANNER_MODEL,
            'instructions': CONTRACT['goalPlannerInstructions'],
            'input': planner_messages(value) if self.shared_planner_context else js_json(value),
            'reasoning': {'effort': self.config.PLANNER_REASONING_EFFORT},
            'max_output_tokens': self.config.PLANNER_MAX_OUTPUT_TOKENS,
            'stream': True,
            'text': {'format': formats()['goal_strategy']},
            'provider': {'require_parameters': True},
        }

    async def plan(self, o: Observation, previous: Plan | None=None, reason=None, attempt_budget_ms=None, execution_history=None, review_application=None) -> PlannerResult:
        started = time.perf_counter()
        result = None
        try:
            result = await self.post('/v1/responses', self.route_body(o, previous, reason, execution_history, review_application), attempt_budget_ms if attempt_budget_ms is not None else self.config.PLANNER_TIMEOUT_MS)
            raw = public_json(result, 'Planner')
            strategy = GoalStrategy.model_validate(raw)
            if strategy.disposition == 'keep':
                if previous is None or strategy.goals:
                    raise APIError('keep requires an installed plan and an empty goals list')
                plan = previous
            else:
                if not strategy.goals or len({g.id for g in strategy.goals}) != len(strategy.goals):
                    raise APIError('Revised goals must be nonempty and have unique IDs')
                for g in strategy.goals:
                    if g.kind in ('drive', 'fly'):
                        valid = g.position is not None and g.target is None
                    else:
                        valid = g.position is None and (g.kind == 'relay' and (g.target or '').startswith('relay-') or (g.kind == 'charge' and g.target == 'charger') or (g.kind == 'depot' and g.target == 'depot'))
                    if not valid:
                        raise APIError('Goal kind, target and position have incompatible shapes')
                plan = Plan.model_validate({'goals': [g.model_dump() for g in strategy.goals]})
            return dict(plan=plan, latencyMs=math.floor((time.perf_counter() - started) * 1000 + 0.5), usage=result['usage'], model=result['model'], disposition=strategy.disposition, transportTimings=result['transportTimings'])
        except asyncio.CancelledError:
            raise
        except (APIError, ValidationError) as error:
            message = f'Model output schema invalid ({error.error_count()} errors)' if isinstance(error, ValidationError) else str(error)
            raise APIError(message, result['usage'] if result else getattr(error, 'usage', {}), retryable=getattr(error, 'retryable', False), retry_after=getattr(error, 'retry_after', None), code=getattr(error, 'code', None)) from None

    async def decide(self, o: Observation, plan: Plan, model: str, facts: EngineFacts, attempt_budget_ms=None) -> DecisionResult:
        body = {
            'model': model,
            'state': goal_context.decision_state(o, plan, facts, goal_context.decision_timing(self.config)),
            'questions': {'maneuver': {
                'type': 'choice',
                'instructions': CHOICE_INSTRUCTIONS,
                'criteria': goal_context.MECHANICS,
            }},
        }
        result = await self.post('/alpha/decisions', body, attempt_budget_ms if attempt_budget_ms is not None else self.config.DECISION_TIMEOUT_MS)
        try:
            answer = result['data'].get('answers', {}).get('maneuver', {})
            if answer.get('type') != 'choice' or answer.get('choice') not in MODEL_ACTIONS:
                raise ValueError('Decision returned no valid maneuver choice')
            probabilities = answer.get('probabilities', {})
            if not isinstance(probabilities, dict) or set(probabilities) != set(MODEL_ACTIONS):
                raise ValueError('Decision returned incomplete probabilities')

            def probability(v):
                return type(v) in (int, float) and math.isfinite(v) and (0 <= v <= 1)
            if not all((probability(v) for v in probabilities.values())) or not probability(answer.get('confidence')):
                raise ValueError('Decision probabilities/confidence out of range')
            return {
                'action': answer['choice'],
                'probabilities': probabilities,
                'confidence': answer['confidence'],
                'latencyMs': result['latencyMs'],
                'usage': result['usage'],
                'model': result['model'],
            }
        except (ValueError, TypeError, AttributeError) as error:
            raise APIError(str(error), result['usage']) from None
