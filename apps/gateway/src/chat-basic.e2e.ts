import "dotenv/config";
import {
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	type TestOptions,
} from "vitest";

import { beforeAllHook, beforeEachHook } from "@/chat-helpers.e2e";

import { db, tables } from "@llmgateway/db";
import {
	type ModelDefinition,
	models,
	type ProviderModelMapping,
	providers,
} from "@llmgateway/models";

import { app } from ".";
import { waitForLogByRequestId } from "./test-utils/test-helpers";

// Helper function to generate unique request IDs for tests
export function generateTestRequestId(): string {
	return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to get test options with retry for CI environment
export function getTestOptions(): TestOptions {
	return process.env.CI ? { retry: 3 } : {};
}

console.log("running with test options:", getTestOptions());

export const fullMode = process.env.FULL_MODE;
export const logMode = process.env.LOG_MODE;

// Parse TEST_MODELS environment variable
export const testModelsEnv = process.env.TEST_MODELS;
export const specifiedModels = testModelsEnv
	? testModelsEnv.split(",").map((m) => m.trim())
	: null;

if (specifiedModels) {
	console.log(`TEST_MODELS specified: ${specifiedModels.join(", ")}`);
}

// Filter models based on test skip/only property
export const hasOnlyModels = models.some((model) =>
	model.providers.some(
		(provider: ProviderModelMapping) => provider.test === "only",
	),
);

// Log if we're using "only" mode
if (hasOnlyModels) {
	if (process.env.CI) {
		throw new Error(
			"Cannot use 'only' in test configuration when running in CI. Please remove 'only' from the test configuration and try again.",
		);
	}
	console.log(
		"Running in 'only' mode - only testing models marked with test: 'only'",
	);
}

export const filteredModels = models
	// Filter out auto/custom models
	.filter((model) => !["custom", "auto"].includes(model.id))
	// Filter out deactivated models
	.filter((model) => !model.deactivatedAt || new Date() <= model.deactivatedAt)
	// Filter out unstable models if not in full mode, unless they have test: "only" or are in TEST_MODELS
	.filter((model) => {
		// Check if model or any of its providers are marked as unstable
		const modelStability = (model as ModelDefinition).stability;
		const hasUnstableProviders = model.providers.some(
			(provider: ProviderModelMapping) => provider.stability === "unstable",
		);
		const isUnstable = modelStability === "unstable" || hasUnstableProviders;

		if (!isUnstable) {
			return true;
		} // Non-unstable models are always included
		if (fullMode) {
			return true;
		} // In full mode, all models are included

		// For unstable models in non-full mode, include if:
		// 1. Any provider has test: "only"
		if (
			model.providers.some(
				(provider: ProviderModelMapping) => provider.test === "only",
			)
		) {
			return true;
		}

		// 2. Model is specified in TEST_MODELS
		if (specifiedModels) {
			const modelInTestModels = model.providers.some(
				(provider: ProviderModelMapping) => {
					const providerModelId = `${provider.providerId}/${model.id}`;
					return specifiedModels.includes(providerModelId);
				},
			);
			if (modelInTestModels) {
				return true;
			}
		}

		return false; // Otherwise, exclude unstable models in non-full mode
	})
	// Filter out free models if not in full mode, unless they have test: "only" or are in TEST_MODELS
	.filter((model) => {
		const isFreeModel = (model as ModelDefinition).free;
		if (!isFreeModel) {
			return true;
		} // Non-free models are always included
		if (fullMode) {
			return true;
		} // In full mode, all models are included

		// For free models in non-full mode, include if:
		// 1. Any provider has test: "only"
		if (
			model.providers.some(
				(provider: ProviderModelMapping) => provider.test === "only",
			)
		) {
			return true;
		}

		// 2. Model is specified in TEST_MODELS
		if (specifiedModels) {
			const modelInTestModels = model.providers.some(
				(provider: ProviderModelMapping) => {
					const providerModelId = `${provider.providerId}/${model.id}`;
					return specifiedModels.includes(providerModelId);
				},
			);
			if (modelInTestModels) {
				return true;
			}
		}

		return false; // Otherwise, exclude free models in non-full mode
	})
	// Filter by TEST_MODELS if specified
	.filter((model) => {
		if (!specifiedModels) {
			return true;
		}
		// Check if any provider/model combination from this model matches TEST_MODELS
		return model.providers.some((provider: ProviderModelMapping) => {
			const providerModelId = `${provider.providerId}/${model.id}`;
			return specifiedModels.includes(providerModelId);
		});
	});

export const testModels = filteredModels
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

		if (process.env.TEST_ALL_VARIATIONS) {
			// test root model without a specific provider
			testCases.push({
				model: model.id,
				providers: model.providers.filter(
					(provider: ProviderModelMapping) => provider.test !== "skip",
				),
			});
		}

		// Create entries for provider-specific requests using provider/model format
		for (const provider of model.providers as ProviderModelMapping[]) {
			// Skip providers marked with test: "skip"
			if (provider.test === "skip") {
				continue;
			}

			// Skip unstable providers if not in full mode, unless they have test: "only" or are in TEST_MODELS
			if (provider.stability === "unstable" && !fullMode) {
				// Allow if provider has test: "only"
				if (provider.test !== "only") {
					// Allow if model is specified in TEST_MODELS
					if (!specifiedModels) {
						continue;
					}
					const providerModelId = `${provider.providerId}/${model.id}`;
					if (!specifiedModels.includes(providerModelId)) {
						continue;
					}
				}
			}

			// If we have any "only" providers, skip those not marked as "only"
			if (hasOnlyModels && provider.test !== "only") {
				continue;
			}

			testCases.push({
				model: `${provider.providerId}/${model.id}`,
				providers: [provider],
				originalModel: model.id, // Keep track of the original model for reference
			});
		}

		return testCases;
	});

