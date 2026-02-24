import { describe, it, expect, vi, beforeEach } from "vitest";

import { selectNextProvider } from "@/chat/tools/retry-with-fallback.js";

import { validateModelAccess, throwIamException, type IamRule } from "./iam.js";

import type { ModelDefinition } from "@llmgateway/models";

// Mock the cached-queries module so we can control IAM rules per test
vi.mock("@/lib/cached-queries.js", () => ({
	findActiveIamRules: vi.fn(),
}));

const mockCachedQueries = await import("@/lib/cached-queries.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(
	overrides: Partial<IamRule> & Pick<IamRule, "ruleType" | "ruleValue">,
) {
	return {
		id: overrides.id ?? "rule-1",
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-01"),
		apiKeyId: "key-1",
		status: "active" as const,
		...overrides,
	};
}

/**
 * A model with 3 providers – mirrors the Nano Banana pattern (google-vertex,
 * google-ai-studio, obsidian) but uses generic ids so the tests are self-contained.
 */
const threeProviderModel: ModelDefinition = {
	id: "test-model-3p",
	family: "test",
	providers: [
		{
			providerId: "google-vertex",
			modelName: "test-model-vertex",
			streaming: true,
			inputPrice: 0.5,
			outputPrice: 1.0,
		},
		{
			providerId: "google-ai-studio",
			modelName: "test-model-studio",
			streaming: true,
			inputPrice: 0.5,
			outputPrice: 1.0,
		},
		{
			providerId: "openai",
			modelName: "test-model-openai",
			streaming: true,
			inputPrice: 0.3,
			outputPrice: 0.6,
		},
	],
};

/**
 * A model where two of the three providers have been deactivated, leaving
 * only google-vertex active. This is the `activeModelInfo` that chat.ts
 * would pass after filtering deactivated providers.
 */
const singleActiveProviderModel: ModelDefinition = {
	id: "test-model-3p",
	family: "test",
	providers: [
		{
			providerId: "google-vertex",
			modelName: "test-model-vertex",
			streaming: true,
			inputPrice: 0.5,
			outputPrice: 1.0,
		},
	],
};

const freeModel: ModelDefinition = {
	id: "free-model",
	family: "test",
	free: true,
	providers: [
		{
			providerId: "openai",
			modelName: "free-model-openai",
			streaming: true,
		},
	],
};

const paidModel: ModelDefinition = {
	id: "paid-model",
	family: "test",
	providers: [
		{
			providerId: "openai",
			modelName: "paid-model-openai",
			streaming: true,
			inputPrice: 5.0,
			outputPrice: 15.0,
		},
		{
			providerId: "anthropic",
			modelName: "paid-model-anthropic",
			streaming: true,
			inputPrice: 3.0,
			outputPrice: 10.0,
		},
	],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	vi.clearAllMocks();
});

// ===========================
// No rules — backwards compat
// ===========================

describe("validateModelAccess — no IAM rules", () => {
	it("allows access and returns all providers when no rules exist", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
		expect(result.allowedProviders).toEqual(
			expect.arrayContaining(["google-vertex", "google-ai-studio", "openai"]),
		);
	});

	it("uses activeModelInfo providers (not global list) when provided", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([]);

		const result = await validateModelAccess(
			"key-1",
			singleActiveProviderModel.id,
			undefined,
			singleActiveProviderModel,
		);

		expect(result.allowed).toBe(true);
		expect(result.allowedProviders).toEqual(["google-vertex"]);
	});
});

// ===========================
// Model not found
// ===========================

describe("validateModelAccess — model not found", () => {
	it("denies access when model does not exist and no activeModelInfo provided", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([]);

		const result = await validateModelAccess("key-1", "nonexistent-model-xyz");

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("not found");
	});
});

// ===========================
// deny_providers
// ===========================

describe("validateModelAccess — deny_providers", () => {
	it("removes denied provider from allowed set", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
		expect(result.allowedProviders).not.toContain("google-vertex");
		expect(result.allowedProviders).toEqual(
			expect.arrayContaining(["google-ai-studio", "openai"]),
		);
	});

	it("denies access when all providers are denied", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_providers",
				ruleValue: {
					providers: ["google-vertex", "google-ai-studio", "openai"],
				},
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("denied providers list");
	});

	it("denies access when the only active provider is denied (deactivation scenario)", async () => {
		// This is the core Nano Banana bug: only google-vertex is active,
		// and the IAM rule denies google-vertex.
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			singleActiveProviderModel.id,
			undefined,
			singleActiveProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("denied providers list");
	});

	it("denies access when a specific requested provider is denied", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			"google-vertex",
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("denied providers list");
	});

	it("allows access when the specific requested provider is not denied", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			"openai",
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
	});
});

