"""One HTTP attempt. Public output is auditable; only terminal output becomes a plan."""
import asyncio
import codecs
from collections import Counter
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import json
import time
from uuid import uuid4

import httpx

from .context import js_json
from .errors import APIError

TRANSIENT_HTTP = {408, 429, 500, 502, 503, 504, 524, 529}
TRANSIENT_CODES = {"server_error", "rate_limit_exceeded", "service_unavailable", "no_capacity"}


def retry_after_seconds(value):
    if not value:
        return None
    try:
        return max(0, float(value))
    except ValueError:
        try:
            return max(0, (parsedate_to_datetime(value) - datetime.now(timezone.utc)).total_seconds())
        except (ValueError, TypeError, OverflowError):
            return None


async def request_json(client, url, path, body, headers, timeout_ms, audit, provider_name="OpenRouter", purpose=None):
    started = time.perf_counter()
    elapsed = lambda: round((time.perf_counter() - started) * 1000)
    counts = Counter()
    item_types = Counter()
    timing = dict(requestId=str(uuid4()), attemptBudgetMs=timeout_ms, mode=None, headersMs=None, firstByteMs=None,
                  firstEventMs=None, firstOutputTextMs=None, terminalMs=None,
                  lastEventMs=None, lastEventType=None, responseId=None)
    outcome = "cancelled"
    error_code = None
    usage = None
    model = body.get("model")
    audit(dict(path=path, body=body, apiProvider=provider_name, requestId=timing["requestId"]))
    public_chunks = []
    public_chars = public_whitespace_chars = 0
    last_public_flush = started

    def flush_public():
        nonlocal last_public_flush
        if public_chunks:
            audit(dict(kind="public_output_chunk", path=path, requestId=timing["requestId"],
                       elapsedMs=elapsed(), chunks=public_chunks[:], executable=False))
            public_chunks.clear()
        last_public_flush = time.perf_counter()

    def progress(phase):
        audit(dict(kind="transport_progress", path=path, phase=phase, **timing))

    async def chunks(response):
        async for chunk in response.aiter_bytes():
            if chunk and timing["firstByteMs"] is None:
                timing["firstByteMs"] = elapsed()
            yield chunk

    try:
        async with asyncio.timeout(timeout_ms / 1000):
            async with client.stream("POST", url, content=js_json(body), headers=headers, timeout=None) as response:
                timing["headersMs"] = elapsed()
                timing["httpStatus"] = response.status_code
                timing["providerRequestId"] = response.headers.get("x-request-id") or response.headers.get("x-ms-request-id")
                timing["providerMetadata"] = {k: response.headers[k] for k in (
                    "x-request-id", "apim-request-id", "x-ms-request-id", "x-ms-region",
                    "x-ratelimit-remaining-tokens", "x-ratelimit-remaining-requests", "retry-after")
                    if k in response.headers}
                progress("headers")
                if not response.is_success:
                    code = response.status_code
                    # Keep useful typed API validation messages, never an arbitrary response body.
                    try:
                        error = json.loads(await response.aread()).get("error", {})
                        raw_error = error.get("metadata", {}).get("raw")
                        if isinstance(raw_error, str):
                            error = json.loads(raw_error).get("error", error)
                        detail = {k: error.get(k) for k in ("code", "type", "param", "message") if isinstance(error.get(k), (str, int))}
                        for k, value in detail.items():
                            if isinstance(value, str):
                                for name, secret in headers.items():
                                    if name.lower() in ("authorization", "api-key"):
                                        for token in (secret, secret.removeprefix("Bearer ")):
                                            if token:
                                                value = value.replace(token, "[REDACTED]")
                                detail[k] = value[:2000]
                        audit(dict(kind="http_error_detail", path=path, httpStatus=code, detail=detail))
                    except (ValueError, TypeError, AttributeError):
                        pass
                    hint = {401: " — check API key", 402: " — check credits", 429: " — rate limited"}.get(code, "")
                    raise APIError(f"{provider_name} HTTP {code}{hint}", retryable=code in TRANSIENT_HTTP,
                                   retry_after=retry_after_seconds(response.headers.get("retry-after")), code=f"http_{code}")
                if "text/event-stream" not in response.headers.get("content-type", "").lower():
                    timing["mode"] = "json"
                    raw = b"".join([chunk async for chunk in chunks(response)])
                    data = json.loads(raw)
                    if not isinstance(data, dict):
                        raise APIError(f"{provider_name} returned an invalid response object")
                    usage, model = data.get("usage"), data.get("model") or model
                else:
                    timing["mode"] = "sse"
                    terminal = None
                    decoder = codecs.getincrementaldecoder("utf-8")()
                    pending, data_lines = "", []

                    def dispatch():
                        nonlocal terminal, public_chars, public_whitespace_chars, usage, model
                        if not data_lines:
                            return
                        value = "\n".join(data_lines)
                        data_lines.clear()
                        if value == "[DONE]":
                            return
                        event = json.loads(value)
                        if not isinstance(event, dict):
                            raise APIError("Invalid streaming event")
                        name = event.get("type", "unknown")
                        if not isinstance(name, str):
                            raise APIError("Invalid streaming event type")
                        counts[name] += 1
                        timing["lastEventMs"], timing["lastEventType"] = elapsed(), name
                        if timing["firstEventMs"] is None:
                            timing["firstEventMs"] = elapsed()
                            progress("first_event")
                        candidate = event.get("response")
                        if isinstance(candidate, dict) and candidate.get("id"):
                            timing["responseId"] = candidate["id"]
                        if isinstance(candidate, dict):
                            usage = candidate.get("usage") or usage
                            model = candidate.get("model") or model
                            timing["responseStatus"] = candidate.get("status")
                            timing["incompleteDetails"] = candidate.get("incomplete_details")
                        if name == "response.output_item.added":
                            item_type = event.get("item", {}).get("type")
                            if isinstance(item_type, str):
                                item_types[item_type] += 1
                                # Log only the type; never reasoning text or arbitrary item payloads.
                                audit(dict(kind="transport_item", path=path, requestId=timing["requestId"],
                                           elapsedMs=elapsed(), itemType=item_type))
                        if name == "response.output_text.delta" and timing["firstOutputTextMs"] is None:
                            timing["firstOutputTextMs"] = elapsed()
                            progress("first_output_text")
                        if name == "response.output_text.delta" and isinstance(event.get("delta"), str):
                            delta = event["delta"]
                            public_chars += len(delta)
                            public_whitespace_chars += sum(c.isspace() for c in delta)
                            public_chunks.append({"outputIndex": event.get("output_index", 0),
                                                  "contentIndex": event.get("content_index", 0), "text": delta})
                            if time.perf_counter() - last_public_flush >= 1:
                                flush_public()
                        if name in ("response.completed", "response.incomplete", "response.failed"):
                            timing["terminalMs"] = elapsed()
                            if not isinstance(candidate, dict):
                                raise APIError("Streaming terminal event omitted its response")
                            terminal = candidate
                        if name in ("error", "response.failed"):
                            error = (candidate or {}).get("error") or event.get("error") or event
                            code = error.get("code")
                            raise APIError(f"{provider_name} streaming API error", (candidate or {}).get("usage"),
                                           retryable=code in TRANSIENT_CODES | TRANSIENT_HTTP, code=code)
                        # Only explicitly public output_text deltas are retained. Never private reasoning.

                    async for chunk in chunks(response):
                        pending += decoder.decode(chunk)
                        while "\n" in pending:
                            line, pending = pending.split("\n", 1)
                            line = line.rstrip("\r")
                            if not line:
                                dispatch()
                            elif line.startswith("data:"):
                                data_lines.append(line[5:].lstrip(" "))
                        if terminal is not None:
                            break
                    if terminal is None:
                        pending += decoder.decode(b"", final=True)
                        if pending.startswith("data:"):
                            data_lines.append(pending[5:].lstrip(" "))
                        dispatch()
                    if terminal is None:
                        raise APIError(f"{provider_name} stream ended before a terminal response", retryable=True, code="stream_eof")
                    data = terminal
                outcome = "api_error" if data.get("error") else data.get("status") or "completed"
                return data, timing
    except TimeoutError:
        outcome, error_code = "timeout", "deadline"
        raise APIError(f"{provider_name} request timeout", retryable=True, code="deadline") from None
    except httpx.TransportError:
        outcome, error_code = "transport_error", "transport"
        raise APIError(f"{provider_name} transport error", retryable=True, code="transport") from None
    except (ValueError, UnicodeError):
        outcome, error_code = "invalid_payload", "invalid_payload"
        raise APIError(f"{provider_name} returned invalid response JSON", code="invalid_payload") from None
    except APIError as error:
        outcome, error_code = "api_error", error.code
        raise
    finally:
        flush_public()
        timing["elapsedMs"] = elapsed()
        timing["eventCounts"] = dict(counts)
        timing["outputItemTypes"] = dict(item_types)
        timing["publicOutputCharacters"] = public_chars
        timing["publicWhitespaceCharacters"] = public_whitespace_chars
        audit(dict(kind="attempt_accounting", requestId=timing["requestId"], path=path,
                   apiProvider=provider_name, model=model, purpose=purpose, outcome=outcome,
                   role="decisionControl" if path == "/alpha/decisions" else "initialPlanning" if purpose == "initial route and guidance" else "planningReview",
                   usage=usage, errorCode=error_code))
        audit(dict(kind="transport_diagnostics", path=path, outcome=outcome, errorCode=error_code, **timing))