export const providerModels = filteredModels
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
			// Skip providers marked with test: "skip"
			if (provider.test === "skip") {
				continue;
			}

			// Skip unstable providers if not in full mode, unless they have test: "only" or are in TEST_MODELS
			if (provider.stability === "unstable" && !fullMode) {
				// Allow if provider has test: "only"
				if (provider.test !== "only") {
					// Allow if model is specified in TEST_MODELS
					if (!specifiedModels) {
						continue;
					}
					const providerModelId = `${provider.providerId}/${model.id}`;
					if (!specifiedModels.includes(providerModelId)) {
						continue;
					}
				}
			}

			// If we have any "only" providers, skip those not marked as "only"
			if (hasOnlyModels && provider.test !== "only") {
				continue;
			}

			testCases.push({
				model: `${provider.providerId}/${model.id}`,
				provider,
				originalModel: model.id, // Keep track of the original model for reference
			});
		}

		return testCases;
	});

// Log the number of test models after filtering
console.log(`Testing ${testModels.length} model configurations`);
console.log(`Testing ${providerModels.length} provider model configurations`);

export const streamingModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
);

export const reasoningModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => p.reasoning === true),
);

export const streamingReasoningModels = reasoningModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
);

export const toolCallModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => p.tools === true),
);

export const imageModels = testModels.filter((m) => {
	const model = models.find((mo) => m.originalModel === mo.id);
	return (model as ModelDefinition).output?.includes("image");
});

export const streamingImageModels = imageModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
);

export async function createProviderKey(
	provider: string,
	token: string,
	keyType: "api-keys" | "credits" = "api-keys",
) {
	const keyId =
		keyType === "credits" ? `env-${provider}` : `provider-key-${provider}`;
	await db
		.insert(tables.providerKey)
		.values({
			id: keyId,
			token,
			provider: provider.replace("env-", ""), // Remove env- prefix for the provider field
			organizationId: "org-id",
		})
		.onConflictDoNothing();
}

export function validateResponse(json: any) {
	expect(json).toHaveProperty("choices.[0].message.content");

	expect(json).toHaveProperty("usage.prompt_tokens");
	expect(json).toHaveProperty("usage.completion_tokens");
	expect(json).toHaveProperty("usage.total_tokens");
}

