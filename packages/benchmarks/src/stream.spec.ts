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

it("preserves opaque tool metadata across later argument deltas", async () => {
	const extra = {
		google: { thought_signature: "signature-fixture" },
		opaque: { values: [1, "value"] },
	};
	const provider = { google: { thought_signature: "signature-fixture" } };
	const chunks = [
		{
			index: 0,
			id: "call",
			function: { name: "ping", arguments: "{" },
			extra_content: extra,
		},
		{
			index: 0,
			function: { arguments: '"value":1' },
			provider_extra: provider,
		},
		{ index: 0, function: { arguments: "}" } },
	];
	const response = await executeStreamingRequest({
		client: { url: "https://gateway.example" },
		request: { messages: [] },
		model: "fixture",
		timeoutMs: 1000,
		fetch: async () =>
			new Response(
				chunks
					.map(
						(call) =>
							`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [call] } }] })}\n\n`,
					)
					.join("") + "data: [DONE]\n\n",
			),
	});
	expect(response.toolCalls).toEqual([
		{
			id: "call",
			type: "function",
			function: { name: "ping", arguments: '{"value":1}' },
			extra_content: extra,
			provider_extra: provider,
		},
	]);
});

it("marks a normalized provider-error frame as a failed benchmark", async () => {
	const response = await executeStreamingRequest({
		client: { url: "https://gateway.example" },
		request: { messages: [] },
		model: "fixture",
		timeoutMs: 1000,
		fetch: async () =>
			new Response(
				`event: error\ndata: ${JSON.stringify({ error: { type: "provider_error", message: "Provider inference failed" } })}\n\n`,
				{ headers: { "content-type": "text/event-stream" } },
			),
	});
	expect(response.error?.code).toBe("upstream_stream_error");
	expect(response.content).toBe("");
});
