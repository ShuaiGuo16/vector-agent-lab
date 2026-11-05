import json
import os
from unittest import TestCase
from unittest.mock import patch

from vector_agent.config import Config, ROOT, apply_candidate
from vector_agent.server import AgentServer


class CandidateSettings(TestCase):
    def test_candidate_is_shared_non_secret_and_explicit_overrides_win(self):
        values = json.loads((ROOT/'config/working-candidate.json').read_text())
        self.assertFalse(any('KEY' in name or 'ENDPOINT' in name for name in values))
        with patch.dict(os.environ, {'OPENROUTER_API_KEY':'mock-key'}, clear=True):
            apply_candidate()
            self.assertEqual(os.environ['OPENROUTER_API_KEY'], 'mock-key')
            with patch('vector_agent.config.load_dotenv'):
                config = Config.load()
            self.assertEqual(config.DECISION_INTERVAL_MS, 4000)
            self.assertEqual(config.ACTION_MAX_AGE_MS, 2250)
            self.assertEqual(config.REVIEW_SCHEDULE, 'planned')
            self.assertEqual(config.MODEL_PROVIDER, values['MODEL_PROVIDER'])
            self.assertEqual(config.PLANNER_MODEL, values['PLANNER_MODEL'])
            os.environ['DECISION_INTERVAL_MS'] = '6000'
            with patch('vector_agent.config.load_dotenv'):
                self.assertEqual(Config.load().DECISION_INTERVAL_MS, 6000)

    def test_health_reports_loaded_identity_config_and_active_run(self):
        server = AgentServer(Config())
        health = server.health()
        self.assertEqual(health['sourceIdentity'], health['config']['sourceIdentity'])
        self.assertEqual(len(health['sourceIdentity']), 64)
        self.assertIsNone(health['activeRun'])
        self.assertNotIn('API_KEY', json.dumps(health))
