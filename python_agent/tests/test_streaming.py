import asyncio
import json
import unittest

import httpx

from vector_agent.provider import OpenRouter, APIError
from support import goal_fixture as fixture, test_config


class Bytes(httpx.AsyncByteStream):
    def __init__(self, value, gate=None):
        self.value, self.gate = value, gate

    async def __aiter__(self):
        # Deliberately split UTF-8 codepoints, CRLFs and event boundaries.
        for i in range(0, len(self.value), 3):
            yield self.value[i:i+3]
        if self.gate:
            await self.gate.wait()


def sse(event):
    return ("data: " + json.dumps(event, ensure_ascii=False) + "\r\n\r\n").encode()


class StreamingContracts(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.o, self.plan, _ = fixture()
        self.audit = []

    def terminal(self):
        return {"id":"resp_test","status":"completed","output_text":json.dumps({"disposition":"revise","goals":self.plan.wire()["goals"]}),"usage":{"cost":.003}}

    async def test_chunked_stream_preserves_schema_and_retains_only_public_text(self):
        value = sse({"type": "response.created", "response": {"id": "resp_test"}})
        value += sse({"type": "response.output_item.added", "item": {"type": "reasoning", "text": "PRIVATE_ITEM_TEXT"}})
        value += sse({"type": "response.reasoning_text.delta", "delta": "PRIVATE_STREAM_TEXT"})
        value += sse({"type": "response.output_text.delta", "delta": "PARTIAL 文本"})
        value += sse({"type": "response.completed", "response": self.terminal()})
        async def handler(request):
            self.assertTrue(json.loads(request.content)["stream"])
            return httpx.Response(200, headers={"content-type": "text/event-stream", "x-ms-region": "test-region",
                                  "x-ratelimit-remaining-tokens": "1000", "set-cookie": "PRIVATE_COOKIE"}, stream=Bytes(value))
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            result = await OpenRouter(test_config(), self.audit.append, client).plan(self.o)
        self.assertEqual(result["plan"].goals, self.plan.goals)
        timing = result["transportTimings"]
        self.assertEqual(timing["mode"], "sse")
        self.assertGreaterEqual(timing["terminalMs"], timing["firstEventMs"])
        self.assertEqual(timing["eventCounts"]["response.completed"], 1)
        self.assertEqual(result["usage"]["cost"], .003)
        self.assertNotIn("PRIVATE_STREAM_TEXT", json.dumps(self.audit))
        self.assertNotIn("PRIVATE_ITEM_TEXT", json.dumps(self.audit))
        self.assertNotIn("PRIVATE_COOKIE", json.dumps(self.audit))
        self.assertEqual(timing["outputItemTypes"], {"reasoning": 1})
        self.assertEqual(timing["responseStatus"], "completed")
        self.assertEqual(timing["providerMetadata"]["x-ms-region"], "test-region")
        self.assertIn("PARTIAL", json.dumps(self.audit))
        self.assertEqual(timing["publicOutputCharacters"], len("PARTIAL 文本"))
        self.assertTrue(all(not e["executable"] for e in self.audit if e.get("kind") == "public_output_chunk"))

    async def test_no_plan_is_returned_before_terminal_response(self):
        gate = asyncio.Event()
        class Delayed(httpx.AsyncByteStream):
            async def __aiter__(inner):
                yield sse({"type": "response.output_text.delta", "delta": "{}"})
                await gate.wait()
                yield sse({"type": "response.completed", "response": self.terminal()})
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=Delayed()))) as client:
            task = asyncio.create_task(OpenRouter(test_config(), self.audit.append, client).plan(self.o))
            await asyncio.sleep(.01)
            self.assertFalse(task.done())
            gate.set()
            await task

    async def test_cancelled_stream_keeps_public_output_without_executing_it(self):
        arrived = asyncio.Event()
        class Incomplete(httpx.AsyncByteStream):
            async def __aiter__(inner):
                yield sse({"type": "response.reasoning_text.delta", "delta": "PRIVATE_REASONING"})
                yield sse({"type": "response.output_text.delta", "delta": '{"route":'})
                arrived.set()
                await asyncio.Future()
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=Incomplete()))) as client:
            task = asyncio.create_task(OpenRouter(test_config(), self.audit.append, client).plan(self.o))
            await arrived.wait()
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        chunks = [e for e in self.audit if e.get("kind") == "public_output_chunk"]
        self.assertEqual("".join(c["text"] for e in chunks for c in e["chunks"]), '{"route":')
        self.assertTrue(all(not e["executable"] for e in chunks))
        self.assertNotIn("PRIVATE_REASONING", json.dumps(self.audit))

    async def test_truncated_stream_is_transient_but_invalid_json_is_not(self):
        for value, retryable in [(sse({"type": "response.created"}), True), (b"data: invalid\n\n", False)]:
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200, headers={"content-type": "text/event-stream"}, stream=Bytes(value)))) as client:
                with self.assertRaises(APIError) as caught:
                    await OpenRouter(test_config(), self.audit.append, client).plan(self.o)
                self.assertEqual(caught.exception.retryable, retryable)

    async def test_retry_after_and_http_classification_do_not_echo_upstream_body(self):
        for status, retryable in [(429, True), (503, True), (524, True), (529, True), (401, False), (400, False)]:
            async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(status, headers={"retry-after": "2"}, text="PRIVATE_ERROR_BODY"))) as client:
                with self.assertRaises(APIError) as caught:
                    await OpenRouter(test_config(), self.audit.append, client).plan(self.o)
                self.assertEqual(caught.exception.retryable, retryable)
                self.assertEqual(caught.exception.retry_after, 2)
                self.assertNotIn("PRIVATE_ERROR_BODY", str(caught.exception))
