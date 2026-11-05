from unittest import TestCase

from support import goal_fixture
from vector_agent.context import CONTRACT
from vector_agent.goal_context import decision_state, planner_input
from vector_agent.protocol import Goal, Plan


class ModelAuthoredDeparture(TestCase):
    def test_revised_departure_guidance_is_visible_before_departure_completion(self):
        observation, previous, facts = goal_fixture()
        goal = Goal(id='planned-departure', kind='drive', target=None,
                    position=[35, .6, 119], speed=5, guidance=['Initial model guidance'], reviewAfter=False)
        plan = Plan(goals=[goal, previous.goals[-1]])
        observation = observation.model_copy(update={
            'goal': goal, 'legIndex': 0, 'position': [35, .58, 150],
            'grounded': True, 'departureComplete': False,
        })
        state = decision_state(observation, plan, facts)
        self.assertFalse(state['liveState']['departureComplete'])
        self.assertEqual(state['liveState']['currentGoal']['id'], goal.id)
        self.assertEqual(state['modelPlan']['currentGoalGuidance'], goal.guidance)
        self.assertEqual([g['id'] for g in state['modelPlan']['upcomingPath']], [previous.goals[-1].id])

        revised = goal.model_copy(update={'guidance': ['Revised model guidance'], 'speed': 3})
        context = planner_input(observation, plan, 'Review the active driving goal')
        self.assertEqual(context['review']['currentGoal']['id'], goal.id)
        self.assertFalse(context['mission']['departureComplete'])
        self.assertIn('ordinary drive goals', CONTRACT['goalPlannerInstructions'])
        observation = observation.model_copy(update={'goal': revised})
        state = decision_state(observation, Plan(goals=[revised, previous.goals[-1]]), facts)
        self.assertEqual(state['modelPlan']['currentGoalGuidance'], revised.guidance)
        self.assertEqual(state['liveState']['currentGoal']['speed'], 3)
