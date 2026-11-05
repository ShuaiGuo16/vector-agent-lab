import asyncio
import math
import time
import traceback
from uuid import uuid4

from .config import Config
from .errors import APIError
from .protocol import Observation, EngineFacts, Plan
from .recorder import Recorder, now_ms
from .history import ExecutionHistory


def objective_key(o):
    return f'{o.planVersion}:goal:{o.goal.id}' if o.goal else f'{o.planVersion}:setup'


class AgentSession:
    """One planner and one immediate decision request in flight."""
    def __init__(self, run_id, mode, decision_model, config: Config, api, recorder: Recorder, send):
        self.id, self.mode, self.decision_model = (run_id, mode, decision_model)
        self.config, self.api, self.recorder, self.send = (config, api, recorder, send)
        self.latest: Observation | None = None
        self.latest_facts: EngineFacts | None = None
        self.history = ExecutionHistory()
        self.retry_attempts = 0
        self.plan: Plan | None = None
        self.plan_version = 0
        self.calls = self.stale = self.generation = 0
        self.latencies = []
        self.last_decision = 0
        self.last_decision_objective = None
        self.reviewed_goals = set()
        self.pending_review_goal = None
        self.last_plan_time = -999
        self.prepared_review = None
        self.progress_position = None
        self.progress_energy = self.progress_at = 0
        self.progress_key = ''
        self.stopped = self.paused = False
        self.planner_task = self.decision_task = None
        self._tasks = set()
        self._finalizer = None

    def spawn(self, coroutine):
        task = asyncio.create_task(coroutine)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)
        return task

    def event(self, name, data):
        self.recorder.event(name, data)

    def cancel_requests(self):
        self.prepared_review = None
        self.pending_review_goal = None
        self.generation += 1
        current = asyncio.current_task()
        for task in (self.planner_task, self.decision_task):
            if task and task is not current and (not task.done()):
                task.cancel()
        self.planner_task = self.decision_task = None

    def takeover(self):
        self.mode = 'manual'
        self.cancel_requests()
        self.event('manual_takeover', {})
        self.send({'type': 'agent_status', 'state': 'Manual takeover — API requests stopped'})

    def observe(self, o: Observation, facts: EngineFacts):
        if self.stopped or o.runId != self.id or (self.latest and o.seq <= self.latest.seq):
            return
        self.latest, self.latest_facts = (o, facts)
        self.event('observation', o.wire())
        if o.status in ('success', 'failed'):
            self.finish(o.status)
            return
        if o.paused:
            if not self.paused:
                self.cancel_requests()
            self.paused = True
            return
        self.paused = False
        if self.mode != 'openrouter' or o.status != 'running' or now_ms() - o.observedAt > 1000:
            return
        self.history.observe(o)
        if self.plan:
            self.observe_goals(o, facts)
        elif not self.planner_task or self.planner_task.done():
            if self.calls >= self.config.MAX_API_CALLS_PER_RUN:
                self.finish('api_budget_exhausted')
                return
            self.last_plan_time = o.simTime
            self.calls += 1
            self.planner_task = self.spawn(self.request_plan(o, 'Initial independent planning', self.generation))

    def observe_goals(self, o, facts):
        if self.prepared_review:
            result, snapshot, goal_id = self.prepared_review
            if goal_id in (o.completedGoalIds or []):
                self.prepared_review = None
                self.accept_review(result, snapshot, goal_id)
        if self.calls >= self.config.MAX_API_CALLS_PER_RUN:
            if not any((t and (not t.done()) for t in (self.planner_task, self.decision_task))):
                self.finish('api_budget_exhausted')
            return
        progress_key = tuple(o.completedGoalIds or [])
        if self.progress_position is None or math.dist(o.position, self.progress_position) > 3 or o.energy > self.progress_energy + 3 or (progress_key != self.progress_key):
            self.progress_position, self.progress_energy, self.progress_at, self.progress_key = (o.position[:], o.energy, o.simTime, progress_key)
        g = o.goal
        station_id = g.id.removesuffix(':review') if g and g.kind == 'wait_review' else g.id if g else None
        scheduled = bool(g and station_id not in self.reviewed_goals and (station_id != self.pending_review_goal) and (g.kind == 'wait_review' or (self.config.REVIEW_SCHEDULE == 'every_relay' and g.kind == 'relay' or (g.kind in ('relay', 'charge') and g.reviewAfter))))
        stalled = g and g.kind != 'wait_review' and (o.simTime - self.progress_at > 15) and (o.simTime - self.last_plan_time > 20)
        if stalled and self.prepared_review:
            self.event('planner_prepared_superseded', {'reason': 'Station has not completed and execution stalled; reviewing the current state'})
            self.prepared_review = None
            self.pending_review_goal = None
        busy = self.prepared_review or (self.planner_task and (not self.planner_task.done()))
        if not busy and (scheduled or stalled) and (o.simTime - self.last_plan_time > 8):
            self.last_plan_time = o.simTime
            goal_id = station_id if scheduled else None
            if scheduled:
                self.pending_review_goal = goal_id
            self.calls += 1
            self.planner_task = self.spawn(self.request_plan(o, 'Scheduled station review' if scheduled else 'No measured movement, energy gain or goal progress for 15 seconds', self.generation, goal_id))
        key = objective_key(o)
        changed = key != self.last_decision_objective
        if changed and self.decision_task and (not self.decision_task.done()):
            self.decision_task.cancel()
            self.decision_task = None
        decision_busy = self.decision_task and (not self.decision_task.done())
        if self.calls < self.config.MAX_API_CALLS_PER_RUN and o.planVersion == self.plan_version and (not decision_busy) and (changed or now_ms() - self.last_decision >= self.config.DECISION_INTERVAL_MS):
            self.last_decision, self.last_decision_objective = (now_ms(), key)
            self.calls += 1
            self.decision_task = self.spawn(self.request_decision(o, facts, self.plan, self.generation))

    async def model_call(self, where, o, plan, facts, generation, reason=None, review_goal_id=None):
        """At most one retry; every attempt receives the full configured budget."""
        operation = str(uuid4())
        started = time.monotonic()
        budget_ms = self.config.PLANNER_TIMEOUT_MS if where == 'Planner' else self.config.DECISION_TIMEOUT_MS
        for attempt in range(self.config.MAX_TRANSIENT_RETRIES + 1):
            if self.stopped or generation != self.generation:
                raise asyncio.CancelledError
            if attempt:
                o, plan, facts = (self.latest, self.plan, self.latest_facts)
                if not o or now_ms() - o.observedAt > 1000 or (where == 'Decision' and (not plan or o.planVersion != self.plan_version)):
                    self.event('api_retry_cancelled', {
                        'operationId': operation,
                        'where': where,
                        'reason': 'No fresh executable observation',
                    })
                    raise asyncio.CancelledError
                if self.calls >= self.config.MAX_API_CALLS_PER_RUN:
                    raise APIError('API call budget prevents retry')
                self.calls += 1
                self.retry_attempts += 1
            planner_model = self.config.review_model() if plan is not None else self.config.PLANNER_MODEL
            request = {
                'observation': o.wire(),
                'model': planner_model if where == 'Planner' else self.decision_model,
                'operationId': operation,
                'attempt': attempt + 1,
                'attemptBudgetMs': budget_ms,
            }
            if where == 'Planner':
                application = {'mode': 'after_goal_completion' if review_goal_id else 'on_response' if plan else 'initial_setup', 'completionGoalId': review_goal_id}
                request.update(reasoning=self.config.PLANNER_REASONING_EFFORT, reason=reason, application=application)
            self.event('planner_request' if where == 'Planner' else 'decision_request', request)
            try:
                result = await (self.api.plan(o, plan, reason, budget_ms, self.history.snapshot() if plan else None, application) if where == 'Planner' else self.api.decide(o, plan, self.decision_model, facts, budget_ms))
                result['attemptLatencyMs'] = result['latencyMs']
                result['latencyMs'] = round((time.monotonic() - started) * 1000)
                result['attempts'] = attempt + 1
                return (result, o)
            except asyncio.CancelledError:
                raise
            except APIError as error:
                usage = error.usage
                delay = max(self.config.API_RETRY_DELAY_MS / 1000, error.retry_after or 0)
                eligible = error.retryable and attempt < self.config.MAX_TRANSIENT_RETRIES and (self.calls < self.config.MAX_API_CALLS_PER_RUN)
                self.event('api_attempt_failed', {
                    'operationId': operation,
                    'where': where,
                    'attempt': attempt + 1,
                    'code': error.code,
                    'message': str(error),
                    'retryable': error.retryable,
                    'willRetry': eligible,
                    'nextAttemptBudgetMs': budget_ms if eligible else None,
                    'reportedUsage': usage,
                })
                if not eligible:
                    raise
                self.event('api_retry', {
                    'operationId': operation,
                    'where': where,
                    'nextAttempt': attempt + 2,
                    'delayMs': round(delay * 1000),
                    'reason': error.code,
                    'context': 'Latest observation and current own plan at dispatch',
                })
                await asyncio.sleep(delay)

    def accept_review(self, result, snapshot, goal_id=None):
        current = self.latest or snapshot
        if goal_id and goal_id not in (current.completedGoalIds or []):
            self.prepared_review = (result, snapshot, goal_id)
            self.event('planner_prepared', {
                'goalId': goal_id,
                'plan': result['plan'].wire(),
                'latencyMs': result['latencyMs'],
            })
            return
        self.install_goal_review(result, snapshot, current, goal_id)

    def install_goal_review(self, result, snapshot, current, goal_id):
        if goal_id:
            self.reviewed_goals.add(goal_id)
        self.pending_review_goal = None
        self.plan = result['plan']
        self.plan_version += 1
        self.progress_at, self.progress_position = (current.simTime, current.position[:])
        self.event('planner_result', {**{k: v for k, v in result.items() if k != 'plan'}, 'plan': self.plan.wire()})
        if goal_id:
            self.event('relay_handoff_release', {
                'goalId': goal_id,
                'requestPosition': snapshot.position,
                'releasePosition': current.position,
                'releaseEnergy': current.energy,
                'releaseExecutionSeconds': current.simTime,
                'waitingSecondsTotal': current.relayHandoffWaitSeconds or 0,
            })
        self.send({
            'type': 'plan',
            'runId': self.id,
            'plan': self.plan.wire(),
            'version': self.plan_version,
            'latencyMs': result['latencyMs'],
            'model': result['model'],
        })

    async def request_plan(self, o, reason, generation, relay=None):
        self.send({'type': 'agent_status', 'state': 'Strategist reviewing progress' if self.plan else 'Strategist creating route'})
        try:
            r, o = await self.model_call('Planner', o, self.plan, None, generation, reason, relay)
            if self.stopped or generation != self.generation:
                return
            self.accept_review(r, o, relay)
        except asyncio.CancelledError:
            pass
        except Exception as error:
            if not self.stopped and generation == self.generation:
                self.report_error(error, 'Planner')

    async def request_decision(self, o, facts, plan, generation):
        try:
            r, o = await self.model_call('Decision', o, plan, facts, generation)
            if self.stopped or generation != self.generation:
                return
            self.latencies.append(r['latencyMs'])
            age = now_ms() - o.observedAt
            expired = age > self.config.ACTION_MAX_AGE_MS or self.plan_version != o.planVersion or objective_key(self.latest) != objective_key(o)
            result = {k: r[k] for k in ('action', 'probabilities', 'confidence', 'latencyMs', 'usage', 'model')}
            self.event('decision_result', {
                **result,
                'selection': 'provider categorical choice using task facts, model guidance and action mechanics',
                'ageMs': age,
                'expired': expired,
            })
            if expired:
                self.stale += 1
                self.send({'type': 'agent_status', 'state': 'Expired decision discarded; previous accepted maneuver continues on its goal'})
                return
            self.send({
                'type': 'action',
                'runId': self.id,
                'seq': o.seq,
                'planVersion': o.planVersion,
                'legIndex': o.legIndex,
                'objectiveKey': objective_key(o),
                'continuity': 'goal',
                'action': r['action'],
                'validUntil': o.observedAt + self.config.ACTION_MAX_AGE_MS,
                'probabilities': r['probabilities'],
                'confidence': r['confidence'],
                'latencyMs': r['latencyMs'],
                'calls': self.calls,
                'model': r['model'],
            })
        except asyncio.CancelledError:
            pass
        except Exception as error:
            if not self.stopped and generation == self.generation:
                self.report_error(error, 'Decision')

    def report_error(self, error, where):
        outcome = 'api_error' if isinstance(error, APIError) else 'implementation_error'
        detail = {
            'where': where,
            'message': str(error),
            'errorType': type(error).__name__,
        }
        if outcome == 'implementation_error':
            detail['frames'] = [{
                'file': frame.filename,
                'line': frame.lineno,
                'function': frame.name,
            } for frame in traceback.extract_tb(error.__traceback__)]
        self.event(outcome, detail)
        self.send({'type': 'agent_status', 'state': f'{where}: {error} — experiment stopped'})
        self.finish(outcome)

    def finish(self, reason):
        if self.stopped:
            return
        self.stopped = True
        self.cancel_requests()
        latencies = sorted(self.latencies)
        result = {"outcome": reason, "final": self.latest.wire() if self.latest else None, "calls": self.calls, "retryAttempts": self.retry_attempts,
                  "expiredDecisions": self.stale,
                  "decisionLatencyP50": latencies[len(latencies) // 2] if latencies else None,
                  "decisionLatencyP95": latencies[math.floor(len(latencies) * .95)] if latencies else None}
        # Let cancelled transports emit their final diagnostics before closing
        # the recorder. finish() may itself run inside one of these tasks.
        pending = list(self._tasks)
        async def finalize():
            if pending:
                await asyncio.gather(*pending, return_exceptions=True)
            self.recorder.finish(result)
            self.send({"type": "finished", "runId": self.id, "summary": self.recorder.summary})
        self._finalizer = asyncio.create_task(finalize())

    async def drain(self):
        if self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)
        if self._finalizer:
            await self._finalizer
