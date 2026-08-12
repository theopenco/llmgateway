import { describe, expect, test } from "vitest";

import { buildUsage, parseSpecVersion } from "./spec.js";
import { buildChatRequest } from "./tools/build-chat-request.js";
import { buildConfigModels } from "./tools/build-config-models.js";
import { convertChatToGenerateResult } from "./tools/convert-chat-to-generate.js";
import { convertPromptToMessages } from "./tools/convert-prompt-to-chat.js";
import {
	createStreamingPartsState,
	finalizeStream,
	processChatChunk,
} from "./tools/convert-streaming-to-parts.js";
import { convertToolsToChat } from "./tools/convert-tools-to-chat.js";

import type { SpecMessage } from "./schemas.js";

function partsOfType(parts: object[], type: string) {
	return parts.filter((part) => (part as { type?: string }).type === type);
}

describe("spec version negotiation", () => {
	test("falls back to the newest spec when the header is missing or junk", () => {
		expect(parseSpecVersion(undefined)).toBe(4);
		expect(parseSpecVersion("")).toBe(4);
		expect(parseSpecVersion("v3")).toBe(4);
		expect(parseSpecVersion("99")).toBe(4);
	});

	test("honours the announced version", () => {
		expect(parseSpecVersion("2")).toBe(2);
		expect(parseSpecVersion(" 3 ")).toBe(3);
		expect(parseSpecVersion("4")).toBe(4);
	});

	test("v2 reports usage flat, v3/v4 nested", () => {
		const tokens = {
			inputTokens: 100,
			outputTokens: 40,
			totalTokens: 140,
			reasoningTokens: 15,
			cachedInputTokens: 30,
			cacheWriteTokens: 10,
		};

		expect(buildUsage(2, tokens)).toEqual({
			inputTokens: 100,
			outputTokens: 40,
			totalTokens: 140,
			reasoningTokens: 15,
			cachedInputTokens: 30,
		});

		for (const version of [3, 4] as const) {
			expect(buildUsage(version, tokens)).toEqual({
				inputTokens: { total: 100, noCache: 60, cacheRead: 30, cacheWrite: 10 },
				outputTokens: { total: 40, text: 25, reasoning: 15 },
			});
		}
	});

	test("nested usage tolerates a provider that reports nothing", () => {
		expect(
			buildUsage(4, {
				inputTokens: undefined,
				outputTokens: undefined,
				totalTokens: undefined,
				reasoningTokens: undefined,
				cachedInputTokens: undefined,
				cacheWriteTokens: undefined,
			}),
		).toEqual({
			inputTokens: {
				total: undefined,
				noCache: undefined,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: undefined, text: undefined, reasoning: undefined },
		});
	});
});

