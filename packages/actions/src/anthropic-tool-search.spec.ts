import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type {
	AnthropicRequestBody,
	BaseMessage,
	OpenAIRequestBody,
	OpenAIToolInput,
	ProviderId,
} from "@llmgateway/models";

const TOOL_SEARCH_TOOL: OpenAIToolInput = {
	type: "tool_search",
	tool_search_type: "tool_search_tool_regex_20251119",
	name: "tool_search_tool_regex",
};

const DEFERRED_TOOL: OpenAIToolInput = {
	type: "function",
	function: {
		name: "get_weather",
		description: "Get the weather at a specific location",
		parameters: {
			type: "object",
			properties: { location: { type: "string" } },
			required: ["location"],
		},
	},
	defer_loading: true,
};

const SEARCH_CALL = {
	type: "server_tool_use",
	id: "srvtoolu_1",
	name: "tool_search_tool_regex",
	input: { pattern: "weather" },
};

const SEARCH_RESULT = {
	type: "tool_search_tool_result",
	tool_use_id: "srvtoolu_1",
	content: {
		type: "tool_search_tool_search_result",
		tool_references: [{ type: "tool_reference", tool_name: "get_weather" }],
	},
};

async function prepare(
	provider: ProviderId,
	model: string,
	messages: BaseMessage[],
	tools: OpenAIToolInput[],
) {
	return await prepareRequestBody(
		provider,
		model,
		null,
		model,
		messages,
		false,
		undefined,
		1024,
		undefined,
		undefined,
		undefined,
		undefined,
		tools,
	);
}

