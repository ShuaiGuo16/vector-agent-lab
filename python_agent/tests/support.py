from functools import cache
import json
from pathlib import Path
import subprocess
import shutil

from vector_agent.config import Config, ROOT
from vector_agent.protocol import Observation, Plan, EngineFacts


@cache
def samples():
    result = subprocess.run([shutil.which("node"), "--import", "tsx", "scripts/goal-reference.ts"], cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True)
    return json.loads(result.stdout)


def fixture():
    data = samples()
    o = Observation.model_validate({**data["observation"], "runId": "runtime", "seq": 1, "simTime": 0, "planVersion": 0, "observedAt": 0})
    plan = Plan.model_validate(data["plan"])
    return o.model_copy(update={"goal":plan.goals[0]}), plan, EngineFacts.model_validate(data["facts"])


def test_config(**overrides):
    return Config(OPENROUTER_API_KEY="test-only-no-real-key", **overrides)


def goal_fixture():
    return fixture()
