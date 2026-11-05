import asyncio
import json
import unittest
import httpx
from vector_agent.provider import OpenRouter, APIError
from vector_agent.protocol import MODEL_ACTIONS
from vector_agent.response_schema import GoalStrategy, formats
from vector_agent.goal_context import MECHANICS
from support import goal_fixture, test_config

class ProviderContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.o,self.plan,self.facts=goal_fixture()
        self.requests,self.audit=[],[]
        self.output={"disposition":"revise","goals":self.plan.wire()["goals"]}

    async def handler(self,request):
        body=json.loads(request.content);self.requests.append((request.url.path,body))
        if "input" in body:
            return httpx.Response(200,json={"status":"completed","model":body["model"],"output_text":json.dumps(self.output),"usage":{"input_tokens":5,"output_tokens":3,"cost":.001}})
        return httpx.Response(200,json={"answers":{"maneuver":{"type":"choice","choice":"climb","probabilities":{a:int(a=="climb") for a in MODEL_ACTIONS},"confidence":1}},"usage":{"input_tokens":2}})

    async def test_initial_and_review_share_strict_schema_local_guidance_and_keep_path(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.handler)) as client:
            api=OpenRouter(test_config(),self.audit.append,client)
            initial=await api.plan(self.o)
            self.output["goals"][0]["guidance"]=["Mock local trade-off"]
            revised=await api.plan(self.o,initial["plan"],"Review",execution_history={"samples":[]})
            self.assertEqual(revised["plan"].goals[0].guidance,["Mock local trade-off"])
            choice=await api.decide(self.o,revised["plan"],"typesafe/jev-1.14",self.facts)
            self.assertEqual(choice["action"],"climb")
            self.assertEqual(self.requests[-1][1]["questions"]["maneuver"]["criteria"],MECHANICS)
            self.output={"disposition":"keep","goals":[]}
            kept=await api.plan(self.o,revised["plan"],"Review")
            self.assertEqual(kept["plan"],revised["plan"])
        for _,body in (self.requests[0],self.requests[1],self.requests[3]):
            self.assertEqual(body["text"]["format"],formats()["goal_strategy"])
            self.assertTrue(body["provider"]["require_parameters"])
        self.assertEqual(self.requests[0][1]["instructions"],self.requests[1][1]["instructions"])
        self.assertNotIn("test-only-no-real-key",json.dumps(self.audit))

    async def test_schema_is_closed_operational_only_without_cosmetic_caps(self):
        schema=GoalStrategy.model_json_schema()
        self.assertEqual(set(schema["properties"]),{"disposition","goals"})
        for node in [schema,*schema["$defs"].values()]:
            if node.get("type")=="object":
                self.assertFalse(node["additionalProperties"])
                self.assertEqual(set(node["required"]),set(node["properties"]))
                self.assertTrue(all(f.get("description") for f in node["properties"].values()))
        self.assertNotIn("maxLength",json.dumps(schema))
        self.output["goals"][0]["guidance"]=["x"*5000]
        self.output["goals"][0]["position"]=[0,-10,0]
        GoalStrategy.model_validate(self.output)
        with self.assertRaises(ValueError):GoalStrategy.model_validate({**self.output,"summary":"Unrequested"})

    async def test_no_strategy_grading_or_action_repair(self):
        # An energetically poor path and depot before unfinished relays still pass.
        self.output["goals"]=list(reversed(self.output["goals"]))
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.handler)) as client:
            r=await OpenRouter(test_config(),self.audit.append,client).plan(self.o)
        self.assertEqual(r["plan"].goals[0].kind,"depot")

    async def test_self_contained_generic_roles_and_six_distinct_choices(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.handler)) as client:
            api=OpenRouter(test_config(),self.audit.append,client)
            await api.plan(self.o)
            await api.decide(self.o,self.plan,"typesafe/jev-1.14",self.facts)
        for text in (self.requests[0][1]["instructions"],self.requests[1][1]["questions"]["maneuver"]["instructions"]):
            for role in ("route planner","decision model","engine"):self.assertIn(role,text)
            self.assertNotRegex(text,r"\b(?:Sol|Jev|Luna)\b")
        self.assertNotIn("brake",self.requests[1][1]["questions"]["maneuver"]["criteria"])

    async def test_real_request_carries_cadence_resource_facts_and_review_application(self):
        async with httpx.AsyncClient(transport=httpx.MockTransport(self.handler)) as client:
            api=OpenRouter(test_config(DECISION_INTERVAL_MS=4000,ACTION_MAX_AGE_MS=2250),self.audit.append,client)
            application={"mode":"after_goal_completion","completionGoalId":"roof"}
            await api.plan(self.o,self.plan,"Scheduled station review",review_application=application)
            await api.decide(self.o,self.plan,"typesafe/jev-1.14",self.facts)
        planner=json.loads(self.requests[0][1]['input'])
        decision=self.requests[1][1]['state']['suppliedFacts']
        self.assertEqual(planner['review']['application'],application)
        self.assertEqual(planner['decisionTiming'],decision['decisionTiming'])
        self.assertEqual(decision['decisionTiming']['regularRequestIntervalMs'],4000)
        self.assertEqual(decision['decisionTiming']['arrivingResponseMaxAgeMs'],2250)
        self.assertEqual(planner['physics']['energy'],decision['physics']['energy'])
        self.assertIn('thrust reserve',decision['physics']['energy']['units'])
        self.assertIn('consume none',decision['physics']['energy']['scope'])

    async def test_bad_probabilities_are_rejected(self):
        async def bad(request):
            r=await self.handler(request);data=r.json();data["answers"]["maneuver"]["probabilities"]["drive"]=2
            return httpx.Response(200,json=data)
        async with httpx.AsyncClient(transport=httpx.MockTransport(bad)) as client:
            with self.assertRaisesRegex(APIError,"out of range"):
                await OpenRouter(test_config(),self.audit.append,client).decide(self.o,self.plan,"typesafe/jev-1.14",self.facts)

    async def test_incomplete_output_preserves_usage_without_repair(self):
        async def incomplete(request):return httpx.Response(200,json={"status":"incomplete","output":[],"usage":{"cost":.004}})
        async with httpx.AsyncClient(transport=httpx.MockTransport(incomplete)) as client:
            with self.assertRaises(APIError) as caught:await OpenRouter(test_config(),self.audit.append,client).plan(self.o)
        self.assertEqual(caught.exception.usage["cost"],.004)

    async def test_cancel_reaches_transport_and_http_error_does_not_echo_body(self):
        cancelled=asyncio.Event()
        async def hanging(request):
            try:await asyncio.Future()
            finally:cancelled.set()
        async with httpx.AsyncClient(transport=httpx.MockTransport(hanging)) as client:
            task=asyncio.create_task(OpenRouter(test_config(),self.audit.append,client).plan(self.o));await asyncio.sleep(.01);task.cancel()
            with self.assertRaises(asyncio.CancelledError):await task
            self.assertTrue(cancelled.is_set())
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r:httpx.Response(401,text="SECRET"))) as client:
            with self.assertRaises(APIError) as caught:await OpenRouter(test_config(),self.audit.append,client).plan(self.o)
            self.assertNotIn("SECRET",str(caught.exception))
