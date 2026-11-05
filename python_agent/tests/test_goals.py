import asyncio
import tempfile
import unittest
from pathlib import Path
from vector_agent.protocol import Goal,Plan,Observation
from vector_agent.recorder import Recorder,now_ms
from vector_agent.runtime import AgentSession,objective_key
from vector_agent.goal_context import decision_state,geometry,planner_input
from vector_agent.context import WORLD
from support import goal_fixture,test_config
from test_runtime import FakeAPI


class GoalContext(unittest.TestCase):
    def test_compaction_preserves_every_solid_and_local_guidance_has_no_future_advice(self):
        o,p,f=goal_fixture()
        p.goals[0].guidance=['Current local priority'];p.goals[1].guidance=['Future landing priority']
        s=decision_state(o,p,f)
        self.assertEqual(s['modelPlan']['currentGoalGuidance'],['Current local priority'])
        self.assertNotIn('Future landing priority',str(s))
        self.assertEqual(s['modelPlan']['upcomingPath'][0]['position'],[35,.6,150])
        for seed,key in ((7,'odd'),(8,'even')):
            g=geometry(seed)
            restored=[{'kind':g['kinds'][b[0]],'min':b[1:4],'max':b[4:7]} for b in g['solids']]
            self.assertEqual(restored,WORLD['collisionMaps'][key])
        self.assertIn('bodyCollisionEnvelopeLocal',s['suppliedFacts']['physics'])

    def test_wire_preserves_required_nullable_fields_and_history_is_factual(self):
        o,p,_=goal_fixture()
        self.assertIsNone(p.wire()['goals'][0]['target'])
        self.assertIsNone(p.wire()['goals'][1]['position'])
        self.assertEqual(Observation.model_validate(o.wire()).goal,o.goal)
        context=planner_input(o,p,'Review',{'samples':[]})
        self.assertEqual(context['review']['installedPlan'],p.wire())
        self.assertIn('actualGoalRecords',context['review'])


