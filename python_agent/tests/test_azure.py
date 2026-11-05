import json
import unittest

import httpx

from vector_agent.azure import Azure
from vector_agent.context import CONTRACT
from vector_agent.goal_context import MECHANICS as ACTION_MECHANICS, planner_input
from vector_agent.provider import response_context
from vector_agent.protocol import MODEL_ACTIONS as ACTIONS
from vector_agent.response_schema import formats
from vector_agent.model_api import ModelAPI
from support import goal_fixture as fixture, test_config


class AzureContracts(unittest.IsolatedAsyncioTestCase):
    async def test_sol_initial_then_luna_reviews_keep_same_context_schema_and_latest_plan(self):
        o, plan, facts = fixture()
        requests = []
        config = test_config(MODEL_PROVIDER="azure", DECISION_PROVIDER="openrouter",
            REVIEW_PROVIDER="openrouter", REVIEW_MODEL="openai/gpt-6-luna",
            AZURE_ENDPOINT="https://fixture.services.ai.azure.com", AZURE_API_KEY="azure-test-secret",
            AZURE_LLM_DEPLOYMENT="gpt-6.1-sol", PLANNER_MODEL="gpt-6.1-sol")
        async def handler(request):
            body = json.loads(request.content)
            requests.append((request, body))
            if request.url.path.endswith("/responses"):
                return httpx.Response(200, json={"status": "completed", "model": body["model"],
                    "output_text": json.dumps({"disposition":"revise","goals":[{**g,"guidance":[f"Guidance {len(requests)}"]} for g in plan.wire()["goals"]]})})
            return httpx.Response(200, json={"answers": {"maneuver": {"type": "choice", "choice": "hold",
                "probabilities": {a: int(a == "hold") for a in ACTIONS}, "confidence": 1}}})
        history = {"samples": [{"elapsedExecutionSeconds": 1}], "missionEvents": []}
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            api = ModelAPI(config, lambda event: None, client)
            initial = await api.plan(o)
            revised = await api.plan(o, initial["plan"], "Review", execution_history=history)
            await api.plan(o, revised["plan"], "Review again", execution_history=history)
            await api.decide(o, revised["plan"], "typesafe/jev-1.14", facts)
        self.assertEqual([r.url.host for r, _ in requests], ["fixture.services.ai.azure.com"] + ["openrouter.ai"] * 3)
        self.assertEqual([b["model"] for _, b in requests], ["gpt-6.1-sol", "openai/gpt-6-luna", "openai/gpt-6-luna", "typesafe/jev-1.14"])
        self.assertEqual(requests[0][1]["instructions"], requests[1][1]["instructions"])
        self.assertEqual(requests[0][1]["text"]["format"], requests[1][1]["text"]["format"])
        review = response_context(requests[1][1])
        self.assertEqual(review["review"]["installedPlan"], initial["plan"].wire())
        self.assertEqual(review["review"]["installedPlan"]["goals"][0]["guidance"], initial["plan"].goals[0].guidance)
        self.assertEqual(review["executionHistory"], history)
        self.assertEqual(response_context(requests[2][1])["review"]["installedPlan"], revised["plan"].wire())
        for _, body in requests[:3]:
            self.assertEqual(body["reasoning"]["effort"], "medium")
        self.assertEqual(config.public()["reviewModel"], "openai/gpt-6-luna")
        self.assertNotIn("api-key", requests[1][0].headers)

    async def test_cache_prefix_identical_across_initial_and_moving_review(self):
        o, plan, facts = fixture()
        async with httpx.AsyncClient() as client:
            api = Azure(test_config(), lambda event: None, client)
            initial = api.route_body(o)
            moved = o.model_copy(update={"position": [10, 11, 12], "energy": 42, "simTime": 37})
            history = {"samples": [{"elapsedExecutionSeconds": 36}], "missionEvents": []}
            review = api.route_body(moved, plan, "Review", execution_history=history)
        self.assertEqual(initial["instructions"], review["instructions"])
        self.assertEqual(initial["instructions"], CONTRACT["goalPlannerInstructions"])
        self.assertEqual(initial["input"][0]["content"][0], review["input"][0]["content"][0])
        self.assertEqual(initial["prompt_cache_options"], {"mode": "explicit", "ttl": "30m"})
        self.assertNotIn("prompt_cache_breakpoint", review["input"][0]["content"][1])
        stable = json.loads(review["input"][0]["content"][0]["text"])
        self.assertFalse({"vehicle", "executionHistory", "mission", "review"} & stable.keys())
        full = response_context(review)
        expected = planner_input(moved, plan, "Review", history)
        for key in expected:
            self.assertEqual(full[key], expected[key])
        self.assertEqual(full["purpose"], "review route and guidance")

    async def test_hybrid_uses_azure_planner_and_openrouter_decision_without_shared_auth(self):
        o, plan, facts = fixture()
        requests, audit = [], []
        config = test_config(MODEL_PROVIDER="azure", DECISION_PROVIDER="openrouter", AZURE_ENDPOINT="https://fixture.services.ai.azure.com",
                             AZURE_API_KEY="azure-test-secret", AZURE_LLM_DEPLOYMENT="sol-deployment")
        async def handler(request):
            body = json.loads(request.content)
            requests.append((request, body))
            if request.url.path.endswith("/responses"):
                return httpx.Response(200, json={"status": "completed", "model": "gpt-6.1-sol", "output_text": json.dumps({"disposition":"revise","goals":plan.wire()["goals"]})})
            return httpx.Response(200, json={"model": "typesafe/jev-1.14", "answers": {"maneuver": {"type": "choice", "choice": "hold", "probabilities": {a: int(a == "hold") for a in ACTIONS}, "confidence": 1}}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            api = ModelAPI(config, audit.append, client)
            result = await api.plan(o)
            decision = await api.decide(o, result["plan"], "typesafe/jev-1.14", facts)
        self.assertEqual(decision["action"], "hold")  # Routing never replaces a choice.
        self.assertEqual(requests[0][0].url.host, "fixture.services.ai.azure.com")
        self.assertEqual(requests[1][0].url.host, "openrouter.ai")
        self.assertEqual(requests[0][0].headers["api-key"], "azure-test-secret")
        self.assertNotIn("authorization", requests[0][0].headers)
        self.assertEqual(requests[1][0].headers["authorization"], "Bearer test-only-no-real-key")
        self.assertNotIn("api-key", requests[1][0].headers)
        self.assertEqual(requests[0][1]["model"], "sol-deployment")
        self.assertEqual(requests[1][1]["model"], "typesafe/jev-1.14")
        self.assertEqual(config.public()["decisionProvider"], "openrouter")
        self.assertEqual(requests[1][1]["questions"]["maneuver"]["criteria"], ACTION_MECHANICS)
        self.assertNotIn("azure-test-secret", json.dumps(audit))

    async def test_shared_resource_key_distinct_routes_deployments_and_no_router_parameters(self):
        o, plan, facts = fixture()
        requests, audit = [], []
        config = test_config(MODEL_PROVIDER="azure", AZURE_ENDPOINT="https://fixture.services.ai.azure.com/",
                             AZURE_API_KEY="azure-test-secret", AZURE_LLM_DEPLOYMENT="sol-deployment", AZURE_DECISION_DEPLOYMENT="decision-deployment")
        async def handler(request):
            body = json.loads(request.content)
            requests.append((request, body))
            if request.url.path.endswith("/responses"):
                output = {"disposition":"revise","goals":plan.wire()["goals"]}
                return httpx.Response(200, json={"status": "completed", "model": "gpt-6.1-sol", "output_text": json.dumps(output)})
            return httpx.Response(200, json={"model": "microsoft-decision-1", "answers": {"maneuver": {"type": "choice", "choice": "climb", "probabilities": {a: int(a == "climb") for a in ACTIONS}, "confidence": 1}}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            api = Azure(config, audit.append, client)
            result = await api.plan(o)
            decision = await api.decide(o, result["plan"], "microsoft/microsoft-decision-1", facts)
        self.assertEqual(decision["action"], "climb")
        self.assertEqual([r.url.path for r, _ in requests], ["/openai/v1/responses", "/providers/microsoft/v1/systemone"])
        self.assertEqual([b["model"] for _, b in requests], ["sol-deployment", "decision-deployment"])
        self.assertNotIn("provider", requests[0][1])
        self.assertEqual(requests[0][1]["text"]["format"], formats()["goal_strategy"])
        for request, _ in requests:
            self.assertEqual(request.headers["api-key"], "azure-test-secret")
            self.assertNotIn("authorization", request.headers)
        self.assertTrue(config.public()["configured"])
        self.assertEqual(config.public()["provider"], "azure")
        self.assertNotIn("azure-test-secret", json.dumps([config.audit(), config.public(), audit]))
        self.assertNotIn("AZURE_API_KEY", config.audit())

    async def test_native_schema_preserves_descriptions_without_ref_siblings(self):
        def visit(node):
            if isinstance(node, dict):
                if "$ref" in node:
                    self.assertEqual(set(node), {"$ref"})
                for child in node.values():
                    visit(child)
            elif isinstance(node, list):
                for child in node:
                    visit(child)
        for format in formats().values():
            visit(format["schema"])
        root = formats()["goal_strategy"]["schema"]
        self.assertTrue(root["properties"]["goals"]["description"])
        self.assertTrue(root["properties"]["disposition"]["description"])
