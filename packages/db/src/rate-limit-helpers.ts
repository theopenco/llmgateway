import { and, eq, isNull, or } from "drizzle-orm";

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
	enforcement: "per_org" | "global";
}

/**
 * Result of rate limit lookup with precedence information.
 *
 * `rpmShared`/`rpdShared` are true when the matched limit is a global row
 * (organizationId = null) configured for shared enforcement, meaning the
 * counter is shared across all orgs rather than bucketed per-org.
 *
 * For shared limits, `rpmProvider`/`rpmModel` (and the rpd equivalents) carry
 * the matched row's target so callers can key the shared counter by what the
 * limit actually covers — `null` means the row left that dimension as a
 * wildcard (all providers / all models). They are undefined for non-shared
 * limits, which are keyed per request.
 */
export interface EffectiveRateLimit {
	maxRpm: number;
	maxRpd: number;
	rpmSource: RateLimitSource;
	rpdSource: RateLimitSource;
	rpmRateLimitId?: string;
	rpdRateLimitId?: string;
	rpmShared?: boolean;
	rpdShared?: boolean;
	rpmProvider?: string | null;
	rpmModel?: string | null;
	rpdProvider?: string | null;
	rpdModel?: string | null;
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
): {
	limit: number;
	source: RateLimitSource;
	rateLimitId?: string;
	shared: boolean;
	provider: string | null;
	model: string | null;
} {
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
				shared: match.organizationId === null && match.enforcement === "global",
				provider: match.provider,
				model: match.model,
			};
		}
	}

	return {
		limit: 0,
		source: "none",
		shared: false,
		provider: null,
		model: null,
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
	const rateLimits = await db
		.select({
			id: rateLimitTable.id,
			organizationId: rateLimitTable.organizationId,
			provider: rateLimitTable.provider,
			model: rateLimitTable.model,
			maxRpm: rateLimitTable.maxRpm,
			maxRpd: rateLimitTable.maxRpd,
			enforcement: rateLimitTable.enforcement,
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
		rpmShared: rpm.shared,
		rpdShared: rpd.shared,
		rpmProvider: rpm.shared ? rpm.provider : undefined,
		rpmModel: rpm.shared ? rpm.model : undefined,
		rpdProvider: rpd.shared ? rpd.provider : undefined,
		rpdModel: rpd.shared ? rpd.model : undefined,
	};
}
