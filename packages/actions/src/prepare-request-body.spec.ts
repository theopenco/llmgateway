import { describe, expect, test } from "vitest";

import { prepareRequestBody, RequestError } from "./prepare-request-body.js";

import type { AnthropicRequestBody } from "@llmgateway/models";

function getCacheControl(block: unknown): unknown {
	if (block && typeof block === "object" && "cache_control" in block) {
		return (block as { cache_control: unknown }).cache_control;
	}
	return undefined;
}

async function prepareOpenAIImageRequest(imageConfig: {
	aspect_ratio?: string;
	image_size?: string;
	image_quality?: string;
	n?: number;
}) {
	return await prepareRequestBody(
		"openai",
		"gpt-image-2",
		null,
		"gpt-image-2",
		[{ role: "user", content: "Generate a cinematic landscape" }],
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
		20,
		null,
		undefined,
		imageConfig,
		undefined,
		true,
	);
}

async function prepareOpenAITextRequest(options: {
	provider?: "openai" | "azure";
	model?: string;
	useResponsesApi?: boolean;
	promptCacheKey?: string;
	promptCacheRetention?: "in_memory" | "24h";
	serviceTier?: "flex" | "priority";
	verbosity?: "low" | "medium" | "high";
}) {
	const model = options.model ?? "gpt-5.5";
	return await prepareRequestBody(
		options.provider ?? "openai",
		model,
		null,
		model,
		[{ role: "user", content: "Hello!" }],
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
		20,
		null,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		undefined,
		options.useResponsesApi ?? false,
		options.promptCacheKey,
		options.promptCacheRetention,
		true,
		undefined,
		options.serviceTier,
		options.verbosity,
	);
}

describe("prepareRequestBody - Anthropic", () => {
	test("should extract system messages to system field for caching", async () => {
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			null,
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
			null,
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
			null,
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
			null,
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

	test("strips caller-supplied cache_control when providerCacheControlEnabled is false", async () => {
		const longContent = "A".repeat(5000);
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			null,
			"claude-3-5-sonnet-20241022",
			[
				{
					role: "system",
					content: [
						{
							type: "text",
							text: longContent,
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: longContent,
							cache_control: { type: "ephemeral" },
						},
					],
				},
			],
			false, // stream
			undefined, // temperature
			1024, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			undefined, // supportsReasoning
			false, // isProd
			20, // maxImageSizeMB
			null, // userPlan
			undefined, // sensitive_word_check
			undefined, // image_config
			undefined, // effort
			undefined, // imageGenerations
			undefined, // webSearchTool
			undefined, // reasoning_max_tokens
			undefined, // useResponsesApi
			undefined, // prompt_cache_key
			undefined, // prompt_cache_retention
			false, // providerCacheControlEnabled
		)) as AnthropicRequestBody;

		// System: no caller marker preserved, no heuristic-added marker.
		if (requestBody.system && Array.isArray(requestBody.system)) {
			for (const block of requestBody.system) {
				expect(getCacheControl(block)).toBeUndefined();
			}
		}

		// User content: no caller marker preserved, no heuristic-added marker.
		for (const msg of requestBody.messages) {
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					expect(getCacheControl(block)).toBeUndefined();
				}
			}
		}
	});

	test("defers auto-injection when caller supplies a 1h ttl marker in messages", async () => {
		const longContent = "A".repeat(5000);
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			null,
			"claude-3-5-sonnet-20241022",
			[
				{ role: "system", content: longContent },
				{ role: "user", content: longContent },
				{ role: "assistant", content: "Hi!" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What should I do next?",
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					],
				},
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
			undefined,
			false,
		)) as AnthropicRequestBody;

		// Long system prompt must NOT get a heuristic (5m) marker — it would
		// precede the caller's 1h marker and Anthropic rejects that ordering.
		expect(Array.isArray(requestBody.system)).toBe(true);
		for (const block of requestBody.system as unknown[]) {
			expect(getCacheControl(block)).toBeUndefined();
		}

		// No auto-injected markers in messages either (long-block heuristic and
		// turn-boundary placement are both suppressed); only the caller's own
		// 1h marker survives, with its ttl intact.
		const markers: unknown[] = [];
		for (const msg of requestBody.messages) {
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					const cacheControl = getCacheControl(block);
					if (cacheControl) {
						markers.push(cacheControl);
					}
				}
			}
		}
		expect(markers).toEqual([{ type: "ephemeral", ttl: "1h" }]);
	});

	test("keeps auto-injection when caller markers do not use a 1h ttl", async () => {
		const longContent = "A".repeat(5000);
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-3-5-sonnet-20241022",
			null,
			"claude-3-5-sonnet-20241022",
			[
				{ role: "system", content: longContent },
				{ role: "user", content: "Hello!" },
				{ role: "assistant", content: "Hi!" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What should I do next?",
							cache_control: { type: "ephemeral" },
						},
					],
				},
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
			undefined,
			false,
		)) as AnthropicRequestBody;

		// ttl-less caller markers are all 5m, same as the heuristics — no
		// ordering conflict is possible, so the existing behavior is preserved:
		// long system prompt and turn boundary still get auto markers.
		expect(getCacheControl((requestBody.system as unknown[])[0])).toEqual({
			type: "ephemeral",
		});

		const boundaryMsg = requestBody.messages[1];
		expect(boundaryMsg.role).toBe("assistant");
		expect(getCacheControl((boundaryMsg.content as unknown[])[0])).toEqual({
			type: "ephemeral",
		});

		const explicitMsg = requestBody.messages[2];
		expect(getCacheControl((explicitMsg.content as unknown[])[0])).toEqual({
			type: "ephemeral",
		});
	});
});

describe("prepareRequestBody - OpenAI image generation", () => {
	test.each([
		"1024x1024",
		"1536x1024",
		"1024x1536",
		"2048x2048",
		"3072x2160",
		"3840x2160",
		"2160x3840",
		"auto",
	])("should pass image_size %s straight through", async (size) => {
		const requestBody = (await prepareOpenAIImageRequest({
			image_size: size,
			image_quality: "high",
			n: 1,
		})) as any;

		expect(requestBody).toMatchObject({
			model: "gpt-image-2",
			prompt: "Generate a cinematic landscape",
			size,
			quality: "high",
			n: 1,
		});
	});

	test("should not derive size from aspect_ratio", async () => {
		const requestBody = (await prepareOpenAIImageRequest({
			aspect_ratio: "16:9",
		})) as any;

		expect(requestBody.size).toBeUndefined();
	});

	test("should drop unsupported quality values", async () => {
		const requestBody = (await prepareOpenAIImageRequest({
			image_size: "1024x1024",
			image_quality: "standard",
		})) as any;

		expect(requestBody.size).toBe("1024x1024");
		expect(requestBody.quality).toBeUndefined();
	});
});

