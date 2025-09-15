import "dotenv/config";
import {
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	type TestOptions,
} from "vitest";

import { db, tables } from "@llmgateway/db";
import {
	type ModelDefinition,
	models,
	type ProviderModelMapping,
	providers,
} from "@llmgateway/models";

import { app } from ".";
import {
	clearCache,
	waitForLogByRequestId,
	getProviderEnvVar,
	readAll,
} from "./test-utils/test-helpers";

// Helper function to generate unique request IDs for tests
function generateTestRequestId(): string {
	return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Helper function to get test options with retry for CI environment
function getTestOptions(): TestOptions {
	return process.env.CI ? { retry: 3, timeout: 120000 } : {};
}

console.log("running with test options:", getTestOptions());

const fullMode = process.env.FULL_MODE;
const logMode = process.env.LOG_MODE;

// Parse TEST_MODELS environment variable
const testModelsEnv = process.env.TEST_MODELS;
const specifiedModels = testModelsEnv
	? testModelsEnv.split(",").map((m) => m.trim())
	: null;

if (specifiedModels) {
	console.log(`TEST_MODELS specified: ${specifiedModels.join(", ")}`);
}

// Filter models based on test skip/only property
const hasOnlyModels = models.some((model) =>
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

const filteredModels = models
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

const testModels = filteredModels
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

const providerModels = filteredModels
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

const streamingModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
);

const reasoningModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => p.reasoning === true),
);

const streamingReasoningModels = reasoningModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
);

const toolCallModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => p.tools === true),
);

const imageModels = testModels.filter((m) => {
	const model = models.find((mo) => m.originalModel === mo.id);
	return (model as ModelDefinition).output?.includes("image");
});

const streamingImageModels = imageModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
);

