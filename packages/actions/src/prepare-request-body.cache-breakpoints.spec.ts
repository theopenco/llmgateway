import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type {
	BaseMessage,
	ProviderCacheControlMode,
	ProviderId,
} from "@llmgateway/models";

const toolCall = (id: string): BaseMessage => ({
	role: "assistant",
	content: "",
	tool_calls: [
		{
			id,
			type: "function",
			function: { name: "read_file", arguments: '{"path":"src/app.ts"}' },
		},
	],
});

const toolLoop: BaseMessage[] = [
	{ role: "system", content: "You are a coding agent." },
	{ role: "user", content: "Fix the failing test." },
	toolCall("call_1"),
	{ role: "tool", tool_call_id: "call_1", content: "first file" },
	toolCall("call_2"),
	{ role: "tool", tool_call_id: "call_2", content: "second file" },
];

const chat: BaseMessage[] = [
	{ role: "system", content: "You are a helpful assistant." },
	{ role: "user", content: "Hello!" },
	{ role: "assistant", content: "Hi, how can I help?" },
	{ role: "user", content: "Tell me a joke." },
];

async function prepare(
	provider: ProviderId,
	messages: BaseMessage[],
	mode: ProviderCacheControlMode = "auto",
) {
	return (await prepareRequestBody(
		provider,
		"claude-opus-4-7",
		null,
		"claude-opus-4-7",
		structuredClone(messages),
		false,
		undefined,
		1024,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		false,
		20,
		null,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		mode,
	)) as { messages: Array<{ content: Array<Record<string, unknown>> }> };
}

function markerCount(body: unknown): number {
	if (Array.isArray(body)) {
		return body.reduce<number>((sum, item) => sum + markerCount(item), 0);
	}
	if (body && typeof body === "object") {
		return Object.entries(body).reduce<number>(
			(sum, [key, value]) =>
				sum +
				(key === "cache_control" || key === "cachePoint"
					? 1
					: markerCount(value)),
			0,
		);
	}
	return 0;
}

const anthropicFormat: ProviderId[] = [
	"anthropic",
	"vertex-anthropic",
	"azure-anthropic",
];

describe("automatic cache breakpoint on the conversation tail", () => {
	test.each(anthropicFormat)(
		"%s marks the latest tool result of a tool loop",
		async (provider) => {
			const body = await prepare(provider, toolLoop);

			expect(body.messages.at(-1)!.content.at(-1)).toMatchObject({
				type: "tool_result",
				content: "second file",
				cache_control: { type: "ephemeral" },
			});
			expect(markerCount(body)).toBe(1);
		},
	);

	test.each(anthropicFormat)(
		"%s marks the new user message of a chat",
		async (provider) => {
			const body = await prepare(provider, chat);

			expect(body.messages.at(-1)!.content.at(-1)).toMatchObject({
				type: "text",
				text: "Tell me a joke.",
				cache_control: { type: "ephemeral" },
			});
			expect(markerCount(body)).toBe(1);
		},
	);

	test("aws-bedrock ends the latest tool result with a cachePoint", async () => {
		const body = await prepare("aws-bedrock", toolLoop);

		expect(body.messages.at(-1)!.content).toEqual([
			expect.objectContaining({
				toolResult: expect.objectContaining({ toolUseId: "call_2" }),
			}),
			{ cachePoint: { type: "default" } },
		]);
		expect(markerCount(body)).toBe(1);
	});

	test("aws-bedrock ends the new user message of a chat with a cachePoint", async () => {
		const body = await prepare("aws-bedrock", chat);

		expect(body.messages.at(-1)!.content).toEqual([
			{ text: "Tell me a joke." },
			{ cachePoint: { type: "default" } },
		]);
		expect(markerCount(body)).toBe(1);
	});

	test.each([...anthropicFormat, "aws-bedrock" as const])(
		"%s adds no breakpoint to the first turn",
		async (provider) => {
			const body = await prepare(provider, chat.slice(0, 2));

			expect(markerCount(body)).toBe(0);
		},
	);

	test.each([...anthropicFormat, "aws-bedrock" as const])(
		"%s adds no breakpoint in client-managed mode",
		async (provider) => {
			const body = await prepare(provider, toolLoop, "passthrough");

			expect(markerCount(body)).toBe(0);
		},
	);
});