describe("prompt conversion", () => {
	test("converts each role into chat completions messages", () => {
		const prompt: SpecMessage[] = [
			{ role: "system", content: "be brief" },
			{ role: "user", content: [{ type: "text", text: "hi" }] },
			{
				role: "assistant",
				content: [
					{ type: "reasoning", text: "thinking" },
					{ type: "text", text: "calling a tool" },
					{
						type: "tool-call",
						toolCallId: "call_1",
						toolName: "github_repo",
						input: { repo: "vercel/ai" },
					},
				],
			},
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "call_1",
						toolName: "github_repo",
						output: { type: "json", value: { stars: 1 } },
					},
				],
			},
		];

		const { messages } = convertPromptToMessages(prompt);

		expect(messages).toEqual([
			{ role: "system", content: "be brief" },
			{ role: "user", content: "hi" },
			{
				role: "assistant",
				content: "calling a tool",
				reasoning: "thinking",
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: {
							name: "github_repo",
							arguments: '{"repo":"vercel/ai"}',
						},
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: '{"stars":1}' },
		]);
	});

	test("drops provider-executed tool calls and results from the replayed turn", () => {
		const { messages } = convertPromptToMessages([
			{
				role: "assistant",
				content: [
					{
						type: "tool-call",
						toolCallId: "ws_1",
						toolName: "web_search",
						input: {},
						providerExecuted: true,
					},
					{
						type: "tool-result",
						toolCallId: "ws_1",
						toolName: "web_search",
						output: { type: "json", value: { sources: [] } },
					},
					{ type: "text", text: "According to the web…" },
				],
			},
		]);

		expect(messages).toEqual([
			{ role: "assistant", content: "According to the web…" },
		]);
	});

	test("renders v4 tagged file data and v2 bare-string data as image parts", () => {
		const { messages } = convertPromptToMessages([
			{
				role: "user",
				content: [
					{ type: "text", text: "what is this?" },
					{
						type: "file",
						mediaType: "image/png",
						data: { type: "data", data: "iVBORw0KGgoAAAA" },
					},
					{
						type: "file",
						mediaType: "image",
						data: "iVBORw0KGgoAAAA",
					},
					{
						type: "file",
						mediaType: "image/jpeg",
						data: { type: "url", url: "https://example.com/cat.jpg" },
					},
				],
			},
		]);

		expect(messages[0].content).toEqual([
			{ type: "text", text: "what is this?" },
			{
				type: "image_url",
				image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAA" },
			},
			// Top-level-only media type: the concrete subtype is recovered from the
			// payload's magic bytes so the data URL stays valid.
			{
				type: "image_url",
				image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAA" },
			},
			{
				type: "image_url",
				image_url: { url: "https://example.com/cat.jpg" },
			},
		]);
	});

	test("serializes every tool output variant", () => {
		const { messages } = convertPromptToMessages([
			{
				role: "tool",
				content: [
					{
						type: "tool-result",
						toolCallId: "a",
						toolName: "t",
						output: { type: "text", value: "plain" },
					},
					{
						type: "tool-result",
						toolCallId: "b",
						toolName: "t",
						output: { type: "error-text", value: "boom" },
					},
					{
						type: "tool-result",
						toolCallId: "c",
						toolName: "t",
						output: { type: "execution-denied", reason: "nope" },
					},
					{
						type: "tool-result",
						toolCallId: "d",
						toolName: "t",
						output: {
							type: "content",
							value: [
								{ type: "text", text: "line" },
								{ type: "file", mediaType: "image/png", data: "x" },
							],
						},
					},
				],
			},
		]);

		expect(messages.map((message) => message.content)).toEqual([
			"plain",
			"boom",
			'{"error":"execution-denied","reason":"nope"}',
			"line\n[file]",
		]);
	});
});

describe("tool conversion", () => {
	test("maps function tools and tool choice", () => {
		const result = convertToolsToChat(
			[
				{
					type: "function",
					name: "github_repo",
					description: "look up a repo",
					inputSchema: { type: "object", properties: {} },
				},
			],
			{ type: "tool", toolName: "github_repo" },
		);

		expect(result.tools).toEqual([
			{
				type: "function",
				function: {
					name: "github_repo",
					description: "look up a repo",
					parameters: { type: "object", properties: {} },
				},
			},
		]);
		expect(result.tool_choice).toEqual({
			type: "function",
			function: { name: "github_repo" },
		});
		expect(result.unsupportedTools).toEqual([]);
	});

	test("maps provider web-search tools onto the native web_search tool", () => {
		for (const [type, id] of [
			["provider", "openai.web_search"],
			["provider", "anthropic.web_search_20260209"],
			["provider-defined", "openai.web_search_preview"],
		] as const) {
			const result = convertToolsToChat(
				[
					{
						type,
						id,
						name: "web_search",
						args: {
							searchContextSize: "high",
							userLocation: { type: "approximate", country: "DE" },
							filters: { allowedDomains: ["example.com"] },
						},
					},
				],
				{ type: "auto" },
			);

			expect(result.tools).toEqual([
				{
					type: "web_search",
					user_location: { country: "DE" },
					search_context_size: "high",
					allowed_domains: ["example.com"],
				},
			]);
			expect(result.webSearchToolName).toBe("web_search");
		}
	});

	test("reports unknown provider tools instead of rejecting the request", () => {
		const result = convertToolsToChat(
			[
				{
					type: "provider",
					id: "openai.code_interpreter",
					name: "code_interpreter",
					args: {},
				},
			],
			undefined,
		);

		expect(result.tools).toBeUndefined();
		expect(result.unsupportedTools).toHaveLength(1);
	});

	test("drops tool_choice when no function tool survives conversion", () => {
		// The AI SDK sends `{ type: "auto" }` unconditionally; several providers
		// 400 on a tool_choice with an empty tool list.
		const result = convertToolsToChat([], { type: "auto" });
		expect(result.tool_choice).toBeUndefined();
	});
});

