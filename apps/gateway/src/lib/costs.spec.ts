import { beforeEach, describe, expect, it, vi } from "vitest";

import { models } from "@llmgateway/models";

import { calculateCosts } from "./costs.js";

const { mockGetEffectiveDiscount } = vi.hoisted(() => ({
	mockGetEffectiveDiscount: vi.fn(),
}));

vi.mock("@llmgateway/db", () => ({
	getEffectiveDiscount: mockGetEffectiveDiscount,
}));

describe("calculateCosts", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		vi.mocked(mockGetEffectiveDiscount).mockImplementation(
			async (_organizationId, _provider, _model, hardcodedDiscount = 0) => ({
				discount: hardcodedDiscount,
				source: hardcodedDiscount > 0 ? "hardcoded" : "none",
			}),
		);
	});

	it("should calculate costs with provided token counts", async () => {
		const result = await calculateCosts("gpt-4", "openai", 100, 50, null);

		expect(result.inputCost).toBeCloseTo(0.001); // 100 * 0.00001
		expect(result.outputCost).toBeCloseTo(0.0015); // 50 * 0.00003
		expect(result.totalCost).toBeCloseTo(0.0025); // 0.001 + 0.0015
		expect(result.promptTokens).toBe(100);
		expect(result.completionTokens).toBe(50);
		expect(result.cachedTokens).toBeNull();
		expect(result.estimatedCost).toBe(false); // Not estimated
	});

	it("should calculate costs with null token counts but provided text", async () => {
		const result = await calculateCosts("gpt-4", "openai", null, null, null, {
			prompt: "Hello, how are you?",
			completion: "I'm doing well, thank you for asking!",
		});

		// The exact token counts will depend on the tokenizer, but we can check that they're calculated
		expect(result.promptTokens).toBeGreaterThan(0);
		expect(result.completionTokens).toBeGreaterThan(0);
		expect(result.inputCost).toBeGreaterThan(0);
		expect(result.outputCost).toBeGreaterThan(0);
		expect(result.totalCost).toBeGreaterThan(0);
		expect(result.estimatedCost).toBe(true); // Should be estimated
	});

	it("should calculate costs with null token counts but provided chat messages", async () => {
		const result = await calculateCosts("gpt-4", "openai", null, null, null, {
			messages: [
				{ role: "user", content: "Hello, how are you?" },
				{ role: "assistant", content: "I'm doing well, thank you for asking!" },
			],
			completion: "I'm doing well, thank you for asking!",
		});

		// The exact token counts will depend on the tokenizer, but we can check that they're calculated
		expect(result.promptTokens).toBeGreaterThan(0);
		expect(result.completionTokens).toBeGreaterThan(0);
		expect(result.inputCost).toBeGreaterThan(0);
		expect(result.outputCost).toBeGreaterThan(0);
		expect(result.totalCost).toBeGreaterThan(0);
		expect(result.estimatedCost).toBe(true); // Should be estimated
	});

	it("should return null costs when model info is not found", async () => {
		// Using a valid model with an invalid provider to test the not-found path
		const result = await calculateCosts(
			"gpt-4",
			"non-existent-provider",
			100,
			50,
			null,
		);

		expect(result.inputCost).toBeNull();
		expect(result.outputCost).toBeNull();
		expect(result.totalCost).toBeNull();
		expect(result.promptTokens).toBe(100);
		expect(result.completionTokens).toBe(50);
		expect(result.cachedTokens).toBeNull();
		expect(result.estimatedCost).toBe(false); // Not estimated
	});

	it("should return null costs when token counts are null and no text is provided", async () => {
		const result = await calculateCosts("gpt-4", "openai", null, null, null);

		expect(result.inputCost).toBeNull();
		expect(result.outputCost).toBeNull();
		expect(result.totalCost).toBeNull();
		expect(result.promptTokens).toBeNull();
		expect(result.completionTokens).toBeNull();
		expect(result.cachedTokens).toBeNull();
		expect(result.estimatedCost).toBe(false); // Not estimated
	});

	it("should calculate costs with cached tokens for OpenAI (prompt_tokens includes cached)", async () => {
		const result = await calculateCosts("gpt-4o", "openai", 100, 50, 20);

		expect(result.inputCost).toBeCloseTo(0.0002); // (100 - 20) * 0.0000025 = 80 * 0.0000025
		expect(result.outputCost).toBeCloseTo(0.0005); // 50 * 0.00001
		expect(result.cachedInputCost).toBeCloseTo(0.000025); // 20 * 0.00000125
		expect(result.totalCost).toBeCloseTo(0.000525); // 0.0002 + 0.0005 + 0.000025
		expect(result.promptTokens).toBe(100);
		expect(result.completionTokens).toBe(50);
		expect(result.cachedTokens).toBe(20);
		expect(result.estimatedCost).toBe(false); // Not estimated
	});

	it("does not add a separate cache write fee for OpenAI", async () => {
		const withoutCacheWrite = await calculateCosts(
			"gpt-4o",
			"openai",
			100,
			50,
			20,
		);
		const withCacheWrite = await calculateCosts(
			"gpt-4o",
			"openai",
			100,
			50,
			20,
			undefined,
			null,
			0,
			undefined,
			0,
			null,
			null,
			undefined,
			null,
			null,
			{
				cacheWriteTokens: 30,
			},
		);

		expect(withCacheWrite.inputCost).toBe(withoutCacheWrite.inputCost);
		expect(withCacheWrite.cachedInputCost).toBe(
			withoutCacheWrite.cachedInputCost,
		);
		expect(withCacheWrite.cacheWriteInputCost).toBe(0);
		expect(withCacheWrite.totalCost).toBe(withoutCacheWrite.totalCost);
		expect(withCacheWrite.cacheWriteTokens).toBe(30);
	});

	it("should calculate costs with cached tokens for Anthropic (first request - cache creation)", async () => {
		// For Anthropic first request: 4 non-cached + 1659 cache creation = 1663 total tokens, 0 cache reads
		const result = await calculateCosts(
			"claude-3-5-sonnet-20241022",
			"anthropic",
			1663,
			50,
			0,
			undefined,
			null,
			0,
			undefined,
			0,
			null,
			null,
			undefined,
			null,
			null,
			{
				cacheWriteTokens: 1659,
			},
		);

		expect(result.inputCost).toBeCloseTo(0.000012); // 4 * 0.000003 (non-cache-write tokens)
		expect(result.outputCost).toBeCloseTo(0.00075); // 50 * 0.000015
		expect(result.cachedInputCost).toBeCloseTo(0); // 0 cache reads
		expect(result.cacheWriteInputCost).toBeCloseTo(0.00622125); // 1659 * 0.00000375
		expect(result.totalCost).toBeCloseTo(0.00698325); // 0.000012 + 0.00075 + 0.00622125
		expect(result.promptTokens).toBe(1663);
		expect(result.completionTokens).toBe(50);
		expect(result.cachedTokens).toBe(0);
		expect(result.cacheWriteTokens).toBe(1659);
		expect(result.estimatedCost).toBe(false); // Not estimated
	});

	it("should price 1h cache writes at the 1h rate when cacheWrite1hTokens is provided", async () => {
		// claude-3-5-sonnet-20241022 input is 3.0/1M; 5m write 3.75/1M; 1h write 6.0/1M.
		// 4 non-cached + 1000 cache creation total (300 5m + 700 1h) = 1004 prompt tokens.
		const result = await calculateCosts(
			"claude-3-5-sonnet-20241022",
			"anthropic",
			1004,
			50,
			0,
			undefined,
			null,
			0,
			undefined,
			0,
			null,
			null,
			undefined,
			null,
			null,
			{
				cacheWriteTokens: 1000,
				cacheWrite1hTokens: 700,
			},
		);

		expect(result.inputCost).toBeCloseTo(4 * (3.0 / 1e6));
		// 300 tokens at 5m rate (3.75/1M) + 700 tokens at 1h rate (6.0/1M)
		const fiveMinuteCost = 300 * (3.75 / 1e6);
		const oneHourCost = 700 * (6.0 / 1e6);
		expect(result.cacheWriteInputCost).toBeCloseTo(
			fiveMinuteCost + oneHourCost,
		);
		expect(result.cacheWriteTokens).toBe(1000);
	});

	it("should fall back to the 5m rate for cache writes when no 1h count is provided", async () => {
		// Pre-existing behavior: cacheWriteTokens is the sum, priced entirely at 5m rate.
		const result = await calculateCosts(
			"claude-3-5-sonnet-20241022",
			"anthropic",
			1004,
			50,
			0,
			undefined,
			null,
			0,
			undefined,
			0,
			null,
			null,
			undefined,
			null,
			null,
			{
				cacheWriteTokens: 1000,
			},
		);

		expect(result.cacheWriteInputCost).toBeCloseTo(1000 * (3.75 / 1e6));
	});

	it("should calculate AWS Bedrock Claude cache write costs", async () => {
		// Bedrock Claude Haiku 4.5 input is 1.0/1M; 5m write 1.25/1M; 1h write 2.0/1M.
		const result = await calculateCosts(
			"claude-haiku-4-5",
			"aws-bedrock",
			1004,
			50,
			0,
			undefined,
			null,
			0,
			undefined,
			0,
			null,
			null,
			undefined,
			null,
			null,
			{
				cacheWriteTokens: 1000,
				cacheWrite1hTokens: 700,
			},
		);

		const discountMultiplier = 0.8;
		expect(result.inputCost).toBeCloseTo(4 * (1.0 / 1e6) * discountMultiplier);
		expect(result.outputCost).toBeCloseTo(
			50 * (5.0 / 1e6) * discountMultiplier,
		);
		const fiveMinuteCacheWriteCost = 300 * (1.25 / 1e6);
		const oneHourCacheWriteCost = 700 * (2.0 / 1e6);
		expect(result.cacheWriteInputCost).toBeCloseTo(
			(fiveMinuteCacheWriteCost + oneHourCacheWriteCost) * discountMultiplier,
		);
		expect(result.discount).toBeCloseTo(0.2);
		expect(result.cacheWriteTokens).toBe(1000);
	});

	it("should calculate costs with cached tokens for Anthropic (subsequent request - cache read)", async () => {
		// For Anthropic subsequent request: 4 non-cached + 1659 cache read = 1663 total tokens, 1659 cache reads
		const result = await calculateCosts(
			"claude-3-5-sonnet-20241022",
			"anthropic",
			1663,
			50,
			1659,
		);

		expect(result.inputCost).toBeCloseTo(0.000012); // 4 * 0.000003 (only non-cached tokens at full price)
		expect(result.outputCost).toBeCloseTo(0.00075); // 50 * 0.000015
		expect(result.cachedInputCost).toBeCloseTo(0.0004977); // 1659 * 0.0000003 (cached token price)
		expect(result.cacheWriteInputCost).toBeCloseTo(0);
		expect(result.totalCost).toBeCloseTo(0.0012597); // 0.000012 + 0.00075 + 0.0004977
		expect(result.promptTokens).toBe(1663);
		expect(result.completionTokens).toBe(50);
		expect(result.cachedTokens).toBe(1659);
		expect(result.estimatedCost).toBe(false); // Not estimated
	});

	it("should apply discount when model has discount field", async () => {
		vi.mocked(mockGetEffectiveDiscount).mockResolvedValueOnce({
			discount: 0.1,
			source: "global_provider",
			discountId: "disc-global-openai",
		});
		const resultWithDiscount = await calculateCosts(
			"gpt-4",
			"openai",
			100,
			50,
			null,
		);

		expect(resultWithDiscount.discount).toBeCloseTo(0.1);
		expect(resultWithDiscount.inputCost).toBeCloseTo(0.0009);
		expect(resultWithDiscount.outputCost).toBeCloseTo(0.00135);
		expect(resultWithDiscount.totalCost).toBeCloseTo(0.00225);
		expect(mockGetEffectiveDiscount).toHaveBeenCalledWith(
			null,
			"openai",
			"gpt-4",
			0,
			"gpt-4",
		);
	});

	it("should not include discount field when no discount applied", async () => {
		const result = await calculateCosts("gpt-4", "azure", 100, 50, null);

		expect(result.discount).toBeUndefined();
	});

	it("should calculate input costs even when output tokens are zero", async () => {
		const result = await calculateCosts("gpt-4", "openai", 100, 0, null);

		expect(result.inputCost).toBeCloseTo(0.001); // 100 * 0.00001
		expect(result.outputCost).toBeCloseTo(0); // 0 * 0.00003
		expect(result.totalCost).toBeCloseTo(0.001); // 0.001 + 0
		expect(result.promptTokens).toBe(100);
		expect(result.completionTokens).toBe(0);
		expect(result.estimatedCost).toBe(false);
	});

	it("should calculate input costs when completion tokens are null but prompt tokens exist", async () => {
		const result = await calculateCosts("gpt-4", "openai", 100, null, null);

		expect(result.inputCost).toBeCloseTo(0.001); // 100 * 0.00001
		expect(result.outputCost).toBeCloseTo(0); // 0 * 0.00003 (completion tokens set to 0)
		expect(result.totalCost).toBeCloseTo(0.001); // 0.001 + 0
		expect(result.promptTokens).toBe(100);
		expect(result.completionTokens).toBe(0); // Should default to 0
		expect(result.estimatedCost).toBe(false);
	});

	it("should include tool results in completion token estimation", async () => {
		const result = await calculateCosts("gpt-4", "openai", null, null, null, {
			prompt: "What's the weather like?",
			completion: "", // Empty completion
			toolResults: [
				{
					id: "call_1",
					type: "function",
					function: {
						name: "get_weather",
						arguments: '{"location": "San Francisco"}',
					},
				},
				{
					id: "call_2",
					type: "function",
					function: {
						name: "get_temperature",
						arguments: '{"location": "New York", "units": "celsius"}',
					},
				},
			],
		});

		// Should calculate tokens for tool calls even with empty completion
		expect(result.promptTokens).toBeGreaterThan(3);
		expect(result.completionTokens).toBeGreaterThan(10); // Should include tool call tokens
		expect(result.inputCost).toBeGreaterThan(0.000001);
		expect(result.outputCost).toBeGreaterThan(0.00001); // Should have cost from tool calls
		expect(result.totalCost).toBeGreaterThan(0.00001);
		expect(result.estimatedCost).toBe(true);
	});

	it("should handle tool results with missing function data gracefully", async () => {
		const result = await calculateCosts("gpt-4", "openai", null, null, null, {
			prompt: "What's the weather like?",
			completion: "Here's the weather:",
			toolResults: [
				{ id: "call_1", type: "function" } as any, // Missing function data
				{ id: "call_2", type: "function", function: {} as any }, // Missing name and arguments
				{
					id: "call_3",
					type: "function",
					function: {
						name: "get_weather",
						arguments: '{"location": "Paris"}',
					},
				},
			],
		});

		// Should still work with partial tool result data
		expect(result.promptTokens).toBeGreaterThan(0);
		expect(result.completionTokens).toBeGreaterThan(0);
		expect(result.estimatedCost).toBe(true);
	});

	it("should include reasoning tokens in output cost calculation", async () => {
		// Test with Google model that has reasoning tokens
		// For Google providers, completionTokens already includes reasoning
		// (merged during token extraction), so we pass 700 = 500 output + 200 reasoning
		const result = await calculateCosts(
			"gemini-2.5-pro",
			"google-ai-studio",
			1000,
			700, // completionTokens includes reasoning for Google
			null,
			undefined,
			200, // 200 reasoning tokens (for display, not added again)
		);

		// For Google: gemini-2.5-pro
		// inputPrice: 1.25 / 1e6
		// outputPrice: 10.0 / 1e6
		// Total output tokens = 700 (completionTokens already includes reasoning)
		expect(result.inputCost).toBeCloseTo(0.00125); // 1000 * 1.25e-6
		expect(result.outputCost).toBeCloseTo(0.007); // 700 * 10.0e-6
		expect(result.totalCost).toBeCloseTo(0.00825); // 0.00125 + 0.007
		expect(result.promptTokens).toBe(1000);
		expect(result.completionTokens).toBe(700);
		expect(result.estimatedCost).toBe(false);
	});

	it("should handle null reasoning tokens gracefully", async () => {
		const result = await calculateCosts(
			"gemini-2.5-pro",
			"google-ai-studio",
			1000,
			500,
			null,
			undefined,
			null, // No reasoning tokens
		);

		// Should calculate costs normally with just completion tokens
		expect(result.inputCost).toBeCloseTo(0.00125); // 1000 * 1.25e-6
		expect(result.outputCost).toBeCloseTo(0.005); // 500 * 10.0e-6
		expect(result.totalCost).toBeCloseTo(0.00625); // 0.00125 + 0.005
	});

	it("should track image input tokens and costs separately", async () => {
		// Test with gemini-3-pro-image-preview which has imageInputPrice
		const result = await calculateCosts(
			"gemini-3-pro-image-preview",
			"google-ai-studio",
			1000, // text prompt tokens
			500, // completion tokens
			null, // no cached tokens
			undefined,
			null, // no reasoning tokens
			0, // no output images
			undefined, // no image size
			2, // 2 input images
		);

		// Each input image is 560 tokens at $2/1M = $0.00112 per image
		expect(result.imageInputTokens).toBe(1120); // 2 * 560
		expect(result.imageInputCost).toBeCloseTo(0.00224); // 1120 * 2e-6
		// promptTokens should include image input tokens
		expect(result.promptTokens).toBe(2120); // 1000 text + 1120 image
		// inputCost includes both text and image input costs
		// eslint-disable-next-line no-mixed-operators
		expect(result.inputCost).toBeCloseTo(1000 * (2 / 1e6) + 0.00224);
		// totalCost = inputCost + outputCost (image costs are folded into input/output costs)
		expect(result.totalCost).toBeCloseTo(
			(result.inputCost ?? 0) + (result.outputCost ?? 0),
		);
	});

	it("should track image output tokens and costs separately", async () => {
		// Test with gemini-3-pro-image-preview for image output
		const result = await calculateCosts(
			"gemini-3-pro-image-preview",
			"google-ai-studio",
			1000, // text prompt tokens
			2500, // completion tokens (includes 1120 * 2 = 2240 image tokens for 2 images)
			null, // no cached tokens
			undefined,
			null, // no reasoning tokens
			2, // 2 output images
			"1K", // 1K image size = 1120 tokens per image
			0, // no input images
		);

		// Each 1K output image is 1120 tokens at $120/1M
		expect(result.imageOutputTokens).toBe(2240); // 2 * 1120
		expect(result.imageOutputCost).toBeCloseTo(0.2688); // 2240 * 120e-6
		// outputCost includes both text and image output costs
		// text: (2500 - 2240) * 12e-6 = 260 * 12e-6 = 0.00312
		// image: 2240 * 120e-6 = 0.2688
		expect(result.outputCost).toBeCloseTo(0.00312 + 0.2688);
		// totalCost = inputCost + outputCost (image costs are folded into input/output costs)
		expect(result.totalCost).toBeCloseTo(
			(result.inputCost ?? 0) + (result.outputCost ?? 0),
		);
	});

	it("should use reported image output tokens for gpt-image-2", async () => {
		const result = await calculateCosts(
			"gpt-image-2",
			"openai",
			1000,
			2000,
			null,
			undefined,
			null,
			1,
			"1024x1024",
			0,
			null,
			null,
			"low",
		);

		const expectedInputCost = 1000 * (5 / 1e6);
		const expectedImageOutputCost = 2000 * (30 / 1e6);

		expect(result.imageOutputTokens).toBe(2000);
		expect(result.imageOutputCost).toBeCloseTo(expectedImageOutputCost);
		expect(result.outputCost).toBeCloseTo(expectedImageOutputCost);
		expect(result.inputCost).toBeCloseTo(expectedInputCost);
		expect(result.totalCost).toBeCloseTo(
			expectedInputCost + expectedImageOutputCost,
		);
	});

	it("should bill reported image input tokens at imageInputPrice for gpt-image-2 edits", async () => {
		// /v1/images/edits sends input images as part of the prompt. OpenAI's
		// usage payload reports text vs image tokens via input_tokens_details.
		// We expect the gateway to bill the image portion at imageInputPrice
		// ($8/M) and the remaining text portion at inputPrice ($5/M) — without
		// double-billing image tokens at the text rate.
		const promptTokens = 524; // 12 text + 512 image (from real OpenAI response)
		const reportedImageInputTokens = 512;
		const completionTokens = 196;
		const reportedImageOutputTokens = 196;

		const result = await calculateCosts(
			"gpt-image-2",
			"openai",
			promptTokens,
			completionTokens,
			null, // cachedTokens
			undefined, // fullOutput
			null, // reasoningTokens
			1, // outputImageCount
			"1024x1024", // imageSize
			0, // inputImageCount (not used for openai)
			null, // webSearchCount
			null, // organizationId
			"low", // imageQuality
			reportedImageInputTokens,
			reportedImageOutputTokens,
		);

		const expectedTextInputCost =
			(promptTokens - reportedImageInputTokens) * (5 / 1e6);
		const expectedImageInputCost = reportedImageInputTokens * (8 / 1e6);
		const expectedImageOutputCost = reportedImageOutputTokens * (30 / 1e6);

		expect(result.imageInputTokens).toBe(reportedImageInputTokens);
		expect(result.imageInputCost).toBeCloseTo(expectedImageInputCost);
		expect(result.imageOutputTokens).toBe(reportedImageOutputTokens);
		expect(result.imageOutputCost).toBeCloseTo(expectedImageOutputCost);
		expect(result.inputCost).toBeCloseTo(
			expectedTextInputCost + expectedImageInputCost,
		);
		expect(result.outputCost).toBeCloseTo(expectedImageOutputCost);
		expect(result.totalCost).toBeCloseTo(
			expectedTextInputCost + expectedImageInputCost + expectedImageOutputCost,
		);
	});

	it("should apply azure discount on top of split image/text input pricing for gpt-image-2", async () => {
		const promptTokens = 524;
		const reportedImageInputTokens = 512;
		const completionTokens = 196;
		const reportedImageOutputTokens = 196;

		const result = await calculateCosts(
			"gpt-image-2",
			"azure",
			promptTokens,
			completionTokens,
			null,
			undefined,
			null,
			1,
			"1024x1024",
			0,
			null,
			null,
			"low",
			reportedImageInputTokens,
			reportedImageOutputTokens,
		);

		// Read discount from the model definition so the test stays correct
		// even if the azure discount value changes.
		const azureProvider = models
			.find((m) => m.id === "gpt-image-2")
			?.providers.find((p) => p.providerId === "azure");
		const discountMultiplier = 1 - (azureProvider?.discount ?? 0);
		const expectedTextInputCost =
			(promptTokens - reportedImageInputTokens) *
			(5 / 1e6) *
			discountMultiplier;
		const expectedImageInputCost =
			reportedImageInputTokens * (8 / 1e6) * discountMultiplier;
		const expectedImageOutputCost =
			reportedImageOutputTokens * (30 / 1e6) * discountMultiplier;

		expect(result.imageInputTokens).toBe(reportedImageInputTokens);
		expect(result.imageInputCost).toBeCloseTo(expectedImageInputCost);
		expect(result.inputCost).toBeCloseTo(
			expectedTextInputCost + expectedImageInputCost,
		);
		expect(result.outputCost).toBeCloseTo(expectedImageOutputCost);
	});

	it("should split cached tokens between text and image rates for gpt-image-2", async () => {
		// OpenAI returns a single cached_tokens count without splitting text/image,
		// so we apportion by the overall image:text ratio in prompt_tokens. With
		// promptTokens=1000, imageInputTokens=800, cachedTokens=500 → ratio 0.8 →
		// 400 cached image tokens billed at $2/M, 100 cached text at $1.25/M.
		const promptTokens = 1000;
		const reportedImageInputTokens = 800;
		const cachedTokens = 500;

		const result = await calculateCosts(
			"gpt-image-2",
			"openai",
			promptTokens,
			0, // completionTokens
			cachedTokens,
			undefined,
			null,
			0,
			undefined,
			0,
			null,
			null,
			undefined,
			reportedImageInputTokens,
			null,
		);

		const expectedCachedImageTokens = 400; // 500 * (800/1000)
		const expectedCachedTextTokens = 100;
		const expectedUncachedImageTokens = 400; // 800 - 400
		const expectedUncachedTextTokens = 100; // (1000 - 800) - 100

		const expectedImageInputCost = expectedUncachedImageTokens * (8 / 1e6);
		const expectedTextInputCost = expectedUncachedTextTokens * (5 / 1e6);
		const cachedTextCost = (expectedCachedTextTokens * 1.25) / 1e6;
		const cachedImageCost = (expectedCachedImageTokens * 2) / 1e6;
		const expectedCachedInputCost = cachedTextCost + cachedImageCost;

		expect(result.imageInputTokens).toBe(reportedImageInputTokens);
		expect(result.imageInputCost).toBeCloseTo(expectedImageInputCost);
		expect(result.inputCost).toBeCloseTo(
			expectedTextInputCost + expectedImageInputCost,
		);
		expect(result.cachedInputCost).toBeCloseTo(expectedCachedInputCost);
		expect(result.totalCost).toBeCloseTo(
			expectedTextInputCost + expectedImageInputCost + expectedCachedInputCost,
		);
	});

	it("should bill cached image tokens for gpt-image-2 even when fully cached", async () => {
		// Edge case: cached_tokens equals image_tokens. All image is cached, all
		// text is uncached. Image is billed entirely at the cached image rate.
		const promptTokens = 524;
		const reportedImageInputTokens = 512;
		const cachedTokens = 512; // every image token is a cache hit

		const result = await calculateCosts(
			"gpt-image-2",
			"openai",
			promptTokens,
			0,
			cachedTokens,
			undefined,
			null,
			0,
			undefined,
			0,
			null,
			null,
			undefined,
			reportedImageInputTokens,
			null,
		);

		const ratio = reportedImageInputTokens / promptTokens;
		const expectedCachedImage = Math.min(
			cachedTokens,
			reportedImageInputTokens,
			Math.round(cachedTokens * ratio),
		);
		const expectedCachedText = cachedTokens - expectedCachedImage;
		const expectedUncachedImage =
			reportedImageInputTokens - expectedCachedImage;
		const expectedUncachedText =
			promptTokens - reportedImageInputTokens - expectedCachedText;

		const uncachedTextCost = (expectedUncachedText * 5) / 1e6;
		const uncachedImageCost = (expectedUncachedImage * 8) / 1e6;
		const cachedTextCost = (expectedCachedText * 1.25) / 1e6;
		const cachedImageCost = (expectedCachedImage * 2) / 1e6;
		expect(result.inputCost).toBeCloseTo(uncachedTextCost + uncachedImageCost);
		expect(result.cachedInputCost).toBeCloseTo(
			cachedTextCost + cachedImageCost,
		);
	});

	it("should fall back to single cached rate when cachedImageInputPrice is unset", async () => {
		// gpt-4o has imageInputPrice but no cachedImageInputPrice and no
		// output: ["image"], so the apportionment branch must NOT fire.
		// All cached tokens stay billed at cachedInputPrice.
		const result = await calculateCosts("gpt-4o", "openai", 1000, 100, 200);

		expect(result.cachedInputCost).toBeCloseTo(200 * (1.25 / 1e6));
		expect(result.imageInputTokens).toBeNull();
	});

	it("should return null for all image fields when no images", async () => {
		const result = await calculateCosts("gpt-4", "openai", 100, 50, null);

		expect(result.imageInputTokens).toBeNull();
		expect(result.imageOutputTokens).toBeNull();
		expect(result.imageInputCost).toBeNull();
		expect(result.imageOutputCost).toBeNull();
	});

	it("should use resolution-specific token counts for Flash Image output (0.5K)", async () => {
		// gemini-3.1-flash-image-preview: 0.5K = 747 tokens/image
		const result = await calculateCosts(
			"gemini-3.1-flash-image-preview",
			"google-ai-studio",
			1000,
			800, // completion tokens (includes 747 image tokens for 1 image)
			null,
			undefined,
			null,
			1, // 1 output image
			"0.5K",
			0,
		);

		expect(result.imageOutputTokens).toBe(747); // 1 * 747
		expect(result.imageOutputCost).toBeCloseTo(747 * (60 / 1e6)); // 747 * $60/1M
		const textTokens = 800 - 747; // 53 text tokens
		const expectedTextCost = textTokens * (1.5 / 1e6);
		const expectedImageCost = 747 * (60 / 1e6);
		expect(result.outputCost).toBeCloseTo(expectedTextCost + expectedImageCost);
	});

	it("should use resolution-specific token counts for Flash Image output (4K)", async () => {
		// gemini-3.1-flash-image-preview: 4K = 2520 tokens/image
		const result = await calculateCosts(
			"gemini-3.1-flash-image-preview",
			"google-ai-studio",
			1000,
			5100, // completion tokens (includes 2520 * 2 = 5040 image tokens)
			null,
			undefined,
			null,
			2, // 2 output images
			"4K",
			0,
		);

		expect(result.imageOutputTokens).toBe(5040); // 2 * 2520
		expect(result.imageOutputCost).toBeCloseTo(5040 * (60 / 1e6));
		const textTokens = Math.max(0, 5100 - 5040); // 60 text tokens
		const expectedTextCost = textTokens * (1.5 / 1e6);
		const expectedImageCost = 5040 * (60 / 1e6);
		expect(result.outputCost).toBeCloseTo(expectedTextCost + expectedImageCost);
	});

	it("should use resolution-specific token counts for Pro Image output (4K = 2000 tokens)", async () => {
		// gemini-3-pro-image-preview: 4K = 2000 tokens/image
		const result = await calculateCosts(
			"gemini-3-pro-image-preview",
			"google-ai-studio",
			1000,
			2100,
			null,
			undefined,
			null,
			1, // 1 output image
			"4K",
			0,
		);

		expect(result.imageOutputTokens).toBe(2000); // 1 * 2000
		expect(result.imageOutputCost).toBeCloseTo(2000 * (120 / 1e6));
		const textTokens = Math.max(0, 2100 - 2000); // 100 text tokens
		const expectedTextCost = textTokens * (12 / 1e6);
		const expectedImageCost = 2000 * (120 / 1e6);
		expect(result.outputCost).toBeCloseTo(expectedTextCost + expectedImageCost);
	});

	it("should fall back to default resolution when no imageSize is provided", async () => {
		// gemini-3.1-flash-image-preview default = 1120 tokens/image
		const result = await calculateCosts(
			"gemini-3.1-flash-image-preview",
			"google-ai-studio",
			1000,
			1200, // includes 1120 image tokens
			null,
			undefined,
			null,
			1, // 1 output image
			undefined, // no imageSize → use default
			0,
		);

		expect(result.imageOutputTokens).toBe(1120); // default = 1K
		expect(result.imageOutputCost).toBeCloseTo(1120 * (60 / 1e6));
	});

	it("should include image costs in totalCost sum", async () => {
		// totalCost = inputCost + outputCost + cachedInputCost + requestCost + webSearchCost
		// (inputCost already includes imageInputCost, outputCost already includes imageOutputCost)
		const result = await calculateCosts(
			"gemini-3-pro-image-preview",
			"google-ai-studio",
			1000, // text prompt tokens
			2500, // completion tokens
			null, // no cached tokens
			undefined,
			null, // no reasoning tokens
			2, // 2 output images
			"1K", // 1K image size
			1, // 1 input image
		);

		// Calculate expected total (image costs are folded into input/output costs)
		const expectedTotal =
			(result.inputCost ?? 0) +
			(result.outputCost ?? 0) +
			(result.cachedInputCost ?? 0) +
			(result.requestCost ?? 0) +
			(result.webSearchCost ?? 0);

		expect(result.totalCost).toBeCloseTo(expectedTotal);
		// Verify image costs are still tracked as breakdown fields
		expect(result.imageInputCost).toBeGreaterThan(0);
		expect(result.imageOutputCost).toBeGreaterThan(0);
	});
});
