"""Pydantic is the source of truth for provider-enforced Responses schemas."""
import json
from pathlib import Path
import sys
from typing import Annotated, Literal

from pydantic import Field
from .protocol import WireModel, Target, Vector


class OutputModel(WireModel):
    model_config = {**WireModel.model_config, "extra": "forbid"}


class GoalOutput(OutputModel):
    id: str = Field(min_length=1, description="Unique stable identity. Retain an installed ID only for the same goal with unchanged kind, target and position; speed/guidance can change. Give changed or new goals new IDs. Never reuse completed IDs for new work.")
    kind: Literal["drive", "fly", "relay", "charge", "depot"] = Field(description="drive/fly are transit points. relay is landing and activation; charge is landing and replenishment; depot is the terminal return. A journey can freely mix drive and fly goals.")
    target: Target | None = Field(description="Station ID for relay/charge/depot goals; null for drive/fly. relay uses a relay ID, charge uses charger, depot uses depot.")
    position: Vector | None = Field(description="Desired vehicle-center xyz for drive/fly; null for station goals, whose exact station center and surface are supplied. Choose obstacle clearance from full geometry and body bounds. Transit completion is distance <2 m; drive additionally requires wheel contact. No speed/dwell requirement or altitude floor.")
    speed: Annotated[float, Field(ge=.5, le=14)] = Field(description="Horizontal speed cap in m/s for DRIVE (also capped at 8, 3.5 in turns) and CRUISE. APPROACH remains capped at 4 and DESCEND at 1.4.")
    guidance: list[str] = Field(description="Only this goal's local priorities/trade-offs for the decision model; empty when the coordinates and supplied mechanics suffice. No reusable controller or repetition of maneuver mechanics.")
    reviewAfter: bool = Field(description="For relay/charge, request an early review as this station goal begins, then wait grounded there after actual completion until the review is ready. Ignored on other goal kinds. In every_relay scheduling, every relay is reviewed regardless of this field.")


class GoalStrategy(OutputModel):
    disposition: Literal["keep", "revise"] = Field(description="Initial planning must revise. On review, keep retains the installed plan and uses goals=[]; revise replaces the remaining goals and their guidance. Completed IDs remain completed even if retained in a revision.")
    goals: list[GoalOutput] = Field(description="For revise, the remaining ordered goals from the current state through every unfinished relay and terminal depot, with charging if chosen. When departureComplete is false, include the mandatory grounded departure using ordinary drive goals; the engine does not insert it. For keep, empty. For reviews, review.application identifies whether installation waits for completion of a named goal or occurs on response against the current execution state. For completion-gated reviews, plan onward from that completed goal.")


def responses_schema(model):
    """Inline local refs with sibling metadata, which native strict APIs reject."""
    schema = model.model_json_schema()
    def normalize(value):
        if isinstance(value, list):
            return [normalize(v) for v in value]
        if not isinstance(value, dict):
            return value
        if "$ref" in value and len(value) > 1:
            ref = value["$ref"]
            if not ref.startswith("#/$defs/"):
                raise ValueError("Only local schema definitions are supported")
            value = {**schema["$defs"][ref.removeprefix("#/$defs/")],
                     **{k: v for k, v in value.items() if k != "$ref"}}
        return {k: normalize(v) for k, v in value.items()}
    return normalize(schema)


def formats():
    return {name: {"type": "json_schema", "name": name, "strict": True,
                   "schema": responses_schema(model)}
            for name, model in (("goal_strategy", GoalStrategy),)}


if __name__ == "__main__":
    path = Path(__file__).with_name("response-schemas.json")
    value = json.dumps(formats(), indent=2) + "\n"
    if "--check" in sys.argv:
        assert path.read_text(encoding="utf-8") == value, "Run python -m vector_agent.response_schema"
        print("Responses schemas match their Pydantic source.")
    else:
        path.write_text(value, encoding="utf-8")
