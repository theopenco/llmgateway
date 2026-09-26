import { getOrganizationLifetimeSpend } from "@/lib/org-rate-limit.js";

import { getOrgContentFilterTier } from "@llmgateway/shared";
import { randomFloat } from "@llmgateway/shared/random";

import type { OpenAIModerationResult } from "./openai-content-filter.js";
import type {
	GatewayContentFilterEvaluation,
	InferSelectModel,
	tables,
} from "@llmgateway/db";
import type {
	ContentFilterClassifier,
	ContentFilterLevel,
	ContentFilterSettings,
} from "@llmgateway/shared";

type Organization = InferSelectModel<typeof tables.organization>;

export type TieredContentFilterOrg = Pick<
	Organization,
	| "id"
	| "plan"
	| "createdAt"
	| "trustTierOverride"
	| "contentFilterTierOverride"
	| "contentFilterLogOnly"
>;

export interface TieredContentFilterPlan {
	provider: string;
	tier: number;
	overridden: boolean;
	level: ContentFilterLevel;
	enforce: boolean;
	exemptReason?: GatewayContentFilterEvaluation["exemptReason"];
	/** Classifier whose scores decide the outcome. */
	classifier: ContentFilterClassifier;
	/**
	 * Second classifier to run for comparison, or null when none is configured.
	 * Its verdict is recorded on the log and never changes the action.
	 */
	shadowClassifier: ContentFilterClassifier | null;
}

export interface TieredContentFilterEvaluation {
	violation: boolean;
	flagged: boolean;
	matchedCategories: string[];
	categoryScores: Record<string, number>;
}

const DEFAULT_STRICT_SCORE_THRESHOLD = 0.5;
const DEFAULT_LENIENT_SCORE_THRESHOLD = 0.9;

function getScoreThreshold(envName: string, fallback: number): number {
	const raw = process.env[envName];
	if (!raw || raw.trim() === "") {
		return fallback;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
		return fallback;
	}
	return parsed;
}

/**
 * Both thresholds, validated together: an env pair where strict exceeds
 * lenient would make lower tiers less restricted than higher ones, so it
 * falls back to the defaults for both.
 */
export function getContentFilterScoreThresholds(): {
	strict: number;
	lenient: number;
} {
	const strict = getScoreThreshold(
		"LLM_CONTENT_FILTER_TIER_STRICT_SCORE_THRESHOLD",
		DEFAULT_STRICT_SCORE_THRESHOLD,
	);
	const lenient = getScoreThreshold(
		"LLM_CONTENT_FILTER_TIER_LENIENT_SCORE_THRESHOLD",
		DEFAULT_LENIENT_SCORE_THRESHOLD,
	);
	if (strict > lenient) {
		return {
			strict: DEFAULT_STRICT_SCORE_THRESHOLD,
			lenient: DEFAULT_LENIENT_SCORE_THRESHOLD,
		};
	}
	return { strict, lenient };
}

export function getStrictContentFilterScoreThreshold(): number {
	return getContentFilterScoreThresholds().strict;
}

export function getLenientContentFilterScoreThreshold(): number {
	return getContentFilterScoreThresholds().lenient;
}

export function isContentFilterSampled(
	settings: ContentFilterSettings,
	random: () => number = randomFloat,
): boolean {
	if (settings.sampleRatePercent <= 0) {
		return false;
	}
	if (settings.sampleRatePercent >= 100) {
		return true;
	}
	return random() * 100 < settings.sampleRatePercent;
}

/**
 * Decide whether the tiered filter runs for this request and, if so, at which
 * tier and whether a violation may block. Null means the filter is skipped
 * entirely (no moderation call, no evaluation logged).
 */
