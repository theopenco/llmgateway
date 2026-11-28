import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import { buildAwsEventStreamMessage } from "./test-utils/mock-openai-server.js";
import { waitForLogs } from "./test-utils/test-helpers.js";

const TOOLS = [
	{
		type: "function",
		function: {
			name: "get_weather",
			parameters: {
				type: "object",
				properties: { city: { type: "string" } },
			},
		},
	},
];

function combine(frames: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const buffer = new Uint8Array(
		frames.reduce((size, frame) => size + frame.length, 0),
	);
	let offset = 0;
	for (const frame of frames) {
		buffer.set(frame, offset);
		offset += frame.length;
	}
	return buffer;
}

function mockUpstream(contentType: string, body: () => BodyInit) {
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async () =>
			new Response(body(), { headers: { "content-type": contentType } }),
	);
}

function openAiSse(chunks: Record<string, unknown>[]): string {
	return (
		chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") +
		"data: [DONE]\n\n"
	);
}

function openAiChunk(delta: Record<string, unknown>, finishReason?: string) {
	return {
		id: "chatcmpl-tool",
		object: "chat.completion.chunk",
		created: 1_700_000_000,
		model: "gpt-4o-mini",
		choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
	};
}

const OPENAI_USAGE_CHUNK = {
	id: "chatcmpl-tool",
	object: "chat.completion.chunk",
	created: 1_700_000_000,
	model: "gpt-4o-mini",
	choices: [],
	usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
};

async function streamChat(model: string): Promise<string> {
	const res = await app.request("/v1/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: "Bearer test-token",
			"x-no-fallback": "true",
		},
		body: JSON.stringify({
			model,
			messages: [{ role: "user", content: "Weather in Paris?" }],
			tools: TOOLS,
			stream: true,
		}),
	});
	expect(res.status).toBe(200);
	return await res.text();
}

async function loggedToolCalls() {
	const [log] = await waitForLogs(1);
	return log.toolResults as
		{ id?: string; function: { name?: string; arguments?: string } }[] | null;
}

describe("streaming tool-call accumulation", () => {
	createGatewayApiTestHarness();

	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "token-id",
			...hashApiKeyForStorage("test-token"),
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	async function addProviderKey(provider: string) {
		await db.insert(tables.providerKey).values({
			id: `provider-key-${provider}`,
			...encryptProviderKeyForStorage(
				"test-provider-key",
				`provider-key-${provider}`,
				"org-id",
			),
			provider,
			organizationId: "org-id",
		});
	}

	it("logs one OpenAI tool call with arguments joined across deltas", async () => {
		await addProviderKey("openai");
		mockUpstream("text/event-stream", () =>
			openAiSse([
				openAiChunk({
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "call_weather",
							type: "function",
							function: { name: "get_weather", arguments: "" },
						},
					],
				}),
				openAiChunk({
					tool_calls: [{ index: 0, function: { arguments: '{"city":' } }],
				}),
				openAiChunk({
					tool_calls: [{ index: 0, function: { arguments: '"Paris"}' } }],
				}),
				openAiChunk({}, "tool_calls"),
				OPENAI_USAGE_CHUNK,
			]),
		);

		await streamChat("openai/gpt-4o-mini");

		const toolCalls = await loggedToolCalls();
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls?.[0]?.id).toBe("call_weather");
		expect(toolCalls?.[0]?.function.name).toBe("get_weather");
		expect(toolCalls?.[0]?.function.arguments).toBe('{"city":"Paris"}');
	});

	it("appends a reused OpenAI index to the latest call and id-less, index-less deltas to the last call", async () => {
		await addProviderKey("openai");
		mockUpstream("text/event-stream", () =>
			openAiSse([
				openAiChunk({
					role: "assistant",
					tool_calls: [
						{
							index: 0,
							id: "call_first",
							type: "function",
							function: { name: "get_weather", arguments: '{"city":"Rome"}' },
						},
					],
				}),
				openAiChunk({
					tool_calls: [
						{
							index: 0,
							id: "call_second",
							type: "function",
							function: { name: "get_weather", arguments: "" },
						},
					],
				}),
				openAiChunk({
					tool_calls: [{ index: 0, function: { arguments: '{"city":' } }],
				}),
				openAiChunk({
					tool_calls: [{ function: { arguments: '"Oslo"}' } }],
				}),
				openAiChunk({}, "tool_calls"),
				OPENAI_USAGE_CHUNK,
			]),
		);

		await streamChat("openai/gpt-4o-mini");

		const toolCalls = await loggedToolCalls();
		expect(
			toolCalls?.map((call) => [call.id, call.function.arguments]),
		).toEqual([
			["call_first", '{"city":"Rome"}'],
			["call_second", '{"city":"Oslo"}'],
		]);
	});

	it("logs one Bedrock tool call with arguments joined across deltas", async () => {
		await addProviderKey("aws-bedrock");
		mockUpstream("application/vnd.amazon.eventstream", () =>
			combine([
				buildAwsEventStreamMessage("messageStart", { role: "assistant" }),
				buildAwsEventStreamMessage("contentBlockStart", {
					contentBlockIndex: 0,
					start: {
						toolUse: { toolUseId: "tooluse_weather", name: "get_weather" },
					},
				}),
				buildAwsEventStreamMessage("contentBlockDelta", {
					contentBlockIndex: 0,
					delta: { toolUse: { input: '{"city":' } },
				}),
				buildAwsEventStreamMessage("contentBlockDelta", {
					contentBlockIndex: 0,
					delta: { toolUse: { input: '"Paris"}' } },
				}),
				buildAwsEventStreamMessage("contentBlockStop", {
					contentBlockIndex: 0,
				}),
				buildAwsEventStreamMessage("messageStop", { stopReason: "tool_use" }),
				buildAwsEventStreamMessage("metadata", {
					usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
				}),
			]),
		);

		await streamChat("aws-bedrock/claude-sonnet-4-5");

		const toolCalls = await loggedToolCalls();
		expect(toolCalls).toHaveLength(1);
		expect(toolCalls?.[0]?.id).toBe("tooluse_weather");
		expect(toolCalls?.[0]?.function.name).toBe("get_weather");
		expect(toolCalls?.[0]?.function.arguments).toBe('{"city":"Paris"}');
	});
});
