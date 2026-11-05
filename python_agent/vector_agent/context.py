"""Python owns model context; the engine supplies only exact measurements/commands."""
import json
import math
from pathlib import Path

from .protocol import Observation

CONTRACT = json.loads(Path(__file__).with_name("contract.json").read_text(encoding="utf-8"))
WORLD = CONTRACT["world"]
TARGETS = {t["id"]: t for t in WORLD["targets"]}
ENERGY = CONTRACT["executionFacts"]["physics"]["energy"]
TASK_FACTS = CONTRACT["taskFacts"]
ACTION_MECHANICS = CONTRACT["actionMechanics"]


def rounded(value):
    # Match Math.round, including negative half values (Python round is ties-to-even).
    return math.floor(value * 100 + 0.5) / 100


def js_json(value):
    def clean(v):
        if isinstance(v, float) and v.is_integer():
            return int(v)
        if isinstance(v, list):
            return [clean(x) for x in v]
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()}
        return v
    return json.dumps(clean(value), ensure_ascii=False, separators=(",", ":"), allow_nan=False)


def physical_state(o: Observation):
    return {"trackerYawReferenceRadians": rounded(o.yaw),
            "bodyHeadingYawRadians": None if o.bodyHeadingYawRadians is None else rounded(o.bodyHeadingYawRadians),
            "orientationQuaternionXYZW": o.bodyOrientationQuaternion,
            "angularVelocityWorldRadiansPerSecond": o.bodyAngularVelocityWorld,
            "upDirectionWorld": o.bodyUpWorld}
