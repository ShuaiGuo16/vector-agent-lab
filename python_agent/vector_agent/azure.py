"""Azure endpoints only; route/guidance generation and execution are shared unchanged."""
from urllib.parse import urlsplit

from .errors import APIError
from .provider import OpenRouter, planner_messages


class Azure(OpenRouter):
    name = "Azure"

    def request_endpoint(self, path):
        root = self.config.AZURE_ENDPOINT.strip().rstrip("/")
        parsed = urlsplit(root)
        if not root or not self.config.AZURE_API_KEY.get_secret_value().strip():
            raise APIError("Fill AZURE_ENDPOINT and AZURE_API_KEY in .env and restart the lab.")
        if parsed.scheme not in ("http", "https") or not parsed.netloc or parsed.path or parsed.query or parsed.fragment:
            raise APIError("AZURE_ENDPOINT must be the shared resource root, without an API path or query.")
        route = {"/v1/responses": "/openai/v1/responses", "/alpha/decisions": "/providers/microsoft/v1/systemone"}[path]
        return root + route, {"api-key": self.config.AZURE_API_KEY.get_secret_value(), "Content-Type": "application/json"}

    def response_body(self, value):
        body = super().response_body(value)
        body["model"] = self.config.AZURE_LLM_DEPLOYMENT
        del body["provider"]  # OpenRouter routing preferences are not an Azure API parameter.
        body["input"] = planner_messages(value, cache=True)
        body["prompt_cache_options"] = {"mode": "explicit", "ttl": "30m"}
        body["prompt_cache_key"] = "vector-agent-lab-i63-goals"
        return body

    async def decide(self, o, plan, model, facts, attempt_budget_ms=None):
        return await super().decide(o, plan, self.config.AZURE_DECISION_DEPLOYMENT, facts, attempt_budget_ms)
