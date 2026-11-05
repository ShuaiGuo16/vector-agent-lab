import json
import shutil
import subprocess
import unittest

from support import fixture, goal_fixture
from vector_agent.protocol import Goal
from vector_agent.config import ROOT
from vector_agent.goal_context import planner_input
from vector_agent.history import ExecutionHistory


class HistoryContext(unittest.TestCase):
    def test_explicit_goal_history_preserves_center_height_identity_and_wait_kind(self):
        o,p,_=goal_fixture()
        h=ExecutionHistory()
        g=p.goals[0].model_copy(update={"id":"transit","position":[-70,34,-58]})
        h.observe(o.model_copy(update={"goal":g,"simTime":1,"setupPending":False}))
        sample=h.snapshot()['samples'][-1]
        self.assertEqual(sample['goalPosition'],[-70,34,-58])
        self.assertEqual(sample['goalId'],'transit')
        self.assertEqual(sample['goalKind'],'fly')
        self.assertNotIn('objectivePosition',sample)
        wait=Goal(id='roof:review',kind='wait_review',target='relay-2',position=[-70,29.6,-58],speed=4,guidance=[],reviewAfter=False)
        h.observe(o.model_copy(update={"goal":wait,"simTime":2,"setupPending":False}))
        self.assertEqual(h.snapshot()['samples'][-1]['stationSurfaceHeight'],29)
        self.assertEqual(h.snapshot()['samples'][-1]['goalKind'],'wait_review')
        self.assertEqual(h.snapshot()['missionEvents'][-1]['type'],'goalObserved')

    def test_measured_history_matches_reference_and_preserves_events_beyond_sample_window(self):
        original, plan, _ = fixture()
        history = ExecutionHistory()
        observations = []
        for t in range(81):
            o = original.model_copy(update={"seq": t + 1, "simTime": t / 2,
                "setupPending": t < 2, "position": [35, .64, 150 - t],
                "lastAppliedManeuver": "drive" if t < 30 else "hold",
                "departureComplete": t >= 10, "completed": [] if t < 20 else ["relay-1"],
                "paused": t == 3, "planVersion": 1 if t < 25 else 2})
            history.observe(o)
            observations.append(o.wire())
        result = history.snapshot()
        self.assertEqual(result["sampleIntervalSeconds"], 1)
        self.assertEqual(result["recentWindowSeconds"], 30)
        self.assertTrue(all(s["elapsedExecutionSeconds"] >= 10 for s in result["samples"]))
        self.assertEqual(result["samples"][-1]["appliedManeuver"], "hold")
        self.assertTrue(any(e["type"] == "departureCompleted" and e["elapsedExecutionSeconds"] == 5 for e in result["missionEvents"]))
        context = planner_input(o, plan, "Review", result)
        self.assertEqual(context["executionHistory"], result)
        self.assertNotIn("executionHistory", planner_input(o))
    def test_request_history_is_a_snapshot_while_execution_continues(self):
        o, _, _ = fixture()
        history = ExecutionHistory()
        history.observe(o.model_copy(update={"simTime": 1, "setupPending": False}))
        request_context = history.snapshot()
        history.observe(o.model_copy(update={"simTime": 2, "completed": ["relay-1"]}))
        self.assertEqual(len(request_context["samples"]), 1)
        self.assertFalse(any(e["type"] == "relayActivated" for e in request_context["missionEvents"]))
