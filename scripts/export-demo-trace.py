"""Export public recorded telemetry for a labeled visual replay; never runs a controller."""
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def export(run_id):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", run_id):
        raise ValueError("Invalid run ID")
    events = [json.loads(line) for line in (ROOT / "runs" / f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()]
    summary = json.loads((ROOT / "runs" / f"{run_id}.summary.json").read_text(encoding="utf-8"))
    frames, plans, latest_latency, latest_time = [], [], None, 0
    for e in events:
        if e["type"] == "planner_result":
            plans.append({"t": latest_time, "model": e["data"].get("model"), "targets": [goal["target"] for goal in e["data"]["plan"].get("goals", e["data"]["plan"].get("legs", [])) if goal.get("target")]})
        if e["type"] == "decision_result":
            latest_latency = e["data"]["latencyMs"]
        if e["type"] == "observation":
            o = e["data"]
            latest_time = o["simTime"]
            frames.append({"t": o["simTime"], "position": o["position"], "quaternion": o["bodyOrientationQuaternion"],
                           "velocity": o["velocity"], "grounded": o["grounded"], "energy": o["energy"], "action": o["lastAppliedManeuver"],
                           "completed": len(o["completed"]), "completedIds": o["completed"], "target": o["target"], "latency": latest_latency, "throttle": o.get("flightThrottle"), "thrusts": o.get("nozzleThrustLevels")})
    gaps = [b["t"] - a["t"] for a, b in zip(frames, frames[1:]) if b["t"] > a["t"]]
    sampling_hz = len(gaps) / sum(gaps) if gaps else None
    return {"runId": run_id, "seed": summary.get("seed", 7), "samplingHz": sampling_hz, "summary": {k: summary[k] for k in ("outcome", "planner", "reasoning", "decisionModel", "agentBackend")},
            "disclosure": "Replay of recorded AI-run telemetry, sampled at the rate in samplingHz. Position/orientation are interpolated for rendering. No controller or model runs during replay. Where nozzle telemetry is absent, plume intensity is illustrative, derived from recorded flight state/maneuver, not a measured force.",
            "frames": frames, "plans": plans}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("run_id")
    args = parser.parse_args()
    dest = ROOT / "runs" / "demo"
    dest.mkdir(exist_ok=True)
    trace = export(args.run_id)
    (dest / "trace.json").write_text(json.dumps(trace, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Exported {len(trace['frames'])} recorded snapshots to {dest / 'trace.json'}")
