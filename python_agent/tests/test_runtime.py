import asyncio
from pathlib import Path
import tempfile
import unittest

from vector_agent.protocol import EngineFacts
from vector_agent.provider import APIError
from vector_agent.recorder import Recorder, now_ms
from vector_agent.runtime import AgentSession
from support import fixture, test_config


class FakeAPI:
    def __init__(self, plan):
        self.value = plan
        self.plans = self.decisions = 0
        self.gate = None
        self.error = None

    async def plan(self, *args):
        self.plans += 1
        if self.gate:
            await self.gate.wait()
        if self.error:
            raise self.error
        return {"plan": self.value, "latencyMs": 1, "usage": {}, "model": "test"}

    async def decide(self, *args):
        self.decisions += 1
        if self.gate:
            await self.gate.wait()
        return {"action": "drive", "probabilities": {"drive": 1}, "confidence": 1, "latencyMs": 1, "usage": {}, "model": "test"}


class RuntimeContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.o, self.plan, self.facts = fixture()
        self.api = FakeAPI(self.plan)
        self.folder = tempfile.TemporaryDirectory()
        self.messages = []
        self.session = AgentSession("runtime", "openrouter", "typesafe/jev-1.14", test_config(), self.api,
                                    Recorder("runtime", Path(self.folder.name), {}), self.messages.append)

    async def asyncTearDown(self):
        self.session.finish("test")
        await self.session.drain()
        self.folder.cleanup()

    def observe(self, **changes):
        seq = self.session.latest.seq + 1 if self.session.latest else 1
        self.session.observe(self.o.model_copy(update={"observedAt": now_ms(), "seq": seq, **changes}), self.facts)

    async def tick(self):
        await asyncio.sleep(.01)

    async def test_expired_decisions_are_logged_but_not_applied(self):
        self.session.config = test_config(ACTION_MAX_AGE_MS=100)
        self.observe()
        await self.tick()
        self.observe(planVersion=1, observedAt=now_ms()-200)
        await self.tick()
        self.assertEqual(self.session.stale, 1)
        self.assertFalse(any(m["type"] == "action" for m in self.messages))

    async def test_pause_cancels_work_without_applying_late_plan(self):
        self.api.gate = asyncio.Event()
        self.observe()
        await self.tick()
        self.observe(paused=True)
        self.api.gate.set()
        await self.tick()
        self.assertFalse(any(m["type"] == "plan" for m in self.messages))

    async def test_resume_restarts_initial_planning_with_frozen_mission_clock(self):
        self.api.gate = asyncio.Event()
        self.observe(simTime=0, setupPending=True)
        await self.tick()
        self.observe(paused=True, simTime=0, setupPending=True)
        await self.tick()
        self.api.gate.set()
        self.observe(paused=False, simTime=0, setupPending=True)
        await self.tick()
        self.assertEqual(self.api.plans, 2)
        self.assertEqual(sum(m["type"] == "plan" for m in self.messages), 1)

    async def test_initial_wait_is_not_immediate_no_progress_replan(self):
        self.api.gate = asyncio.Event()
        self.observe()
        await self.tick()
        self.observe(simTime=25)
        self.api.gate.set()
        await self.tick()
        self.observe(simTime=25.1, planVersion=1)
        await self.tick()
        self.assertEqual(self.api.plans, 1)







    async def test_error_records_usage_finishes_once_and_never_retries(self):
        self.api.error = APIError("Planner response incomplete", {"input_tokens": 10, "output_tokens": 8192, "cost": .004})
        self.observe()
        await self.tick()
        self.observe(simTime=20)
        await self.session.drain()
        self.assertTrue(self.session.stopped)
        self.assertEqual(self.api.plans, 1)
        self.assertEqual(sum(m["type"] == "finished" for m in self.messages), 1)

    async def test_programming_error_is_not_reported_as_a_provider_failure_or_retried(self):
        self.api.error = IndexError("fixture programming error")
        self.observe()
        await self.session.drain()
        self.assertEqual(self.api.plans, 1)
        self.assertEqual(self.session.recorder.summary["outcome"], "implementation_error")

    async def test_call_budget_reserves_one_initial_call_before_dispatch(self):
        self.session.config = test_config(MAX_API_CALLS_PER_RUN=1)
        self.observe()
        await self.tick()
        self.assertEqual(self.api.plans, 1)
        self.assertEqual(self.session.calls, 1)

    async def test_call_quota_waits_for_final_request_then_ends_experiment_explicitly(self):
        self.session.config = test_config(MAX_API_CALLS_PER_RUN=1)
        self.api.gate = asyncio.Event()
        self.observe()
        await self.tick()
        self.observe()
        self.assertFalse(self.session.stopped)
        self.api.gate.set()
        await self.tick()
        self.observe(planVersion=1)
        await self.session.drain()
        self.assertEqual(self.session.recorder.summary["outcome"], "api_budget_exhausted")
        self.assertEqual(self.api.plans, 1)
        self.assertEqual(self.api.decisions, 0)


    async def test_goal_change_cancels_inflight_decision_and_requests_the_new_goal(self):
        self.observe()
        await self.tick()
        self.api.gate = asyncio.Event()
        self.observe(planVersion=1, waypointIndex=0)
        await self.tick()
        self.observe(planVersion=1, goal=self.plan.goals[1])
        self.api.gate.set()
        await self.tick()
        self.assertEqual(self.api.decisions, 2)
        actions=[m for m in self.messages if m["type"]=="action"]
        self.assertEqual(len(actions), 1)
        self.assertIn(self.plan.goals[1].id,actions[0]["objectiveKey"])

    async def test_takeover_cancels_and_stops_model_requests(self):
        self.observe()
        await self.tick()
        self.session.takeover()
        self.observe(planVersion=1)
        await self.tick()
        self.assertEqual(self.api.decisions, 0)

    async def test_one_retry_uses_latest_state_counts_calls_and_preserves_failure_cost(self):
        gate = asyncio.Event()
        received = []
        self.session.config = test_config(API_RETRY_DELAY_MS=0)
        async def plan(o, *args):
            received.append(o.seq)
            if len(received) == 1:
                await gate.wait()
                raise APIError("temporary", {"cost": .001}, retryable=True, code="http_503")
            return {"plan": self.plan, "latencyMs": 1, "usage": {"cost": .002}, "model": "test"}
        self.api.plan = plan
        self.observe()
        await self.tick()
        self.observe(simTime=.2, energy=97)
        gate.set()
        await self.tick()
        self.assertEqual(received, [1, 2])
        self.assertEqual(self.session.calls, 2)
        self.assertEqual(self.session.retry_attempts, 1)
        self.assertFalse(self.session.stopped)

    async def test_retry_is_bounded_and_never_bypasses_quota_or_retry_after(self):
        self.session.finish("replace unused test session")
        await self.session.drain()
        for budget, retry_after, expected in [(5, .001, 2), (1, None, 1)]:
            self.api.plans = 0
            self.session = AgentSession("runtime", "openrouter", "typesafe/jev-1.14",
                test_config(API_RETRY_DELAY_MS=0, MAX_API_CALLS_PER_RUN=budget), self.api,
                Recorder(f"bounded-{budget}-{retry_after}", Path(self.folder.name), {}), self.messages.append)
            self.api.error = APIError("temporary", retryable=True, retry_after=retry_after)
            self.observe()
            await self.session.drain()
            self.assertEqual(self.api.plans, expected)
            self.assertEqual(self.session.calls, expected)
            self.assertTrue(self.session.stopped)

    async def test_decision_retry_uses_new_observation_and_engine_facts(self):
        self.session.config = test_config(API_RETRY_DELAY_MS=0)
        self.observe()
        await self.tick()
        gate = asyncio.Event()
        received = []
        original = self.api.decide
        async def decide(o, plan, model, facts, *budget):
            received.append((o.seq, o.energy, facts))
            if len(received) == 1:
                await gate.wait()
                raise APIError("temporary", retryable=True)
            return await original(o, plan, model, facts)
        self.api.decide = decide
        self.observe(planVersion=1)
        await self.tick()
        self.observe(planVersion=1, energy=93, simTime=.2)
        gate.set()
        await self.tick()
        self.assertEqual([r[:2] for r in received], [(2, 100), (3, 93)])
        action = next(m for m in self.messages if m["type"] == "action")
        self.assertEqual(action["seq"], 3)
        self.assertEqual(self.session.calls, 3)  # plan + two decision attempts

    async def test_pause_cancels_retry_backoff(self):
        self.api.error = APIError("temporary", retryable=True)
        self.observe()
        await self.tick()
        self.observe(paused=True)
        await self.tick()
        self.assertEqual(self.api.plans, 1)
        self.assertEqual(self.session.retry_attempts, 0)



    async def test_finish_flushes_cancelled_transport_diagnostics_before_summary(self):
        async def plan(*args):
            try:
                await asyncio.Future()
            finally:
                self.session.event("transport_test_cancelled", {"outcome": "cancelled"})
        self.api.plan = plan
        self.observe()
        await self.tick()
        self.session.finish("test stop")
        await self.session.drain()
        import json
        events = [json.loads(line) for line in (Path(self.folder.name) / "runtime.jsonl").read_text().splitlines()]
        kinds = [e["type"] for e in events]
        self.assertLess(kinds.index("transport_test_cancelled"), kinds.index("summary"))
