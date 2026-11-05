import asyncio
from http import HTTPStatus
import json

import httpx
from pydantic import ValidationError
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from .config import Config, ROOT
from .context import CONTRACT, js_json
from .protocol import Start, Observation, EngineFacts
from .model_api import ModelAPI
from .recorder import Recorder
from .runtime import AgentSession


class AgentServer:
    def __init__(self, config: Config, runs=None):
        self.config, self.runs = config, runs or ROOT / "runs"
        self.owner = None

    def health(self):
        return {"ok": True, "app": "VECTOR Python Agent", "gamePort": self.config.PORT,
                "agentPort": self.config.PYTHON_AGENT_PORT, "experimentVersion": CONTRACT["version"],
                "sourceIdentity": self.config.public()['sourceIdentity'], "config": self.config.public(),
                "activeRun": self.owner.id if self.owner and not self.owner.stopped else None}

    def http_request(self, connection, request):
        if request.path == "/health":
            response = connection.respond(HTTPStatus.OK, js_json(self.health()))
            del response.headers["Content-Type"]
            response.headers["Content-Type"] = "application/json"
            return response
        if request.path != "/agent":
            return connection.respond(HTTPStatus.NOT_FOUND, "Not found")
        return None

    async def connection(self, socket):
        session = None
        queue = asyncio.Queue()
        def send(value):
            queue.put_nowait(value)
        async def pump():
            while True:
                value = await queue.get()
                try:
                    await socket.send(js_json(value))
                finally:
                    queue.task_done()
        sender = asyncio.create_task(pump())
        send({"type": "hello", "config": self.config.public()})
        async with httpx.AsyncClient(trust_env=False) as client:
            try:
                async for raw in socket:
                    try:
                        msg = json.loads(raw)
                        kind = msg.get("type")
                        if kind == "start":
                            start = Start.model_validate(msg)
                            if self.owner and not self.owner.stopped and self.owner is not session:
                                raise ValueError("Another tab owns the active run. Stop that run first.")
                            if start.mode == "openrouter" and not self.config.configured():
                                raise ValueError("Fill the selected provider credentials in .env and restart the lab. Baseline is available offline.")
                            if (self.runs / f"{start.runId}.jsonl").exists():
                                raise ValueError("Run ID already exists")
                            if session:
                                session.finish("restarted")
                                await session.drain()
                            recorder = Recorder(start.runId, self.runs, {"mode": start.mode, "seed": start.seed,
                                "planner": self.config.PLANNER_MODEL, "reasoning": self.config.PLANNER_REASONING_EFFORT,
                                "reviewModel": self.config.review_model(), "reviewProvider": self.config.review_provider(),
                                "reviewSchedule": self.config.REVIEW_SCHEDULE,
                                "decisionModel": start.decisionModel, "missionVersion": 2, "experimentVersion": CONTRACT["version"],
                                "agentBackend": "python", "modelProvider": self.config.MODEL_PROVIDER, "decisionProvider": self.config.decision_provider(), "decisionDeployment": self.config.AZURE_DECISION_DEPLOYMENT if self.config.decision_provider() == "azure" else None,
                                "controller": "bounded maneuvers + deterministic tracking", "maxActionAgeMs": self.config.ACTION_MAX_AGE_MS})
                            (self.runs / f"{start.runId}.config.json").write_text(js_json(self.config.audit()) + "\n", encoding="utf-8")
                            api = ModelAPI(self.config, lambda payload: recorder.event("api_request_payload", payload), client)
                            session = AgentSession(start.runId, start.mode, start.decisionModel, self.config, api, recorder, send)
                            self.owner = session
                            send({"type": "started", "runId": start.runId, "reviewSchedule": self.config.REVIEW_SCHEDULE})
                        elif kind == "observation" and session:
                            session.observe(Observation.model_validate(msg["data"]), EngineFacts.model_validate(msg["facts"]))
                        elif kind == "stop" and session:
                            reason = msg.get("reason", "stopped")
                            if not isinstance(reason, str) or len(reason) > 120:
                                raise ValueError("Invalid stop reason")
                            session.finish(reason)
                        elif kind == "event" and session and msg.get("runId") == session.id:
                            name = msg.get("name")
                            if name not in ("manual_takeover", "recovery", "pause", "resume", "outcome", "implementation_error"):
                                raise ValueError("Invalid event")
                            session.event(name, msg.get("data", {}))
                            if name == "manual_takeover":
                                session.takeover()
                            elif name == "implementation_error":
                                session.finish("implementation_error")
                        else:
                            raise ValueError("Invalid message or no active run")
                    except ValidationError:
                        send({"type": "error", "message": "Invalid message schema"})
                    except (ValueError, KeyError, TypeError) as error:
                        # Never include the full received packet or credentials.
                        message = str(error) if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError) else "Invalid message"
                        send({"type": "error", "message": message})
            except ConnectionClosed:
                pass
            finally:
                if session:
                    session.finish("disconnected")
                    await session.drain()
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)

    async def run(self):
        origins = [f"http://127.0.0.1:{self.config.PORT}", f"http://localhost:{self.config.PORT}"]
        async with serve(self.connection, "127.0.0.1", self.config.PYTHON_AGENT_PORT, origins=origins,
                         process_request=self.http_request, max_size=1_048_576, compression=None):
            print(f"VECTOR Python Agent: ws://127.0.0.1:{self.config.PYTHON_AGENT_PORT}/agent", flush=True)
            await asyncio.Future()


def main():
    try:
        asyncio.run(AgentServer(Config.load()).run())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