export async function resolveTieredContentFilterPlan(
	organization: TieredContentFilterOrg,
	providerId: string,
	settings: ContentFilterSettings,
	random: () => number = randomFloat,
): Promise<TieredContentFilterPlan | null> {
	if (!settings.enabled || !settings.providerIds.includes(providerId)) {
		return null;
	}
	if (!isContentFilterSampled(settings, random)) {
		return null;
	}

	const pinned = organization.contentFilterTierOverride !== null;
	const lifetimeSpend = pinned
		? 0
		: await getOrganizationLifetimeSpend(organization.id);
	const { tier, overridden, level } = getOrgContentFilterTier(
		organization,
		lifetimeSpend,
	);

	let exemptReason: TieredContentFilterPlan["exemptReason"];
	if (!settings.enforce) {
		exemptReason = "global_log_only";
	} else if (
		organization.plan === "enterprise" &&
		!settings.enforceEnterprise
	) {
		exemptReason = "enterprise";
	} else if (organization.contentFilterLogOnly) {
		exemptReason = "org_log_only";
	}

	return {
		provider: providerId,
		tier,
		overridden,
		level,
		enforce: exemptReason === undefined,
		...(exemptReason ? { exemptReason } : {}),
		classifier: settings.classifier,
		// Shadowing a classifier with itself would just double the cost for an
		// identical verdict.
		shadowClassifier:
			settings.shadowClassifier === "none" ||
			settings.shadowClassifier === settings.classifier
				? null
				: settings.shadowClassifier,
	};
}

/**
 * Apply the tier's thresholds to the raw moderation results. Strict honours
 * OpenAI's own `flagged` bit as well as the score threshold; lenient only
 * looks at scores. No results (moderation failed) never counts as a violation.
 */
export function evaluateTieredContentFilter(
	results: OpenAIModerationResult[],
	level: ContentFilterLevel,
): TieredContentFilterEvaluation {
	const thresholds = getContentFilterScoreThresholds();
	const threshold = level === "strict" ? thresholds.strict : thresholds.lenient;
	const categoryScores: Record<string, number> = {};
	const matched = new Set<string>();
	let flagged = false;

	for (const result of results) {
		if (result.flagged === true) {
			flagged = true;
		}
		for (const [category, score] of Object.entries(
			result.category_scores ?? {},
		)) {
			if (typeof score !== "number" || !Number.isFinite(score)) {
				continue;
			}
			categoryScores[category] = Math.max(categoryScores[category] ?? 0, score);
			if (score > threshold) {
				matched.add(category);
			}
		}
	}

	const violation =
		matched.size > 0 || (level === "strict" && flagged && results.length > 0);

	return {
		violation,
		flagged,
		matchedCategories: [...matched],
		categoryScores,
	};
}

export function buildGatewayContentFilterEvaluation(
	plan: TieredContentFilterPlan,
	evaluation: TieredContentFilterEvaluation,
	moderationFailed: boolean,
	shadow?: {
		classifier: ContentFilterClassifier;
		evaluation: TieredContentFilterEvaluation;
		moderationFailed: boolean;
	},
): GatewayContentFilterEvaluation {
	const blocked = plan.enforce && evaluation.violation;
	return {
		sampled: true,
		classifier: plan.classifier,
		...(shadow
			? {
					shadow: {
						classifier: shadow.classifier,
						violation: shadow.evaluation.violation,
						flagged: shadow.evaluation.flagged,
						matchedCategories: shadow.evaluation.matchedCategories,
						categoryScores: shadow.evaluation.categoryScores,
						moderationFailed: shadow.moderationFailed,
						disagreed: shadow.evaluation.violation !== evaluation.violation,
					},
				}
			: {}),
		provider: plan.provider,
		tier: plan.tier,
		overridden: plan.overridden,
		level: plan.level,
		violation: evaluation.violation,
		action: blocked ? "blocked" : evaluation.violation ? "logged" : "passed",
		enforced: plan.enforce,
		...(plan.exemptReason ? { exemptReason: plan.exemptReason } : {}),
		flagged: evaluation.flagged,
		matchedCategories: evaluation.matchedCategories,
		categoryScores: evaluation.categoryScores,
		moderationFailed,
	};
}
