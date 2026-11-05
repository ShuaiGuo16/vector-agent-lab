from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Action = Literal["drive", "brake", "climb", "cruise", "approach", "descend", "hold"]
ACTIONS = ("drive", "brake", "climb", "cruise", "approach", "descend", "hold")
MODEL_ACTIONS = tuple(a for a in ACTIONS if a != "brake")
Target = Literal["relay-1", "relay-2", "relay-3", "charger", "depot"]
DecisionModel = Literal["typesafe/jev-1.14", "openai/gpt-6-luna-decisions", "microsoft/microsoft-decision-1"]
Vector = Annotated[list[float], Field(min_length=3, max_length=3)]
Nonnegative = Annotated[float, Field(ge=0)]


class WireModel(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True, allow_inf_nan=False)


class Goal(WireModel):
    id: Annotated[str, Field(min_length=1)]
    kind: Literal["drive", "fly", "relay", "charge", "depot", "departure", "wait_review"]
    target: Target | None
    position: Vector | None
    speed: Annotated[float, Field(ge=.5, le=14)]
    guidance: list[str]
    reviewAfter: bool


class Plan(WireModel):
    goals: list[Goal]

    def wire(self):
        return self.model_dump()


class Waypoint(WireModel):
    kind: Literal["departure", "road", "model", "destination"]
    groundedRequired: bool | None = None
    position: Vector
    distance: float
    heightAboveSurface: float


class Observation(WireModel):
    goal: Goal | None = None
    completedGoalIds: list[str] | None = None
    goalLedger: list[dict] | None = None
    reviewSchedule: Literal["every_relay", "planned"] | None = None
    relayHandoffMode: Literal["continuous", "station"] | None = None
    relayHandoffWaiting: bool | None = None
    relayHandoffWaitSeconds: Nonnegative | None = None
    flightThrottle: Annotated[float, Field(ge=0, le=1)] | None = None
    nozzleThrustLevels: Annotated[list[Annotated[float, Field(ge=0, le=1)]], Field(min_length=4, max_length=4)] | None = None
    bodyOrientationQuaternion: Annotated[list[float], Field(min_length=4, max_length=4)] | None = None
    bodyAngularVelocityWorld: Vector | None = None
    bodyUpWorld: Vector | None = None
    bodyHeadingYawRadians: float | None = None
    targetDwellSeconds: Nonnegative | None = None
    lastLandingImpact: Nonnegative | None = None
    chargingEligible: bool | None = None
    onChargingPad: bool | None = None
    chargingStopsCompleted: Annotated[int, Field(ge=0)] | None = None
    waypoint: Waypoint | None = None
    lastAppliedManeuver: Action | None = None
    runId: Annotated[str, Field(max_length=100)]
    seq: Annotated[int, Field(ge=0)]
    simTime: Nonnegative
    wallElapsedSeconds: Nonnegative | None = None
    setupElapsedSeconds: Nonnegative | None = None
    setupPending: bool | None = None
    waypointIndex: Annotated[int, Field(ge=0)] | None = None
    observedAt: float
    position: Vector
    velocity: Vector
    yaw: float
    grounded: bool
    energy: float
    speed: float
    headingError: float
    distance: float
    heightAboveTarget: float
    cruiseAltitude: float
    target: Target
    targetPosition: Vector
    departureComplete: bool
    roadTravelPending: bool
    stage: Annotated[str, Field(max_length=50)]
    completed: list[Target]
    status: Literal["ready", "running", "success", "failed"]
    seed: int
    interventions: Annotated[int, Field(ge=0)]
    collisions: Annotated[int, Field(ge=0)]
    staleSeconds: float
    planVersion: int
    legIndex: int
    paused: bool

    def wire(self):
        value=self.model_dump(exclude_none=True)
        if self.goal is not None:value["goal"]=self.goal.model_dump()
        return value


class Command(WireModel):
    verticalSpeedTarget: float | None
    wheelThrottle: float
    horizontalBrake: bool
    pitchTilt: float
    liftMode: float


class EngineFacts(WireModel):
    actuatorCommandsAtThisState: dict[Action, Command] | None = None

    @field_validator("actuatorCommandsAtThisState")
    @classmethod
    def all_commands(cls, value):
        if value is not None and set(value) != set(ACTIONS):
            raise ValueError("Missing engine command measurements")
        return value


class Start(WireModel):
    type: Literal["start"]
    runId: Annotated[str, Field(pattern=r"^[a-zA-Z0-9_-]{1,80}$")]
    mode: Literal["manual", "baseline", "openrouter"]
    seed: Annotated[int, Field(ge=1, le=99999)]
    decisionModel: DecisionModel
