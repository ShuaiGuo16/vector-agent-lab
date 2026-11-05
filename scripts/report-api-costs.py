"""Offline accounting of recorded usage. Does not call providers or affect control."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
from vector_agent.costs import CostLedger, AZURE_PRICE_SOURCE, AZURE_SOL_RATES
RATES = AZURE_SOL_RATES
SOURCES = [AZURE_PRICE_SOURCE]


def recorded_cost(summary_path):
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    run_id = summary["runId"]
    payloads = [json.loads(line) for line in (ROOT/"runs"/f"{run_id}.jsonl").read_text(encoding="utf-8").splitlines()]
    payloads = [e["data"] for e in payloads if e["type"] == "api_request_payload"]
    attempts = [p for p in payloads if p.get("kind") == "attempt_accounting"]
    # Older logs have ordinary request/response records. Their decoder stays offline.
    records = attempts or [p for p in payloads if "body" in p or p.get("kind") == "response"]
    ledger = CostLedger()
    for record in records:
        if not record.get("apiProvider"):
            provider = summary.get("decisionProvider") if record.get("path") == "/alpha/decisions" else summary.get("modelProvider")
            record = {**record, "apiProvider":"Azure" if provider == "azure" else "OpenRouter"}
        ledger.record(record)
    cost = summary.get("apiCost") or ledger.summary()
    decisions = [p for p in records if p.get("path") == "/alpha/decisions" and p.get("usage")]
    input_tokens = sum((p["usage"].get("input_tokens",p["usage"].get("prompt_tokens",0)) or 0) for p in decisions)
    output_tokens = sum((p["usage"].get("output_tokens",p["usage"].get("completion_tokens",0)) or 0) for p in decisions)
    requests = [p for p in payloads if "body" in p]
    count = sum(p.get("path") == "/alpha/decisions" for p in requests)
    elapsed = (summary.get("final") or {}).get("simTime")
    return {
        "runId":run_id,"startedAt":summary.get("startedAt"),"experimentVersion":summary.get("experimentVersion"),
        "outcome":summary.get("outcome"),"modelProvider":summary.get("modelProvider","openrouter"),
        "planner":summary.get("planner"),"decisionProvider":summary.get("decisionProvider"),
        "providerReportedUSD":cost["openrouterReportedUSD"],"azureSolEstimateUSD":cost["azureEstimatedUSD"],
        "totalRecordedUsageEstimateUSD":cost["combinedEstimateUSD"],"azureSolTokens":cost["azureTokens"],
        "azureSolResponsesWithUsage":cost["azureResponsesWithUsage"],
        "unpricedAzureResponses":cost["unpricedResponsesWithUsage"],
        "requestsWithoutReturnedUsage":cost["requestsWithoutReturnedUsage"],
        "plannerRequests":len(requests)-count,"decisionRequests":count,
        "decisionResponsesWithUsage":len(decisions),"decisionInputTokens":input_tokens,"decisionOutputTokens":output_tokens,
        "meanDecisionInputTokens":input_tokens/len(decisions) if decisions else None,
        "meanDecisionOutputTokens":output_tokens/len(decisions) if decisions else None,
        "executionSeconds":elapsed,"decisionRequestsPerExecutionSecond":count/elapsed if elapsed else None,
    }


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Summarize returned usage from your local runs; makes no API calls.")
    parser.add_argument("run_id", nargs="?", help="Optional run ID; otherwise report all local summaries")
    args = parser.parse_args()
    if args.run_id:
        import re
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", args.run_id):
            parser.error("Invalid run ID")
        paths = [ROOT / "runs" / f"{args.run_id}.summary.json"]
    else:
        paths = sorted((ROOT / "runs").glob("*.summary.json"))
    rows = [recorded_cost(path) for path in paths]
    known = [row["totalRecordedUsageEstimateUSD"] for row in rows
             if row["totalRecordedUsageEstimateUSD"] is not None]
    print(json.dumps({
        "currency": "USD", "runs": rows,
        "pricedSubtotalUSD": sum(known),
        "requestsWithoutReturnedUsage": sum(row["requestsWithoutReturnedUsage"] for row in rows),
        "unpricedResponsesWithUsage": sum(row["unpricedAzureResponses"] for row in rows),
        "azureRateSource": SOURCES,
        "scope": "Returned usage only; Azure uses the rates retained in vector_agent.costs. Missing usage is unknown, not free."
    }, indent=2))


if __name__ == "__main__":
    main()
