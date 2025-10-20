import "dotenv/config";
import { describe, expect, it } from "vitest";

import { db, tables } from "@llmgateway/db";
import {
	type ModelDefinition,
	getProviderEnvVar,
	models,
	type ProviderModelMapping,
	providers,
	getConcurrentTestOptions,
	getTestOptions,
} from "@llmgateway/models";

import {
	clearCache,
	waitForLogByRequestId,
} from "./test-utils/test-helpers.js";

export { getConcurrentTestOptions, getTestOptions };

// Helper function to generate unique request IDs for tests
export function generateTestRequestId(): string {
	return `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

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

			// Filter by TEST_MODELS if specified
			if (specifiedModels) {
				const providerModelId = `${provider.providerId}/${model.id}`;
				if (!specifiedModels.includes(providerModelId)) {
					continue;
				}
			}

			// Skip unstable providers if not in full mode, unless they have test: "only" or are in TEST_MODELS
			if (
				(provider.stability === "unstable" ||
					provider.stability === "experimental") &&
				!fullMode
			) {
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

			// Filter by TEST_MODELS if specified
			if (specifiedModels) {
				const providerModelId = `${provider.providerId}/${model.id}`;
				if (!specifiedModels.includes(providerModelId)) {
					continue;
				}
			}

			// Skip unstable providers if not in full mode, unless they have test: "only" or are in TEST_MODELS
			if (
				(provider.stability === "unstable" ||
					provider.stability === "experimental") &&
				!fullMode
			) {
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

export async function beforeAllHook() {
	await clearCache();

	// Set up shared test data that all tests can use - use ON CONFLICT DO NOTHING to avoid duplicate key errors
	await db
		.insert(tables.user)
		.values({
			id: "user-id",
			name: "user",
			email: "user",
		})
		.onConflictDoNothing();

	await db
		.insert(tables.organization)
		.values({
			id: "org-id",
			name: "Test Organization",
			plan: "pro",
		})
		.onConflictDoNothing();

	await db
		.insert(tables.userOrganization)
		.values({
			id: "user-org-id",
			userId: "user-id",
			organizationId: "org-id",
		})
		.onConflictDoNothing();

	await db
		.insert(tables.project)
		.values({
			id: "project-id",
			name: "Test Project",
			organizationId: "org-id",
			mode: "api-keys",
		})
		.onConflictDoNothing();

	await db
		.insert(tables.apiKey)
		.values({
			id: "token-id",
			token: "real-token",
			projectId: "project-id",
			description: "Test API Key",
			createdBy: "user-id",
		})
		.onConflictDoNothing();

	// Set up provider keys for all providers
	for (const provider of providers) {
		const envVarName = getProviderEnvVar(provider.id);
		const envVarValue = envVarName ? process.env[envVarName] : undefined;
		if (envVarValue) {
			await createProviderKey(provider.id, envVarValue, "api-keys");
			await createProviderKey(provider.id, envVarValue, "credits");
		}
	}
}

export async function beforeEachHook() {
	await clearCache();
}

describe("e2e", getConcurrentTestOptions(), () => {
	it("empty", () => {
		expect(true).toBe(true);
	});
});