describe("prepareRequestBody - OpenAI prompt caching", () => {
	test("should forward prompt cache controls to OpenAI chat completions", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			promptCacheKey: "tenant-a",
			promptCacheRetention: "24h",
		})) as any;

		expect(requestBody.prompt_cache_key).toBe("tenant-a");
		expect(requestBody.prompt_cache_retention).toBe("24h");
	});

	test("should forward prompt cache controls to OpenAI Responses API", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			useResponsesApi: true,
			promptCacheKey: "tenant-a",
			promptCacheRetention: "in_memory",
		})) as any;

		expect(requestBody.prompt_cache_key).toBe("tenant-a");
		expect(requestBody.prompt_cache_retention).toBe("in_memory");
	});

	test("should throw a typed RequestError for tool messages without tool_call_id", async () => {
		await expect(
			prepareRequestBody(
				"openai",
				"gpt-5.5",
				null,
				"gpt-5.5",
				[
					{ role: "user", content: "Hello!" },
					{ role: "tool", content: "result" } as any,
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
				20,
				null,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true,
			),
		).rejects.toBeInstanceOf(RequestError);
	});

	test("should not forward OpenAI prompt cache controls to Azure", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			provider: "azure",
			promptCacheKey: "tenant-a",
			promptCacheRetention: "24h",
		})) as any;

		expect(requestBody.prompt_cache_key).toBeUndefined();
		expect(requestBody.prompt_cache_retention).toBeUndefined();
	});

	test("should strip prompt_cache_retention=24h on models that don't support extended retention", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			model: "gpt-4o",
			promptCacheKey: "tenant-a",
			promptCacheRetention: "24h",
		})) as any;

		expect(requestBody.prompt_cache_key).toBe("tenant-a");
		expect(requestBody.prompt_cache_retention).toBeUndefined();
	});

	test("should still forward prompt_cache_retention=in_memory on models without 24h support", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			model: "gpt-4o",
			promptCacheRetention: "in_memory",
		})) as any;

		expect(requestBody.prompt_cache_retention).toBe("in_memory");
	});

	test("should forward prompt_cache_retention=24h on models that do support extended retention", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			model: "gpt-4.1",
			promptCacheRetention: "24h",
		})) as any;

		expect(requestBody.prompt_cache_retention).toBe("24h");
	});
});

describe("prepareRequestBody - OpenAI service tiers", () => {
	test("should forward service_tier to OpenAI chat completions", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			serviceTier: "flex",
		})) as { service_tier?: string };

		expect(requestBody.service_tier).toBe("flex");
	});

	test("should forward service_tier to OpenAI Responses API", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			useResponsesApi: true,
			serviceTier: "priority",
		})) as { service_tier?: string };

		expect(requestBody.service_tier).toBe("priority");
	});

	test("should not forward service_tier to unsupported OpenAI models", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			model: "gpt-4o",
			serviceTier: "priority",
		})) as { service_tier?: string };

		expect(requestBody.service_tier).toBeUndefined();
	});

	test("should not forward service_tier to Azure", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			provider: "azure",
			serviceTier: "flex",
		})) as { service_tier?: string };

		expect(requestBody.service_tier).toBeUndefined();
	});
});

describe("prepareRequestBody - verbosity", () => {
	test("forwards verbosity to gpt-5.6 chat completions", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			model: "gpt-5.6-terra",
			verbosity: "low",
		})) as { verbosity?: string };

		expect(requestBody.verbosity).toBe("low");
	});

	test("forwards verbosity as text.verbosity to gpt-5.6 Responses API", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			model: "gpt-5.6-sol",
			useResponsesApi: true,
			verbosity: "high",
		})) as { text?: { verbosity?: string } };

		expect(requestBody.text?.verbosity).toBe("high");
	});

	test("keeps text.format when verbosity is combined with response_format", async () => {
		const requestBody = (await prepareRequestBody(
			"openai",
			"gpt-5.6-luna",
			null,
			"gpt-5.6-luna",
			[{ role: "user", content: "Hello!" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			{ type: "json_object" },
			undefined,
			undefined,
			undefined,
			false,
			false,
			20,
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			true, // useResponsesApi
			undefined,
			undefined,
			true,
			undefined,
			undefined,
			"medium", // verbosity
		)) as { text?: { format?: { type: string }; verbosity?: string } };

		expect(requestBody.text?.format?.type).toBe("json_object");
		expect(requestBody.text?.verbosity).toBe("medium");
	});

	test("strips verbosity for models without verbosity support", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			model: "gpt-4o",
			verbosity: "low",
		})) as { verbosity?: string };

		expect(requestBody.verbosity).toBeUndefined();
	});

	test("strips verbosity from the Responses API body for unsupported models", async () => {
		const requestBody = (await prepareOpenAITextRequest({
			model: "gpt-5.5",
			useResponsesApi: true,
			verbosity: "low",
		})) as { text?: { verbosity?: string } };

		expect(requestBody.text?.verbosity).toBeUndefined();
	});
});

describe("prepareRequestBody - reasoning_effort none", () => {
	async function prepare(options: {
		provider: Parameters<typeof prepareRequestBody>[0];
		model: string;
		useResponsesApi?: boolean;
	}) {
		return (await prepareRequestBody(
			options.provider,
			options.model,
			null,
			options.model,
			[{ role: "user", content: "Hello!" }],
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			"none", // reasoning_effort
			true, // supportsReasoning
			false, // isProd
			20,
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			options.useResponsesApi ?? false,
		)) as any;
	}

	test("forwards none to OpenAI chat completions", async () => {
		const requestBody = await prepare({ provider: "openai", model: "gpt-5.5" });
		expect(requestBody.reasoning_effort).toBe("none");
	});

	test("forwards none to OpenAI Responses API", async () => {
		const requestBody = await prepare({
			provider: "openai",
			model: "gpt-5.5",
			useResponsesApi: true,
		});
		expect(requestBody.reasoning.effort).toBe("none");
	});

	test("disables thinking for Google on none", async () => {
		const requestBody = await prepare({
			provider: "google-ai-studio",
			model: "gemini-2.5-pro",
		});
		expect(requestBody.generationConfig.thinkingConfig.includeThoughts).toBe(
			false,
		);
		expect(
			requestBody.generationConfig.thinkingConfig.thinkingBudget,
		).toBeUndefined();
	});

	test("normalizes none to off for Anthropic (thinking not enabled)", async () => {
		const requestBody = (await prepare({
			provider: "anthropic",
			model: "claude-sonnet-4-20250514",
		})) as AnthropicRequestBody;
		expect(requestBody.thinking).toBeUndefined();
	});
});

