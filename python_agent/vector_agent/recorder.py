from datetime import datetime, timezone
from pathlib import Path
import time

from .context import js_json
from .costs import CostLedger


def now_ms():
    return time.time_ns() // 1_000_000


def iso_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class Recorder:
    def __init__(self, run_id: str, folder: Path, metadata: dict):
        folder.mkdir(parents=True, exist_ok=True)
        self.folder, self.id, self.closed = folder, run_id, False
        self.costs = CostLedger()
        self.stream = (folder / f"{run_id}.jsonl").open("x", encoding="utf-8", buffering=1)
        self.summary = {"runId": run_id, "startedAt": iso_now(), **metadata}
        self.event("start", self.summary)

    def event(self, kind, data):
        if not self.closed:
            if kind == "api_request_payload" and data.get("kind") == "attempt_accounting":
                self.costs.record(data)
            self.stream.write(js_json({"at": now_ms(), "type": kind, "data": data}) + "\n")

    def finish(self, result):
        if self.closed:
            return
        self.summary.update(**result, endedAt=iso_now(), apiCost=self.costs.summary(),
            inputTokens=self.costs.input_tokens, outputTokens=self.costs.output_tokens,
            reportedCostUSD=self.costs.router_usd if self.costs.router_responses else None)
        self.event("summary", self.summary)
        self.closed = True
        self.stream.close()
        (self.folder / f"{self.id}.summary.json").write_text(js_json(self.summary) + "\n", encoding="utf-8")
