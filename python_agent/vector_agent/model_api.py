"""Explicit provider routing per role. No model fallback or strategy transformation."""
from .azure import Azure
from .provider import OpenRouter


class ModelAPI:
    def __init__(self, config, audit, client):
        providers = {"azure": Azure, "openrouter": OpenRouter}
        self.planner = providers[config.MODEL_PROVIDER](config, audit, client)
        self.executor = providers[config.decision_provider()](config, audit, client)
        review_config = config.model_copy(update={"MODEL_PROVIDER": config.review_provider(),
            "PLANNER_MODEL": config.review_model(), "AZURE_LLM_DEPLOYMENT": config.review_model()})
        # Keep the same planner instructions/context when an Azure initial planner
        # uses an OpenRouter model for subsequent reviews.
        self.reviewer = providers[config.review_provider()](review_config, audit, client,
            shared_planner_context=config.MODEL_PROVIDER == "azure")

    async def plan(self, observation, previous=None, *args, **kwargs):
        backend = self.reviewer if previous is not None else self.planner
        return await backend.plan(observation, previous, *args, **kwargs)

    async def decide(self, *args, **kwargs):
        return await self.executor.decide(*args, **kwargs)