export async function validateLogByRequestId(requestId: string) {
	const log = await waitForLogByRequestId(requestId);

	if (logMode) {
		console.log("log", JSON.stringify(log, null, 2));
	}

	expect(log.usedProvider).toBeTruthy();
	expect(log.errorDetails).toBeNull();
	expect(log.finishReason).not.toBeNull();
	expect(log.unifiedFinishReason).not.toBeNull();
	expect(log.unifiedFinishReason).toBeTruthy();
	expect(log.usedModel).toBeTruthy();
	expect(log.requestedModel).toBeTruthy();

	return log;
}

describe("e2e", { concurrent: true }, () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test.each(testModels)(
		"completions $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model: model,
					messages: [
						{
							role: "system",
							content: "You are a helpful assistant.",
						},
						{
							role: "user",
							content: "Hello, just reply 'OK'!",
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			validateResponse(json);

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);

			expect(json).toHaveProperty("usage");
			expect(json.usage).toHaveProperty("prompt_tokens");
			expect(json.usage).toHaveProperty("completion_tokens");
			expect(json.usage).toHaveProperty("total_tokens");
			expect(typeof json.usage.prompt_tokens).toBe("number");
			expect(typeof json.usage.completion_tokens).toBe("number");
			expect(typeof json.usage.total_tokens).toBe("number");
			expect(json.usage.prompt_tokens).toBeGreaterThan(0);
			expect(json.usage.completion_tokens).toBeGreaterThan(0);
			expect(json.usage.total_tokens).toBeGreaterThan(0);

			// expect(log.inputCost).not.toBeNull();
			// expect(log.outputCost).not.toBeNull();
			// expect(log.cost).not.toBeNull();
		},
	);

	if (process.env.EXPERIMENTAL) {
		test.each(providerModels)(
			"complex $model",
			getTestOptions(),
			async ({ model, provider }) => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "user",
								content: [
									{
										type: "text",
										text: "<task>\ndescribe this image\n</task>",
									},
									{
										type: "text",
										text: "", // empty text – note this may need special handling
									},
									// provide image url if vision is supported
									...(provider.vision
										? [
												{
													type: "image_url",
													image_url: {
														url: "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://google.com&size=128",
													},
												},
											]
										: []),
								],
							},
						],
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log("response:", JSON.stringify(json, null, 2));
				}

				expect(res.status).toBe(200);
				validateResponse(json);

				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(false);

				expect(json).toHaveProperty("usage");
				expect(json.usage).toHaveProperty("prompt_tokens");
				expect(json.usage).toHaveProperty("completion_tokens");
				expect(json.usage).toHaveProperty("total_tokens");
				expect(typeof json.usage.prompt_tokens).toBe("number");
				expect(typeof json.usage.completion_tokens).toBe("number");
				expect(typeof json.usage.total_tokens).toBe("number");
				if (provider.providerId !== "zai") {
					// zai may have weird prompt tokens
					expect(json.usage.prompt_tokens).toBeGreaterThan(0);
				}
				expect(json.usage.completion_tokens).toBeGreaterThan(0);
				expect(json.usage.total_tokens).toBeGreaterThan(0);
				expect(json.usage.total_tokens).toEqual(
					json.usage.prompt_tokens +
						json.usage.completion_tokens +
						(json.usage.reasoning_tokens || 0),
				);
			},
		);

		test.each(testModels)(
			"parameters $model",
			getTestOptions(),
			async ({ model }) => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "system",
								content: "You are a helpful assistant.",
							},
							{
								role: "user",
								content: "Hello, just reply 'OK'!",
							},
						],
						max_tokens: 200,
						temperature: 0.7,
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log("parameters response:", JSON.stringify(json, null, 2));
				}

				expect(res.status).toBe(200);
				validateResponse(json);

				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(false);

				expect(json).toHaveProperty("usage");
				expect(json.usage).toHaveProperty("prompt_tokens");
				expect(json.usage).toHaveProperty("completion_tokens");
				expect(json.usage).toHaveProperty("total_tokens");
				expect(typeof json.usage.prompt_tokens).toBe("number");
				expect(typeof json.usage.completion_tokens).toBe("number");
				expect(typeof json.usage.total_tokens).toBe("number");
				expect(json.usage.prompt_tokens).toBeGreaterThan(0);
				expect(json.usage.completion_tokens).toBeGreaterThan(0);
				expect(json.usage.total_tokens).toBeGreaterThan(0);
			},
		);
	}
});
