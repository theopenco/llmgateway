import { getOrganizationLifetimeSpend } from "@/lib/org-rate-limit.js";

import {
	DEFAULT_CONTENT_FILTER_SETTINGS,
	getContentFilterCategoryGroup,
	getContentFilterRuleGroup,
	getOrgContentFilterTier,
} from "@llmgateway/shared";
import { randomFloat } from "@llmgateway/shared/random";

import type { OpenAIModerationResult } from "./openai-content-filter.js";
import type {
	ContentFilterShadowVerdict,
	GatewayContentFilterEvaluation,
	InferSelectModel,
	tables,
} from "@llmgateway/db";
import type {
	ContentFilterBlockGroup,
	ContentFilterClassifier,
	ContentFilterInternalScope,
	ContentFilterLevel,
	ContentFilterSettings,
} from "@llmgateway/shared";

type Organization = InferSelectModel<typeof tables.organization>;

export type TieredContentFilterOrg = Pick<
	Organization,
	| "id"
	| "plan"
	| "kind"
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
	/** Classifiers that also score the request in the background, never blocking. */
	shadowClassifiers: ContentFilterClassifier[];
	/** What the internal classifier reads; ignored by the others. */
	internalScope: ContentFilterInternalScope;
	/** What OpenAI moderation reads of the text; ignored by the others. */
	openaiScope: ContentFilterInternalScope;
	/** Whether a text-only classifier delegates image parts to OpenAI. */
	moderateImages: boolean;
	/** Groups whose matches block; null blocks every match. */
	blockGroups: ContentFilterBlockGroup[] | null;
	/** `sexual/minors` score that matches `csam` at every level. */
	csamScoreThreshold: number;
}

export interface TieredContentFilterEvaluation {
	violation: boolean;
	flagged: boolean;
	matchedCategories: string[];
	matchedGroups: ContentFilterBlockGroup[];
	categoryScores: Record<string, number>;
}

const CSAM_CATEGORY = "sexual/minors";

const DEFAULT_STRICT_SCORE_THRESHOLD = 0.5;
const DEFAULT_LENIENT_SCORE_THRESHOLD = 0.9;
/** A request with many images can fail once per image; the stored row stays small. */
const MAX_STORED_MODERATION_ERRORS = 5;

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

function isSampled(ratePercent: number, random: () => number): boolean {
	if (ratePercent <= 0) {
		return false;
	}
	if (ratePercent >= 100) {
		return true;
	}
	return random() * 100 < ratePercent;
}

