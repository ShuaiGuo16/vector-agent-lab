import asyncio
import json
from pathlib import Path
import tempfile
import unittest

import httpx

from support import goal_fixture, test_config
from vector_agent.provider import OpenRouter
from vector_agent.recorder import Recorder, now_ms
from vector_agent.runtime import AgentSession


class AttemptAccounting(unittest.IsolatedAsyncioTestCase):
    async def exercise(self, handler, *, budget=1000, cancel=False):
        observation, plan, facts = goal_fixture()
        with tempfile.TemporaryDirectory() as folder:
            recorder = Recorder('attempt', Path(folder), {})
            config = test_config(PLANNER_TIMEOUT_MS=budget, API_RETRY_DELAY_MS=0)
            async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
                api = OpenRouter(config, lambda value: recorder.event('api_request_payload', value), client)
                messages = []
                session = AgentSession('attempt', 'openrouter', config.DECISION_MODEL,
                                       config, api, recorder, messages.append)
                session.observe(observation.model_copy(update={'runId':'attempt','observedAt':now_ms()}), facts)
                if cancel:
                    await asyncio.sleep(.01)
                    session.finish('paused')
                await session.drain()
                if not session.stopped:
                    session.finish('test')
                    await session.drain()
                events = [json.loads(line) for line in (Path(folder)/'attempt.jsonl').read_text().splitlines()]
                return recorder.summary, events, messages

    async def test_failed_stream_usage_and_successful_retry_are_counted_once(self):
        _, plan, _ = goal_fixture()
        attempts = 0
        async def handler(request):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                terminal = {'type':'response.failed','response':{'status':'failed','model':'openai/gpt-6-luna',
                    'error':{'code':'server_error'},'usage':{'input_tokens':100,'output_tokens':10,'cost':.003}}}
            else:
                terminal = {'type':'response.completed','response':{'status':'completed','model':'openai/gpt-6-luna',
                    'output_text':json.dumps({'disposition':'revise','goals':plan.wire()['goals']}),
                    'usage':{'input_tokens':200,'output_tokens':20,'cost':.004}}}
            return httpx.Response(200, headers={'content-type':'text/event-stream'},
                                  content=('data: '+json.dumps(terminal)+'\n\n').encode())
        summary, events, _ = await self.exercise(handler)
        self.assertEqual(attempts, 2)
        self.assertAlmostEqual(summary['apiCost']['openrouterReportedUSD'], .007)
        self.assertAlmostEqual(summary['reportedCostUSD'], .007)
        self.assertEqual(summary['inputTokens'], 300)
        self.assertEqual(summary['outputTokens'], 30)
        self.assertEqual(summary['apiCost']['requestsWithoutReturnedUsage'], 0)
        accounting = [e['data'] for e in events if e['data'].get('kind')=='attempt_accounting']
        self.assertEqual(len({e['requestId'] for e in accounting}), 2)
        self.assertEqual([e['outcome'] for e in accounting], ['api_error','completed'])

    async def test_timeout_retry_gets_an_independent_full_budget(self):
        _, plan, _ = goal_fixture()
        attempts = 0
        async def handler(request):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                await asyncio.sleep(1)
            await asyncio.sleep(.02)
            return httpx.Response(200,json={'status':'completed',
                'output_text':json.dumps({'disposition':'revise','goals':plan.wire()['goals']})})
        summary, events, messages = await self.exercise(handler, budget=250)
        diagnostics = [e['data'] for e in events if e['data'].get('kind')=='transport_diagnostics']
        self.assertEqual([d['outcome'] for d in diagnostics], ['timeout','completed'])
        self.assertEqual([d['attemptBudgetMs'] for d in diagnostics], [250,250])
        self.assertEqual(summary['retryAttempts'], 1)
        self.assertTrue(any(m['type']=='plan' for m in messages))

    async def test_two_timeouts_stop_and_cancellation_does_not_retry(self):
        async def handler(request):
            await asyncio.sleep(1)
        summary, events, _ = await self.exercise(handler, budget=25)
        self.assertEqual(summary['outcome'], 'api_error')
        self.assertEqual(summary['calls'], 2)
        self.assertEqual([e['data']['outcome'] for e in events if e['data'].get('kind')=='transport_diagnostics'], ['timeout','timeout'])
        summary, events, _ = await self.exercise(handler, cancel=True)
        self.assertEqual(summary['retryAttempts'], 0)
        self.assertEqual([e['data']['outcome'] for e in events if e['data'].get('kind')=='transport_diagnostics'], ['cancelled'])
        self.assertEqual(summary['apiCost']['requestsWithoutReturnedUsage'], 1)

    async def test_capacity_stream_error_uses_the_existing_single_retry(self):
        _, plan, _ = goal_fixture()
        attempts = 0
        async def handler(request):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                event = {'type':'error','code':'no_capacity','message':'No capacity available'}
            else:
                event = {'type':'response.completed','response':{'status':'completed',
                    'output_text':json.dumps({'disposition':'revise','goals':plan.wire()['goals']})}}
            return httpx.Response(200,headers={'content-type':'text/event-stream'},
                                  content=('data: '+json.dumps(event)+'\n\n').encode())
        summary, events, messages = await self.exercise(handler)
        self.assertEqual(attempts, 2)
        self.assertEqual(summary['retryAttempts'], 1)
        self.assertTrue(any(m['type']=='plan' for m in messages))
        failure=next(e['data'] for e in events if e['type']=='api_attempt_failed')
        self.assertEqual(failure['code'], 'no_capacity')
        self.assertTrue(failure['willRetry'])