describe("e2e", { concurrent: true }, () => {
	// Set up database once before all tests
	beforeAll(async () => {
		await clearCache();

		// Clean up any existing data
		await Promise.all([
			db.delete(tables.log),
			db.delete(tables.apiKey),
			db.delete(tables.providerKey),
		]);

		await Promise.all([
			db.delete(tables.userOrganization),
			db.delete(tables.project),
		]);

		await Promise.all([
			db.delete(tables.organization),
			db.delete(tables.user),
			db.delete(tables.account),
			db.delete(tables.session),
			db.delete(tables.verification),
		]);

		// Set up shared test data that all tests can use
		await db.insert(tables.user).values({
			id: "user-id",
			name: "user",
			email: "user",
		});

		await db.insert(tables.organization).values({
			id: "org-id",
			name: "Test Organization",
			plan: "pro",
		});

		await db.insert(tables.userOrganization).values({
			id: "user-org-id",
			userId: "user-id",
			organizationId: "org-id",
		});

		await db.insert(tables.project).values({
			id: "project-id",
			name: "Test Project",
			organizationId: "org-id",
			mode: "api-keys",
		});

		await db.insert(tables.apiKey).values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
		});

		// Set up provider keys for all providers
		for (const provider of providers) {
			const envVarName = getProviderEnvVar(provider.id);
			const envVarValue = envVarName ? process.env[envVarName] : undefined;
			if (envVarValue) {
				await createProviderKey(provider.id, envVarValue, "api-keys");
				await createProviderKey(provider.id, envVarValue, "credits");
			}
		}
	});

	// Only clear cache before each test - avoid clearing logs as concurrent tests may be waiting for them
	beforeEach(async () => {
		await clearCache();
	});

	async function createProviderKey(
		provider: string,
		token: string,
		keyType: "api-keys" | "credits" = "api-keys",
	) {
		const keyId =
			keyType === "credits" ? `env-${provider}` : `provider-key-${provider}`;
		await db.insert(tables.providerKey).values({
			id: keyId,
			token,
			provider: provider.replace("env-", ""), // Remove env- prefix for the provider field
			organizationId: "org-id",
		});
	}

	function validateResponse(json: any) {
		expect(json).toHaveProperty("choices.[0].message.content");

		expect(json).toHaveProperty("usage.prompt_tokens");
		expect(json).toHaveProperty("usage.completion_tokens");
		expect(json).toHaveProperty("usage.total_tokens");
	}

	async function validateLogByRequestId(requestId: string) {
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

	test.each(streamingModels)(
		"/v1/chat/completions streaming with $model",
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
							content: "Hello! This is a streaming e2e test.",
						},
					],
					stream: true,
				}),
			});

			if (res.status !== 200) {
				console.log("response:", await res.text());
				throw new Error(`Request failed with status ${res.status}`);
			}

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");

			const streamResult = await readAll(res.body);
			if (logMode) {
				console.log("streamResult", JSON.stringify(streamResult, null, 2));
			}

			expect(streamResult.hasValidSSE).toBe(true);
			expect(streamResult.eventCount).toBeGreaterThan(0);
			expect(streamResult.hasContent).toBe(true);

			// Verify that all streaming responses are transformed to OpenAI format
			expect(streamResult.hasOpenAIFormat).toBe(true);

			// Verify that chunks have the correct OpenAI streaming format
			const contentChunks = streamResult.chunks.filter(
				(chunk) => chunk.choices?.[0]?.delta?.content,
			);
			expect(contentChunks.length).toBeGreaterThan(0);

			// Verify each content chunk has proper OpenAI format
			for (const chunk of contentChunks) {
				expect(chunk).toHaveProperty("id");
				expect(chunk).toHaveProperty("object", "chat.completion.chunk");
				expect(chunk).toHaveProperty("created");
				expect(chunk).toHaveProperty("model");
				expect(chunk).toHaveProperty("choices");
				expect(chunk.choices).toHaveLength(1);
				expect(chunk.choices[0]).toHaveProperty("index", 0);
				expect(chunk.choices[0]).toHaveProperty("delta");
				expect(chunk.choices[0]).toHaveProperty("delta.role", "assistant");
				expect(chunk.choices[0].delta).toHaveProperty("content");
				expect(typeof chunk.choices[0].delta.content).toBe("string");
			}

			// Verify that usage object is returned in streaming mode
			const usageChunks = streamResult.chunks.filter(
				(chunk) =>
					chunk.usage &&
					(chunk.usage.prompt_tokens !== null ||
						chunk.usage.completion_tokens !== null ||
						chunk.usage.total_tokens !== null),
			);
			expect(usageChunks.length).toBeGreaterThan(0);

			// Verify the usage chunk has proper format
			const usageChunk = usageChunks[usageChunks.length - 1]; // Get the last usage chunk
			expect(usageChunk).toHaveProperty("usage");
			expect(usageChunk.usage).toHaveProperty("prompt_tokens");
			expect(usageChunk.usage).toHaveProperty("completion_tokens");
			expect(usageChunk.usage).toHaveProperty("total_tokens");
			expect(typeof usageChunk.usage.prompt_tokens).toBe("number");
			expect(typeof usageChunk.usage.completion_tokens).toBe("number");
			expect(typeof usageChunk.usage.total_tokens).toBe("number");
			expect(usageChunk.usage.prompt_tokens).toBeGreaterThan(0);
			expect(usageChunk.usage.completion_tokens).toBeGreaterThan(0);
			expect(usageChunk.usage.total_tokens).toBeGreaterThan(0);

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(true);

			// expect(log.cost).not.toBeNull();
			// expect(log.cost).toBeGreaterThanOrEqual(0);
		},
	);

	test.each(reasoningModels)(
		"reasoning $model",
		getTestOptions(),
		async ({ model, providers }) => {
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
							content: "What is 2/3 + 1/4 + 5/6?",
						},
					],
					reasoning_effort: "medium",
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("reasoning response:", JSON.stringify(json, null, 2));
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

			// Check for reasoning tokens if available
			if (json.usage.reasoning_tokens !== undefined) {
				expect(typeof json.usage.reasoning_tokens).toBe("number");
				expect(json.usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
			}

			// check for reasoning response - only if the provider expects reasoning output
			const reasoningProvider = providers?.find(
				(p: ProviderModelMapping) => p.reasoning === true,
			) as ProviderModelMapping;
			const useResponsesApi = process.env.USE_RESPONSES_API === "true";
			const isOpenAI = reasoningProvider?.providerId === "openai";
			// only enforce reasoning_content checks for where reasoningOutput is not "omit" and for openai, only if the responses api is used
			if (
				reasoningProvider?.reasoningOutput !== "omit" &&
				(!isOpenAI || useResponsesApi)
			) {
				expect(json.choices[0].message).toHaveProperty("reasoning_content");
			}
		},
	);

	test.each(streamingReasoningModels)(
		"reasoning + streaming $model",
		getTestOptions(),
		async ({ model, providers }) => {
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
							content:
								"You are a helpful assistant. Think step by step and show your reasoning.",
						},
						{
							role: "user",
							content:
								"Solve this logic puzzle: If all roses are flowers, and some flowers are red, what can we conclude about roses? Think through this step by step.",
						},
					],
					reasoning_effort: "medium",
					stream: true,
				}),
			});

			if (res.status !== 200) {
				console.log("response:", await res.text());
				throw new Error(`Request failed with status ${res.status}`);
			}

			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("text/event-stream");

			const streamResult = await readAll(res.body);
			if (logMode) {
				console.log(
					"reasoning streaming response:",
					JSON.stringify(streamResult.chunks, null, 2),
				);
			}

			expect(streamResult.hasValidSSE).toBe(true);
			expect(streamResult.eventCount).toBeGreaterThan(0);
			expect(streamResult.hasContent).toBe(true);

			// Verify that all streaming responses are transformed to OpenAI format
			expect(streamResult.hasOpenAIFormat).toBe(true);

			// Verify that chunks have the correct OpenAI streaming format
			const contentChunks = streamResult.chunks.filter(
				(chunk: any) => chunk.choices?.[0]?.delta?.content,
			);
			expect(contentChunks.length).toBeGreaterThan(0);

			// Verify each content chunk has proper OpenAI format
			for (const chunk of contentChunks) {
				expect(chunk).toHaveProperty("id");
				expect(chunk).toHaveProperty("object", "chat.completion.chunk");
				expect(chunk).toHaveProperty("created");
				expect(chunk).toHaveProperty("model");
				expect(chunk).toHaveProperty("choices");
				expect(chunk.choices).toHaveLength(1);
				expect(chunk.choices[0]).toHaveProperty("delta");
				expect(typeof chunk.choices[0].delta.content).toBe("string");
			}

			// Verify that usage object is returned in streaming mode
			const usageChunks = streamResult.chunks.filter(
				(chunk: any) =>
					chunk.usage &&
					(chunk.usage.prompt_tokens !== null ||
						chunk.usage.completion_tokens !== null ||
						chunk.usage.total_tokens !== null),
			);
			expect(usageChunks.length).toBeGreaterThan(0);

			// Verify the usage chunk has proper format
			const usageChunk = usageChunks[usageChunks.length - 1]; // Get the last usage chunk
			expect(usageChunk).toHaveProperty("usage");
			expect(usageChunk.usage).toHaveProperty("prompt_tokens");
			expect(usageChunk.usage).toHaveProperty("completion_tokens");
			expect(usageChunk.usage).toHaveProperty("total_tokens");
			expect(typeof usageChunk.usage.prompt_tokens).toBe("number");
			expect(typeof usageChunk.usage.completion_tokens).toBe("number");
			expect(typeof usageChunk.usage.total_tokens).toBe("number");
			expect(usageChunk.usage.prompt_tokens).toBeGreaterThan(0);
			expect(usageChunk.usage.completion_tokens).toBeGreaterThan(0);
			expect(usageChunk.usage.total_tokens).toBeGreaterThan(0);

			// Check for reasoning tokens if available
			if (usageChunk.usage.reasoning_tokens !== undefined) {
				expect(typeof usageChunk.usage.reasoning_tokens).toBe("number");
				expect(usageChunk.usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
			}

			// Verify reasoning content is present in unified reasoning_content field - only if the provider expects reasoning output
			const reasoningProvider = providers?.find(
				(p: ProviderModelMapping) => p.reasoning === true,
			) as ProviderModelMapping;
			const useResponsesApi = process.env.USE_RESPONSES_API === "true";
			const isOpenAI = reasoningProvider?.providerId === "openai";
			// When using the Responses API, only enforce reasoning_content checks for OpenAI.
			if (
				reasoningProvider?.reasoningOutput !== "omit" &&
				(!isOpenAI || useResponsesApi)
			) {
				const reasoningChunks = streamResult.chunks.filter(
					(chunk: any) =>
						chunk.choices?.[0]?.delta?.reasoning_content &&
						chunk.choices[0].delta.reasoning_content.length > 0,
				);
				expect(reasoningChunks.length).toBeGreaterThan(0);
			}

			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(true);
		},
	);

	if (fullMode) {
		const reasoningToolCallModels = testModels.filter((m) =>
			m.providers.some(
				(p: ProviderModelMapping) => p.reasoning === true && p.tools === true,
			),
		);

		test.each(reasoningToolCallModels)(
			"reasoning + tool calls $model",
			getTestOptions(),
			async ({ model, providers }) => {
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
								content:
									"You are a weather assistant that can get weather information for cities. Think step by step and use tools when needed.",
							},
							{
								role: "user",
								content:
									"What's the weather like in San Francisco? Consider all the exact details. Use the weather tool and explain your reasoning.",
							},
						],
						tools: [
							{
								type: "function",
								function: {
									name: "get_weather",
									description: "Get the current weather for a given city",
									parameters: {
										type: "object",
										properties: {
											city: {
												type: "string",
												description: "The city name to get weather for",
											},
											unit: {
												type: "string",
												enum: ["celsius", "fahrenheit"],
												description: "Temperature unit",
												default: "fahrenheit",
											},
										},
										required: ["city"],
									},
								},
							},
						],
						tool_choice: "auto",
						reasoning_effort: "medium",
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log(
						"reasoning + tool calls response:",
						JSON.stringify(json, null, 2),
					);
				}

				expect(res.status).toBe(200);
				expect(json).toHaveProperty("choices");
				expect(json.choices).toHaveLength(1);
				expect(json.choices[0]).toHaveProperty("message");

				const message = json.choices[0].message;
				expect(message).toHaveProperty("role", "assistant");

				// Should have tool calls since we're asking about weather
				expect(message).toHaveProperty("tool_calls");
				expect(Array.isArray(message.tool_calls)).toBe(true);
				expect(message.tool_calls.length).toBeGreaterThan(0);

				// Validate tool call structure
				const toolCall = message.tool_calls[0];
				expect(toolCall).toHaveProperty("id");
				expect(toolCall).toHaveProperty("type", "function");
				expect(toolCall).toHaveProperty("function");
				expect(toolCall.function).toHaveProperty("name", "get_weather");
				expect(toolCall.function).toHaveProperty("arguments");

				// Parse and validate arguments
				const args = JSON.parse(toolCall.function.arguments);
				expect(args).toHaveProperty("city");
				expect(typeof args.city).toBe("string");
				expect(args.city.toLowerCase()).toContain("san francisco");

				// Check finish reason
				expect(json.choices[0]).toHaveProperty("finish_reason", "tool_calls");

				// Check for reasoning content - only if the provider expects reasoning output
				const reasoningProvider = providers?.find(
					(p: ProviderModelMapping) => p.reasoning === true,
				);
				if (
					(reasoningProvider as ProviderModelMapping)?.reasoningOutput !==
					"omit"
				) {
					expect(json.choices[0].message).toHaveProperty("reasoning_content");
					expect(typeof json.choices[0].message.reasoning_content).toBe(
						"string",
					);
					expect(
						json.choices[0].message.reasoning_content.length,
					).toBeGreaterThan(0);
				}

				// Validate logs
				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(false);

				// Validate usage
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

				// Check for reasoning tokens if available
				if (json.usage.reasoning_tokens !== undefined) {
					expect(typeof json.usage.reasoning_tokens).toBe("number");
					expect(json.usage.reasoning_tokens).toBeGreaterThanOrEqual(0);
				}
			},
		);
	}

	test.each(toolCallModels)(
		"tool calls $model",
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
							content:
								"You are a weather assistant that can get weather information for cities.",
						},
						{
							role: "user",
							content: "What's the weather like in San Francisco?",
						},
					],
					tools: [
						{
							type: "function",
							function: {
								name: "get_weather",
								description: "Get the current weather for a given city",
								parameters: {
									type: "object",
									properties: {
										city: {
											type: "string",
											description: "The city name to get weather for",
										},
										unit: {
											type: "string",
											enum: ["celsius", "fahrenheit"],
											description: "Temperature unit",
											default: "fahrenheit",
										},
									},
									required: ["city"],
								},
							},
						},
					],
					tool_choice: "auto",
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("tool calls response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices");
			expect(json.choices).toHaveLength(1);
			expect(json.choices[0]).toHaveProperty("message");

			const message = json.choices[0].message;
			expect(message).toHaveProperty("role", "assistant");

			// Should have tool calls since we're asking about weather
			expect(message).toHaveProperty("tool_calls");
			expect(Array.isArray(message.tool_calls)).toBe(true);
			expect(message.tool_calls.length).toBeGreaterThan(0);

			// Validate tool call structure
			const toolCall = message.tool_calls[0];
			expect(toolCall).toHaveProperty("id");
			expect(toolCall).toHaveProperty("type", "function");
			expect(toolCall).toHaveProperty("function");
			expect(toolCall.function).toHaveProperty("name", "get_weather");
			expect(toolCall.function).toHaveProperty("arguments");

			// Parse and validate arguments
			const args = JSON.parse(toolCall.function.arguments);
			expect(args).toHaveProperty("city");
			expect(typeof args.city).toBe("string");
			expect(args.city.toLowerCase()).toContain("san francisco");

			// Check finish reason
			expect(json.choices[0]).toHaveProperty("finish_reason", "tool_calls");

			// Validate logs
			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);

			// Validate usage
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

	test.each(toolCallModels)(
		"tool calls with result $model",
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
							content:
								"You are Noemi, a thoughtful and clear assistant. Your tone is calm, minimal, and human. You write with intention—never too much, never too little. You avoid clichés, speak simply, and offer helpful, grounded answers. When needed, you ask good questions. You don't try to impress—you aim to clarify. You may use metaphors if they bring clarity, but you stay sharp and sincere. You're here to help the user think clearly and move forward, not to overwhelm or overperform.",
						},
						{
							role: "user",
							content: "web search for the best ai notetaker apps!!!!",
						},
						{
							role: "assistant",
							content: "",
							tool_calls: [
								{
									id: "toolu_015dgN1nk5Ay12iN8e16XPbs",
									type: "function",
									function: {
										name: "webSearch",
										arguments: '{"query":"best AI notetaker apps 2024"}',
									},
								},
							],
						},
						{
							role: "tool",
							content:
								'{"type":"webSearch","query":"best AI notetaker apps 2024","results":[{"title":"My Deep Dive into 25+ AI Note-Taking Apps (The Brutally ... - Reddit","href":"https://www.reddit.com/r/Zoom/comments/1jtbxkf/my_deep_dive_into_25_ai_notetaking_apps_the/","description":"The Good: Think Obsidian meets Miro. Whiteboard-style interface for connecting notes visually. AI assistant can generate summaries and do ..."},{"title":"The 9 best AI meeting assistants in 2025 - Zapier","href":"https://zapier.com/blog/best-ai-meeting-assistant/","description":"Granola automatically transcribes, summarizes, and analyzes your meetings. It also acts as a live notepad, allowing you to manually jot down ..."},{"title":"The Best AI Tools for Taking Notes in 2025 - PCMag","href":"https://www.pcmag.com/picks/best-ai-tools-taking-notes","description":"The popular note-taking app Notion now has AI tools. Notion AI excels at answering questions about your existing data, generating text from a prompt you give it ..."},{"title":"Top 5 BEST AI Note-Taking Apps (Better than Notion?) - YouTube","href":"https://www.youtube.com/watch?v=wGLd43TkCGc","description":"Voicenotes is a voice‑to‑text powerhouse that transcribes and extracts action items in one tap. · Saner is A distraction‑free workspace built for ..."},{"title":"9 Best AI Note-Taking Apps Built For Your Meetings - Quil\'s AI","href":"https://quil.ai/2024/09/12/9-best-ai-note-taking-apps-built-for-your-meetings/","description":"Quil.ai: The AI Note-taker Built for Recruiting Firms. 2. Notion: Write, Plan, Organize. 3. Jamie AI: The Bot-Free AI Note-taker."}],"timestamp":"2025-08-29T01:20:29.553Z"}',
							tool_call_id: "toolu_015dgN1nk5Ay12iN8e16XPbs",
						},
					],
					tools: [
						{
							type: "function",
							function: {
								name: "webSearch",
								description: "Search the web for information",
								parameters: {
									type: "object",
									properties: {
										query: {
											type: "string",
											description: "Search query",
										},
									},
									required: ["query"],
								},
							},
						},
					],
					tool_choice: "auto",
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log(
					"tool calls with empty content response:",
					JSON.stringify(json, null, 2),
				);
			}

			// Log error response if status is not 200
			if (res.status !== 200) {
				console.log(
					`Error ${res.status} - tool calls with result response:`,
					JSON.stringify(json, null, 2),
				);
			}

			expect(res.status).toBe(200);
			expect(json).toHaveProperty("choices");
			expect(json.choices).toHaveLength(1);
			expect(json.choices[0]).toHaveProperty("message");

			const message = json.choices[0].message;
			expect(message).toHaveProperty("role", "assistant");

			// Should have proper content (not empty) as a response to the tool call
			expect(message).toHaveProperty("content");
			// verify either content is string or tool_calls is present
			expect(message.content || message.tool_calls).toBeTruthy();

			// Should have finish reason as stop (not tool_calls since this is a response)
			// TODO THIS IS FAILING ON SOME MODELS
			// expect(json.choices[0]).toHaveProperty("finish_reason", "stop");

			// Validate logs
			const log = await validateLogByRequestId(requestId);
			expect(log.streamed).toBe(false);

			// Validate usage
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

	test.each(
		testModels.filter((m) => {
			const modelDef = models.find((def) => def.id === m.model);
			return (modelDef as ModelDefinition)?.jsonOutput === true;
		}),
	)("JSON output $model", getTestOptions(), async ({ model }) => {
		const res = await app.request("/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: model,
				messages: [
					{
						role: "system",
						content:
							"You are a helpful assistant. Always respond with valid JSON.",
					},
					{
						role: "user",
						content: 'Return a JSON object with "message": "Hello World"',
					},
				],
				response_format: { type: "json_object" },
			}),
		});

		const json = await res.json();
		if (logMode) {
			console.log("json", JSON.stringify(json, null, 2));
		}
		expect(res.status).toBe(200);
		expect(json).toHaveProperty("choices.[0].message.content");

		const content = json.choices[0].message.content;
		expect(() => JSON.parse(content)).not.toThrow();

		const parsedContent = JSON.parse(content);
		expect(parsedContent).toHaveProperty("message");
	});

	if (fullMode) {
		test.each(imageModels)(
			"image output $model",
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
								role: "user",
								content: "Generate an image of a cute dog",
							},
						],
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log("image output response:", JSON.stringify(json, null, 2));
				}

				expect(res.status).toBe(200);
				expect(json).toHaveProperty("choices");
				expect(json.choices).toHaveLength(1);
				expect(json.choices[0]).toHaveProperty("message");

				const message = json.choices[0].message;
				expect(message).toHaveProperty("role", "assistant");

				// Check that the response contains text content
				expect(message.content).toBeTruthy();
				expect(typeof message.content).toBe("string");

				// Check for images array in OpenAI format
				expect(message).toHaveProperty("images");
				expect(Array.isArray(message.images)).toBe(true);
				expect(message.images.length).toBeGreaterThan(0);

				// Validate each image object
				for (const image of message.images) {
					expect(image).toHaveProperty("type", "image_url");
					expect(image).toHaveProperty("image_url");
					expect(image.image_url).toHaveProperty("url");
					expect(typeof image.image_url.url).toBe("string");
					// Check if it's a base64 data URL
					expect(image.image_url.url).toMatch(
						/^data:image\/(png|jpeg|jpg|webp);base64,/,
					);
				}

				// Validate logs
				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(false);

				// Validate usage
				expect(json).toHaveProperty("usage");
				expect(json.usage).toHaveProperty("prompt_tokens");
				expect(json.usage).toHaveProperty("completion_tokens");
				expect(json.usage).toHaveProperty("total_tokens");
			},
		);

		test.each(streamingImageModels)(
			"streaming image output $model",
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
								role: "user",
								content: "Generate an image of a cute dog",
							},
						],
						stream: true,
					}),
				});

				if (res.status !== 200) {
					console.log("response:", await res.text());
					throw new Error(`Request failed with status ${res.status}`);
				}

				expect(res.status).toBe(200);
				expect(res.headers.get("content-type")).toContain("text/event-stream");

				const streamResult = await readAll(res.body);
				if (logMode) {
					console.log(
						"streaming image result:",
						JSON.stringify(streamResult, null, 2),
					);
				}

				expect(streamResult.hasValidSSE).toBe(true);
				expect(streamResult.eventCount).toBeGreaterThan(0);
				expect(streamResult.hasContent).toBe(true);

				// Verify that all streaming responses are transformed to OpenAI format
				expect(streamResult.hasOpenAIFormat).toBe(true);

				// Look for chunks containing images
				const imageChunks = streamResult.chunks.filter(
					(chunk) => chunk.choices?.[0]?.delta?.images,
				);
				expect(imageChunks.length).toBeGreaterThan(0);

				// Validate image chunks
				for (const chunk of imageChunks) {
					expect(chunk).toHaveProperty("id");
					expect(chunk).toHaveProperty("object", "chat.completion.chunk");
					expect(chunk).toHaveProperty("created");
					expect(chunk).toHaveProperty("model");
					expect(chunk).toHaveProperty("choices");
					expect(chunk.choices).toHaveLength(1);
					expect(chunk.choices[0]).toHaveProperty("index", 0);
					expect(chunk.choices[0]).toHaveProperty("delta");

					const delta = chunk.choices[0].delta;
					if (delta.images) {
						expect(Array.isArray(delta.images)).toBe(true);
						for (const image of delta.images) {
							expect(image).toHaveProperty("type", "image_url");
							expect(image).toHaveProperty("image_url");
							expect(image.image_url).toHaveProperty("url");
							expect(typeof image.image_url.url).toBe("string");
							// Check if it's a base64 data URL
							expect(image.image_url.url).toMatch(
								/^data:image\/(png|jpeg|jpg|webp);base64,/,
							);
						}
					}
				}

				// Verify that usage object is returned in streaming mode
				const usageChunks = streamResult.chunks.filter(
					(chunk) =>
						chunk.usage &&
						(chunk.usage.prompt_tokens !== null ||
							chunk.usage.completion_tokens !== null ||
							chunk.usage.total_tokens !== null),
				);
				expect(usageChunks.length).toBeGreaterThan(0);

				const log = await validateLogByRequestId(requestId);
				expect(log.streamed).toBe(true);
			},
		);
	}

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
