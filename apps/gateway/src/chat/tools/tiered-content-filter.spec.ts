import { afterEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_CONTENT_FILTER_SETTINGS } from "@llmgateway/shared";

import {
	buildGatewayContentFilterEvaluation,
	evaluateTieredContentFilter,
	getLenientContentFilterScoreThreshold,
	getStrictContentFilterScoreThreshold,
	isContentFilterSampled,
	resolveTieredContentFilterPlan,
} from "./tiered-content-filter.js";

import type { OpenAIModerationResult } from "./openai-content-filter.js";

vi.mock("@/lib/org-rate-limit.js", () => ({
	getOrganizationLifetimeSpend: vi.fn(async () => 0),
}));

const NOW = Date.parse("2026-09-13T00:00:00Z");

function org(
	overrides: Partial<Parameters<typeof resolveTieredContentFilterPlan>[0]> = {},
) {
	return {
		id: "org-id",
		plan: "pro" as const,
		createdAt: new Date(NOW),
		trustTierOverride: null,
		contentFilterTierOverride: null,
		contentFilterLogOnly: false,
		...overrides,
	};
}

const enabledSettings = {
	...DEFAULT_CONTENT_FILTER_SETTINGS,
	providerIds: ["openai"],
};

describe("resolveTieredContentFilterPlan", () => {
	test("skips when disabled, when the provider is not enabled, or when not sampled", async () => {
		expect(
			await resolveTieredContentFilterPlan(org(), "openai", {
				...enabledSettings,
				enabled: false,
			}),
		).toBeNull();
		expect(
			await resolveTieredContentFilterPlan(org(), "anthropic", enabledSettings),
		).toBeNull();
		expect(
			await resolveTieredContentFilterPlan(
				org(),
				"openai",
				{ ...enabledSettings, sampleRatePercent: 0 },
				() => 0,
			),
		).toBeNull();
		expect(
			await resolveTieredContentFilterPlan(
				org(),
				"openai",
				{ ...enabledSettings, sampleRatePercent: 50 },
				() => 0.7,
			),
		).toBeNull();
	});

	test("is log-only by default and reports the inherited tier", async () => {
		expect(
			await resolveTieredContentFilterPlan(org(), "openai", enabledSettings),
		).toEqual({
			provider: "openai",
			tier: 0,
			overridden: false,
			level: "strict",
			enforce: false,
			exemptReason: "global_log_only",
		});
	});

	test("enforces when enabled globally, except for enterprise and log-only orgs", async () => {
		const enforcing = { ...enabledSettings, enforce: true };
		expect(
			await resolveTieredContentFilterPlan(org(), "openai", enforcing),
		).toMatchObject({ enforce: true });
		expect(
			await resolveTieredContentFilterPlan(
				org({ plan: "enterprise" }),
				"openai",
				enforcing,
			),
		).toMatchObject({ enforce: false, exemptReason: "enterprise" });
		expect(
			await resolveTieredContentFilterPlan(
				org({ plan: "enterprise" }),
				"openai",
				{ ...enforcing, enforceEnterprise: true },
			),
		).toMatchObject({ enforce: true });
		expect(
			await resolveTieredContentFilterPlan(
				org({ contentFilterLogOnly: true }),
				"openai",
				enforcing,
			),
		).toMatchObject({ enforce: false, exemptReason: "org_log_only" });
	});

	test("honours the content filter pin and the trust tier pin", async () => {
		expect(
			await resolveTieredContentFilterPlan(
				org({ trustTierOverride: 3 }),
				"openai",
				enabledSettings,
			),
		).toMatchObject({ tier: 3, overridden: false, level: "lenient" });
		expect(
			await resolveTieredContentFilterPlan(
				org({ trustTierOverride: 4, contentFilterTierOverride: 0 }),
				"openai",
				enabledSettings,
			),
		).toMatchObject({ tier: 0, overridden: true, level: "strict" });
	});
});

describe("isContentFilterSampled", () => {
	test("samples by rate", () => {
		expect(isContentFilterSampled(enabledSettings, () => 0.999)).toBe(true);
		expect(
			isContentFilterSampled(
				{ ...enabledSettings, sampleRatePercent: 25 },
				() => 0.2,
			),
		).toBe(true);
		expect(
			isContentFilterSampled(
				{ ...enabledSettings, sampleRatePercent: 25 },
				() => 0.3,
			),
		).toBe(false);
	});
});

