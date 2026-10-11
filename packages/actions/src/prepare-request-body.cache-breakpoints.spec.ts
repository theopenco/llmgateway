import { describe, expect, test } from "vitest";

import { models } from "@llmgateway/models";

import { prepareRequestBody } from "./prepare-request-body.js";

import type {
	BaseMessage,
	OpenAIToolInput,
	ProviderCacheAutoTtl,
	ProviderModelMapping,
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

const toolLoop = (): BaseMessage[] => [
	{ role: "system", content: "You are a coding agent." },
	{ role: "user", content: "Fix the failing test." },
	toolCall("call_1"),
	{ role: "tool", tool_call_id: "call_1", content: "first file" },
	toolCall("call_2"),
	{ role: "tool", tool_call_id: "call_2", content: "second file" },
];

const chat = (): BaseMessage[] => [
	{ role: "system", content: "You are a helpful assistant." },
	{ role: "user", content: "Hello!" },
	{ role: "assistant", content: "Hi, how can I help?" },
	{ role: "user", content: "Tell me a joke." },
];

async function prepare(
	provider: ProviderId,
	messages: BaseMessage[],
	mode: ProviderCacheControlMode = "auto",
	ttl: ProviderCacheAutoTtl = "5m",
	tools?: OpenAIToolInput[],
	mapping?: ProviderModelMapping,
) {
	return (await prepareRequestBody(
		provider,
		"claude-opus-4-7",
		null,
		"claude-opus-4-7",
		messages,
		false,
		undefined,
		1024,
		undefined,
		undefined,
		undefined,
		undefined,
		tools,
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
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		mapping,
		undefined,
		ttl,
	)) as { messages: Array<{ content: Array<Record<string, unknown>> }> };
}

function markers(body: unknown): unknown[] {
	if (Array.isArray(body)) {
		return body.flatMap(markers);
	}
	if (body && typeof body === "object") {
		return Object.entries(body).flatMap(([key, value]) =>
			key === "cache_control" || key === "cachePoint"
				? [value]
				: markers(value),
		);
	}
	return [];
}

const anthropicFormat: ProviderId[] = [
	"anthropic",
	"vertex-anthropic",
	"azure-anthropic",
];

describe("automatic conversation breakpoints", () => {
	test.each(anthropicFormat)(
		"%s marks the latest tool result of a tool loop",
		async (provider) => {
			const body = await prepare(provider, toolLoop());

			expect(body.messages.at(-1)!.content.at(-1)).toMatchObject({
				type: "tool_result",
				content: "second file",
				cache_control: { type: "ephemeral" },
			});
			// The turn before it holds only tool_use, so the boundary has no target.
			expect(markers(body)).toHaveLength(1);
		},
	);

	test.each(anthropicFormat)(
		"%s marks the turn boundary and the new user message of a chat",
		async (provider) => {
			const body = await prepare(provider, chat());

			expect(body.messages.at(-2)!.content.at(-1)).toMatchObject({
				text: "Hi, how can I help?",
				cache_control: { type: "ephemeral" },
			});
			expect(body.messages.at(-1)!.content.at(-1)).toMatchObject({
				text: "Tell me a joke.",
				cache_control: { type: "ephemeral" },
			});
			expect(markers(body)).toHaveLength(2);
		},
	);

	test("aws-bedrock marks the tool call turn and the latest tool result", async () => {
		const body = await prepare("aws-bedrock", toolLoop());

		expect(body.messages.at(-2)!.content.at(-1)).toEqual({
			cachePoint: { type: "default" },
		});
		expect(body.messages.at(-1)!.content).toEqual([
			expect.objectContaining({
				toolResult: expect.objectContaining({ toolUseId: "call_2" }),
			}),
			{ cachePoint: { type: "default" } },
		]);
		expect(markers(body)).toHaveLength(2);
	});

	test("aws-bedrock marks the turn boundary and the new user message of a chat", async () => {
		const body = await prepare("aws-bedrock", chat());

		expect(body.messages.slice(-2).map((message) => message.content)).toEqual([
			[{ text: "Hi, how can I help?" }, { cachePoint: { type: "default" } }],
			[{ text: "Tell me a joke." }, { cachePoint: { type: "default" } }],
		]);
	});

	test.each([...anthropicFormat, "aws-bedrock" as const])(
		"%s adds no breakpoint to the first turn",
		async (provider) => {
			const body = await prepare(provider, chat().slice(0, 2));

			expect(markers(body)).toEqual([]);
		},
	);

	test.each([...anthropicFormat, "aws-bedrock" as const])(
		"%s adds no breakpoint in client-managed mode",
		async (provider) => {
			const body = await prepare(provider, toolLoop(), "passthrough");

			expect(markers(body)).toEqual([]);
		},
	);

	test.each(anthropicFormat)(
		"%s leaves the caller's messages unchanged",
		async (provider) => {
			const messages: BaseMessage[] = [
				...chat().slice(0, 2),
				{
					role: "assistant",
					content: [{ type: "text", text: "Hi, how can I help?" }],
				},
				{ role: "user", content: [{ type: "text", text: "Tell me a joke." }] },
			];
			const sent = structuredClone(messages);

			const body = await prepare(provider, messages);

			expect(markers(body)).toHaveLength(2);
			// A fallback re-prepares these same objects for the next provider.
			expect(messages).toEqual(sent);
		},
	);

	test.each(anthropicFormat)(
		"%s keeps the boundary marker when the new message is only an image",
		async (provider) => {
			const pixel =
				"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
			const body = await prepare(provider, [
				...chat().slice(0, 3),
				{
					role: "user",
					content: [{ type: "image_url", image_url: { url: pixel } }],
				},
			]);

			expect(body.messages.at(-2)!.content.at(-1)).toMatchObject({
				text: "Hi, how can I help?",
				cache_control: { type: "ephemeral" },
			});
			expect(markers(body)).toHaveLength(1);
		},
	);

	test.each(anthropicFormat)(
		"%s counts markers on replayed native blocks toward the limit",
		async (provider) => {
			const marked = (ttl?: "1h") =>
				Array.from({ length: 4 }, (_, index) => ({
					type: "text",
					text: `replayed ${index}`,
					cache_control: { type: "ephemeral", ...(ttl && { ttl }) },
				}));
			const withNative = (
				blocks: NonNullable<BaseMessage["anthropic_native_blocks"]>,
			): BaseMessage[] => [
				{ role: "user", content: "Look it up." },
				{ ...toolCall("call_1"), anthropic_native_blocks: blocks },
				{ role: "tool", tool_call_id: "call_1", content: "found" },
			];

			const full = await prepare(provider, withNative(marked()));
			expect(markers(full)).toHaveLength(4);

			// A 5m marker must not land before a caller's 1h one.
			const oneHour = await prepare(provider, withNative(marked("1h")));
			expect(markers(oneHour)).toEqual(
				Array.from({ length: 4 }, () => ({ type: "ephemeral", ttl: "1h" })),
			);
		},
	);

	test.each(["anthropic", "aws-bedrock"] as const)(
		"%s marks the latest tool result after long opening messages",
		async (provider) => {
			const body = await prepare(provider, [
				{ role: "system", content: "S".repeat(20000) },
				{ role: "user", content: "U".repeat(20000) },
				{ role: "assistant", content: "A".repeat(20000) },
				{ role: "user", content: "V".repeat(20000) },
				...toolLoop().slice(2),
			]);

			expect(JSON.stringify(body.messages.at(-1)!.content.at(-1))).toMatch(
				/"(cache_control|cachePoint)"/,
			);
		},
	);

	test.each(["vertex-anthropic", "azure-anthropic"] as const)(
		"%s keeps a caller's fourth marker past a long message",
		async (provider) => {
			const body = await prepare(provider, [
				{
					role: "system",
					content: ["one", "two", "three"].map((text) => ({
						type: "text" as const,
						text,
						cache_control: { type: "ephemeral" as const },
					})),
				},
				{ role: "user", content: "A".repeat(20000) },
				toolCall("call_1"),
				{
					role: "tool",
					tool_call_id: "call_1",
					content: "result",
					tool_result_cache_control: { type: "ephemeral" },
				},
			]);

			expect(body.messages.at(-1)!.content.at(-1)).toMatchObject({
				type: "tool_result",
				cache_control: { type: "ephemeral" },
			});
			expect(markers(body)).toHaveLength(4);
		},
	);
});

describe("automatic cache duration", () => {
	const providers = [...anthropicFormat, "aws-bedrock" as const];

	test.each(providers)(
		"%s applies 1h to every automatic breakpoint",
		async (provider) => {
			const messages = chat();
			messages[0]!.content = "Stable instructions. ".repeat(1500);
			messages[1]!.content = "Long opening turn. ".repeat(1500);
			const before = structuredClone(messages);
			const defaults = await prepare(provider, messages);
			const extended = await prepare(provider, messages, "auto", "1h");
			expect(markers(extended).length).toBeGreaterThanOrEqual(3);
			expect(markers(extended)).toHaveLength(markers(defaults).length);
			for (const marker of markers(extended)) {
				expect(marker).toHaveProperty("ttl", "1h");
			}
			expect(extended.messages.at(-1)!.content.at(-1)).toMatchObject(
				provider === "aws-bedrock"
					? { cachePoint: { ttl: "1h" } }
					: { cache_control: { ttl: "1h" } },
			);
			expect(messages).toEqual(before);
			// Retrying against a different mapping must re-evaluate support.
			const mapping = models
				.find((model) => model.id === "claude-opus-4-7")!
				.providers.find((entry) => entry.providerId === provider)!;
			const unsupported = await prepare(
				provider,
				messages,
				"auto",
				"1h",
				undefined,
				{ ...mapping, cacheWriteInputPrice1h: undefined },
			);
			expect(unsupported).toEqual(defaults);
		},
	);

	test.each(providers)(
		"%s applies 1h to the latest tool result",
		async (provider) => {
			const body = await prepare(provider, toolLoop(), "auto", "1h");
			expect(markers(body).length).toBeGreaterThan(0);
			for (const marker of markers(body)) {
				expect(marker).toHaveProperty("ttl", "1h");
			}
		},
	);

	for (const provider of providers) {
		for (const ttl of [undefined, "5m", "1h"] as const) {
			test.each(["system", "message", "tool", "tool_result"] as const)(
				`${provider} ignores preference with caller ${ttl ?? "default"} marker on %s`,
				async (location) => {
					const marker = { type: "ephemeral" as const, ...(ttl && { ttl }) };
					const messages = location === "tool_result" ? toolLoop() : chat();
					const tools: OpenAIToolInput[] = [
						{
							type: "function",
							function: {
								name: "read_file",
								parameters: { type: "object", properties: {} },
							},
							...(location === "tool" && { cache_control: marker }),
						},
					];
					if (location === "system" || location === "message") {
						const index = location === "system" ? 0 : messages.length - 1;
						messages[index]!.content = [
							{ type: "text", text: "Marked content", cache_control: marker },
						];
					} else if (location === "tool_result") {
						messages.at(-1)!.tool_result_cache_control = marker;
					}
					const defaults = await prepare(
						provider,
						messages,
						"auto",
						"5m",
						tools,
					);
					expect(
						await prepare(provider, messages, "auto", "1h", tools),
					).toEqual(defaults);
				},
			);
		}
	}

	test.each(["passthrough", "off"] as const)(
		"%s does not inject 1h markers",
		async (mode) => {
			for (const provider of providers) {
				expect(
					markers(await prepare(provider, toolLoop(), mode, "1h")),
				).toEqual([]);
			}
		},
	);

	test("does not alter unrelated provider requests", async () => {
		expect(await prepare("openai", chat(), "auto", "1h")).toEqual(
			await prepare("openai", chat()),
		);
	});
});