export function isContentFilterSampled(
	settings: ContentFilterSettings,
	random: () => number = randomFloat,
): boolean {
	return isSampled(settings.sampleRatePercent, random);
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
	// Optional: settings cached by an older release lack these fields.
	const providerEnforced =
		(settings.enforceProviderIds?.includes(providerId) ?? false) ||
		(organization.kind === "devpass" &&
			(settings.devPassEnforceProviderIds?.includes(providerId) ?? false));
	if (
		!settings.enabled ||
		(!providerEnforced && !settings.providerIds.includes(providerId))
	) {
		return null;
	}
	// A blocking provider blocks at its own rate; requests that miss it fall
	// back to log-only monitoring at the general rate.
	const blockingSampled =
		providerEnforced &&
		!settings.enforce &&
		isSampled(settings.enforceSampleRatePercent ?? 100, random);
	if (!blockingSampled && !isContentFilterSampled(settings, random)) {
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
	if (!settings.enforce && !blockingSampled) {
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
		// Optional: settings cached by the previous release lack this field.
		shadowClassifiers: [...new Set(settings.shadowClassifiers ?? [])].filter(
			(classifier) => classifier !== settings.classifier,
		),
		internalScope: settings.internalScope,
		// Optional: settings cached by the previous release lack this field.
		openaiScope:
			settings.openaiScope ?? DEFAULT_CONTENT_FILTER_SETTINGS.openaiScope,
		moderateImages: settings.moderateImages,
		// Optional: settings cached by the previous release lack these fields.
		blockGroups: settings.blockGroups ?? null,
		csamScoreThreshold:
			settings.csamScoreThreshold ??
			DEFAULT_CONTENT_FILTER_SETTINGS.csamScoreThreshold,
	};
}

/**
 * Apply the tier's thresholds to the raw moderation results. Strict honours
 * OpenAI's own `flagged` bit as well as the score threshold; lenient only
 * looks at scores. `sexual/minors` also matches above `csamScoreThreshold` at
 * either level. No results (moderation failed) never counts as a violation.
 */
export function evaluateTieredContentFilter(
	results: OpenAIModerationResult[],
	level: ContentFilterLevel,
	csamScoreThreshold: number = DEFAULT_CONTENT_FILTER_SETTINGS.csamScoreThreshold,
): TieredContentFilterEvaluation {
	const thresholds = getContentFilterScoreThresholds();
	const threshold = level === "strict" ? thresholds.strict : thresholds.lenient;
	const categoryScores: Record<string, number> = {};
	const matched = new Set<string>();
	const groups = new Set<ContentFilterBlockGroup>();
	let flagged = false;
	let resultViolation = false;

	const addGroup = (group: ContentFilterBlockGroup | null) => {
		if (group) {
			groups.add(group);
		}
	};

	for (const result of results) {
		const resultFlagged = result.flagged === true;
		if (resultFlagged) {
			flagged = true;
		}
		const resultMatched: string[] = [];
		for (const [category, score] of Object.entries(
			result.category_scores ?? {},
		)) {
			if (typeof score !== "number" || !Number.isFinite(score)) {
				continue;
			}
			categoryScores[category] = Math.max(categoryScores[category] ?? 0, score);
			if (
				score > threshold ||
				(category === CSAM_CATEGORY && score > csamScoreThreshold)
			) {
				matched.add(category);
				resultMatched.push(category);
			}
		}
		const strictFlag = level === "strict" && resultFlagged;
		if (resultMatched.length === 0 && !strictFlag) {
			continue;
		}
		resultViolation = true;
		// The internal classifier's tags all fire together on a block; only
		// its rules name what triggered it, so a block without one has no group.
		if (result.rules) {
			for (const rule of result.rules) {
				addGroup(getContentFilterRuleGroup(rule));
			}
			continue;
		}
		const flaggedCategories = strictFlag
			? Object.entries(result.categories ?? {})
					.filter(([, value]) => value === true)
					.map(([category]) => category)
			: [];
		for (const category of [...resultMatched, ...flaggedCategories]) {
			addGroup(getContentFilterCategoryGroup(category));
		}
	}

	return {
		violation: resultViolation,
		flagged,
		matchedCategories: [...matched],
		matchedGroups: [...groups],
		categoryScores,
	};
}

type ContentFilterRunBreakdown = Pick<
	GatewayContentFilterEvaluation,
	| "classifierDurationMs"
	| "classifierRequests"
	| "imageDurationMs"
	| "moderationErrors"
>;

function breakdownFields(breakdown: ContentFilterRunBreakdown) {
	return {
		...(breakdown.classifierDurationMs !== undefined
			? { classifierDurationMs: breakdown.classifierDurationMs }
			: {}),
		...(breakdown.classifierRequests !== undefined
			? { classifierRequests: breakdown.classifierRequests }
			: {}),
		...(breakdown.imageDurationMs !== undefined
			? { imageDurationMs: breakdown.imageDurationMs }
			: {}),
		...(breakdown.moderationErrors && breakdown.moderationErrors.length > 0
			? {
					moderationErrors: breakdown.moderationErrors.slice(
						0,
						MAX_STORED_MODERATION_ERRORS,
					),
				}
			: {}),
	};
}

/**
 * A shadow classifier's verdict, scored at the plan's level exactly as if it
 * had decided, so its flag rate compares with any run of the same classifier.
 */
export function buildContentFilterShadowVerdict(
	plan: TieredContentFilterPlan,
	classifier: ContentFilterClassifier,
	evaluation: TieredContentFilterEvaluation,
	moderationFailed: boolean,
	durationMs: number,
	breakdown: ContentFilterRunBreakdown = {},
): ContentFilterShadowVerdict {
	return {
		classifier,
		violation: evaluation.violation,
		flagged: evaluation.flagged,
		matchedCategories: evaluation.matchedCategories,
		matchedGroups: evaluation.matchedGroups,
		categoryScores: evaluation.categoryScores,
		moderationFailed,
		durationMs,
		...breakdownFields(breakdown),
		...(classifier === "internal" ? { internalScope: plan.internalScope } : {}),
	};
}

export function buildGatewayContentFilterEvaluation(
	plan: TieredContentFilterPlan,
	evaluation: TieredContentFilterEvaluation,
	moderationFailed: boolean,
	durationMs: number,
	breakdown: ContentFilterRunBreakdown = {},
): GatewayContentFilterEvaluation {
	// With block groups set, a violation outside them is only logged.
	const blocked =
		plan.enforce &&
		evaluation.violation &&
		(plan.blockGroups === null ||
			evaluation.matchedGroups.some((group) =>
				plan.blockGroups?.includes(group),
			));
	return {
		sampled: true,
		classifier: plan.classifier,
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
		matchedGroups: evaluation.matchedGroups,
		categoryScores: evaluation.categoryScores,
		moderationFailed,
		durationMs,
		...breakdownFields(breakdown),
		...(plan.classifier === "internal"
			? { internalScope: plan.internalScope }
			: {}),
	};
}