// ===========================
// allow_providers
// ===========================

describe("validateModelAccess — allow_providers", () => {
	it("restricts to only allowed providers", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_providers",
				ruleValue: { providers: ["openai"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
		expect(result.allowedProviders).toEqual(["openai"]);
	});

	it("denies when no model providers match the allow list", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_providers",
				ruleValue: { providers: ["anthropic"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("allowed providers list");
	});

	it("denies when the only active provider is not in the allow list (deactivation scenario)", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_providers",
				ruleValue: { providers: ["google-ai-studio", "openai"] },
			}),
		]);

		// Only google-vertex is active, but the allow list does not include it
		const result = await validateModelAccess(
			"key-1",
			singleActiveProviderModel.id,
			undefined,
			singleActiveProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("allowed providers list");
	});

	it("allows when the only active provider is in the allow list", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			singleActiveProviderModel.id,
			undefined,
			singleActiveProviderModel,
		);

		expect(result.allowed).toBe(true);
		expect(result.allowedProviders).toEqual(["google-vertex"]);
	});

	it("denies when specific requested provider is not in the allow list", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_providers",
				ruleValue: { providers: ["openai"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			"google-vertex",
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("allowed providers list");
	});

	it("allows when specific requested provider is in the allow list", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_providers",
				ruleValue: { providers: ["openai", "google-vertex"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			"openai",
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
	});
});

// ===========================
// allow_models / deny_models
// ===========================

describe("validateModelAccess — allow_models", () => {
	it("allows access when model is in the allowed list", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_models",
				ruleValue: { models: ["test-model-3p", "other-model"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
	});

	it("denies access when model is not in the allowed list", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_models",
				ruleValue: { models: ["other-model-only"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("not in the allowed models list");
	});
});

describe("validateModelAccess — deny_models", () => {
	it("denies access when model is in the denied list", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_models",
				ruleValue: { models: ["test-model-3p"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("denied models list");
	});

	it("allows access when model is not in the denied list", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_models",
				ruleValue: { models: ["some-other-model"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
	});
});

// ===========================
// allow_pricing / deny_pricing
// ===========================

describe("validateModelAccess — allow_pricing", () => {
	it("allows free model when pricingType is 'free'", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: { pricingType: "free" },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			freeModel.id,
			undefined,
			freeModel,
		);

		expect(result.allowed).toBe(true);
	});

	it("denies paid model when pricingType is 'free'", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: { pricingType: "free" },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			paidModel.id,
			undefined,
			paidModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("Only free models are allowed");
	});

	it("allows paid model when pricingType is 'paid'", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: { pricingType: "paid" },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			paidModel.id,
			undefined,
			paidModel,
		);

		expect(result.allowed).toBe(true);
	});

	it("denies free model when pricingType is 'paid'", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: { pricingType: "paid" },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			freeModel.id,
			undefined,
			freeModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("Only paid models are allowed");
	});

	it("denies when input price exceeds maxInputPrice", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: { maxInputPrice: 1.0 },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			paidModel.id,
			undefined,
			paidModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("input price exceeds maximum");
	});

	it("denies when output price exceeds maxOutputPrice", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: { maxOutputPrice: 5.0 },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			paidModel.id,
			undefined,
			paidModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("output price exceeds maximum");
	});

	it("allows when prices are within limits", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: { maxInputPrice: 10.0, maxOutputPrice: 20.0 },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			paidModel.id,
			undefined,
			paidModel,
		);

		expect(result.allowed).toBe(true);
	});

	it("checks price only for the requested provider", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: { maxInputPrice: 4.0 },
			}),
		]);

		// openai provider has inputPrice: 5.0 (exceeds), anthropic has 3.0 (ok)
		const resultDenied = await validateModelAccess(
			"key-1",
			paidModel.id,
			"openai",
			paidModel,
		);
		expect(resultDenied.allowed).toBe(false);

		const resultAllowed = await validateModelAccess(
			"key-1",
			paidModel.id,
			"anthropic",
			paidModel,
		);
		expect(resultAllowed.allowed).toBe(true);
	});
});

describe("validateModelAccess — deny_pricing", () => {
	it("denies free model when pricingType is 'free'", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_pricing",
				ruleValue: { pricingType: "free" },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			freeModel.id,
			undefined,
			freeModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("Free models are not allowed");
	});

	it("allows paid model when pricingType is 'free' is denied", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_pricing",
				ruleValue: { pricingType: "free" },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			paidModel.id,
			undefined,
			paidModel,
		);

		expect(result.allowed).toBe(true);
	});

	it("denies paid model when pricingType is 'paid'", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_pricing",
				ruleValue: { pricingType: "paid" },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			paidModel.id,
			undefined,
			paidModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("Paid models are not allowed");
	});

	it("allows free model when pricingType is 'paid' is denied", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_pricing",
				ruleValue: { pricingType: "paid" },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			freeModel.id,
			undefined,
			freeModel,
		);

		expect(result.allowed).toBe(true);
	});
});

