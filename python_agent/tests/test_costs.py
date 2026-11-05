import json
from pathlib import Path
import tempfile
import unittest

from vector_agent.costs import CostLedger
from vector_agent.recorder import Recorder


class CostAccounting(unittest.TestCase):
    def test_luna_review_cost_is_separate_from_jev_control(self):
        ledger = CostLedger()
        for purpose, path, model, cost in [("review route and guidance", "/v1/responses", "openai/gpt-6-luna", .002),
                                            (None, "/alpha/decisions", "typesafe/jev-1.14", .03)]:
            ledger.record({"apiProvider": "OpenRouter", "purpose": purpose, "path": path, "model": model, "usage": {"cost": cost}})
        self.assertAlmostEqual(ledger.summary()["openrouterReportedUSD"], .032)
        self.assertEqual(ledger.summary()["byRole"]["planningReview"]["openrouterReportedUSD"], .002)
        self.assertEqual(ledger.summary()["byRole"]["decisionControl"]["openrouterReportedUSD"], .03)

    def test_exclusive_input_categories_and_reasoning_not_added_twice(self):
        ledger = CostLedger()
        ledger.record({"apiProvider": "Azure", "model": "gpt-6.1-sol", "usage": {
            "input_tokens": 1000, "input_tokens_details": {"cached_tokens": 600, "cache_write_tokens": 300},
            "output_tokens": 200, "output_tokens_details": {"reasoning_tokens": 150}}})
        ledger.record({"apiProvider": "OpenRouter", "model": "typesafe/jev-1.14", "usage": {"cost": .03}})
        self.assertAlmostEqual(ledger.summary()["combinedEstimateUSD"], .03301)
        self.assertEqual(ledger.summary()["azureTokens"]["ordinaryInput"], 100)

    def test_unpriced_provider_usage_is_not_reported_as_free(self):
        ledger = CostLedger()
        ledger.record({"apiProvider": "Azure", "model": "Decision-1", "usage": {"input_tokens": 12}})
        self.assertIsNone(ledger.summary()["combinedEstimateUSD"])
        self.assertEqual(ledger.summary()["unpricedResponsesWithUsage"], 1)

    def test_recorder_prices_discarded_response_once_and_persists_cost(self):
        with tempfile.TemporaryDirectory() as folder:
            recorder = Recorder("fixture", Path(folder), {})
            recorder.event("api_request_payload", {"apiProvider": "Azure", "path": "/v1/responses", "body": {}})
            usage = {"input_tokens": 7276, "input_tokens_details": {"cache_write_tokens": 7273, "cached_tokens": 0}, "output_tokens": 1350}
            recorder.event("api_request_payload", {"kind": "response", "apiProvider": "Azure", "model": "gpt-6.1-sol", "usage": usage})
            recorder.event("api_request_payload", {"kind":"attempt_accounting", "apiProvider":"Azure", "model":"gpt-6.1-sol", "usage":usage})
            recorder.event("planner_discarded", {"usage": usage})
            recorder.event("api_request_payload", {"apiProvider": "Azure", "path": "/v1/responses", "body": {}})
            recorder.event("api_request_payload", {"kind":"attempt_accounting", "usage":None})
            recorder.finish({"outcome": "success"})
            summary = json.loads((Path(folder) / "fixture.summary.json").read_text())
            self.assertEqual(summary["apiCost"]["azureResponsesWithUsage"], 1)
            self.assertEqual(summary["apiCost"]["requestsWithoutReturnedUsage"], 1)
            self.assertAlmostEqual(summary["apiCost"]["combinedEstimateUSD"], .0316885)