describe("evaluateTieredContentFilter", () => {
	afterEach(() => {
		delete process.env.LLM_CONTENT_FILTER_TIER_STRICT_SCORE_THRESHOLD;
		delete process.env.LLM_CONTENT_FILTER_TIER_LENIENT_SCORE_THRESHOLD;
	});

	test("strict flags on the moderation flag alone", () => {
		expect(
			evaluateTieredContentFilter(
				[{ flagged: true, category_scores: { violence: 0.2 } }],
				"strict",
			),
		).toEqual({
			violation: true,
			flagged: true,
			matchedCategories: [],
			categoryScores: { violence: 0.2 },
		});
	});

	test("strict flags above 0.5, lenient only above 0.9", () => {
		const results: OpenAIModerationResult[] = [
			{ flagged: false, category_scores: { violence: 0.6, hate: 0.1 } },
			{ flagged: false, category_scores: { violence: 0.3, harassment: 0.55 } },
		];
		expect(evaluateTieredContentFilter(results, "strict")).toEqual({
			violation: true,
			flagged: false,
			matchedCategories: ["violence", "harassment"],
			categoryScores: { violence: 0.6, hate: 0.1, harassment: 0.55 },
		});
		expect(evaluateTieredContentFilter(results, "lenient")).toMatchObject({
			violation: false,
			matchedCategories: [],
		});
		expect(
			evaluateTieredContentFilter(
				[{ flagged: true, category_scores: { sexual: 0.95 } }],
				"lenient",
			),
		).toMatchObject({ violation: true, matchedCategories: ["sexual"] });
	});

	test("lenient ignores the moderation flag", () => {
		expect(
			evaluateTieredContentFilter(
				[{ flagged: true, category_scores: { violence: 0.6 } }],
				"lenient",
			),
		).toMatchObject({ violation: false, flagged: true });
	});

	test("no results never violates", () => {
		expect(evaluateTieredContentFilter([], "strict")).toEqual({
			violation: false,
			flagged: false,
			matchedCategories: [],
			categoryScores: {},
		});
	});

	test("inverted thresholds fall back to the defaults for both", () => {
		process.env.LLM_CONTENT_FILTER_TIER_STRICT_SCORE_THRESHOLD = "0.95";
		process.env.LLM_CONTENT_FILTER_TIER_LENIENT_SCORE_THRESHOLD = "0.5";
		expect(getStrictContentFilterScoreThreshold()).toBe(0.5);
		expect(getLenientContentFilterScoreThreshold()).toBe(0.9);
	});

	test("thresholds come from the environment when valid", () => {
		process.env.LLM_CONTENT_FILTER_TIER_STRICT_SCORE_THRESHOLD = "0.8";
		process.env.LLM_CONTENT_FILTER_TIER_LENIENT_SCORE_THRESHOLD = "2";
		expect(getStrictContentFilterScoreThreshold()).toBe(0.8);
		expect(getLenientContentFilterScoreThreshold()).toBe(0.9);
		expect(
			evaluateTieredContentFilter(
				[{ flagged: false, category_scores: { violence: 0.7 } }],
				"strict",
			),
		).toMatchObject({ violation: false });
	});
});

describe("buildGatewayContentFilterEvaluation", () => {
	const plan = {
		provider: "openai",
		tier: 1,
		overridden: false,
		level: "strict" as const,
		enforce: true,
	};
	const violation = {
		violation: true,
		flagged: true,
		matchedCategories: ["violence"],
		categoryScores: { violence: 0.9 },
	};

	test("marks enforced violations as blocked", () => {
		expect(buildGatewayContentFilterEvaluation(plan, violation, false)).toEqual(
			{
				sampled: true,
				provider: "openai",
				tier: 1,
				overridden: false,
				level: "strict",
				violation: true,
				action: "blocked",
				enforced: true,
				flagged: true,
				matchedCategories: ["violence"],
				categoryScores: { violence: 0.9 },
				moderationFailed: false,
			},
		);
	});

	test("marks log-only violations as logged and clean requests as passed", () => {
		expect(
			buildGatewayContentFilterEvaluation(
				{ ...plan, enforce: false, exemptReason: "global_log_only" },
				violation,
				false,
			),
		).toMatchObject({ action: "logged", exemptReason: "global_log_only" });
		expect(
			buildGatewayContentFilterEvaluation(
				plan,
				{ ...violation, violation: false, matchedCategories: [] },
				true,
			),
		).toMatchObject({ action: "passed", moderationFailed: true });
	});
});
