"""Independent real-time trials; each gets its own game and Python worker."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

from vector_agent.config import Config, ROOT, apply_candidate


def timing_profile(value):
    try:
        interval, age = map(int, value.split("/"))
        if interval <= 0 or age <= 0:
            raise ValueError
        return interval, age
    except ValueError:
        raise argparse.ArgumentTypeError("Use positive milliseconds as INTERVAL/MAX_AGE") from None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--count", type=int, default=2)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--game-port", type=int, default=5181)
    parser.add_argument("--agent-port", type=int, default=8181)
    parser.add_argument("--name", default=f"trial-{time.strftime('%Y%m%d-%H%M%S')}")
    parser.add_argument("--no-preset", action="store_true", help="Use env settings instead of the selected candidate")
    parser.add_argument("--decision-interval-ms", type=int)
    parser.add_argument("--action-max-age-ms", type=int)
    parser.add_argument("--timing-profile", type=timing_profile, action="append",
                        help="One INTERVAL/MAX_AGE pair per trial; repeat to compare profiles")
    parser.add_argument("--review-provider", choices=("inherit", "openrouter", "azure"))
    parser.add_argument("--review-model")
    parser.add_argument("--review-schedule", choices=("every_relay", "planned"), action="append",
                        help="One explicit-goal review schedule per trial")
    args = parser.parse_args()
    if not args.no_preset:
        apply_candidate()
    if args.review_schedule and len(args.review_schedule) != args.count:
        parser.error("Supply exactly one --review-schedule per trial")
    if args.timing_profile and len(args.timing_profile) != args.count:
        parser.error("Supply exactly one --timing-profile for each trial")
    if args.decision_interval_ms is not None:
        os.environ["DECISION_INTERVAL_MS"] = str(args.decision_interval_ms)
    if args.action_max_age_ms is not None:
        os.environ["ACTION_MAX_AGE_MS"] = str(args.action_max_age_ms)
    if args.review_provider is not None:
        os.environ["REVIEW_PROVIDER"] = args.review_provider
    if args.review_model is not None:
        os.environ["REVIEW_MODEL"] = args.review_model
    config = Config.load()
    if not config.configured():
        raise SystemExit("Selected provider credentials are missing")
    node = shutil.which("node")
    source = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    children, streams, trials = [], [], []
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    def start(command, env, log):
        stream = log.open("w", encoding="utf-8")
        streams.append(stream)
        child = subprocess.Popen(command, cwd=ROOT, env=env, stdout=stream, stderr=subprocess.STDOUT, creationflags=flags)
        children.append(child)
        return child
    try:
        for index in range(args.count):
            env = dict(os.environ, AGENT_BACKEND="python", PORT=str(args.game_port + index), PYTHON_AGENT_PORT=str(args.agent_port + index))
            interval, age = args.timing_profile[index] if args.timing_profile else (config.DECISION_INTERVAL_MS, config.ACTION_MAX_AGE_MS)
            env.update(DECISION_INTERVAL_MS=str(interval), ACTION_MAX_AGE_MS=str(age))
            schedule = args.review_schedule[index] if args.review_schedule else config.REVIEW_SCHEDULE
            env["REVIEW_SCHEDULE"] = schedule
            prefix = ROOT / "runs" / f"{args.name}-parallel-{index + 1}"
            worker = start([sys.executable, "-m", "vector_agent.server"], env, prefix.with_suffix(".worker.log"))
            game = start([node, "--import", "tsx", "server/index.ts"], env, prefix.with_suffix(".game.log"))
            trials.append(dict(trial=index + 1, env=env, prefix=prefix, worker=worker, game=game,
                               effectiveConfig=config.model_copy(update={'PORT':args.game_port+index,'PYTHON_AGENT_PORT':args.agent_port+index,
                                   'DECISION_INTERVAL_MS':interval,'ACTION_MAX_AGE_MS':age,'REVIEW_SCHEDULE':schedule}).public(),
                               timingProfile=dict(decisionIntervalMs=interval, actionMaxAgeMs=age), reviewSchedule=schedule))
        for trial in trials:
            deadline = time.monotonic() + 30
            for port, endpoint in ((trial["env"]["PYTHON_AGENT_PORT"], "/health"), (trial["env"]["PORT"], "/api/health")):
                while True:
                    if trial["worker"].poll() is not None or trial["game"].poll() is not None:
                        raise RuntimeError(f"Trial {trial['trial']} server exited; inspect its logs")
                    try:
                        with urllib.request.urlopen(f"http://127.0.0.1:{port}{endpoint}", timeout=1) as response:
                            if json.load(response).get("ok"):
                                break
                    except OSError:
                        pass
                    if time.monotonic() > deadline:
                        raise RuntimeError(f"Trial {trial['trial']} server startup exceeded 30 seconds")
                    time.sleep(.25)
        for trial in trials:
            trial["client"] = start([node, "--import", "tsx", "scripts/run-agent.ts", str(args.seed)], trial["env"], trial["prefix"].with_suffix(".client.log"))
        print(json.dumps({"event": "parallel_started", "source": source, "count": args.count,
                          "trialSettings": [{**t["timingProfile"], "reviewSchedule": t["reviewSchedule"]} for t in trials]}), flush=True)
        last_report = 0
        while any(trial["client"].poll() is None for trial in trials):
            if time.monotonic() - last_report >= 15:
                last_report = time.monotonic()
                for trial in trials:
                    lines = trial["prefix"].with_suffix(".client.log").read_text(encoding="utf-8").splitlines()
                    progress = next((json.loads(line) for line in reversed(lines) if line.startswith('{"event":"progress"')), None)
                    print(json.dumps({"trial": trial["trial"], "progress": progress}), flush=True)
            time.sleep(1)
        results = []
        for trial in trials:
            lines = trial["prefix"].with_suffix(".client.log").read_text(encoding="utf-8").splitlines()
            final = next((json.loads(line) for line in reversed(lines) if line.startswith('{"event":"finished"')), None)
            results.append({"trial": trial["trial"], "effectiveConfig":trial['effectiveConfig'], "timingProfile": trial["timingProfile"], "reviewSchedule": trial["reviewSchedule"],
                            "clientExitCode": trial["client"].returncode, "result": final})
        target = ROOT / "runs" / f"{args.name}-parallel-results.json"
        target.write_text(json.dumps({"functionalSource": source, "seed": args.seed, "trials": results}, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"event": "parallel_finished", "results": str(target), "outcomes": [(r["result"] or {}).get("summary", {}).get("outcome") for r in results]}), flush=True)
    finally:
        for child in reversed(children):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait()
        for stream in streams:
            stream.close()


if __name__ == "__main__":
    main()