// ===========================
// Multiple rules combined
// ===========================

describe("validateModelAccess — combined rules", () => {
	it("applies deny_providers then allow_providers sequentially", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				id: "rule-deny",
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
			makeRule({
				id: "rule-allow",
				ruleType: "allow_providers",
				ruleValue: { providers: ["openai"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
		// google-vertex removed by deny, then allow filters to openai only
		expect(result.allowedProviders).toEqual(["openai"]);
	});

	it("deny_models short-circuits before provider rules", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				id: "rule-deny-model",
				ruleType: "deny_models",
				ruleValue: { models: ["test-model-3p"] },
			}),
			makeRule({
				id: "rule-allow-provider",
				ruleType: "allow_providers",
				ruleValue: { providers: ["openai"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("denied models list");
	});

	it("allow_models + deny_providers: model allowed but all active providers denied", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				id: "rule-allow-model",
				ruleType: "allow_models",
				ruleValue: { models: ["test-model-3p"] },
			}),
			makeRule({
				id: "rule-deny-provider",
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
		]);

		// Only google-vertex is active; it's denied
		const result = await validateModelAccess(
			"key-1",
			singleActiveProviderModel.id,
			undefined,
			singleActiveProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("denied providers list");
	});

	it("allow_pricing + deny_providers: pricing ok but provider denied", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				id: "rule-pricing",
				ruleType: "allow_pricing",
				ruleValue: { maxInputPrice: 10.0, maxOutputPrice: 20.0 },
			}),
			makeRule({
				id: "rule-deny",
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			singleActiveProviderModel.id,
			undefined,
			singleActiveProviderModel,
		);

		expect(result.allowed).toBe(false);
	});

	it("multiple deny_providers rules are cumulative", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				id: "rule-deny-1",
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
			makeRule({
				id: "rule-deny-2",
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-ai-studio"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
		// Only openai remains
		expect(result.allowedProviders).toEqual(["openai"]);
	});

	it("multiple deny_providers rules deny all providers cumulatively", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				id: "rule-deny-1",
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
			makeRule({
				id: "rule-deny-2",
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-ai-studio"] },
			}),
			makeRule({
				id: "rule-deny-3",
				ruleType: "deny_providers",
				ruleValue: { providers: ["openai"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
	});
});

// ===========================
// Error message formatting
// ===========================

describe("validateModelAccess — error messages", () => {
	it("includes rule ID in denial reason", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				id: "iam-rule-42",
				ruleType: "deny_models",
				ruleValue: { models: ["test-model-3p"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain("Rule ID: iam-rule-42");
	});

	it("includes dashboard guidance in denial reason", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_providers",
				ruleValue: { providers: ["google-vertex"] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			singleActiveProviderModel.id,
			undefined,
			singleActiveProviderModel,
		);

		expect(result.allowed).toBe(false);
		expect(result.reason).toContain(
			"Adapt your LLMGateway API key IAM permissions",
		);
	});
});

// ===========================
// throwIamException
// ===========================

describe("throwIamException", () => {
	it("throws HTTPException with 403 status", () => {
		expect(() => throwIamException("test reason")).toThrow();
		try {
			throwIamException("test reason");
		} catch (e: unknown) {
			const err = e as { status: number; message: string };
			expect(err.status).toBe(403);
			expect(err.message).toContain("Access denied: test reason");
		}
	});
});

// ===========================
// selectNextProvider with IAM-filtered model providers
// ===========================

describe("selectNextProvider — IAM-filtered providers", () => {
	// Tests the integration pattern used in chat.ts where modelProviders
	// is pre-filtered by IAM rules (iamFilteredModelProviders)

	it("never selects a provider not in the IAM-filtered list", () => {
		// Simulate IAM filtering: only openai is allowed
		const iamFilteredProviders = [
			{ providerId: "openai", modelName: "test-model-openai" },
		];

		const providerScores = [
			{ providerId: "google-vertex", score: 0.1 }, // best score but not in filtered list
			{ providerId: "google-ai-studio", score: 0.2 },
			{ providerId: "openai", score: 0.9 }, // worst score but only allowed
		];

		const result = selectNextProvider(
			providerScores,
			new Set<string>(),
			iamFilteredProviders,
		);

		expect(result).toEqual({
			providerId: "openai",
			modelName: "test-model-openai",
		});
	});

	it("returns null when the only scored providers are IAM-denied", () => {
		// IAM allows only openai, but only google providers are scored
		const iamFilteredProviders = [
			{ providerId: "openai", modelName: "test-model-openai" },
		];

		const providerScores = [
			{ providerId: "google-vertex", score: 0.1 },
			{ providerId: "google-ai-studio", score: 0.2 },
		];

		const result = selectNextProvider(
			providerScores,
			new Set<string>(),
			iamFilteredProviders,
		);

		expect(result).toBeNull();
	});

	it("skips IAM-denied providers even when they have the best score", () => {
		// IAM denies google-vertex
		const iamFilteredProviders = [
			{ providerId: "google-ai-studio", modelName: "test-model-studio" },
			{ providerId: "openai", modelName: "test-model-openai" },
		];

		const providerScores = [
			{ providerId: "google-vertex", score: 0.05 }, // best but denied
			{ providerId: "google-ai-studio", score: 0.3 },
			{ providerId: "openai", score: 0.5 },
		];

		const result = selectNextProvider(
			providerScores,
			new Set<string>(),
			iamFilteredProviders,
		);

		expect(result).toEqual({
			providerId: "google-ai-studio",
			modelName: "test-model-studio",
		});
	});

	it("handles both IAM filtering and failed providers together", () => {
		// IAM denies google-vertex; google-ai-studio has failed
		const iamFilteredProviders = [
			{ providerId: "google-ai-studio", modelName: "test-model-studio" },
			{ providerId: "openai", modelName: "test-model-openai" },
		];
		const failedProviders = new Set(["google-ai-studio"]);

		const providerScores = [
			{ providerId: "google-vertex", score: 0.1 },
			{ providerId: "google-ai-studio", score: 0.2 },
			{ providerId: "openai", score: 0.5 },
		];

		const result = selectNextProvider(
			providerScores,
			failedProviders,
			iamFilteredProviders,
		);

		expect(result).toEqual({
			providerId: "openai",
			modelName: "test-model-openai",
		});
	});

	it("returns null when all providers are either IAM-denied or failed", () => {
		// IAM denies google-vertex; openai and google-ai-studio have failed
		const iamFilteredProviders = [
			{ providerId: "google-ai-studio", modelName: "test-model-studio" },
			{ providerId: "openai", modelName: "test-model-openai" },
		];
		const failedProviders = new Set(["google-ai-studio", "openai"]);

		const providerScores = [
			{ providerId: "google-vertex", score: 0.1 },
			{ providerId: "google-ai-studio", score: 0.2 },
			{ providerId: "openai", score: 0.5 },
		];

		const result = selectNextProvider(
			providerScores,
			failedProviders,
			iamFilteredProviders,
		);

		expect(result).toBeNull();
	});

	it("with empty IAM-filtered list returns null (all providers denied)", () => {
		const iamFilteredProviders: Array<{
			providerId: string;
			modelName: string;
		}> = [];

		const providerScores = [
			{ providerId: "google-vertex", score: 0.1 },
			{ providerId: "openai", score: 0.5 },
		];

		const result = selectNextProvider(
			providerScores,
			new Set<string>(),
			iamFilteredProviders,
		);

		expect(result).toBeNull();
	});
});

// ===========================
// Edge cases: rules with empty/undefined ruleValue fields
// ===========================

describe("validateModelAccess — edge cases", () => {
	it("deny_providers with empty providers array is a no-op", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_providers",
				ruleValue: { providers: [] },
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
		expect(result.allowedProviders).toEqual(
			expect.arrayContaining(["google-vertex", "google-ai-studio", "openai"]),
		);
	});

	it("allow_models with undefined models field is a no-op", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_models",
				ruleValue: {},
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
	});

	it("deny_models with undefined models field is a no-op", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_models",
				ruleValue: {},
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
	});

	it("deny_providers with undefined providers field is a no-op", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "deny_providers",
				ruleValue: {},
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			threeProviderModel.id,
			undefined,
			threeProviderModel,
		);

		expect(result.allowed).toBe(true);
	});

	it("allow_pricing with undefined pricingType and no price limits is a no-op", async () => {
		vi.mocked(mockCachedQueries.findActiveIamRules).mockResolvedValue([
			makeRule({
				ruleType: "allow_pricing",
				ruleValue: {},
			}),
		]);

		const result = await validateModelAccess(
			"key-1",
			paidModel.id,
			undefined,
			paidModel,
		);

		expect(result.allowed).toBe(true);
	});
});
