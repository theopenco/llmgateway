import "dotenv/config";
import { describe, expect, it } from "vitest";

import { db, tables } from "@llmgateway/db";
import {
	type ModelDefinition,
	getProviderDefinition,
	getProviderEnvVar,
	models,
	type ProviderModelMapping,
	providers,
	getConcurrentTestOptions,
	getTestOptions,
	expandAllProviderRegions,
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
// Supports optional region filter: "alibaba/deepseek-v3.2:cn-beijing"
export const testModelsEnv = process.env.TEST_MODELS;
export const specifiedModels = testModelsEnv
	? testModelsEnv.split(",").map((m) => m.trim())
	: null;

interface ParsedTestModel {
	providerId: string;
	modelId: string;
	region?: string;
}

function parseTestModel(spec: string): ParsedTestModel {
	const [providerModel, region] = spec.split(":");
	const [providerId, ...modelParts] = providerModel.split("/");
	return {
		providerId,
		modelId: modelParts.join("/"),
		region,
	};
}

const parsedTestModels = specifiedModels?.map(parseTestModel) ?? null;

/**
 * Check if a provider/model/region matches any TEST_MODELS entry.
 * "alibaba/model" matches all regions. "alibaba/model:cn-beijing" matches only that region.
 */
export function matchesTestModel(
	providerId: string,
	modelId: string,
	region?: string,
): boolean {
	if (!parsedTestModels) {
		return false;
	}
	return parsedTestModels.some(
		(t) =>
			t.providerId === providerId &&
			t.modelId === modelId &&
			(t.region === undefined || t.region === region),
	);
}

/**
 * Check if a model (any provider) matches any TEST_MODELS entry.
 */
function modelMatchesAnyTestModel(
	modelId: string,
	providers: ProviderModelMapping[],
): boolean {
	if (!parsedTestModels) {
		return false;
	}
	// Expand regions so "alibaba/model:cn-beijing" matches a nested region entry
	const expanded = expandAllProviderRegions(providers);
	return expanded.some((p) =>
		matchesTestModel(p.providerId, modelId, p.region),
	);
}

// Parse TEST_PROVIDERS environment variable (filter by provider name)
export const testProvidersEnv = process.env.TEST_PROVIDERS;
export const specifiedProviders = testProvidersEnv
	? testProvidersEnv.split(",").map((p) => p.trim())
	: null;

if (specifiedModels) {
	console.log(`TEST_MODELS specified: ${specifiedModels.join(", ")}`);
}
if (specifiedProviders) {
	console.log(`TEST_PROVIDERS specified: ${specifiedProviders.join(", ")}`);
}

function hasAllRequiredProviderEnvVars(providerId: string): boolean {
	const def = getProviderDefinition(providerId);
	if (!def) {
		return false;
	}
	const required = def.env.required as Record<string, string | undefined>;
	for (const envVarName of Object.values(required)) {
		if (!envVarName) {
			continue;
		}
		if (!process.env[envVarName]) {
			return false;
		}
	}
	return true;
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
	// Filter out video-only models (they use the /v1/videos endpoint, not chat completions)
	.filter((model) => {
		const output = (model as ModelDefinition).output;
		return !output || !output.includes("video") || output.includes("text");
	})
	// Filter out unstable models if not in full mode, unless they have test: "only" or are in TEST_MODELS
	// Note: This only filters models with model-level stability, not provider-level stability
	.filter((model) => {
		// Check only model-level stability, not provider-level
		const modelStability = (model as ModelDefinition).stability;
		const isUnstable =
			modelStability === "unstable" || modelStability === "experimental";

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

		// 2. Model is specified in TEST_MODELS or TEST_PROVIDERS
		if (specifiedProviders) {
			const modelInTestProviders = model.providers.some(
				(provider: ProviderModelMapping) =>
					specifiedProviders.includes(provider.providerId),
			);
			if (modelInTestProviders) {
				return true;
			}
		}
		if (specifiedModels) {
			const modelInTestModels = modelMatchesAnyTestModel(
				model.id,
				model.providers as ProviderModelMapping[],
			);
			if (modelInTestModels) {
				return true;
			}
		}

		return false; // Otherwise, exclude unstable models in non-full mode
	})
	// Filter out free models if not in full mode, unless they have test: "only" or are in TEST_MODELS/TEST_PROVIDERS
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

		// 2. Model is specified in TEST_MODELS or TEST_PROVIDERS
		if (specifiedProviders) {
			const modelInTestProviders = model.providers.some(
				(provider: ProviderModelMapping) =>
					specifiedProviders.includes(provider.providerId),
			);
			if (modelInTestProviders) {
				return true;
			}
		}
		if (specifiedModels) {
			const modelInTestModels = modelMatchesAnyTestModel(
				model.id,
				model.providers as ProviderModelMapping[],
			);
			if (modelInTestModels) {
				return true;
			}
		}

		return false; // Otherwise, exclude free models in non-full mode
	})
	// Filter by TEST_MODELS or TEST_PROVIDERS if specified
	.filter((model) => {
		if (!specifiedModels && !specifiedProviders) {
			return true;
		}
		const expanded = expandAllProviderRegions(
			model.providers as ProviderModelMapping[],
		);
		return expanded.some((provider: ProviderModelMapping) => {
			if (specifiedProviders) {
				return specifiedProviders.includes(provider.providerId);
			}
			return matchesTestModel(provider.providerId, model.id, provider.region);
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
				providers: expandAllProviderRegions(
					model.providers as ProviderModelMapping[],
				).filter((provider: ProviderModelMapping) => provider.test !== "skip"),
			});
		}

		// Create entries for provider-specific requests using provider/model format
		// Expand regions so each provider:region combo becomes a separate test case
		const expandedProviders = expandAllProviderRegions(
			model.providers as ProviderModelMapping[],
		);
		for (const provider of expandedProviders) {
			// Skip deactivated provider mappings
			if (provider.deactivatedAt && new Date() > provider.deactivatedAt) {
				continue;
			}

			// Skip deprecated provider mappings
			if (provider.deprecatedAt && new Date() > provider.deprecatedAt) {
				continue;
			}

			// Filter by TEST_MODELS or TEST_PROVIDERS if specified
			if (specifiedModels || specifiedProviders) {
				if (specifiedProviders) {
					if (!specifiedProviders.includes(provider.providerId)) {
						continue;
					}
				} else {
					if (
						!matchesTestModel(provider.providerId, model.id, provider.region)
					) {
						continue;
					}
				}
				// TEST_MODELS/TEST_PROVIDERS takes precedence over test: "skip"
			} else {
				// Skip providers marked with test: "skip" (only when TEST_MODELS/TEST_PROVIDERS is not specified)
				if (provider.test === "skip") {
					continue;
				}

				// Skip providers whose required env vars aren't set (no creds to hit them)
				if (
					provider.test !== "only" &&
					!hasAllRequiredProviderEnvVars(provider.providerId)
				) {
					continue;
				}
			}

			// Skip unstable providers if not in full mode, unless they have test: "only" or are in TEST_MODELS/TEST_PROVIDERS
			if (
				(provider.stability === "unstable" ||
					provider.stability === "experimental") &&
				!fullMode
			) {
				// Allow if provider has test: "only"
				if (provider.test !== "only") {
					if (specifiedProviders) {
						if (!specifiedProviders.includes(provider.providerId)) {
							continue;
						}
					} else if (specifiedModels) {
						if (
							!matchesTestModel(provider.providerId, model.id, provider.region)
						) {
							continue;
						}
					} else {
						continue;
					}
				}
			}

			// If we have any "only" providers, skip those not marked as "only"
			if (hasOnlyModels && provider.test !== "only") {
				continue;
			}

			testCases.push({
				model: `${provider.providerId}/${provider.region ? provider.modelName : model.id}`,
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

		// Expand regions so each provider:region combo becomes a separate test case
		const expandedProviders = expandAllProviderRegions(
			model.providers as ProviderModelMapping[],
		);
		for (const provider of expandedProviders) {
			// Skip deactivated provider mappings
			if (provider.deactivatedAt && new Date() > provider.deactivatedAt) {
				continue;
			}

			// Skip deprecated provider mappings
			if (provider.deprecatedAt && new Date() > provider.deprecatedAt) {
				continue;
			}

			// Filter by TEST_MODELS or TEST_PROVIDERS if specified
			if (specifiedModels || specifiedProviders) {
				if (specifiedProviders) {
					if (!specifiedProviders.includes(provider.providerId)) {
						continue;
					}
				} else {
					if (
						!matchesTestModel(provider.providerId, model.id, provider.region)
					) {
						continue;
					}
				}
				// TEST_MODELS/TEST_PROVIDERS takes precedence over test: "skip"
			} else {
				// Skip providers marked with test: "skip" (only when TEST_MODELS/TEST_PROVIDERS is not specified)
				if (provider.test === "skip") {
					continue;
				}

				// Skip providers whose required env vars aren't set (no creds to hit them)
				if (
					provider.test !== "only" &&
					!hasAllRequiredProviderEnvVars(provider.providerId)
				) {
					continue;
				}

				// Skip unstable providers if not in full mode, unless they have test: "only"
				if (
					(provider.stability === "unstable" ||
						provider.stability === "experimental") &&
					!fullMode
				) {
					// Allow if provider has test: "only"
					if (provider.test !== "only") {
						continue;
					}
				}
			}

			// If we have any "only" providers, skip those not marked as "only"
			if (hasOnlyModels && provider.test !== "only") {
				continue;
			}

			testCases.push({
				model: `${provider.providerId}/${provider.region ? provider.modelName : model.id}`,
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

export const toolCallModels = testModels
	.filter((m) =>
		m.providers.some((p: ProviderModelMapping) => p.tools === true),
	)
	// Exclude novita/minimax-m2.1 due to model variability in tool calling
	.filter((m) => m.model !== "novita/minimax-m2.1");

export const streamingToolCallModels = toolCallModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
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

export const webSearchModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => p.webSearch === true),
);

export const streamingWebSearchModels = webSearchModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
);

export const jsonOutputModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => p.jsonOutput === true),
);

export const streamingJsonOutputModels = jsonOutputModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => {
		// Check model-level streaming first, then fall back to provider-level
		if (p.streaming !== undefined) {
			return p.streaming;
		}
		const provider = providers.find((pr) => pr.id === p.providerId);
		return provider?.streaming;
	}),
);

export const jsonSchemaOutputModels = testModels.filter((m) =>
	m.providers.some((p: ProviderModelMapping) => p.jsonOutputSchema === true),
);

export const streamingJsonSchemaOutputModels = jsonSchemaOutputModels.filter(
	(m) =>
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
	baseUrl?: string,
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
			baseUrl,
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
			billingEmail: "user@test.com",
			plan: "pro",
			retentionLevel: "retain",
			credits: "100",
		})
		.onConflictDoUpdate({
			target: tables.organization.id,
			set: {
				retentionLevel: "retain",
				plan: "pro",
				credits: "100",
			},
		});

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
		const baseUrlEnvName = (
			provider.env.required as Record<string, string | undefined>
		).baseUrl;
		const baseUrlValue = baseUrlEnvName
			? process.env[baseUrlEnvName]
			: undefined;
		if (envVarValue) {
			await createProviderKey(
				provider.id,
				envVarValue,
				"api-keys",
				baseUrlValue,
			);
			await createProviderKey(
				provider.id,
				envVarValue,
				"credits",
				baseUrlValue,
			);
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
