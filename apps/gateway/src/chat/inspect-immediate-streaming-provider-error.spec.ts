import { describe, expect, it } from "vitest";

import { inspectImmediateStreamingProviderError } from "./chat.js";

function sseResponse(...events: unknown[]): Response {
	const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
	return new Response(body, {
		headers: { "content-type": "text/event-stream" },
	});
}

describe("inspectImmediateStreamingProviderError", () => {
	it("catches a Responses rate limit error after response.created", async () => {
		const result = await inspectImmediateStreamingProviderError(
			sseResponse(
				{
					type: "response.created",
					response: { id: "resp_1", status: "in_progress" },
					sequence_number: 0,
				},
				{
					type: "error",
					error: {
						type: "too_many_requests",
						code: "rate_limit_exceeded",
						message: "Your requests have exceeded token rate limit.",
						param: null,
					},
					sequence_number: 1,
				},
			),
			"azure",
		);

		expect(result.immediateError).toMatchObject({
			errorCode: "rate_limit_exceeded",
			errorType: "upstream_error",
			inferredStatusCode: 429,
		});
	});

	it("catches an Anthropic error after message_start and ping", async () => {
		const result = await inspectImmediateStreamingProviderError(
			sseResponse(
				{ type: "message_start", message: { id: "msg_1" } },
				{ type: "ping" },
				{
					type: "error",
					error: { type: "overloaded_error", message: "Overloaded" },
				},
			),
			"anthropic",
		);

		expect(result.immediateError).toMatchObject({
			errorCode: "overloaded_error",
			errorMessage: "Overloaded",
		});
	});

	it("catches an early response.failed", async () => {
		const result = await inspectImmediateStreamingProviderError(
			sseResponse(
				{ type: "response.created", response: { id: "resp_1" } },
				{ type: "response.in_progress", response: { id: "resp_1" } },
				{
					type: "response.failed",
					response: {
						id: "resp_1",
						error: { code: "server_error", message: "boom" },
					},
				},
			),
			"openai",
		);

		expect(result.immediateError).toMatchObject({
			errorCode: "server_error",
			errorMessage: "boom",
			errorType: "upstream_error",
		});
	});

	it("passes the stream through once output has started", async () => {
		const events = [
			{ type: "response.created", response: { id: "resp_1" } },
			{ type: "response.output_text.delta", delta: "Hi" },
			{ type: "error", error: { code: "rate_limit_exceeded" } },
		];
		const result = await inspectImmediateStreamingProviderError(
			sseResponse(...events),
			"azure",
		);

		expect(result.immediateError).toBeNull();
		expect(await result.response.text()).toBe(
			await sseResponse(...events).text(),
		);
	});

	it("classifies stream read failures as upstream errors", async () => {
		const response = new Response(
			new ReadableStream<Uint8Array>({
				pull() {
					throw new Error("stream read failed");
				},
			}),
		);

		const result = await inspectImmediateStreamingProviderError(
			response,
			"openai",
		);

		expect(result.immediateError).toEqual({
			errorCode: "stream_read_error",
			errorMessage: "stream read failed",
			errorResponseText: "",
			errorType: "upstream_error",
			inferredStatusCode: 502,
			statusText: "stream_read_error",
		});
	});
});