describe("chat request building", () => {
	const basePrompt: SpecMessage[] = [
		{ role: "user", content: [{ type: "text", text: "hi" }] },
	];

	test("maps generation settings and reports unsupported ones", () => {
		const { body, warnings } = buildChatRequest({
			options: {
				prompt: basePrompt,
				maxOutputTokens: 512,
				temperature: 0.4,
				topP: 0.9,
				frequencyPenalty: 0.1,
				presencePenalty: 0.2,
				stopSequences: ["END"],
				seed: 7,
				topK: 5,
			},
			modelId: "anthropic/claude-sonnet-5",
			stream: true,
			specVersion: 4,
		});

		expect(body).toMatchObject({
			model: "anthropic/claude-sonnet-5",
			stream: true,
			max_tokens: 512,
			temperature: 0.4,
			top_p: 0.9,
			frequency_penalty: 0.1,
			presence_penalty: 0.2,
		});
		expect(warnings).toEqual([
			{
				type: "unsupported",
				feature: "stopSequences",
				details: "Not supported on the gateway chat completions surface.",
			},
			{
				type: "unsupported",
				feature: "seed",
				details: "Not supported on the gateway chat completions surface.",
			},
			{
				type: "unsupported",
				feature: "topK",
				details: "Not supported on the gateway chat completions surface.",
			},
		]);
	});

	test("uses the v2 warning shape when the caller announced spec version 2", () => {
		const { warnings } = buildChatRequest({
			options: { prompt: basePrompt, seed: 7 },
			modelId: "openai/gpt-5.6-terra",
			stream: false,
			specVersion: 2,
		});

		expect(warnings[0]).toMatchObject({
			type: "unsupported-setting",
			setting: "seed",
		});
	});

	test("maps a json response format with and without a schema", () => {
		const withSchema = buildChatRequest({
			options: {
				prompt: basePrompt,
				responseFormat: {
					type: "json",
					name: "answer",
					schema: { type: "object" },
				},
			},
			modelId: "m",
			stream: false,
			specVersion: 4,
		});
		expect(withSchema.body.response_format).toEqual({
			type: "json_schema",
			json_schema: { name: "answer", schema: { type: "object" } },
		});

		const withoutSchema = buildChatRequest({
			options: { prompt: basePrompt, responseFormat: { type: "json" } },
			modelId: "m",
			stream: false,
			specVersion: 4,
		});
		expect(withoutSchema.body.response_format).toEqual({ type: "json_object" });
	});

	test("spreads providerOptions.llmgateway onto the body but never the owned fields", () => {
		const { body } = buildChatRequest({
			options: {
				prompt: basePrompt,
				providerOptions: {
					llmgateway: {
						reasoning_effort: "high",
						routing: "price",
						model: "someone-elses-model",
						stream: true,
					},
					openai: { reasoningEffort: "low" },
				},
			},
			modelId: "openai/gpt-5.6-terra",
			stream: false,
			specVersion: 4,
		});

		expect(body.reasoning_effort).toBe("high");
		expect(body.routing).toBe("price");
		expect(body.model).toBe("openai/gpt-5.6-terra");
		expect(body.stream).toBe(false);
	});
});