class GoalRuntime(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.o,self.plan,self.facts=goal_fixture()
        self.api=FakeAPI(self.plan);self.messages=[];self.folder=tempfile.TemporaryDirectory()
        self.s=AgentSession('runtime','openrouter','typesafe/jev-1.14',test_config(DECISION_INTERVAL_MS=1500),self.api,Recorder('runtime',Path(self.folder.name),{}),self.messages.append)
        self.s.plan=self.plan;self.s.plan_version=1

    async def asyncTearDown(self):
        self.s.finish('test');await self.s.drain();self.folder.cleanup()

    def observe(self,**updates):
        seq=self.s.latest.seq+1 if self.s.latest else 1
        self.s.observe(self.o.model_copy(update={'planVersion':self.s.plan_version,'observedAt':now_ms(),'seq':seq,**updates}),self.facts)

    async def test_goal_change_gets_immediate_decision_and_commands_continue_by_goal(self):
        self.observe();await asyncio.sleep(.01)
        other=self.plan.goals[1];self.observe(goal=other,legIndex=1,simTime=.1)
        await asyncio.sleep(.01)
        actions=[m for m in self.messages if m['type']=='action']
        self.assertEqual(len(actions),2)
        self.assertEqual(actions[-1]['continuity'],'goal')
        self.assertEqual(actions[-1]['objectiveKey'],objective_key(self.s.latest))

    async def test_station_review_is_prepared_then_installed_at_actual_completion(self):
        applications=[]
        original=self.api.plan
        async def capture(*args):
            applications.append(args[-1]);return await original(*args)
        self.api.plan=capture
        roof=Goal(id='roof',kind='relay',target='relay-1',position=None,speed=8,guidance=[],reviewAfter=False)
        self.plan.goals=[roof,self.plan.goals[-1]]
        self.observe(goal=roof,simTime=30,departureComplete=True)
        await asyncio.sleep(.01)
        self.assertEqual(self.api.plans,1);self.assertIsNotNone(self.s.prepared_review)
        self.assertEqual(applications,[{'mode':'after_goal_completion','completionGoalId':'roof'}])
        self.assertFalse(any(m['type']=='plan' for m in self.messages))
        waiting=roof.model_copy(update={'id':'roof:review','kind':'wait_review'})
        self.observe(goal=waiting,simTime=33,completed=['relay-1'],completedGoalIds=['roof'])
        await asyncio.sleep(.01)
        self.assertEqual(sum(m['type']=='plan' for m in self.messages),1)
        self.assertEqual(self.api.plans,1)

    async def test_planned_schedule_does_not_force_unrequested_relay_review(self):
        self.s.config=self.s.config.model_copy(update={'REVIEW_SCHEDULE':'planned'})
        roof=Goal(id='roof',kind='relay',target='relay-1',position=None,speed=8,guidance=[],reviewAfter=False)
        self.observe(goal=roof,simTime=30,departureComplete=True)
        await asyncio.sleep(.01)
        self.assertEqual(self.api.plans,0)

    async def test_station_stall_review_is_not_mislabeled_as_completion_gated(self):
        self.s.config=self.s.config.model_copy(update={'REVIEW_SCHEDULE':'planned'})
        applications=[]
        original=self.api.plan
        async def capture(*args):
            applications.append(args[-1]);return await original(*args)
        self.api.plan=capture
        roof=Goal(id='roof',kind='relay',target='relay-1',position=None,speed=8,guidance=[],reviewAfter=False)
        self.observe(goal=roof,simTime=30,departureComplete=True)
        await asyncio.sleep(.01)
        self.observe(goal=roof,simTime=46,departureComplete=True)
        await asyncio.sleep(.01)
        self.assertEqual(applications,[{'mode':'on_response','completionGoalId':None}])
        self.assertTrue(any(m['type']=='plan' for m in self.messages))

    async def test_pause_resumes_pending_and_prepared_station_reviews(self):
        for prepared in (False, True):
            for completed_on_resume in (False, True):
                with self.subTest(prepared=prepared, completed=completed_on_resume):
                    self.s.reviewed_goals.clear()
                    self.s.last_plan_time = -999
                    self.api.plans = 0
                    self.messages.clear()
                    roof = Goal(id='roof', kind='relay', target='relay-1', position=None,
                                speed=4, guidance=[], reviewAfter=True)
                    self.plan.goals = [roof, self.plan.goals[-1]]
                    self.api.gate = None if prepared else asyncio.Event()
                    self.observe(goal=roof, simTime=30, departureComplete=True)
                    await asyncio.sleep(.01)
                    self.assertEqual(self.api.plans, 1)
                    self.assertEqual(self.s.prepared_review is not None, prepared)
                    self.observe(goal=roof, paused=True, simTime=31)
                    await asyncio.sleep(.01)
                    self.assertIsNone(self.s.pending_review_goal)
                    self.assertIsNone(self.s.prepared_review)
                    if self.api.gate:
                        self.api.gate.set()
                    waiting = roof.model_copy(update={'id':'roof:review','kind':'wait_review'})
                    updates = dict(completed=['relay-1'], completedGoalIds=['roof']) if completed_on_resume else {}
                    self.observe(goal=waiting if completed_on_resume else roof, simTime=40, **updates)
                    await asyncio.sleep(.01)
                    self.assertEqual(self.api.plans, 2)
                    if not completed_on_resume:
                        # A second pause must also release a prepared replacement.
                        self.observe(goal=roof, paused=True, simTime=41)
                        await asyncio.sleep(.01)
                        self.observe(goal=waiting, simTime=50, completed=['relay-1'], completedGoalIds=['roof'])
                        await asyncio.sleep(.01)
                        self.assertEqual(self.api.plans, 3)
                    self.assertEqual(sum(m['type']=='plan' for m in self.messages), 1)
                    self.assertIn('roof', self.s.reviewed_goals)
                    self.observe(goal=waiting, simTime=70, completed=['relay-1'], completedGoalIds=['roof'])
                    await asyncio.sleep(.01)
                    self.assertEqual(sum(m['type']=='plan' for m in self.messages), 1)
