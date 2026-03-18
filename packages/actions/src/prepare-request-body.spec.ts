import { describe, expect, test } from "vitest";

import { prepareRequestBody } from "./prepare-request-body.js";

import type { AnthropicRequestBody } from "@llmgateway/models";

describe("prepareRequestBody - Anthropic", () => {
	test("should extract system messages to system field for caching", async () => {
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			[
				{ role: "system", content: "You are a helpful assistant." },
				{ role: "user", content: "Hello!" },
			],
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
			false,
			false,
		)) as AnthropicRequestBody;

		expect(requestBody.system).toBeDefined();
		expect(Array.isArray(requestBody.system)).toBe(true);
		expect(requestBody.system).toHaveLength(1);
		expect((requestBody.system as any)[0].type).toBe("text");
		expect((requestBody.system as any)[0].text).toBe(
			"You are a helpful assistant.",
		);
		// Short system messages should not have cache_control
		expect((requestBody.system as any)[0].cache_control).toBeUndefined();

		// Messages should only contain user message
		expect(requestBody.messages).toHaveLength(1);
		expect(requestBody.messages[0].role).toBe("user");
	});

	test("should add cache_control for long system prompts", async () => {
		// Create a long system prompt (>4096 characters)
		const longSystemPrompt = "A".repeat(5000);

		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			[
				{ role: "system", content: longSystemPrompt },
				{ role: "user", content: "Hello!" },
			],
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
			false,
			false,
		)) as AnthropicRequestBody;

		expect(requestBody.system).toBeDefined();
		expect(Array.isArray(requestBody.system)).toBe(true);
		expect((requestBody.system as any)[0].cache_control).toEqual({
			type: "ephemeral",
		});
	});

	test("should handle array content in system messages", async () => {
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			[
				{
					role: "system",
					content: [
						{ type: "text", text: "Part 1. " },
						{ type: "text", text: "Part 2." },
					],
				},
				{ role: "user", content: "Hello!" },
			],
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
			false,
			false,
		)) as AnthropicRequestBody;

		expect(requestBody.system).toBeDefined();
		expect(Array.isArray(requestBody.system)).toBe(true);
		expect((requestBody.system as any)[0].text).toBe("Part 1. Part 2.");
	});

	test("should limit cache_control blocks to 4 total across system and user messages", async () => {
		// Create 5 long prompts that would each trigger cache_control
		const longContent = "A".repeat(5000);
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			[
				{ role: "system", content: longContent }, // Would be cache block 1
				{ role: "system", content: longContent }, // Would be cache block 2
				{ role: "user", content: longContent }, // Would be cache block 3
				{ role: "user", content: longContent }, // Would be cache block 4
				{ role: "user", content: longContent }, // Should NOT get cache_control (limit reached)
			],
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
			false,
			false,
		)) as AnthropicRequestBody;

		// Count total cache_control blocks
		let totalCacheControlBlocks = 0;

		// Count in system messages
		if (requestBody.system && Array.isArray(requestBody.system)) {
			for (const block of requestBody.system) {
				if ((block as any).cache_control) {
					totalCacheControlBlocks++;
				}
			}
		}

		// Count in user messages
		for (const msg of requestBody.messages) {
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if ((block as any).cache_control) {
						totalCacheControlBlocks++;
					}
				}
			}
		}

		// Should be exactly 4 (the limit)
		expect(totalCacheControlBlocks).toBe(4);
	});
});

