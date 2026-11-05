# VECTOR Agent Lab

A 3D flying-car playground combining LLM planning and decision-model control, with Python orchestration, shared physics, and replayable experiments.

Drive a Roadster-inspired car through a small city, take off, land on rooftops, or let a model-driven agent attempt the same mission. Manual play, paid AI trials, and recorded-video rendering have separate entry points.

## Restore the City

Start on the road, cross the departure checkpoint while grounded, land gently on three rooftop relays, and return to park at the depot. Each relay requires 2.5 seconds of qualifying stationary contact. A waterfront charger can replenish thrust reserve.

The reserve powers flight and hovering. Ordinary wheel driving does not consume it. There is no mission deadline; execution time and initial planning time are recorded separately.

## How the AI works

| Component | Responsibility |
| --- | --- |
| Initial planner | Choose goals, 3D waypoints, speeds, charging, local guidance, and review stops. |
| Reviewer | Keep or revise the remaining plan using measured progress and execution history. |
| Decision model | Select DRIVE, CLIMB, CRUISE, APPROACH, DESCEND, or HOLD from fresh observations. |
| Conventional controller | Track the selected maneuver and stabilize the car at 120 Hz. |
| Game engine | Simulate physics and measure actual task completion. |

The models receive structured game state and full static obstacle geometry. They do not consume screenshots. Initial planning and reviews use the same strict Pydantic Responses schema. The decision model receives the active goal, model-authored guidance, upcoming path, mechanics, and live measurements.

The engine does not supply a solved AI route, select substitute maneuvers, or perform automatic obstacle avoidance. A separate conventional baseline is available for comparison. Manual play and headless trials share the same Rapier physics and mission implementation.

## Requirements

- Node.js 22.12 or later, with npm.
- Python 3.11 or later for AI trials and replay export.
- Windows PowerShell for the supplied desktop launchers and commands below.
- Your own model-provider credentials for paid trials. Manual play and offline replay do not require credentials.

## Play manually

```powershell
npm.cmd ci
npm.cmd run dev
```

Open <http://127.0.0.1:5176/>. Alternatively, double-click `Play VECTOR.cmd` to build and serve the game. Stop that server with `Stop VECTOR Game.cmd`.

| Keys | Action |
| --- | --- |
| W / S | Accelerate, brake, or reverse |
| A / D | Steer |
| Space | Lift / take off |
| Shift | Descend / ground handbrake |
| C | Camera view |
| Escape | Pause |
| R | Manual recovery to a road |

Build static files with `npm.cmd run build`. The `dist/` output can be served by a static web host.

## Set up the Python agent

Run these commands from the repository root:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r python_agent/requirements.lock.txt
.venv\Scripts\python.exe -m pip install --no-deps -e ./python_agent
Copy-Item .env.example .env
```

Fill `OPENROUTER_API_KEY` in your local `.env`. Do not overwrite an existing `.env` containing credentials. Credentials stay on the machine running the agent; they are not sent to the game browser.

The checked-in `config/working-candidate.json` selects:

- OpenRouter `openai/gpt-6.1-sol` for initial planning.
- OpenRouter `openai/gpt-6-luna` for reviews.
- Medium reasoning for both planner roles.
- OpenRouter `typesafe/jev-1.14` for immediate decisions.
- A 4,000 ms regular decision interval and 2,250 ms incoming-response freshness limit.
- Planner-selected station reviews and the existing no-progress review trigger.

Model availability and provider access depend on your account. Azure adapters are included; set your own endpoint, key, and deployment names using `.env.example`. Use `--no-preset` to select model settings from your environment. There is no automatic provider fallback.

## Run an AI trial

The following command makes paid model calls:

```powershell
.venv\Scripts\python.exe -X utf8 scripts/run-parallel.py --count 1
```

The runner starts an isolated Node transport and Python worker on ports 5181/8181, runs headlessly, prints progress, and cleans up its services. Logs, effective configuration, model requests, returned usage, and results are saved under the ignored `runs/` directory.

For an explicit timing experiment:

```powershell
.venv\Scripts\python.exe -X utf8 scripts/run-parallel.py --name cadence-test --count 1 --timing-profile 2500/2250
```

Use `--help` for all options. `--count 2` runs two independent trials concurrently and incurs charges for both. New goals request a fresh decision immediately. Accepted maneuvers keep tracking their goal between regular decisions.

Initial planning pauses physics and the execution clock. Reviews run while physics continues. Planned station reviews start during station approach; after measured station completion, the decision model maintains a grounded wait until the review is ready. Stalled execution can request a separate review.

The planner has 180 seconds per HTTP attempt; the decision model has 5 seconds. One transient retry receives its own full budget. The planner output allowance is 16,000 tokens, including reasoning; the run ceiling is 3,000 initiated API attempts. See [RUNTIME-LIMITS.txt](RUNTIME-LIMITS.txt) for precise timing semantics. These ceilings do not estimate the eventual bill. Returned usage is accounted for once; unreturned usage remains unknown.

The free conventional baseline uses no model calls:

```powershell
npm.cmd run baseline
```

Summarize returned API usage from your own saved runs without making new calls:

```powershell
.venv\Scripts\python.exe scripts/report-api-costs.py
```

You can supply one run ID to report only that run. Charges without returned usage remain unknown.

For a long-lived programmatic transport, use `scripts/launch-python.ps1` and stop it with `scripts/stop-python.ps1`. Its default ports are 5180/8176. The manual game's port 5176 does not expose the agent WebSocket.

## Render a recorded run

After you have a local recorded run:

```powershell
.venv\Scripts\python.exe -X utf8 scripts/export-demo-trace.py <run-id>
npm.cmd run replay
```

Open <http://127.0.0.1:5178/>. Select a continuous passage, preview it, and record a WebM clip. Keep the tab visible while recording. The separate replay studio can also open an exported trace JSON directly.

Replay interpolates recorded position and orientation and displays the dashboard, thrust plumes, and optional compact model responses. It makes no model calls and executes no controller. Sampling and interpolation are disclosed in the exported trace. Older traces without nozzle telemetry use a documented visual approximation.

This repository includes no private experiment recordings. Generate a run with your own credentials to use this workflow.

## Layout

```text
src/                         Scene, car, audio, manual controls, and flight physics
shared/                      Mission, goal execution, maneuvers, and protocols
server/                      Static game server and agent transport
python_agent/vector_agent/   Python context, providers, scheduling, and recording
config/                      Non-secret model and timing preset
demo/                        Offline replay and video renderer
scripts/                     Launchers, runner, exporters, and local diagnostics
tests/                       Engine, protocol, replay, and actuator checks
python_agent/tests/          Mocked provider and Python runtime checks
```

## Local checks

These commands do not start a paid model trial:

```powershell
npm.cmd test
npm.cmd run build
npm.cmd run python:contract:check
.venv\Scripts\python.exe -m vector_agent.response_schema --check
.venv\Scripts\python.exe -m unittest discover -s python_agent/tests
```

Task facts and mechanics are exported from shared TypeScript definitions with `npm.cmd run python:contract`. Pydantic response schemas are regenerated with `.venv\Scripts\python.exe -m vector_agent.response_schema`.

## Local files and credentials

Keep `.env`, API keys, provider-resource details, generated runs, and personal writing outside Git. `.env.example` contains empty credential fields. Internal development notes and unpublished writing are not part of this source release.

The car and city are an independent prototype inspired by a futuristic roadster; the project is not affiliated with Tesla or SpaceX.
