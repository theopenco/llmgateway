import { describe, expect, test } from "vitest";

import { models, type ProviderModelMapping } from "@llmgateway/models";

import { prepareRequestBody } from "./prepare-request-body.js";

import type {
	AnthropicRequestBody,
	OpenAIRequestBody,
	OpenAIToolInput,
	ProviderId,
} from "@llmgateway/models";

const MODEL = "claude-opus-5-5";
const UPSTREAM_ID = "global.anthropic.claude-opus-5-5";
const BEDROCK_MAPPING = models
	.find((model) => model.id === MODEL)!
	.providers.find(
		(mapping) => mapping.providerId === "aws-bedrock",
	) as ProviderModelMapping;

const FUNCTION_TOOL: OpenAIToolInput = {
	type: "function",
	function: {
		name: "get_weather",
		description: "Get the weather for a city",
		parameters: {
			type: "object",
			properties: { city: { type: "string" } },
			required: ["city"],
		},
	},
	defer_loading: true,
	allowed_callers: ["code_execution"],
};

const TOOL_SEARCH_TOOL: OpenAIToolInput = {
	type: "tool_search",
	tool_search_type: "tool_search_tool_regex_20251119",
	name: "tool_search_tool_regex",
};

const WEB_FETCH_TOOL: OpenAIToolInput = {
	type: "web_fetch",
	web_fetch_type: "web_fetch_20250910",
	name: "web_fetch",
};

async function prepare(options: {
	provider: ProviderId;
	mapping?: ProviderModelMapping;
	tools?: OpenAIToolInput[];
	responseFormat?: OpenAIRequestBody["response_format"];
	reasoningEffort?: Parameters<typeof prepareRequestBody>[14];
}) {
	const args: Parameters<typeof prepareRequestBody> = [
		options.provider,
		MODEL,
		null,
		UPSTREAM_ID,
		[{ role: "user", content: "What is the weather in Paris?" }],
		true,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		options.responseFormat,
		options.tools,
		undefined,
		options.reasoningEffort,
		true,
	];
	args[35] = "safety-identifier";
	args[36] = options.mapping;
	return (await prepareRequestBody(...args)) as AnthropicRequestBody &
		Record<string, unknown>;
}

describe("prepareRequestBody - Claude on AWS Bedrock's Messages API", () => {
	test("shapes the Bedrock mapping as an Anthropic Messages body", async () => {
		const body = await prepare({ provider: "aws-bedrock" });

		expect(body.model).toBe(UPSTREAM_ID);
		expect(body.stream).toBe(true);
		expect(body.max_tokens).toBe(BEDROCK_MAPPING.maxOutput);
		expect(body.messages).toEqual([
			{
				role: "user",
				content: [{ type: "text", text: "What is the weather in Paris?" }],
			},
		]);
		expect(body).not.toHaveProperty("toolConfig");
		expect(body).not.toHaveProperty("inferenceConfig");
		// Bedrock does not forward safety identifiers.
		expect(body).not.toHaveProperty("metadata");
	});

	test("matches the gateway's Anthropic transport with the Bedrock mapping", async () => {
		expect(
			await prepare({ provider: "anthropic", mapping: BEDROCK_MAPPING }),
		).toEqual(await prepare({ provider: "aws-bedrock" }));
	});

	test("folds a JSON schema into output_config next to the effort", async () => {
		const body = await prepare({
			provider: "aws-bedrock",
			reasoningEffort: "high",
			responseFormat: {
				type: "json_schema",
				json_schema: {
					name: "person",
					schema: {
						type: "object",
						properties: { name: { type: "string" } },
						required: ["name"],
					},
				},
			},
		});

		expect(body.thinking).toEqual({ type: "adaptive", display: "summarized" });
		expect(body.output_config).toEqual({
			effort: "high",
			format: {
				type: "json_schema",
				schema: {
					type: "object",
					properties: { name: { type: "string" } },
					required: ["name"],
					additionalProperties: false,
				},
			},
		});
	});

	test("keeps tool search and drops what Bedrock rejects", async () => {
		const body = await prepare({
			provider: "aws-bedrock",
			tools: [TOOL_SEARCH_TOOL, FUNCTION_TOOL, WEB_FETCH_TOOL],
		});

		expect(body.tools).toEqual([
			{
				type: "tool_search_tool_regex_20251119",
				name: "tool_search_tool_regex",
			},
			{
				name: "get_weather",
				description: "Get the weather for a city",
				input_schema: {
					type: "object",
					properties: { city: { type: "string" } },
					required: ["city"],
				},
				defer_loading: true,
			},
		]);
	});
});
