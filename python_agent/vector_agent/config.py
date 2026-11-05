from pathlib import Path
import json
import os
from typing import Literal

from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from .identity import SOURCE_IDENTITY

ROOT = Path(__file__).resolve().parents[2]


class Config(BaseModel):
    model_config = ConfigDict(extra="ignore")
    OPENROUTER_API_KEY: SecretStr = SecretStr("")
    OPENROUTER_BASE_URL: str = "https://openrouter.ai/api"
    OPENROUTER_SITE_URL: str = "http://127.0.0.1:5175"
    OPENROUTER_APP_NAME: str = "VECTOR Agent Lab"
    MODEL_PROVIDER: Literal["openrouter", "azure"] = "openrouter"
    DECISION_PROVIDER: Literal["inherit", "openrouter", "azure"] = "inherit"
    REVIEW_PROVIDER: Literal["inherit", "openrouter", "azure"] = "inherit"
    REVIEW_MODEL: str | None = None
    REVIEW_SCHEDULE: Literal["every_relay", "planned"] = "every_relay"
    AZURE_ENDPOINT: str = ""
    AZURE_API_KEY: SecretStr = SecretStr("")
    AZURE_LLM_DEPLOYMENT: str = "gpt-6.1-sol"
    AZURE_DECISION_DEPLOYMENT: str = "Decision-1"
    MAX_TRANSIENT_RETRIES: int = Field(default=1, ge=0, le=1)
    API_RETRY_DELAY_MS: int = Field(default=250, ge=0)
    PLANNER_MODEL: str = "openai/gpt-6-luna"
    PLANNER_REASONING_EFFORT: str = "medium"
    PLANNER_TIMEOUT_MS: int = Field(default=180000, ge=1)
    PLANNER_MAX_OUTPUT_TOKENS: int = Field(default=16000, ge=1)
    DECISION_MODEL: str = "typesafe/jev-1.14"
    DECISION_INTERVAL_MS: int = Field(default=250, ge=0)
    DECISION_TIMEOUT_MS: int = Field(default=5000, ge=1)
    ACTION_MAX_AGE_MS: int = Field(default=900, ge=1)
    MAX_API_CALLS_PER_RUN: int = Field(default=3000, ge=1)
    PORT: int = Field(default=5180, ge=1024, le=65535)
    PYTHON_AGENT_PORT: int = Field(default=8176, ge=1024, le=65535)

    @classmethod
    def load(cls):
        load_dotenv(ROOT / ".env", override=False)
        values = dict(os.environ)
        if values.get("MODEL_PROVIDER") == "azure":
            values["PLANNER_MODEL"] = values.get("AZURE_LLM_DEPLOYMENT", "gpt-6.1-sol")
        decision_provider = values.get("DECISION_PROVIDER", "inherit")
        if (values.get("MODEL_PROVIDER") if decision_provider == "inherit" else decision_provider) == "azure":
            values["DECISION_MODEL"] = "microsoft/microsoft-decision-1"
        return cls.model_validate(values)

    def decision_provider(self):
        return self.MODEL_PROVIDER if self.DECISION_PROVIDER == "inherit" else self.DECISION_PROVIDER

    def review_provider(self):
        return self.MODEL_PROVIDER if self.REVIEW_PROVIDER == "inherit" else self.REVIEW_PROVIDER

    def review_model(self):
        return self.REVIEW_MODEL or (self.AZURE_LLM_DEPLOYMENT if self.review_provider() == "azure" else self.PLANNER_MODEL)

    def configured(self):
        available = {"azure": bool(self.AZURE_ENDPOINT.strip() and self.AZURE_API_KEY.get_secret_value().strip()),
                     "openrouter": bool(self.OPENROUTER_API_KEY.get_secret_value().strip())}
        return all(available[p] for p in (self.MODEL_PROVIDER, self.decision_provider(), self.review_provider()))

    def public(self):
        return dict(sourceIdentity=SOURCE_IDENTITY, configured=self.configured(), provider=self.MODEL_PROVIDER, decisionProvider=self.decision_provider(),
                    reviewProvider=self.review_provider(), reviewModel=self.review_model(), reviewSchedule=self.REVIEW_SCHEDULE,
                    plannerModel=self.PLANNER_MODEL, reasoning=self.PLANNER_REASONING_EFFORT,
                    decisionModel=self.DECISION_MODEL, decisionInterval=self.DECISION_INTERVAL_MS,
                    maxActionAge=self.ACTION_MAX_AGE_MS, maxCalls=self.MAX_API_CALLS_PER_RUN,
                    plannerTimeoutMs=self.PLANNER_TIMEOUT_MS, plannerMaxOutputTokens=self.PLANNER_MAX_OUTPUT_TOKENS,
                    decisionTimeoutMs=self.DECISION_TIMEOUT_MS, maxTransientRetries=self.MAX_TRANSIENT_RETRIES,
                    apiRetryDelayMs=self.API_RETRY_DELAY_MS, retryBudgetScope="full budget per attempt; backoff between attempts",
                    agentBackend="python")

    def audit(self):
        return {k: v for k, v in self.model_dump(mode="json").items() if k not in ("OPENROUTER_API_KEY", "AZURE_API_KEY")}


def apply_candidate():
    values = json.loads((ROOT / 'config/working-candidate.json').read_text())
    os.environ.update({key: str(value) for key, value in values.items()})


if __name__ == '__main__':
    print(json.dumps(Config.load().public()))
