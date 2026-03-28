import { and, eq, isNull, or } from "drizzle-orm";

import { logger } from "@llmgateway/logger";

import { db } from "./db.js";
import { rateLimit as rateLimitTable } from "./schema.js";

/**
 * Result of rate limit lookup with precedence information
 */
export interface EffectiveRateLimit {
	/** The max RPM value */
	maxRpm: number;
	/** Source of the rate limit for debugging */
	source:
		| "org_provider_model"
		| "org_provider"
		| "org_model"
		| "global_provider_model"
		| "global_provider"
		| "global_model"
		| "none";
	/** The rate limit record ID if from database */
	rateLimitId?: string;
}

/**
 * Get the effective rate limit for a given organization, provider, and model.
 * Uses the uncached database client so admin changes take effect immediately.
 *
 * Precedence (highest to lowest):
 * 1. Org + Provider + Model rate limit (checks both root model ID and provider model name)
 * 2. Org + Provider rate limit (all models)
 * 3. Org + Model rate limit (all providers)
 * 4. Global + Provider + Model rate limit (checks both root model ID and provider model name)
 * 5. Global + Provider rate limit
 * 6. Global + Model rate limit
 *
 * @param organizationId - The organization ID (null for global only)
 * @param provider - The provider ID
 * @param model - The root model ID (e.g., "gpt-4o-mini")
 * @param providerModelName - The provider-specific model name (e.g., "gpt-4o-mini-2024-07-18")
 * @returns The effective rate limit to apply, or null if none
 */
export async function getEffectiveRateLimit(
	organizationId: string | null,
	provider: string,
	model: string,
	providerModelName?: string,
): Promise<EffectiveRateLimit> {
	try {
		// Build model matching condition - match either root model ID or provider model name
		const modelConditions = [eq(rateLimitTable.model, model)];
		if (providerModelName && providerModelName !== model) {
			modelConditions.push(eq(rateLimitTable.model, providerModelName));
		}

		// Query all potentially matching rate limits
		const rateLimits = await db
			.select({
				id: rateLimitTable.id,
				organizationId: rateLimitTable.organizationId,
				provider: rateLimitTable.provider,
				model: rateLimitTable.model,
				maxRpm: rateLimitTable.maxRpm,
			})
			.from(rateLimitTable)
			.where(
				and(
					// Either global (null org) or specific org
					or(
						isNull(rateLimitTable.organizationId),
						organizationId
							? eq(rateLimitTable.organizationId, organizationId)
							: isNull(rateLimitTable.organizationId),
					),
					// Either matches provider or is null (all providers)
					or(
						eq(rateLimitTable.provider, provider),
						isNull(rateLimitTable.provider),
					),
					// Either matches model (root ID or provider model name) or is null (all models)
					or(...modelConditions, isNull(rateLimitTable.model)),
				),
			);

		// Helper to check if a rate limit's model matches
		const modelMatches = (rateLimitModel: string | null): boolean => {
			if (rateLimitModel === null) {
				return false;
			}
			if (rateLimitModel === model) {
				return true;
			}
			if (providerModelName && rateLimitModel === providerModelName) {
				return true;
			}
			return false;
		};

		// Find highest precedence rate limit
		// 1. Org + Provider + Model
		if (organizationId) {
			const orgProviderModel = rateLimits.find(
				(r) =>
					r.organizationId === organizationId &&
					r.provider === provider &&
					modelMatches(r.model),
			);
			if (orgProviderModel) {
				return {
					maxRpm: orgProviderModel.maxRpm,
					source: "org_provider_model",
					rateLimitId: orgProviderModel.id,
				};
			}

			// 2. Org + Provider (any model)
			const orgProvider = rateLimits.find(
				(r) =>
					r.organizationId === organizationId &&
					r.provider === provider &&
					r.model === null,
			);
			if (orgProvider) {
				return {
					maxRpm: orgProvider.maxRpm,
					source: "org_provider",
					rateLimitId: orgProvider.id,
				};
			}

			// 3. Org + Model (any provider)
			const orgModel = rateLimits.find(
				(r) =>
					r.organizationId === organizationId &&
					r.provider === null &&
					modelMatches(r.model),
			);
			if (orgModel) {
				return {
					maxRpm: orgModel.maxRpm,
					source: "org_model",
					rateLimitId: orgModel.id,
				};
			}
		}

		// 4. Global + Provider + Model
		const globalProviderModel = rateLimits.find(
			(r) =>
				r.organizationId === null &&
				r.provider === provider &&
				modelMatches(r.model),
		);
		if (globalProviderModel) {
			return {
				maxRpm: globalProviderModel.maxRpm,
				source: "global_provider_model",
				rateLimitId: globalProviderModel.id,
			};
		}

		// 5. Global + Provider (any model)
		const globalProvider = rateLimits.find(
			(r) =>
				r.organizationId === null &&
				r.provider === provider &&
				r.model === null,
		);
		if (globalProvider) {
			return {
				maxRpm: globalProvider.maxRpm,
				source: "global_provider",
				rateLimitId: globalProvider.id,
			};
		}

		// 6. Global + Model (any provider)
		const globalModel = rateLimits.find(
			(r) =>
				r.organizationId === null &&
				r.provider === null &&
				modelMatches(r.model),
		);
		if (globalModel) {
			return {
				maxRpm: globalModel.maxRpm,
				source: "global_model",
				rateLimitId: globalModel.id,
			};
		}

		return {
			maxRpm: 0,
			source: "none",
		};
	} catch (error) {
		logger.error("Error fetching effective rate limit:", error as Error);
		return {
			maxRpm: 0,
			source: "none",
		};
	}
}