describe("anthropic tool search", () => {
	test("forwards defer_loading and the tool search tool to Anthropic", async () => {
		const body = (await prepare(
			"anthropic",
			"claude-sonnet-4-6",
			[{ role: "user", content: "What is the weather in Paris?" }],
			[TOOL_SEARCH_TOOL, DEFERRED_TOOL],
		)) as AnthropicRequestBody;

		expect(body.tools).toEqual([
			{
				type: "tool_search_tool_regex_20251119",
				name: "tool_search_tool_regex",
			},
			{
				name: "get_weather",
				description: "Get the weather at a specific location",
				input_schema: {
					type: "object",
					properties: { location: { type: "string" } },
					required: ["location"],
				},
				defer_loading: true,
			},
		]);
	});

	// Microsoft Foundry fronts the Messages API directly and accepts
	// defer_loading on a live deployment, so Claude on Azure gets the same
	// treatment as the direct API.
	test("forwards the same tools on azure-anthropic", async () => {
		const body = (await prepare(
			"azure-anthropic",
			"claude-opus-4-8",
			[{ role: "user", content: "What is the weather in Paris?" }],
			[TOOL_SEARCH_TOOL, DEFERRED_TOOL],
		)) as AnthropicRequestBody;

		expect(body.tools?.[0]).toEqual({
			type: "tool_search_tool_regex_20251119",
			name: "tool_search_tool_regex",
		});
		expect(body.tools?.[1]).toMatchObject({ defer_loading: true });
	});

	// Anthropic lists tool search as available on Google Cloud, and the gateway
	// posts a Messages body to :rawPredict there, so Vertex gets the same
	// treatment as the direct API.
	test("forwards the same tools on vertex-anthropic", async () => {
		const body = (await prepare(
			"vertex-anthropic",
			"claude-sonnet-4-6",
			[{ role: "user", content: "What is the weather in Paris?" }],
			[TOOL_SEARCH_TOOL, DEFERRED_TOOL],
		)) as AnthropicRequestBody;

		expect(body.tools?.[0]).toEqual({
			type: "tool_search_tool_regex_20251119",
			name: "tool_search_tool_regex",
		});
		expect(body.tools?.[1]).toMatchObject({ defer_loading: true });
	});

	// Anthropic offers tool search on Bedrock only through InvokeModel, and the
	// gateway drives Bedrock through Converse — so it degrades to eager loading
	// here even though Bedrock serves the same Claude models.
	test("strips both for aws-bedrock, which the gateway drives via Converse", async () => {
		const body = await prepare(
			"aws-bedrock",
			"claude-sonnet-4-6",
			[{ role: "user", content: "What is the weather in Paris?" }],
			[TOOL_SEARCH_TOOL, DEFERRED_TOOL],
		);

		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain("tool_search");
		expect(serialized).not.toContain("defer_loading");
		expect(serialized).toContain("get_weather");
	});

	test("derives the tool search tool name when the caller omits it", async () => {
		const body = (await prepare(
			"anthropic",
			"claude-sonnet-4-6",
			[{ role: "user", content: "hi" }],
			[
				{
					type: "tool_search",
					tool_search_type: "tool_search_tool_bm25_20251119",
				},
			],
		)) as AnthropicRequestBody;

		expect(body.tools).toEqual([
			{
				type: "tool_search_tool_bm25_20251119",
				name: "tool_search_tool_bm25",
			},
		]);
	});

	test("drops the tool search tool and defer_loading for other providers", async () => {
		const body = (await prepare(
			"openai",
			"gpt-4o-mini",
			[{ role: "user", content: "What is the weather in Paris?" }],
			[TOOL_SEARCH_TOOL, DEFERRED_TOOL],
		)) as OpenAIRequestBody;

		// The tool is still offered, just eagerly — degrading costs prompt cache,
		// not correctness.
		expect(body.tools).toEqual([
			{
				type: "function",
				function: {
					name: "get_weather",
					description: "Get the weather at a specific location",
					parameters: {
						type: "object",
						properties: { location: { type: "string" } },
						required: ["location"],
					},
				},
			},
		]);
	});

	test("replays the tool search pair ahead of the assistant's tool calls", async () => {
		const body = (await prepare(
			"anthropic",
			"claude-sonnet-4-6",
			[
				{ role: "user", content: "What is the weather in Paris?" },
				{
					role: "assistant",
					content: "Let me look for a weather tool.",
					tool_calls: [
						{
							id: "toolu_1",
							type: "function",
							function: {
								name: "get_weather",
								arguments: '{"location":"Paris"}',
							},
						},
					],
					anthropic_native_blocks: [SEARCH_CALL, SEARCH_RESULT],
				},
				{ role: "tool", tool_call_id: "toolu_1", content: "sunny" },
			],
			[TOOL_SEARCH_TOOL, DEFERRED_TOOL],
		)) as AnthropicRequestBody;

		const assistant = body.messages.find((m) => m.role === "assistant");
		expect(assistant?.content.map((block) => block.type)).toEqual([
			"text",
			"server_tool_use",
			"tool_search_tool_result",
			"tool_use",
		]);
	});

	test("keeps a search-only assistant turn for Anthropic", async () => {
		const body = (await prepare(
			"anthropic",
			"claude-sonnet-4-6",
			[
				{ role: "user", content: "What is the weather in Paris?" },
				{
					role: "assistant",
					content: "",
					anthropic_native_blocks: [SEARCH_CALL, SEARCH_RESULT],
				},
				{ role: "user", content: "Well?" },
			],
			[TOOL_SEARCH_TOOL, DEFERRED_TOOL],
		)) as AnthropicRequestBody;

		const assistant = body.messages.find((m) => m.role === "assistant");
		expect(assistant?.content.map((block) => block.type)).toEqual([
			"server_tool_use",
			"tool_search_tool_result",
		]);
	});

	test("drops a search-only assistant turn for other providers", async () => {
		const body = (await prepare(
			"openai",
			"gpt-4o-mini",
			[
				{ role: "user", content: "What is the weather in Paris?" },
				{
					role: "assistant",
					content: "",
					anthropic_native_blocks: [SEARCH_CALL, SEARCH_RESULT],
				},
				{ role: "user", content: "Well?" },
			],
			[DEFERRED_TOOL],
		)) as OpenAIRequestBody;

		// Stripping the blocks would otherwise leave an empty assistant message,
		// which providers reject.
		expect(body.messages.map((m) => m.role)).toEqual(["user", "user"]);
		expect(JSON.stringify(body.messages)).not.toContain(
			"anthropic_native_blocks",
		);
	});

	test("replays tool_reference blocks in a tool_result verbatim", async () => {
		const references = [{ type: "tool_reference", tool_name: "get_weather" }];
		const body = (await prepare(
			"anthropic",
			"claude-sonnet-4-6",
			[
				{ role: "user", content: "What is the weather in Paris?" },
				{
					role: "assistant",
					content: "",
					tool_calls: [
						{
							id: "toolu_search",
							type: "function",
							function: { name: "find_tools", arguments: '{"q":"weather"}' },
						},
					],
				},
				{
					role: "tool",
					tool_call_id: "toolu_search",
					content: JSON.stringify(references),
					anthropic_native_blocks: references,
				},
			],
			[DEFERRED_TOOL],
		)) as AnthropicRequestBody;

		const toolResultTurn = body.messages.at(-1);
		expect(toolResultTurn?.content).toEqual([
			{
				type: "tool_result",
				tool_use_id: "toolu_search",
				content: references,
				cache_control: { type: "ephemeral" },
			},
		]);
	});
});