describe("non-streaming response conversion", () => {
	test("emits reasoning, text and tool-call content parts", () => {
		const result = convertChatToGenerateResult({
			response: {
				choices: [
					{
						message: {
							reasoning: "hmm",
							content: "here you go",
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: { name: "github_repo", arguments: '{"a":1}' },
								},
							],
						},
						finish_reason: "tool_calls",
					},
				],
				usage: {
					prompt_tokens: 10,
					completion_tokens: 5,
					total_tokens: 15,
					cost: 0.002,
				},
				metadata: { used_model: "claude-sonnet-5", used_provider: "anthropic" },
			},
			specVersion: 4,
			warnings: [],
		});

		expect(result.content).toEqual([
			{ type: "reasoning", text: "hmm" },
			{ type: "text", text: "here you go" },
			{
				type: "tool-call",
				toolCallId: "call_1",
				toolName: "github_repo",
				input: '{"a":1}',
			},
		]);
		expect(result.finishReason).toBe("tool-calls");
		expect(result.providerMetadata).toEqual({
			llmgateway: {
				cost: 0.002,
				usedModel: "claude-sonnet-5",
				usedProvider: "anthropic",
			},
			gateway: { cost: 0.002 },
		});
	});

	test("turns url citations into source parts plus a provider-executed tool pair", () => {
		const result = convertChatToGenerateResult({
			response: {
				choices: [
					{
						message: {
							content: "the answer",
							annotations: [
								{
									type: "url_citation",
									url_citation: { url: "https://a.example", title: "A" },
								},
								{
									type: "url_citation",
									url_citation: { url: "https://a.example", title: "A" },
								},
								{
									type: "url_citation",
									url_citation: { url: "https://b.example" },
								},
							],
						},
						finish_reason: "stop",
					},
				],
			},
			specVersion: 4,
			warnings: [],
			webSearchToolName: "web_search",
		});

		const content = result.content as {
			type: string;
			[key: string]: unknown;
		}[];

		expect(content.map((part) => part.type)).toEqual([
			"tool-call",
			"tool-result",
			"source",
			"source",
			"text",
		]);
		// Deduplicated by URL: providers repeat a citation per referencing span.
		expect(
			content.filter((part) => part.type === "source").map((part) => part.url),
		).toEqual(["https://a.example", "https://b.example"]);
		expect(content[0]).toMatchObject({
			toolName: "web_search",
			providerExecuted: true,
			input: "{}",
		});
		expect(content[1]).toMatchObject({
			toolName: "web_search",
			providerExecuted: true,
			result: {
				sources: [
					{ type: "url", url: "https://a.example", title: "A" },
					{ type: "url", url: "https://b.example" },
				],
			},
		});
	});

	test("does not synthesize a tool pair when web search was not requested", () => {
		const result = convertChatToGenerateResult({
			response: {
				choices: [
					{
						message: {
							content: "hi",
							annotations: [
								{
									type: "url_citation",
									url_citation: { url: "https://a.example" },
								},
							],
						},
						finish_reason: "stop",
					},
				],
			},
			specVersion: 4,
			warnings: [],
		});

		const content = result.content as { type: string }[];
		expect(content.map((part) => part.type)).toEqual(["source", "text"]);
	});
});