describe("prepareRequestBody - Google AI Studio", () => {
	test("should set thinkingBudget when reasoning_effort is provided", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.5-pro",
			[{ role: "user", content: "What is 2+2?" }],
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			"medium", // reasoning_effort
			true, // supportsReasoning
			false, // isProd
		)) as any;

		expect(requestBody.generationConfig).toBeDefined();
		expect(requestBody.generationConfig.thinkingConfig).toBeDefined();
		expect(requestBody.generationConfig.thinkingConfig.includeThoughts).toBe(
			true,
		);
		expect(requestBody.generationConfig.thinkingConfig.thinkingBudget).toBe(
			8192,
		);
	});

	test("should map reasoning_effort values correctly", async () => {
		const effortMapping = [
			{ effort: "minimal", expected: 512 },
			{ effort: "low", expected: 2048 },
			{ effort: "medium", expected: 8192 },
			{ effort: "high", expected: 24576 },
		];

		for (const { effort, expected } of effortMapping) {
			const requestBody = (await prepareRequestBody(
				"google-ai-studio",
				"gemini-2.5-pro",
				[{ role: "user", content: "test" }],
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				effort as "minimal" | "low" | "medium" | "high",
				true,
				false,
			)) as any;

			expect(requestBody.generationConfig.thinkingConfig.thinkingBudget).toBe(
				expected,
			);
		}
	});

	test("should not set thinkingBudget when reasoning_effort is not provided", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.5-pro",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined, // reasoning_effort not provided
			true, // supportsReasoning
			false,
		)) as any;

		expect(requestBody.generationConfig.thinkingConfig.includeThoughts).toBe(
			true,
		);
		expect(
			requestBody.generationConfig.thinkingConfig.thinkingBudget,
		).toBeUndefined();
	});

	test("should not set thinkingConfig when supportsReasoning is false", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-1.5-pro",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			false, // supportsReasoning is false
			false,
		)) as any;

		expect(requestBody.generationConfig.thinkingConfig).toBeUndefined();
	});

	test("should expand $ref references in tool parameters", async () => {
		const toolsWithRef = [
			{
				type: "function" as const,
				function: {
					name: "ask_question",
					description: "Ask a question",
					parameters: {
						type: "object",
						properties: {
							question: { type: "string" },
							options: {
								type: "array",
								items: { $ref: "#/$defs/QuestionOption" },
							},
						},
						$defs: {
							QuestionOption: {
								type: "object",
								properties: {
									label: { type: "string" },
									value: { type: "string" },
								},
								required: ["label", "value"],
							},
						},
						required: ["question"],
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.0-flash",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			toolsWithRef,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		expect(requestBody.tools).toBeDefined();
		expect(requestBody.tools[0].functionDeclarations).toBeDefined();

		const params = requestBody.tools[0].functionDeclarations[0].parameters;

		// Should not have $defs anymore
		expect(params.$defs).toBeUndefined();

		// The $ref should be expanded inline
		expect(params.properties.options.items).toEqual({
			type: "object",
			properties: {
				label: { type: "string" },
				value: { type: "string" },
			},
			required: ["label", "value"],
		});
	});

	test("should strip additionalProperties from tool parameters", async () => {
		const toolsWithAdditionalProps = [
			{
				type: "function" as const,
				function: {
					name: "test_tool",
					description: "Test tool",
					parameters: {
						type: "object",
						properties: {
							name: { type: "string" },
						},
						additionalProperties: false,
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.0-flash",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			toolsWithAdditionalProps,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const params = requestBody.tools[0].functionDeclarations[0].parameters;

		// Should not have additionalProperties
		expect(params.additionalProperties).toBeUndefined();
	});

	test("should strip advanced JSON Schema properties from Google tool parameters", async () => {
		const toolsWithAdvancedSchema = [
			{
				type: "function" as const,
				function: {
					name: "test_tool",
					description: "Test tool",
					parameters: {
						type: "object",
						properties: {
							count: {
								type: "number",
								exclusiveMinimum: 0,
								exclusiveMaximum: 100,
								multipleOf: 5,
							},
							name: {
								type: "string",
								const: "fixed_value",
							},
							metadata: {
								type: "object",
								properties: {
									key: { type: "string" },
								},
								propertyNames: { type: "string" },
								minProperties: 1,
								maxProperties: 10,
							},
							items: {
								type: "array",
								items: { type: "string" },
								minItems: 1,
								maxItems: 50,
								uniqueItems: true,
								contains: { type: "string" },
								prefixItems: [{ type: "string" }],
							},
						},
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.0-flash",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			toolsWithAdvancedSchema,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const params = requestBody.tools[0].functionDeclarations[0].parameters;

		// Number properties: should strip exclusiveMinimum, exclusiveMaximum, multipleOf
		expect(params.properties.count.exclusiveMinimum).toBeUndefined();
		expect(params.properties.count.exclusiveMaximum).toBeUndefined();
		expect(params.properties.count.multipleOf).toBeUndefined();
		expect(params.properties.count.type).toBe("number");

		// String const: should strip const
		expect(params.properties.name.const).toBeUndefined();
		expect(params.properties.name.type).toBe("string");

		// Object properties: should strip propertyNames, minProperties, maxProperties
		expect(params.properties.metadata.propertyNames).toBeUndefined();
		expect(params.properties.metadata.minProperties).toBeUndefined();
		expect(params.properties.metadata.maxProperties).toBeUndefined();
		expect(params.properties.metadata.properties.key.type).toBe("string");

		// Array properties: should strip minItems, maxItems, uniqueItems, contains, prefixItems
		expect(params.properties.items.minItems).toBeUndefined();
		expect(params.properties.items.maxItems).toBeUndefined();
		expect(params.properties.items.uniqueItems).toBeUndefined();
		expect(params.properties.items.contains).toBeUndefined();
		expect(params.properties.items.prefixItems).toBeUndefined();
		expect(params.properties.items.type).toBe("array");
		expect(params.properties.items.items.type).toBe("string");
	});

	test("should add additionalProperties: false to Cerebras tool parameters", async () => {
		const toolsWithoutAdditionalProps = [
			{
				type: "function" as const,
				function: {
					name: "test_tool",
					description: "Test tool",
					parameters: {
						type: "object",
						properties: {
							name: { type: "string" },
							nested: {
								type: "object",
								properties: {
									value: { type: "string" },
								},
							},
						},
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"cerebras",
			"llama-4-scout-17b-16e-instruct",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			toolsWithoutAdditionalProps,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const params = requestBody.tools[0].function.parameters;

		// Should have additionalProperties: false at root
		expect(params.additionalProperties).toBe(false);
		// Should have additionalProperties: false on nested objects
		expect(params.properties.nested.additionalProperties).toBe(false);
		// Should have strict: true on function
		expect(requestBody.tools[0].function.strict).toBe(true);
	});

	test("should strip unsupported string fields from Cerebras tool parameters", async () => {
		const toolsWithStringFields = [
			{
				type: "function" as const,
				function: {
					name: "fetch_url",
					description: "Fetch a URL",
					parameters: {
						type: "object",
						properties: {
							url: { type: "string", format: "uri" },
							email: { type: "string", format: "email" },
							name: { type: "string", minLength: 1, maxLength: 100 },
							code: { type: "string", pattern: "^[A-Z]+$" },
							plainString: { type: "string" },
						},
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"cerebras",
			"llama-4-scout-17b-16e-instruct",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			toolsWithStringFields,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const params = requestBody.tools[0].function.parameters;

		// Should strip format field from string schemas
		expect(params.properties.url.format).toBeUndefined();
		expect(params.properties.email.format).toBeUndefined();
		// Should strip minLength/maxLength
		expect(params.properties.name.minLength).toBeUndefined();
		expect(params.properties.name.maxLength).toBeUndefined();
		// Should strip pattern
		expect(params.properties.code.pattern).toBeUndefined();
		// Should preserve type
		expect(params.properties.url.type).toBe("string");
		expect(params.properties.email.type).toBe("string");
		expect(params.properties.name.type).toBe("string");
		expect(params.properties.code.type).toBe("string");
		expect(params.properties.plainString.type).toBe("string");
	});
});

describe("prepareRequestBody - AWS Bedrock", () => {
	test("should sanitize complex tool schemas for Bedrock Converse", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			[{ role: "user", content: "Run a tool" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			[
				{
					type: "function" as const,
					function: {
						name: "exec",
						description: "Execute shell commands",
						parameters: {
							type: "object",
							required: ["command"],
							properties: {
								command: {
									type: "string",
									minLength: 1,
								},
								env: {
									type: "object",
									patternProperties: {
										"^(.*)$": {
											type: "string",
											minLength: 1,
										},
									},
								},
								yieldMs: {
									type: "number",
									minimum: 0,
								},
								fields: {
									type: "array",
									items: {
										type: "object",
										additionalProperties: true,
										properties: {},
									},
								},
							},
							additionalProperties: false,
						},
					},
				},
			],
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const schema = requestBody.toolConfig.tools[0].toolSpec.inputSchema.json;

		expect(schema).toEqual({
			type: "object",
			required: ["command"],
			properties: {
				command: {
					type: "string",
				},
				env: {
					type: "object",
					properties: {},
				},
				yieldMs: {
					type: "number",
				},
				fields: {
					type: "array",
					items: {
						type: "object",
						properties: {},
					},
				},
			},
		});
	});

	test("should group consecutive tool results into a single user message", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"anthropic.claude-sonnet-4-6",
			[
				{ role: "user", content: "What is the weather and time in Berlin?" },
				{
					role: "assistant",
					content: "",
					tool_calls: [
						{
							id: "tool_1",
							type: "function",
							function: {
								name: "get_weather",
								arguments: JSON.stringify({ city: "Berlin" }),
							},
						},
						{
							id: "tool_2",
							type: "function",
							function: {
								name: "get_time",
								arguments: JSON.stringify({ city: "Berlin" }),
							},
						},
					],
				},
				{
					role: "tool",
					tool_call_id: "tool_1",
					content: JSON.stringify({ temperature: 17, unit: "celsius" }),
				},
				{
					role: "tool",
					tool_call_id: "tool_2",
					content: JSON.stringify({ time: "20:52" }),
				},
			],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		expect(requestBody.messages).toHaveLength(3);
		expect(requestBody.messages[0]).toEqual({
			role: "user",
			content: [{ text: "What is the weather and time in Berlin?" }],
		});
		expect(requestBody.messages[1].role).toBe("assistant");
		expect(requestBody.messages[1].content).toHaveLength(2);
		expect(requestBody.messages[1].content[0]).toEqual({
			toolUse: {
				toolUseId: "tool_1",
				name: "get_weather",
				input: { city: "Berlin" },
			},
		});
		expect(requestBody.messages[1].content[1]).toEqual({
			toolUse: {
				toolUseId: "tool_2",
				name: "get_time",
				input: { city: "Berlin" },
			},
		});
		expect(requestBody.messages[2]).toEqual({
			role: "user",
			content: [
				{
					toolResult: {
						toolUseId: "tool_1",
						content: [
							{ text: JSON.stringify({ temperature: 17, unit: "celsius" }) },
						],
					},
				},
				{
					toolResult: {
						toolUseId: "tool_2",
						content: [{ text: JSON.stringify({ time: "20:52" }) }],
					},
				},
			],
		});
	});
});