describe("anthropic web search and web fetch", () => {
	const WEB_FETCH_TOOL: OpenAIToolInput = {
		type: "web_fetch",
		web_fetch_type: "web_fetch_20250910",
		name: "web_fetch",
		max_uses: 3,
		citations: { enabled: true },
	};
	const FETCH_CALL = {
		type: "server_tool_use",
		id: "srvtoolu_01fetch",
		name: "web_fetch",
		input: { url: "https://example.com" },
	};
	const FETCH_RESULT = {
		type: "web_fetch_tool_result",
		tool_use_id: "srvtoolu_01fetch",
		content: { type: "web_fetch_result", url: "https://example.com" },
	};
	const SEARCH_CALL_WEB = {
		type: "server_tool_use",
		id: "srvtoolu_01search",
		name: "web_search",
		input: { query: "example" },
	};
	const SEARCH_RESULT_WEB = {
		type: "web_search_tool_result",
		tool_use_id: "srvtoolu_01search",
		content: [
			{
				type: "web_search_result",
				url: "https://example.com",
				title: "Example",
				encrypted_content: "opaque",
				page_age: null,
			},
		],
	};
	const history: BaseMessage[] = [
		{ role: "user", content: "Summarize example.com" },
		{
			role: "assistant",
			content: "Example.com is a placeholder domain.",
			anthropic_native_blocks: [
				SEARCH_CALL_WEB,
				SEARCH_RESULT_WEB,
				FETCH_CALL,
				FETCH_RESULT,
			],
		},
		{ role: "user", content: "Thanks" },
	];

	test("forwards the web fetch tool and replays the server tool blocks ahead of the text", async () => {
		const body = (await prepare("anthropic", "claude-sonnet-4-6", history, [
			WEB_FETCH_TOOL,
		])) as AnthropicRequestBody;

		expect(body.tools).toEqual([
			{
				type: "web_fetch_20250910",
				name: "web_fetch",
				max_uses: 3,
				citations: { enabled: true },
			},
		]);
		expect(body.messages[1]?.content).toEqual([
			SEARCH_CALL_WEB,
			SEARCH_RESULT_WEB,
			FETCH_CALL,
			FETCH_RESULT,
			expect.objectContaining({
				type: "text",
				text: "Example.com is a placeholder domain.",
			}),
		]);
	});

	test("strips both for providers without the Messages API", async () => {
		const body = await prepare("openai", "gpt-4o-mini", history, [
			WEB_FETCH_TOOL,
		]);

		const serialized = JSON.stringify(body);
		expect(serialized).not.toContain("web_fetch");
		expect(serialized).not.toContain("encrypted_content");
	});
});
