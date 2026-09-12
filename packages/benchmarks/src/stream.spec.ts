import { describe, expect, it } from "vitest";

import { executeStreamingRequest } from "./stream.js";

describe("stream telemetry", () => {
	it("assembles tool-call deltas and records content chunks", async () => {
		const chunks = [
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									type: "function",
									function: {
										name: "lookup_",
										arguments: '{"order',
									},
								},
							],
						},
					},
				],
			},
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									function: {
										name: "order",
										arguments: 'Id":"1"}',
									},
								},
							],
						},
					},
				],
			},
			{ choices: [{ delta: { content: "FINAL: " } }] },
			{ choices: [{ delta: { content: "done" }, finish_reason: "stop" }] },
			{
				choices: [],
				usage: { prompt_tokens: 10, completion_tokens: 2 },
			},
		];
		const fetchMock: typeof fetch = async () =>
			new Response(
				`${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`,
			);
		const response = await executeStreamingRequest({
			client: { url: "https://example.com" },
			request: { messages: [{ role: "user", content: "test" }] },
			model: "provider/model",
			timeoutMs: 1_000,
			fetch: fetchMock,
		});

		expect(response.toolCalls).toEqual([
			{
				id: "call_1",
				type: "function",
				function: { name: "lookup_order", arguments: '{"orderId":"1"}' },
			},
		]);
		expect(response.timing.contentChunkCount).toBe(2);
		expect(
			response.streamChunks.filter((chunk) => chunk.kind === "content"),
		).toHaveLength(2);
	});
});
