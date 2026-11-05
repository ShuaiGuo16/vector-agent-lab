"""Accounting only: published-rate estimates never enter model inputs or control."""
from copy import deepcopy

AZURE_SOL_RATES = {"ordinaryInput": 2.0, "cachedInput": .10, "cacheWrite": 2.50, "output": 10.0}
AZURE_PRICE_SOURCE = "https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/provisioned-throughput-sizing#normalized-token-pricing-for-gpt-6-astra-and-newer-models"


class CostLedger:
    def __init__(self):
        self.azure_tokens = dict.fromkeys(AZURE_SOL_RATES, 0)
        self.azure_responses = self.router_responses = self.unpriced_responses = 0
        self.router_usd = 0.0
        self.requests = self.responses_with_usage = 0
        self.by_role = {}
        self.input_tokens = self.output_tokens = 0

    def record(self, response):
        if response.get("kind") == "attempt_accounting":
            self.requests += 1
        if "body" in response:
            self.requests += 1
            return
        usage = response.get("usage") or {}
        if not usage:
            return
        self.input_tokens += usage.get("input_tokens", usage.get("prompt_tokens", 0)) or 0
        self.output_tokens += usage.get("output_tokens", usage.get("completion_tokens", 0)) or 0
        self.responses_with_usage += 1
        provider, model = response.get("apiProvider"), response.get("model") or ""
        azure_usd = router_usd = 0.0
        if provider == "OpenRouter" and isinstance(usage.get("cost"), (float, int)):
            self.router_usd += usage["cost"]
            router_usd = usage["cost"]
            self.router_responses += 1
        elif provider == "Azure" and model.startswith("gpt-6.1-sol"):
            details = usage.get("input_tokens_details") or {}
            cached, writes = details.get("cached_tokens", 0) or 0, details.get("cache_write_tokens", 0) or 0
            ordinary = usage["input_tokens"] - cached - writes
            if ordinary < 0:
                self.unpriced_responses += 1
                return
            self.azure_responses += 1
            for key, count in dict(ordinaryInput=ordinary, cachedInput=cached, cacheWrite=writes,
                                   output=usage["output_tokens"]).items():
                self.azure_tokens[key] += count
                azure_usd += count * AZURE_SOL_RATES[key] / 1_000_000
        else:
            self.unpriced_responses += 1
            return
        role = response.get("role") or ("decisionControl" if response.get("path") == "/alpha/decisions" else
                "initialPlanning" if response.get("purpose") == "initial route and guidance" else
                "planningReview" if response.get("purpose") == "review route and guidance" else "unspecified")
        entry = self.by_role.setdefault(role, {"azureEstimatedUSD": 0.0, "openrouterReportedUSD": 0.0,
                                              "responsesWithUsage": 0, "models": []})
        entry["azureEstimatedUSD"] += azure_usd
        entry["openrouterReportedUSD"] += router_usd
        entry["responsesWithUsage"] += 1
        if model not in entry["models"]:
            entry["models"].append(model)

    def summary(self):
        azure = sum(self.azure_tokens[key] * rate for key, rate in AZURE_SOL_RATES.items()) / 1_000_000
        return {
            "currency": "USD", "azureEstimatedUSD": azure, "openrouterReportedUSD": self.router_usd,
            "byRole": deepcopy(self.by_role),
            "combinedEstimateUSD": azure + self.router_usd if not self.unpriced_responses else None,
            "pricedSubtotalUSD": azure + self.router_usd, "unpricedResponsesWithUsage": self.unpriced_responses,
            "requestsWithoutReturnedUsage": max(0, self.requests - self.responses_with_usage),
            "azureResponsesWithUsage": self.azure_responses, "openrouterResponsesWithCost": self.router_responses,
            "azureTokens": deepcopy(self.azure_tokens), "azureUSDPerMillionTokens": AZURE_SOL_RATES.copy(),
            "azureRateBasis": "GPT-6.1 Sol Global Standard short context; checked 2026-10-18",
            "azurePriceSource": AZURE_PRICE_SOURCE,
            "scope": "Returned response usage, including discarded reviews. Excludes unreturned usage from canceled/failed requests; published-rate estimate, not an invoice. Output already includes reasoning.",
        }