describe("prepareRequestBody - xAI reasoning_effort", () => {
	async function prepare(effort: "low" | "medium" | "high" | "xhigh") {
		return (await prepareRequestBody(
			"xai",
			"grok-4-5",
			null,
			"grok-4.5",
			[{ role: "user", content: "Hello!" }],
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			effort, // reasoning_effort
			true, // supportsReasoning
			false, // isProd
			20,
			null,
		)) as any;
	}

	test("forwards low to xAI", async () => {
		const requestBody = await prepare("low");
		expect(requestBody.reasoning_effort).toBe("low");
	});

	test("forwards high to xAI", async () => {
		const requestBody = await prepare("high");
		expect(requestBody.reasoning_effort).toBe("high");
	});

	test("forwards medium to xAI", async () => {
		const requestBody = await prepare("medium");
		expect(requestBody.reasoning_effort).toBe("medium");
	});

	test("forwards effort verbatim and lets xAI reject unsupported tiers", async () => {
		const requestBody = await prepare("xhigh");
		expect(requestBody.reasoning_effort).toBe("xhigh");
	});
});

describe("prepareRequestBody - Google AI Studio", () => {
	test("should map gateway 0.5K image size to Google 512", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-3.1-flash-image-preview",
			null,
			"gemini-3.1-flash-image-preview",
			[
				{
					role: "user",
					content: "Generate a small colorful abstract painting",
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
			20,
			null,
			undefined,
			{
				aspect_ratio: "1:1",
				image_size: "0.5K",
			},
		)) as any;

		expect(requestBody.generationConfig.imageConfig).toEqual({
			aspectRatio: "1:1",
			imageSize: "512",
		});
		expect(requestBody.generationConfig.responseModalities).toEqual([
			"TEXT",
			"IMAGE",
		]);
	});

	test("should map gateway 0.5K image size to Google 512 for Vertex", async () => {
		const requestBody = (await prepareRequestBody(
			"google-vertex",
			"gemini-3.1-flash-image-preview",
			null,
			"gemini-3.1-flash-image-preview",
			[
				{
					role: "user",
					content: "Generate a small colorful abstract painting",
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
			20,
			null,
			undefined,
			{
				aspect_ratio: "1:1",
				image_size: "0.5K",
			},
		)) as any;

		expect(requestBody.generationConfig.imageConfig).toEqual({
			aspectRatio: "1:1",
			imageSize: "512",
		});
	});

	test("should set thinkingBudget when reasoning_effort is provided", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.5-pro",
			null,
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
				null,
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

	test('preserves "max" effort natively for adaptive Anthropic models', async () => {
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-opus-4-7",
			null,
			"claude-opus-4-7",
			[{ role: "user", content: "test" }],
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			"max", // reasoning_effort
			true, // supportsReasoning
			false, // isProd
		)) as any;

		expect(requestBody.thinking).toEqual({
			type: "adaptive",
			display: "summarized",
		});
		expect(requestBody.output_config.effort).toBe("max");
	});

	test('preserves "max" effort natively for adaptive Anthropic models on Bedrock', async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-opus-4-7",
			null,
			"claude-opus-4-7",
			[{ role: "user", content: "test" }],
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			"max", // reasoning_effort
			true, // supportsReasoning
			false, // isProd
		)) as any;

		expect(requestBody.additionalModelRequestFields.thinking).toEqual({
			type: "adaptive",
			display: "summarized",
		});
		expect(requestBody.additionalModelRequestFields.output_config.effort).toBe(
			"max",
		);
	});

	test('sets display "summarized" for adaptive thinking on Bedrock', async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-opus-4-7",
			null,
			"claude-opus-4-7",
			[{ role: "user", content: "test" }],
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			"high", // reasoning_effort
			true, // supportsReasoning
			false, // isProd
		)) as any;

		expect(requestBody.additionalModelRequestFields.thinking).toEqual({
			type: "adaptive",
			display: "summarized",
		});
	});

	test('sets display "summarized" for adaptive thinking on Anthropic', async () => {
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-opus-4-7",
			null,
			"claude-opus-4-7",
			[{ role: "user", content: "test" }],
			false, // stream
			undefined, // temperature
			undefined, // max_tokens
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			"high", // reasoning_effort
			true, // supportsReasoning
			false, // isProd
		)) as any;

		expect(requestBody.thinking).toEqual({
			type: "adaptive",
			display: "summarized",
		});
	});

	test('aliases "max" effort to "high" for providers without a max tier', async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.5-pro",
			null,
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
			"max", // reasoning_effort
			true,
			false,
		)) as any;

		// "max" has no Google tier, so it aliases to "high" (24576) rather than
		// falling through to the medium default (8192).
		expect(requestBody.generationConfig.thinkingConfig.thinkingBudget).toBe(
			24576,
		);
	});

	test("should not set thinkingBudget when reasoning_effort is not provided", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.5-pro",
			null,
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
			null,
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
			null,
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

	test("should not overflow the stack on self-referential $ref schemas", async () => {
		const recursiveTools = [
			{
				type: "function" as const,
				function: {
					name: "build_tree",
					description: "Build a recursive tree",
					parameters: {
						type: "object",
						properties: {
							root: { $ref: "#/$defs/TreeNode" },
						},
						$defs: {
							TreeNode: {
								type: "object",
								properties: {
									value: { type: "string" },
									children: {
										type: "array",
										items: { $ref: "#/$defs/TreeNode" },
									},
								},
								required: ["value"],
							},
						},
						required: ["root"],
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.0-flash",
			null,
			"gemini-2.0-flash",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			recursiveTools,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const params = requestBody.tools[0].functionDeclarations[0].parameters;
		expect(params.$defs).toBeUndefined();
		// The recursive node is expanded one level then collapsed to a generic
		// object where it would otherwise recurse forever.
		expect(params.properties.root.properties.value).toEqual({
			type: "string",
		});
		expect(params.properties.root.properties.children.items).toEqual({
			type: "object",
		});
	});

	test("should not overflow the stack on self-referential $ref schemas for bedrock", async () => {
		const recursiveTools = [
			{
				type: "function" as const,
				function: {
					name: "build_tree",
					description: "Build a recursive tree",
					parameters: {
						type: "object",
						properties: {
							root: { $ref: "#/$defs/TreeNode" },
						},
						$defs: {
							TreeNode: {
								type: "object",
								properties: {
									value: { type: "string" },
									children: {
										type: "array",
										items: { $ref: "#/$defs/TreeNode" },
									},
								},
								required: ["value"],
							},
						},
						required: ["root"],
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-sonnet-4-6",
			null,
			"claude-sonnet-4-6",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			recursiveTools,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const toolSpec = requestBody.toolConfig.tools[0].toolSpec;
		const schema = toolSpec.inputSchema.json;
		expect(schema.properties.root.properties.children.items).toEqual({
			type: "object",
			properties: {},
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
			null,
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
			null,
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

	test("should strip $id, examples, enumTitles, prefill from Google tool parameters", async () => {
		const toolsWithMetaSchema = [
			{
				type: "function" as const,
				function: {
					name: "test_tool",
					description: "Test tool",
					parameters: {
						$id: "https://example.com/schema.json",
						$comment: "internal note",
						type: "object",
						properties: {
							field_a: {
								type: "string",
								prefill: "hello",
								examples: ["a", "b"],
							},
							field_b: {
								type: "string",
								examples: ["x"],
							},
							field_c: {
								type: "array",
								items: {
									type: "string",
									enum: ["one", "two"],
									enumTitles: ["One", "Two"],
								},
								examples: [["one"]],
							},
						},
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.0-flash",
			null,
			"gemini-2.0-flash",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			toolsWithMetaSchema,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const params = requestBody.tools[0].functionDeclarations[0].parameters;

		expect(params.$id).toBeUndefined();
		expect(params.$comment).toBeUndefined();
		expect(params.properties.field_a.prefill).toBeUndefined();
		expect(params.properties.field_a.examples).toBeUndefined();
		expect(params.properties.field_b.examples).toBeUndefined();
		expect(params.properties.field_c.examples).toBeUndefined();
		expect(params.properties.field_c.items.enumTitles).toBeUndefined();
		expect(params.properties.field_a.type).toBe("string");
		expect(params.properties.field_c.items.enum).toEqual(["one", "two"]);
	});

	test("should preserve user-named fields that collide with stripped schema keywords", async () => {
		const toolsWithCollidingNames = [
			{
				type: "function" as const,
				function: {
					name: "test_tool",
					description: "Test tool",
					parameters: {
						type: "object",
						properties: {
							examples: {
								type: "array",
								items: { type: "string" },
								description: "User-provided examples list",
							},
							prefill: {
								type: "string",
								description: "User-provided prefill text",
							},
							const: {
								type: "string",
								description: "A field literally named const",
							},
							nested: {
								type: "object",
								properties: {
									examples: { type: "string" },
								},
								required: ["examples"],
							},
						},
						required: ["examples", "prefill"],
					},
				},
			},
		];

		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.0-flash",
			null,
			"gemini-2.0-flash",
			[{ role: "user", content: "test" }],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			toolsWithCollidingNames,
			undefined,
			undefined,
			false,
			false,
		)) as any;

		const params = requestBody.tools[0].functionDeclarations[0].parameters;

		// User-named fields must survive, even though they collide with stripped keywords
		expect(params.properties.examples).toBeDefined();
		expect(params.properties.examples.type).toBe("array");
		expect(params.properties.examples.description).toBe(
			"User-provided examples list",
		);
		expect(params.properties.prefill).toBeDefined();
		expect(params.properties.prefill.type).toBe("string");
		expect(params.properties.const).toBeDefined();
		expect(params.properties.const.type).toBe("string");

		// Nested properties map should also preserve user field names
		expect(params.properties.nested.properties.examples).toBeDefined();
		expect(params.properties.nested.properties.examples.type).toBe("string");
		expect(params.properties.nested.required).toContain("examples");

		// And `required` should still mention these user fields
		expect(params.required).toContain("examples");
		expect(params.required).toContain("prefill");
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
			null,
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
			null,
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

describe("prepareRequestBody - MiniMax", () => {
	test("should enable reasoning_split for reasoning-capable models", async () => {
		const requestBody = (await prepareRequestBody(
			"minimax",
			"MiniMax-M2",
			null,
			"MiniMax-M2",
			[{ role: "user", content: "What is 2+2?" }],
			true,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			true,
			false,
		)) as { extra_body?: Record<string, unknown> };

		expect(requestBody.extra_body).toEqual({
			reasoning_split: true,
		});
	});

	test("should not set reasoning_split when supportsReasoning is false", async () => {
		const requestBody = (await prepareRequestBody(
			"minimax",
			"MiniMax-M2",
			null,
			"MiniMax-M2",
			[{ role: "user", content: "What is 2+2?" }],
			true,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			"medium",
			false,
			false,
		)) as { extra_body?: Record<string, unknown> };

		expect(requestBody.extra_body?.reasoning_split).toBeUndefined();
	});
});

describe("prepareRequestBody - function tool parameter normalization", () => {
	test("should default missing parameters to a JSON Schema object for DeepSeek", async () => {
		const requestBody = (await prepareRequestBody(
			"deepseek",
			"deepseek-chat",
			null,
			"deepseek-chat",
			[{ role: "user", content: "hi" }],
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
						name: "web_search",
						description: "Search the web",
					},
				},
			],
			undefined,
			undefined,
			false,
			false,
		)) as { tools?: any[] };

		expect(requestBody.tools).toBeDefined();
		expect(requestBody.tools?.[0].function.parameters).toEqual({
			type: "object",
			properties: {},
		});
	});

	test("should rewrite parameters with type: null to type: object", async () => {
		const requestBody = (await prepareRequestBody(
			"deepseek",
			"deepseek-chat",
			null,
			"deepseek-chat",
			[{ role: "user", content: "hi" }],
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
						name: "web_search",
						description: "Search the web",
						parameters: { type: null as unknown as string },
					},
				},
			],
			undefined,
			undefined,
			false,
			false,
		)) as { tools?: any[] };

		expect(requestBody.tools?.[0].function.parameters).toEqual({
			type: "object",
			properties: {},
		});
	});

	test("should preserve valid object parameters as-is", async () => {
		const params = {
			type: "object",
			properties: { query: { type: "string" } },
			required: ["query"],
		};
		const requestBody = (await prepareRequestBody(
			"deepseek",
			"deepseek-chat",
			null,
			"deepseek-chat",
			[{ role: "user", content: "hi" }],
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
						name: "web_search",
						description: "Search the web",
						parameters: params,
					},
				},
			],
			undefined,
			undefined,
			false,
			false,
		)) as { tools?: any[] };

		expect(requestBody.tools?.[0].function.parameters).toEqual(params);
	});
});

describe("prepareRequestBody - AWS Bedrock", () => {
	test("should keep Grok 4.3 as Bedrock Mantle OpenAI chat completions", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"grok-4-3",
			"us-west-2",
			"xai.grok-4.3",
			[{ role: "user", content: "Hello!" }],
			true,
			0.2,
			128,
			0.9,
			undefined,
			undefined,
			{ type: "json_object" },
			undefined,
			undefined,
			"high",
			true,
			false,
		)) as any;

		expect(requestBody).toMatchObject({
			model: "xai.grok-4.3",
			messages: [{ role: "user", content: "Hello!" }],
			stream: true,
			stream_options: { include_usage: true },
			temperature: 0.2,
			max_completion_tokens: 128,
			top_p: 0.9,
			response_format: { type: "json_object" },
			reasoning: { effort: "high" },
		});
		expect(requestBody.inferenceConfig).toBeUndefined();
		expect(requestBody.system).toBeUndefined();
	});

	test("should preserve explicit cache_control ttl as Bedrock cachePoint ttl", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-sonnet-4-5",
			null,
			"anthropic.claude-sonnet-4-5-20250929-v1:0",
			[
				{
					role: "system",
					content: [
						{
							type: "text",
							text: "Cache this system prompt.",
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What should I do next?",
							cache_control: { type: "ephemeral", ttl: "5m" },
						},
					],
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

		expect(requestBody.system).toEqual([
			{ text: "Cache this system prompt." },
			{ cachePoint: { type: "default", ttl: "1h" } },
		]);
		expect(requestBody.messages[0].content).toEqual([
			{ text: "What should I do next?" },
			{ cachePoint: { type: "default", ttl: "5m" } },
		]);
	});

	test("forwards base64 image blocks as Bedrock image content", async () => {
		const pngBase64 =
			"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-sonnet-4-5",
			null,
			"anthropic.claude-sonnet-4-5-20250929-v1:0",
			[
				{
					role: "user",
					content: [
						{ type: "text", text: "What is in this image?" },
						{
							type: "image_url",
							image_url: {
								url: `data:image/png;base64,${pngBase64}`,
							},
						},
					],
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
			undefined,
			false,
		)) as any;

		expect(requestBody.messages[0].content).toEqual([
			{ text: "What is in this image?" },
			{
				image: {
					format: "png",
					source: { bytes: pngBase64 },
				},
			},
		]);
	});

	test("suppresses heuristic cachePoints when caller supplies a 1h ttl marker in messages", async () => {
		const longContent = "A".repeat(5000);
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-sonnet-4-5",
			null,
			"anthropic.claude-sonnet-4-5-20250929-v1:0",
			[
				{ role: "system", content: longContent },
				{ role: "user", content: "Hello!" },
				{ role: "assistant", content: "Hi!" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What should I do next?",
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					],
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
			undefined,
			false,
		)) as any;

		// No heuristic cachePoint on the long system prompt and no turn-boundary
		// cachePoint — a default-ttl (5m) point would precede the caller's 1h
		// point, which Bedrock rejects.
		expect(requestBody.system).toEqual([{ text: longContent }]);
		expect(requestBody.messages[1]).toEqual({
			role: "assistant",
			content: [{ text: "Hi!" }],
		});
		expect(requestBody.messages[2].content).toEqual([
			{ text: "What should I do next?" },
			{ cachePoint: { type: "default", ttl: "1h" } },
		]);
	});

	test("keeps heuristic cachePoints when a caller 1h ttl is downgraded to 5m", async () => {
		const longContent = "A".repeat(5000);
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-3-7-sonnet",
			null,
			"anthropic.claude-3-7-sonnet-20250219-v1:0",
			[
				{ role: "system", content: longContent },
				{ role: "user", content: "Hello!" },
				{ role: "assistant", content: "Hi!" },
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What should I do next?",
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					],
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
			undefined,
			false,
		)) as any;

		// claude-3-7-sonnet has no 1h TTL on Bedrock, so the caller's marker is
		// downgraded to a default (5m) cachePoint. With every point at 5m there
		// is no ordering conflict, so the heuristics stay active.
		expect(requestBody.system).toEqual([
			{ text: longContent },
			{ cachePoint: { type: "default" } },
		]);
		expect(requestBody.messages[1]).toEqual({
			role: "assistant",
			content: [{ text: "Hi!" }, { cachePoint: { type: "default" } }],
		});
		expect(requestBody.messages[2].content).toEqual([
			{ text: "What should I do next?" },
			{ cachePoint: { type: "default" } },
		]);
	});

	test("should drop ttl:1h on bedrock models that do not support 1h TTL", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-3-7-sonnet",
			null,
			"anthropic.claude-3-7-sonnet-20250219-v1:0",
			[
				{
					role: "system",
					content: [
						{
							type: "text",
							text: "Cache this system prompt.",
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What should I do next?",
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					],
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

		expect(requestBody.system).toEqual([
			{ text: "Cache this system prompt." },
			{ cachePoint: { type: "default" } },
		]);
		expect(requestBody.messages[0].content).toEqual([
			{ text: "What should I do next?" },
			{ cachePoint: { type: "default" } },
		]);
	});

	test("should sanitize complex tool schemas for Bedrock Converse", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-sonnet-4-6",
			null,
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
			"claude-sonnet-4-6",
			null,
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
		// 2 toolUse blocks + 1 turn-boundary cachePoint
		expect(requestBody.messages[1].content).toHaveLength(3);
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
		expect(requestBody.messages[1].content[2]).toEqual({
			cachePoint: { type: "default" },
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
	test("synthesizes toolConfig when history has tool blocks but request omits tools", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-opus-4-8",
			null,
			"anthropic.claude-opus-4-8",
			[
				{ role: "user", content: "What is the weather in Berlin?" },
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
					],
				},
				{
					role: "tool",
					tool_call_id: "tool_1",
					content: JSON.stringify({ temperature: 17, unit: "celsius" }),
				},
				{ role: "user", content: "Thanks, what should I wear?" },
			],
			false,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined, // tools omitted on the follow-up turn
			undefined,
			undefined,
			false,
			false,
		)) as any;

		// Bedrock requires toolConfig whenever toolUse/toolResult blocks are
		// present in the history, so it must be synthesized from the tool
		// names seen in the assistant toolUse blocks.
		expect(requestBody.toolConfig).toEqual({
			tools: [
				{
					toolSpec: {
						name: "get_weather",
						inputSchema: {
							json: {
								type: "object",
								properties: {},
							},
						},
					},
				},
			],
		});
	});

	test("does not synthesize toolConfig when history has no tool blocks", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-opus-4-8",
			null,
			"anthropic.claude-opus-4-8",
			[{ role: "user", content: "Hello there" }],
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

		expect(requestBody.toolConfig).toBeUndefined();
	});
});

describe("prepareRequestBody - reasoning.max_tokens forwarding", () => {
	const budget = 1024;

	test("anthropic forwards budget into thinking.budget_tokens", async () => {
		const requestBody = (await prepareRequestBody(
			"anthropic",
			"claude-sonnet-4-6",
			null,
			"claude-sonnet-4-6",
			[{ role: "user", content: "What is 2/3 + 1/4 + 5/6?" }],
			false, // stream
			undefined, // temperature
			1024, // max_tokens (must exceed thinking budget)
			undefined, // top_p
			undefined, // frequency_penalty
			undefined, // presence_penalty
			undefined, // response_format
			undefined, // tools
			undefined, // tool_choice
			undefined, // reasoning_effort
			true, // supportsReasoning
			false, // isProd
			20, // maxImageSizeMB
			null, // userPlan
			undefined, // sensitive_word_check
			undefined, // image_config
			undefined, // effort
			undefined, // imageGenerations
			undefined, // webSearchTool
			budget, // reasoning_max_tokens
		)) as any;

		expect(requestBody.thinking).toEqual({
			type: "enabled",
			budget_tokens: budget,
		});
	});

	test("aws-bedrock forwards budget into additionalModelRequestFields.thinking.budget_tokens", async () => {
		const requestBody = (await prepareRequestBody(
			"aws-bedrock",
			"claude-sonnet-4-6",
			null,
			"anthropic.claude-sonnet-4-6",
			[{ role: "user", content: "What is 2/3 + 1/4 + 5/6?" }],
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
			true,
			false,
			20,
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			budget,
		)) as any;

		expect(requestBody.additionalModelRequestFields?.thinking).toEqual({
			type: "enabled",
			budget_tokens: budget,
		});
	});

	test("google-ai-studio forwards budget into generationConfig.thinkingConfig.thinkingBudget", async () => {
		const requestBody = (await prepareRequestBody(
			"google-ai-studio",
			"gemini-2.5-pro",
			null,
			"gemini-2.5-pro",
			[{ role: "user", content: "What is 2/3 + 1/4 + 5/6?" }],
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
			true,
			false,
			20,
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			budget,
		)) as any;

		expect(requestBody.generationConfig?.thinkingConfig?.thinkingBudget).toBe(
			budget,
		);
	});

	test("google-vertex forwards budget into generationConfig.thinkingConfig.thinkingBudget", async () => {
		const requestBody = (await prepareRequestBody(
			"google-vertex",
			"gemini-2.5-pro",
			null,
			"gemini-2.5-pro",
			[{ role: "user", content: "What is 2/3 + 1/4 + 5/6?" }],
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
			true,
			false,
			20,
			null,
			undefined,
			undefined,
			undefined,
			undefined,
			undefined,
			budget,
		)) as any;

		expect(requestBody.generationConfig?.thinkingConfig?.thinkingBudget).toBe(
			budget,
		);
	});
});

describe("prepareRequestBody - Alibaba cache_control", () => {
	test("forwards cache_control: {type: 'ephemeral'} unchanged", async () => {
		const requestBody = (await prepareRequestBody(
			"alibaba",
			"qwen-plus",
			null,
			"qwen-plus",
			[
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Cache this content.",
							cache_control: { type: "ephemeral" },
						},
					],
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

		expect(requestBody.messages[0].content[0].cache_control).toEqual({
			type: "ephemeral",
		});
	});

	test("strips ttl from cache_control because Alibaba only supports 5m", async () => {
		const requestBody = (await prepareRequestBody(
			"alibaba",
			"qwen-plus",
			null,
			"qwen-plus",
			[
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Cache this content.",
							cache_control: { type: "ephemeral", ttl: "1h" },
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "And this.",
							cache_control: { type: "ephemeral", ttl: "5m" },
						},
					],
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

		expect(requestBody.messages[0].content[0].cache_control).toEqual({
			type: "ephemeral",
		});
		expect(requestBody.messages[1].content[0].cache_control).toEqual({
			type: "ephemeral",
		});
	});

	test("drops cache_control entirely when stripping ttl leaves an empty marker", async () => {
		const requestBody = (await prepareRequestBody(
			"alibaba",
			"qwen-plus",
			null,
			"qwen-plus",
			[
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Caller forgot the type field.",
							cache_control: { ttl: "1h" } as any,
						},
					],
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

		expect("cache_control" in requestBody.messages[0].content[0]).toBe(false);
	});
});

// Sibling to the Anthropic max_tokens regression tests above. Every provider
// gets the same three checks (caller-supplied, caller-omitted, reasoning) so
// we never silently regress to a stale fallback the way the Anthropic 1024
// default did (see PR #2289). For providers where max_tokens is OPTIONAL
// upstream (everything except Anthropic), the omit path must leave the field
// undefined so the provider's own default wins.
describe("prepareRequestBody - max_tokens forwarding", () => {
	describe("aws-bedrock (Anthropic via Converse)", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"aws-bedrock",
				"claude-sonnet-4-6",
				null,
				"anthropic.claude-sonnet-4-6",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.inferenceConfig?.maxTokens).toBe(32000);
		});

		test("leaves maxTokens unset when caller omits (no reasoning)", async () => {
			// Bedrock's Converse API tolerates omitting max_tokens; the historical
			// 1024 default was Anthropic-specific. When reasoning is off, just let
			// upstream pick.
			const requestBody = (await prepareRequestBody(
				"aws-bedrock",
				"claude-sonnet-4-6",
				null,
				"anthropic.claude-sonnet-4-6",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.inferenceConfig?.maxTokens).toBeUndefined();
		});

		test("falls back to model maxOutput when caller omits with reasoning enabled", async () => {
			const requestBody = (await prepareRequestBody(
				"aws-bedrock",
				"claude-sonnet-4-6",
				null,
				"anthropic.claude-sonnet-4-6",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"high",
				true,
				false,
			)) as any;

			// claude-sonnet-4-6's aws-bedrock provider mapping declares maxOutput:
			// 64000. Falling back to a flat 1024 (the old historical Anthropic
			// default) silently truncates large reasoning + tool responses.
			expect(requestBody.inferenceConfig?.maxTokens).toBe(64000);
		});

		test("preserves caller max_tokens even when reasoning is enabled", async () => {
			const requestBody = (await prepareRequestBody(
				"aws-bedrock",
				"claude-sonnet-4-6",
				null,
				"anthropic.claude-sonnet-4-6",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"high",
				true,
				false,
			)) as any;

			expect(requestBody.inferenceConfig?.maxTokens).toBe(32000);
		});

		test("preserves max_tokens=0 instead of overwriting it", async () => {
			// Regression: the original `if (!inferenceConfig.maxTokens)` guard
			// silently rewrote a caller-supplied 0 to the fallback. The fix uses
			// `=== undefined`, so 0 survives the undefined branch and then gets
			// floored by the reasoning check on the way out.
			const requestBody = (await prepareRequestBody(
				"aws-bedrock",
				"claude-sonnet-4-6",
				null,
				"anthropic.claude-sonnet-4-6",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				0,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"high",
				true,
				false,
			)) as any;

			// thinking budget for "high" is 4000, floor is 5000. 0 is below the
			// floor, so it gets bumped to the reasoning floor — NOT silently
			// replaced by the model maxOutput.
			expect(requestBody.inferenceConfig?.maxTokens).toBe(5000);
		});
	});

	describe("openai (Chat Completions)", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"openai",
				"gpt-4o-mini",
				null,
				"gpt-4o-mini",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBe(32000);
		});

		test("leaves max_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"openai",
				"gpt-4o-mini",
				null,
				"gpt-4o-mini",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBeUndefined();
			expect(requestBody.max_completion_tokens).toBeUndefined();
		});

		test("uses max_completion_tokens for gpt-5 family", async () => {
			// gpt-5 defaults to the Responses API, but the Chat Completions
			// branch still needs to translate max_tokens to max_completion_tokens
			// for callers who explicitly bypass the Responses API.
			const requestBody = (await prepareRequestBody(
				"openai",
				"gpt-5",
				null,
				"gpt-5",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
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
				false, // useResponsesApi
			)) as any;

			expect(requestBody.max_completion_tokens).toBe(32000);
			expect(requestBody.max_tokens).toBeUndefined();
		});
	});

	describe("azure-ai-foundry", () => {
		test("keeps Grok 4.3 as Azure Foundry chat completions", async () => {
			const requestBody = (await prepareRequestBody(
				"azure-ai-foundry",
				"grok-4-3",
				null,
				"grok-4.3",
				[{ role: "user", content: "Hello!" }],
				true,
				0.2,
				8192,
				0.9,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"medium",
				true,
			)) as unknown as Record<string, unknown>;

			expect(requestBody.model).toBe("grok-4.3");
			expect(requestBody.messages).toEqual([
				{ role: "user", content: "Hello!" },
			]);
			expect(requestBody.stream).toBe(true);
			expect(requestBody.stream_options).toEqual({ include_usage: true });
			expect(requestBody.temperature).toBe(0.2);
			expect(requestBody.max_tokens).toBe(8192);
			expect(requestBody.max_completion_tokens).toBeUndefined();
			expect(requestBody.top_p).toBe(0.9);
			expect(requestBody.reasoning_effort).toBeUndefined();
			expect(requestBody.inferenceConfig).toBeUndefined();
		});
	});

	describe("openai (Responses API)", () => {
		test("forwards caller-supplied max_tokens to max_output_tokens", async () => {
			const requestBody = (await prepareRequestBody(
				"openai",
				"gpt-5",
				null,
				"gpt-5",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
				false,
				20,
				null,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // useResponsesApi
			)) as any;

			expect(requestBody.max_output_tokens).toBe(32000);
		});

		test("leaves max_output_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"openai",
				"gpt-5",
				null,
				"gpt-5",
				[{ role: "user", content: "Hello!" }],
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
				20,
				null,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // useResponsesApi
			)) as any;

			expect(requestBody.max_output_tokens).toBeUndefined();
		});

		test("passes image_url data URLs through to input_image unchanged", async () => {
			const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
			const requestBody = (await prepareRequestBody(
				"openai",
				"gpt-5",
				null,
				"gpt-5",
				[
					{
						role: "user",
						content: [
							{ type: "text", text: "describe this" },
							{ type: "image_url", image_url: { url: dataUrl } },
						],
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
				20,
				null,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // useResponsesApi
			)) as any;

			const userItem = requestBody.input.find((i: any) => i.role === "user");
			expect(userItem.content).toContainEqual({
				type: "input_text",
				text: "describe this",
			});
			expect(userItem.content).toContainEqual({
				type: "input_image",
				image_url: dataUrl,
			});
		});

		const responsesArgs = (messages: any[]) =>
			[
				"openai",
				"gpt-5",
				null,
				"gpt-5",
				messages,
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
				20,
				null,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				true, // useResponsesApi
			] as const;

		test("pairs tool result with preceding tool_call via explicit tool_call_id", async () => {
			const requestBody = (await prepareRequestBody(
				...responsesArgs([
					{ role: "user", content: "weather in Berlin?" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_abc",
								type: "function",
								function: {
									name: "get_weather",
									arguments: JSON.stringify({ city: "Berlin" }),
								},
							},
						],
					},
					{
						role: "tool",
						tool_call_id: "call_abc",
						content: JSON.stringify({ temperature: 17 }),
					},
				]),
			)) as any;

			const output = requestBody.input.find(
				(i: any) => i.type === "function_call_output",
			);
			expect(output).toEqual({
				type: "function_call_output",
				call_id: "call_abc",
				output: JSON.stringify({ temperature: 17 }),
			});
		});

		test("recovers call_id when a lone tool result omits tool_call_id", async () => {
			const requestBody = (await prepareRequestBody(
				...responsesArgs([
					{ role: "user", content: "weather in Berlin?" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_abc",
								type: "function",
								function: {
									name: "get_weather",
									arguments: JSON.stringify({ city: "Berlin" }),
								},
							},
						],
					},
					{
						role: "tool",
						content: JSON.stringify({ temperature: 17 }),
					},
				]),
			)) as any;

			const output = requestBody.input.find(
				(i: any) => i.type === "function_call_output",
			);
			expect(output.call_id).toBe("call_abc");
		});

		test("matches legacy function-role results by unique name", async () => {
			const requestBody = (await prepareRequestBody(
				...responsesArgs([
					{ role: "user", content: "weather and time in Berlin?" },
					{
						role: "assistant",
						content: "",
						tool_calls: [
							{
								id: "call_weather",
								type: "function",
								function: { name: "get_weather", arguments: "{}" },
							},
							{
								id: "call_time",
								type: "function",
								function: { name: "get_time", arguments: "{}" },
							},
						],
					},
					// Legacy `function` role: no tool_call_id, only name. Matched by
					// unique name, so out-of-order results still resolve correctly.
					{
						role: "function",
						name: "get_time",
						content: JSON.stringify({ time: "20:52" }),
					},
					{
						role: "function",
						name: "get_weather",
						content: JSON.stringify({ temperature: 17 }),
					},
				]),
			)) as any;

			const outputs = requestBody.input.filter(
				(i: any) => i.type === "function_call_output",
			);
			expect(outputs).toEqual([
				{
					type: "function_call_output",
					call_id: "call_time",
					output: JSON.stringify({ time: "20:52" }),
				},
				{
					type: "function_call_output",
					call_id: "call_weather",
					output: JSON.stringify({ temperature: 17 }),
				},
			]);
		});

		test("throws when explicit tool_call_id matches no preceding call", async () => {
			await expect(
				prepareRequestBody(
					...responsesArgs([
						{ role: "user", content: "weather in Berlin?" },
						{
							role: "assistant",
							content: "",
							tool_calls: [
								{
									id: "call_abc",
									type: "function",
									function: { name: "get_weather", arguments: "{}" },
								},
							],
						},
						{
							role: "tool",
							tool_call_id: "call_does_not_exist",
							content: JSON.stringify({ temperature: 17 }),
						},
					]),
				),
			).rejects.toBeInstanceOf(RequestError);
		});

		test("throws for ambiguous parallel results missing tool_call_id", async () => {
			await expect(
				prepareRequestBody(
					...responsesArgs([
						{ role: "user", content: "weather and time?" },
						{
							role: "assistant",
							content: "",
							tool_calls: [
								{
									id: "call_1",
									type: "function",
									function: { name: "get_weather", arguments: "{}" },
								},
								{
									id: "call_2",
									type: "function",
									function: { name: "get_time", arguments: "{}" },
								},
							],
						},
						// Two unmatched calls, no id, no name → ambiguous, must throw
						// rather than guess which call this output belongs to.
						{ role: "tool", content: JSON.stringify({ temperature: 17 }) },
					]),
				),
			).rejects.toBeInstanceOf(RequestError);
		});

		test("drops message `name` (Responses API rejects input[N].name)", async () => {
			const requestBody = (await prepareRequestBody(
				...responsesArgs([
					{ role: "system", content: "be terse", name: "system_helper" },
					{ role: "user", content: "hello", name: "alice" },
				]),
			)) as any;

			expect(requestBody.input.every((i: any) => i.name === undefined)).toBe(
				true,
			);
			expect(requestBody.input).toEqual([
				{ role: "system", content: [{ type: "input_text", text: "be terse" }] },
				{ role: "user", content: [{ type: "input_text", text: "hello" }] },
			]);
		});
	});

	describe("google-ai-studio", () => {
		test("forwards caller-supplied max_tokens to maxOutputTokens (Gemini 2.x)", async () => {
			const requestBody = (await prepareRequestBody(
				"google-ai-studio",
				"gemini-2.5-pro",
				null,
				"gemini-2.5-pro",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				8192,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.generationConfig?.maxOutputTokens).toBe(8192);
		});

		test("leaves maxOutputTokens unset when caller omits (Gemini 2.x)", async () => {
			// Gemini 2.5+ has thinking enabled by default and counts thinking
			// tokens against maxOutputTokens. Setting a low default starves the
			// response. Leave it unset so the provider's own default wins.
			const requestBody = (await prepareRequestBody(
				"google-ai-studio",
				"gemini-2.5-pro",
				null,
				"gemini-2.5-pro",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.generationConfig?.maxOutputTokens).toBeUndefined();
		});

		test("preserves caller max_tokens when reasoning is enabled (Gemini 2.x)", async () => {
			const requestBody = (await prepareRequestBody(
				"google-ai-studio",
				"gemini-2.5-pro",
				null,
				"gemini-2.5-pro",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				16000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				"high",
				true,
				false,
			)) as any;

			expect(requestBody.generationConfig?.maxOutputTokens).toBe(16000);
		});
	});

	describe("google-vertex", () => {
		test("leaves maxOutputTokens unset on Gemini 2.x when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"google-vertex",
				"gemini-2.5-pro",
				null,
				"gemini-2.5-pro",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.generationConfig?.maxOutputTokens).toBeUndefined();
		});
	});

	describe("groq", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"groq",
				"moonshotai/kimi-k2-instruct",
				null,
				"moonshotai/kimi-k2-instruct",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBe(32000);
		});

		test("leaves max_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"groq",
				"moonshotai/kimi-k2-instruct",
				null,
				"moonshotai/kimi-k2-instruct",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBeUndefined();
		});
	});

	describe("mistral", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"mistral",
				"mistral-large-latest",
				null,
				"mistral-large-latest",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBe(32000);
		});

		test("leaves max_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"mistral",
				"mistral-large-latest",
				null,
				"mistral-large-latest",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBeUndefined();
		});
	});

	describe("together-ai", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"together-ai",
				"meta-llama/llama-3.3-70b-instruct",
				null,
				"meta-llama/llama-3.3-70b-instruct",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBe(32000);
		});

		test("leaves max_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"together-ai",
				"meta-llama/llama-3.3-70b-instruct",
				null,
				"meta-llama/llama-3.3-70b-instruct",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBeUndefined();
		});
	});

	describe("inference.net", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"inference.net",
				"meta-llama/llama-3.1-8b-instruct/fp-8",
				null,
				"meta-llama/llama-3.1-8b-instruct/fp-8",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBe(32000);
		});

		test("leaves max_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"inference.net",
				"meta-llama/llama-3.1-8b-instruct/fp-8",
				null,
				"meta-llama/llama-3.1-8b-instruct/fp-8",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBeUndefined();
		});
	});

	describe("cerebras", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"cerebras",
				"llama-3.3-70b",
				null,
				"llama-3.3-70b",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBe(32000);
		});

		test("leaves max_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"cerebras",
				"llama-3.3-70b",
				null,
				"llama-3.3-70b",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBeUndefined();
		});
	});

	describe("perplexity", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"perplexity",
				"sonar",
				null,
				"sonar",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBe(32000);
		});

		test("leaves max_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"perplexity",
				"sonar",
				null,
				"sonar",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBeUndefined();
		});
	});

	describe("zai", () => {
		test("forwards caller-supplied max_tokens verbatim", async () => {
			const requestBody = (await prepareRequestBody(
				"zai",
				"glm-4.6",
				null,
				"glm-4.6",
				[{ role: "user", content: "Hello!" }],
				false,
				undefined,
				32000,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBe(32000);
		});

		test("leaves max_tokens unset when caller omits", async () => {
			const requestBody = (await prepareRequestBody(
				"zai",
				"glm-4.6",
				null,
				"glm-4.6",
				[{ role: "user", content: "Hello!" }],
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
				undefined,
				false,
			)) as any;

			expect(requestBody.max_tokens).toBeUndefined();
		});
	});
});