describe("streaming conversion", () => {
	function run(chunks: object[], webSearchToolName?: string) {
		const state = createStreamingPartsState({
			specVersion: 4,
			webSearchToolName,
		});
		const parts: object[] = [];
		for (const chunk of chunks) {
			parts.push(...processChatChunk(state, chunk));
		}
		parts.push(...finalizeStream(state));
		return parts;
	}

	test("brackets text with start/end and emits a terminal finish part", () => {
		const parts = run([
			{ id: "cmpl-1", model: "claude-sonnet-5", created: 1, choices: [{}] },
			{ choices: [{ delta: { content: "he" } }] },
			{ choices: [{ delta: { content: "llo" } }] },
			{
				choices: [{ delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
			},
		]);

		expect(parts.map((part) => (part as { type: string }).type)).toEqual([
			"response-metadata",
			"text-start",
			"text-delta",
			"text-delta",
			"text-end",
			"finish",
		]);

		const finish = parts.at(-1) as { finishReason: string; usage: unknown };
		expect(finish.finishReason).toBe("stop");
		expect(finish.usage).toEqual({
			inputTokens: {
				total: 3,
				noCache: 3,
				cacheRead: undefined,
				cacheWrite: undefined,
			},
			outputTokens: { total: 2, text: 2, reasoning: undefined },
		});
	});

	test("closes the reasoning block before the answer text starts", () => {
		const parts = run([
			{ choices: [{ delta: { reasoning: "thinking" } }] },
			{ choices: [{ delta: { content: "answer" } }] },
			{ choices: [{ delta: {}, finish_reason: "stop" }] },
		]);

		expect(parts.map((part) => (part as { type: string }).type)).toEqual([
			"reasoning-start",
			"reasoning-delta",
			"reasoning-end",
			"text-start",
			"text-delta",
			"text-end",
			"finish",
		]);
	});

	test("assembles a tool call whose name arrives before its arguments", () => {
		const parts = run([
			{
				choices: [
					{
						delta: {
							tool_calls: [
								{
									index: 0,
									id: "call_1",
									function: { name: "github_repo", arguments: "" },
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
							tool_calls: [{ index: 0, function: { arguments: '{"a":' } }],
						},
					},
				],
			},
			{
				choices: [
					{
						delta: {
							tool_calls: [{ index: 0, function: { arguments: "1}" } }],
						},
						finish_reason: "tool_calls",
					},
				],
			},
		]);

		expect(partsOfType(parts, "tool-input-start")).toEqual([
			{ type: "tool-input-start", id: "call_1", toolName: "github_repo" },
		]);
		expect(partsOfType(parts, "tool-call")).toEqual([
			{
				type: "tool-call",
				toolCallId: "call_1",
				toolName: "github_repo",
				input: '{"a":1}',
			},
		]);
	});

	test("emits sources and a provider-executed web_search pair from annotations", () => {
		const parts = run(
			[
				{
					choices: [
						{
							delta: {
								annotations: [
									{
										type: "url_citation",
										url_citation: { url: "https://a.example", title: "A" },
									},
								],
							},
						},
					],
				},
				{ choices: [{ delta: { content: "cited" } }] },
				{ choices: [{ delta: {}, finish_reason: "stop" }] },
			],
			"web_search",
		);

		const types = parts.map((part) => (part as { type: string }).type);
		expect(types).toEqual([
			"tool-input-start",
			"tool-input-end",
			"tool-call",
			"source",
			"text-start",
			"text-delta",
			"text-end",
			"tool-result",
			"finish",
		]);
		expect(partsOfType(parts, "source")[0]).toMatchObject({
			sourceType: "url",
			url: "https://a.example",
			title: "A",
		});
	});

	test("carries gateway metadata from the final chunk into providerMetadata", () => {
		const parts = run([
			{ choices: [{ delta: { content: "x" } }] },
			{
				choices: [{ delta: {}, finish_reason: "stop" }],
				usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.5 },
				metadata: {
					used_model: "gpt-5.6-terra",
					used_provider: "openai",
					request_id: "req_1",
				},
			},
		]);

		expect(parts.at(-1)).toMatchObject({
			providerMetadata: {
				llmgateway: {
					cost: 0.5,
					usedModel: "gpt-5.6-terra",
					usedProvider: "openai",
					requestId: "req_1",
				},
				gateway: { cost: 0.5 },
			},
		});
	});

	test("finalize is idempotent so the error path cannot double-finish a stream", () => {
		const state = createStreamingPartsState({ specVersion: 4 });
		processChatChunk(state, { choices: [{ delta: { content: "x" } }] });

		expect(finalizeStream(state).length).toBeGreaterThan(0);
		expect(finalizeStream(state)).toEqual([]);
	});

	test("drops a tool call whose name never arrived on a truncated stream", () => {
		const parts = run([
			{
				choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1" }] } }],
			},
		]);

		expect(partsOfType(parts, "tool-call")).toEqual([]);
	});
});

describe("config model listing", () => {
	const entries = buildConfigModels();

	test("addresses models the way the gateway accepts provider-pinned requests", () => {
		const entry = entries.find(
			(candidate) => candidate.id === "openai/gpt-4o-mini",
		);

		expect(entry).toBeDefined();
		expect(entry).toMatchObject({
			specification: {
				specificationVersion: "v4",
				provider: "openai",
				modelId: "gpt-4o-mini",
			},
			modelType: "language",
		});
	});

	test("only emits model types the AI SDK gateway client keeps", () => {
		const known = new Set([
			"embedding",
			"image",
			"language",
			"realtime",
			"reranking",
			"speech",
			"transcription",
			"video",
		]);

		expect(entries.every((entry) => known.has(entry.modelType))).toBe(true);
	});

	test("excludes mappings that were deactivated before now", () => {
		const past = new Date("2000-01-01");
		expect(buildConfigModels(past).length).toBeGreaterThan(entries.length - 1);

		const future = new Date("2999-01-01");
		expect(buildConfigModels(future).length).toBeLessThan(entries.length);
	});
});
