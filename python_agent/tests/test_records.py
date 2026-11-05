import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from vector_agent.config import ROOT


def script(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'scripts'/f'{name}.py')
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class HistoricalReaders(unittest.TestCase):
    def test_replay_export_reads_current_and_historical_plans(self):
        exporter=script('export-demo-trace')
        for plan in ({'goals':[{'kind':'fly','target':None},{'kind':'relay','target':'relay-1'}]},
                     {'legs':[{'target':'relay-1'}]}):
            with tempfile.TemporaryDirectory() as folder:
                root=Path(folder);(root/'runs').mkdir()
                events=[{'type':'planner_result','data':{'plan':plan}}]
                (root/'runs'/'fixture.jsonl').write_text('\n'.join(map(json.dumps,events)))
                summary={'outcome':'success','planner':'mock','reasoning':'medium','decisionModel':'mock','agentBackend':'python'}
                (root/'runs'/'fixture.summary.json').write_text(json.dumps(summary))
                with patch.object(exporter,'ROOT',root):result=exporter.export('fixture')
                self.assertEqual(result['plans'][0]['targets'],['relay-1'])

    def test_cost_reader_prefers_recorded_ledger_and_does_not_double_count_response_aliases(self):
        reader=script('report-api-costs')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);(root/'runs').mkdir()
            usage={'cost':.003,'input_tokens':20,'output_tokens':2}
            request={'path':'/alpha/decisions','body':{}}
            terminal={'kind':'attempt_accounting','apiProvider':'OpenRouter','path':'/alpha/decisions','model':'mock','usage':usage}
            duplicate={**terminal,'kind':'response'}
            events=[{'type':'api_request_payload','data':x} for x in (request,terminal,duplicate)]
            (root/'runs'/'fixture.jsonl').write_text('\n'.join(map(json.dumps,events)))
            path=root/'runs'/'fixture.summary.json';path.write_text(json.dumps({'runId':'fixture','modelProvider':'openrouter'}))
            with patch.object(reader,'ROOT',root):result=reader.recorded_cost(path)
            self.assertEqual(result['providerReportedUSD'],.003)
            self.assertEqual(result['decisionInputTokens'],20)
            self.assertEqual(result['decisionRequests'],1)
