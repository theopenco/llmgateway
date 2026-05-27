import { and, eq, isNull, or } from "drizzle-orm";

import { logger } from "@llmgateway/logger";

import { db } from "./db.js";
import { rateLimit as rateLimitTable } from "./schema.js";

export type RateLimitSource =
	| "org_provider_model"
	| "org_provider"
	| "org_model"
	| "global_provider_model"
	| "global_provider"
	| "global_model"
	| "none";

interface RateLimitMatch {
	id: string;
	organizationId: string | null;
	provider: string | null;
	model: string | null;
	maxRpm: number | null;
	maxRpd: number | null;
}

/**
 * Result of rate limit lookup with precedence information.
 */
export interface EffectiveRateLimit {
	maxRpm: number;
	maxRpd: number;
	rpmSource: RateLimitSource;
	rpdSource: RateLimitSource;
	rpmRateLimitId?: string;
	rpdRateLimitId?: string;
}

const rateLimitPrecedence: Array<{
	source: Exclude<RateLimitSource, "none">;
	matches: (
		rateLimit: RateLimitMatch,
		organizationId: string | null,
		provider: string,
		model: string,
	) => boolean;
}> = [
	{
		source: "org_provider_model",
		matches: (rateLimit, organizationId, provider, model) =>
			organizationId !== null &&
			rateLimit.organizationId === organizationId &&
			rateLimit.provider === provider &&
			rateLimit.model === model,
	},
	{
		source: "org_provider",
		matches: (rateLimit, organizationId, provider) =>
			organizationId !== null &&
			rateLimit.organizationId === organizationId &&
			rateLimit.provider === provider &&
			rateLimit.model === null,
	},
	{
		source: "org_model",
		matches: (rateLimit, organizationId, _provider, model) =>
			organizationId !== null &&
			rateLimit.organizationId === organizationId &&
			rateLimit.provider === null &&
			rateLimit.model === model,
	},
	{
		source: "global_provider_model",
		matches: (rateLimit, _organizationId, provider, model) =>
			rateLimit.organizationId === null &&
			rateLimit.provider === provider &&
			rateLimit.model === model,
	},
	{
		source: "global_provider",
		matches: (rateLimit, _organizationId, provider) =>
			rateLimit.organizationId === null &&
			rateLimit.provider === provider &&
			rateLimit.model === null,
	},
	{
		source: "global_model",
		matches: (rateLimit, _organizationId, _provider, model) =>
			rateLimit.organizationId === null &&
			rateLimit.provider === null &&
			rateLimit.model === model,
	},
];

function pickRateLimitByPrecedence(
	rateLimits: RateLimitMatch[],
	organizationId: string | null,
	provider: string,
	model: string,
	getLimitValue: (rateLimit: RateLimitMatch) => number | null,
): { limit: number; source: RateLimitSource; rateLimitId?: string } {
	for (const precedence of rateLimitPrecedence) {
		const match = rateLimits.find(
			(rateLimit) =>
				getLimitValue(rateLimit) !== null &&
				precedence.matches(rateLimit, organizationId, provider, model),
		);
		if (match) {
			return {
				limit: getLimitValue(match) ?? 0,
				source: precedence.source,
				rateLimitId: match.id,
			};
		}
	}

	return {
		limit: 0,
		source: "none",
	};
}

/**
 * Get the effective rate limits for a given organization, provider, and model.
 * Uses the uncached database client so admin changes take effect immediately.
 *
 * Rate limits are always keyed by the root model ID — provider-specific model
 * names are reserved for upstream requests and are never persisted as a
 * rate-limit target.
 *
 * Precedence (highest to lowest):
 * 1. Org + Provider + Model
 * 2. Org + Provider (all models)
 * 3. Org + Model (all providers)
 * 4. Global + Provider + Model
 * 5. Global + Provider
 * 6. Global + Model
 */
export async function getEffectiveRateLimit(
	organizationId: string | null,
	provider: string,
	model: string,
): Promise<EffectiveRateLimit> {
	try {
		const rateLimits = await db
			.select({
				id: rateLimitTable.id,
				organizationId: rateLimitTable.organizationId,
				provider: rateLimitTable.provider,
				model: rateLimitTable.model,
				maxRpm: rateLimitTable.maxRpm,
				maxRpd: rateLimitTable.maxRpd,
			})
			.from(rateLimitTable)
			.where(
				and(
					or(
						isNull(rateLimitTable.organizationId),
						organizationId
							? eq(rateLimitTable.organizationId, organizationId)
							: isNull(rateLimitTable.organizationId),
					),
					or(
						eq(rateLimitTable.provider, provider),
						isNull(rateLimitTable.provider),
					),
					or(eq(rateLimitTable.model, model), isNull(rateLimitTable.model)),
				),
			);

		const rpm = pickRateLimitByPrecedence(
			rateLimits,
			organizationId,
			provider,
			model,
			(rateLimit) => rateLimit.maxRpm,
		);
		const rpd = pickRateLimitByPrecedence(
			rateLimits,
			organizationId,
			provider,
			model,
			(rateLimit) => rateLimit.maxRpd,
		);

		return {
			maxRpm: rpm.limit,
			maxRpd: rpd.limit,
			rpmSource: rpm.source,
			rpdSource: rpd.source,
			rpmRateLimitId: rpm.rateLimitId,
			rpdRateLimitId: rpd.rateLimitId,
		};
	} catch (error) {
		logger.error("Error fetching effective rate limit:", error as Error);
		return {
			maxRpm: 0,
			maxRpd: 0,
			rpmSource: "none",
			rpdSource: "none",
		};
	}
}
