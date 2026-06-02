import { and, eq, gte, isNull, or } from "drizzle-orm";

import { logger } from "@llmgateway/logger";

import { cdb } from "./cdb.js";
import { discount as discountTable } from "./schema.js";

/**
 * Result of discount lookup with precedence information
 */
export interface EffectiveDiscount {
	/** The discount value as a decimal-safe string (0-1, where "0.3" = 30% off) */
	discount: string;
	/** Source of the discount for debugging */
	source:
		| "org_provider_model"
		| "org_provider"
		| "org_model"
		| "global_provider_model"
		| "global_provider"
		| "global_model"
		| "hardcoded"
		| "none";
	/** The discount record ID if from database */
	discountId?: string;
}

/**
 * Get the effective discount for a given organization, provider, and model.
 * Uses the cached database client (cdb) which has Drizzle's cache layer.
 *
 * Precedence (highest to lowest):
 * 1. Org + Provider + Model discount
 * 2. Org + Provider discount (all models)
 * 3. Org + Model discount (all providers)
 * 4. Global + Provider + Model discount
 * 5. Global + Provider discount
 * 6. Global + Model discount
 * 7. Hardcoded model discount (fallback)
 *
 * Discounts are always keyed by the root model ID — provider-specific model
 * names are reserved for upstream requests and are never persisted as a
 * discount target.
 *
 * @param organizationId - The organization ID (null for global only)
 * @param provider - The provider ID
 * @param model - The root model ID (e.g., "gpt-4o-mini")
 * @param hardcodedDiscount - The hardcoded discount from model definition (0-1)
 * @returns The effective discount to apply
 */
export async function getEffectiveDiscount(
	organizationId: string | null,
	provider: string,
	model: string,
	hardcodedDiscount: string = "0",
): Promise<EffectiveDiscount> {
	try {
		const now = new Date();

		const notExpiredCondition = or(
			isNull(discountTable.expiresAt),
			gte(discountTable.expiresAt, now),
		);

		const discounts = await cdb
			.select({
				id: discountTable.id,
				organizationId: discountTable.organizationId,
				provider: discountTable.provider,
				model: discountTable.model,
				discountPercent: discountTable.discountPercent,
			})
			.from(discountTable)
			.where(
				and(
					notExpiredCondition,
					or(
						isNull(discountTable.organizationId),
						organizationId
							? eq(discountTable.organizationId, organizationId)
							: isNull(discountTable.organizationId),
					),
					or(
						eq(discountTable.provider, provider),
						isNull(discountTable.provider),
					),
					or(eq(discountTable.model, model), isNull(discountTable.model)),
				),
			);

		const modelMatches = (discountModel: string | null): boolean =>
			discountModel !== null && discountModel === model;

		// Find highest precedence discount
		// Order: org-specific > global, more specific > less specific

		// 1. Org + Provider + Model
		if (organizationId) {
			const orgProviderModel = discounts.find(
				(d) =>
					d.organizationId === organizationId &&
					d.provider === provider &&
					modelMatches(d.model),
			);
			if (orgProviderModel) {
				return {
					discount: orgProviderModel.discountPercent,
					source: "org_provider_model",
					discountId: orgProviderModel.id,
				};
			}

			// 2. Org + Provider (any model)
			const orgProvider = discounts.find(
				(d) =>
					d.organizationId === organizationId &&
					d.provider === provider &&
					d.model === null,
			);
			if (orgProvider) {
				return {
					discount: orgProvider.discountPercent,
					source: "org_provider",
					discountId: orgProvider.id,
				};
			}

			// 3. Org + Model (any provider)
			const orgModel = discounts.find(
				(d) =>
					d.organizationId === organizationId &&
					d.provider === null &&
					modelMatches(d.model),
			);
			if (orgModel) {
				return {
					discount: orgModel.discountPercent,
					source: "org_model",
					discountId: orgModel.id,
				};
			}
		}

		// 4. Global + Provider + Model
		const globalProviderModel = discounts.find(
			(d) =>
				d.organizationId === null &&
				d.provider === provider &&
				modelMatches(d.model),
		);
		if (globalProviderModel) {
			return {
				discount: globalProviderModel.discountPercent,
				source: "global_provider_model",
				discountId: globalProviderModel.id,
			};
		}

		// 5. Global + Provider (any model)
		const globalProvider = discounts.find(
			(d) =>
				d.organizationId === null &&
				d.provider === provider &&
				d.model === null,
		);
		if (globalProvider) {
			return {
				discount: globalProvider.discountPercent,
				source: "global_provider",
				discountId: globalProvider.id,
			};
		}

		// 6. Global + Model (any provider)
		const globalModel = discounts.find(
			(d) =>
				d.organizationId === null &&
				d.provider === null &&
				modelMatches(d.model),
		);
		if (globalModel) {
			return {
				discount: globalModel.discountPercent,
				source: "global_model",
				discountId: globalModel.id,
			};
		}

		// 7. Fall back to hardcoded discount
		if (Number(hardcodedDiscount) > 0) {
			return {
				discount: hardcodedDiscount,
				source: "hardcoded",
			};
		}

		return {
			discount: "0",
			source: "none",
		};
	} catch (error) {
		logger.error("Error fetching effective discount:", error as Error);
		// On error, fall back to hardcoded discount
		return {
			discount: hardcodedDiscount,
			source: "hardcoded",
		};
	}
}
