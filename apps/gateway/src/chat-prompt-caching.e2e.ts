import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	filteredModels,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	hasOnlyModels,
	logMode,
	specifiedModels,
	validateLogByRequestId,
	validateResponse,
} from "@/chat-helpers.e2e.js";

import { models } from "@llmgateway/models";

import { app } from "./app.js";

import type { ProviderModelMapping } from "@llmgateway/models";

// Filter to only models that support prompt caching (have cachedInputPrice defined)
const promptCachingModels = filteredModels
	// If any model has test: "only", only include those models
	.filter((model) => {
		if (hasOnlyModels) {
			return model.providers.some(
				(provider: ProviderModelMapping) => provider.test === "only",
			);
		}
		return true;
	})
	.flatMap((model) => {
		const testCases = [];

		for (const provider of model.providers as ProviderModelMapping[]) {
			// Skip providers without cachedInputPrice (no prompt caching support)
			if (provider.cachedInputPrice === undefined) {
				continue;
			}

			// Skip deactivated provider mappings
			if (provider.deactivatedAt && new Date() > provider.deactivatedAt) {
				continue;
			}

			// Skip deprecated provider mappings
			if (provider.deprecatedAt && new Date() > provider.deprecatedAt) {
				continue;
			}

			// Filter by TEST_MODELS if specified
			if (specifiedModels) {
				const providerModelId = `${provider.providerId}/${model.id}`;
				if (!specifiedModels.includes(providerModelId)) {
					continue;
				}
				// TEST_MODELS takes precedence over test: "skip", so don't skip if model is in TEST_MODELS
			} else {
				// Skip providers marked with test: "skip" (only when TEST_MODELS is not specified)
				if (provider.test === "skip") {
					continue;
				}
			}

			// If we have any "only" providers, skip those not marked as "only"
			if (hasOnlyModels && provider.test !== "only") {
				continue;
			}

			testCases.push({
				model: `${provider.providerId}/${model.id}`,
				provider,
				originalModel: model.id,
				minCacheableTokens: provider.minCacheableTokens ?? 1024,
			});
		}

		return testCases;
	});

// Only run prompt caching tests when TEST_CACHE_MODE=true
const testCacheMode = process.env.TEST_CACHE_MODE === "true";

if (testCacheMode) {
	console.log(
		`Testing ${promptCachingModels.length} models with prompt caching support`,
	);
}

describe("e2e prompt caching", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	if (testCacheMode) {
		test.each(promptCachingModels)(
			"prompt caching works for $model",
			getTestOptions(),
			async ({ model, originalModel, provider, minCacheableTokens }) => {
				// Generate a long system prompt that exceeds the model's minimum cacheable token threshold
				// We need significantly more than the minimum to ensure caching is triggered
				// Using 2x the minimum + buffer to be safe (Anthropic's tokenizer is ~4 chars per token)
				// eslint-disable-next-line no-mixed-operators
				const targetTokens = minCacheableTokens * 2 + 1000;
				const charsPerRepeat = 95; // approximate chars in each repeat string
				const repeatCount = Math.ceil((targetTokens * 4) / charsPerRepeat);
				const longSystemPrompt = `You are a helpful AI assistant specialized in analyzing complex data and providing detailed insights. ${"This is detailed context information that should be cached for optimal efficiency and performance. ".repeat(repeatCount)}Please analyze any questions carefully.`;

				if (logMode) {
					console.log(
						`Generated system prompt with ~${longSystemPrompt.length} chars for ${model} (minCacheableTokens: ${minCacheableTokens}, targetTokens: ${targetTokens})`,
					);
				}

				// First request - should write to cache
				const firstRequestId = generateTestRequestId();
				const firstRes = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": firstRequestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "system",
								content: longSystemPrompt,
							},
							{
								role: "user",
								content:
									"Just reply with 'OK' to confirm you received the context.",
							},
						],
					}),
				});

				const firstJson = await firstRes.json();
				if (logMode) {
					console.log("First response:", JSON.stringify(firstJson, null, 2));
				}

				expect(firstRes.status).toBe(200);
				validateResponse(firstJson);

				const firstLog = await validateLogByRequestId(firstRequestId);
				expect(firstLog.streamed).toBe(false);

				if (logMode) {
					console.log("First request log:", {
						model,
						provider: provider.providerId,
						cachedInputCost: firstLog.cachedInputCost,
						cachedTokens: firstLog.cachedTokens,
						inputCost: firstLog.inputCost,
						totalCost: firstLog.cost,
						promptTokens: firstJson.usage?.prompt_tokens,
					});
				}

				// Second request - should read from cache
				const secondRequestId = generateTestRequestId();
				const secondRes = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": secondRequestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "system",
								content: longSystemPrompt,
							},
							{
								role: "user",
								content:
									"Just reply with 'OK' to confirm you received the context.",
							},
						],
					}),
				});

				const secondJson = await secondRes.json();
				if (logMode) {
					console.log("Second response:", JSON.stringify(secondJson, null, 2));
				}

				expect(secondRes.status).toBe(200);
				validateResponse(secondJson);

				const secondLog = await validateLogByRequestId(secondRequestId);
				expect(secondLog.streamed).toBe(false);

				if (logMode) {
					console.log("Second request log:", {
						model,
						provider: provider.providerId,
						cachedInputCost: secondLog.cachedInputCost,
						cachedTokens: secondLog.cachedTokens,
						inputCost: secondLog.inputCost,
						totalCost: secondLog.cost,
						promptTokens: secondJson.usage?.prompt_tokens,
						promptTokensDetails: secondJson.usage?.prompt_tokens_details,
					});
				}

				// Verify that the second request has cached tokens
				// The usage response should include prompt_tokens_details.cached_tokens
				expect(secondJson.usage).toHaveProperty("prompt_tokens_details");
				expect(secondJson.usage.prompt_tokens_details).toHaveProperty(
					"cached_tokens",
				);
				expect(
					secondJson.usage.prompt_tokens_details.cached_tokens,
				).toBeGreaterThan(0);

				// Also verify the log has cachedTokens recorded
				// Note: cachedTokens is stored as a string in the database
				expect(Number(secondLog.cachedTokens)).toBeGreaterThan(0);

				// Verify cached input cost is recorded (should be lower than regular input cost)
				// Note: cachedInputCost is stored as a string in the database
				expect(Number(secondLog.cachedInputCost)).toBeGreaterThan(0);

				// The cached input cost should be less than the non-cached input cost
				// because cached tokens are charged at a discounted rate
				const modelDef = models.find((m) => m.id === originalModel);
				const providerMapping = modelDef?.providers.find(
					(p) => p.providerId === provider.providerId,
				) as ProviderModelMapping | undefined;

				if (providerMapping?.cachedInputPrice && providerMapping?.inputPrice) {
					// Verify the pricing ratio is correct (cached should be cheaper)
					expect(providerMapping.cachedInputPrice).toBeLessThan(
						providerMapping.inputPrice,
					);
				}
			},
		);
	}
});
