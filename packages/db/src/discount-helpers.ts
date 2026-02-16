import { and, eq, gte, isNull, or } from "drizzle-orm";

import { logger } from "@llmgateway/logger";

import { cdb } from "./cdb.js";
import { discount as discountTable } from "./schema.js";

/**
 * Result of discount lookup with precedence information
 */
export interface EffectiveDiscount {
	/** The discount value (0-1, where 0.3 = 30% off) */
	discount: number;
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
 * 1. Org + Provider + Model discount (checks both root model ID and provider model name)
 * 2. Org + Provider discount (all models)
 * 3. Org + Model discount (all providers)
 * 4. Global + Provider + Model discount (checks both root model ID and provider model name)
 * 5. Global + Provider discount
 * 6. Global + Model discount
 * 7. Hardcoded model discount (fallback)
 *
 * @param organizationId - The organization ID (null for global only)
 * @param provider - The provider ID
 * @param model - The root model ID (e.g., "gpt-4o-mini")
 * @param hardcodedDiscount - The hardcoded discount from model definition (0-1)
 * @param providerModelName - The provider-specific model name (e.g., "gpt-4o-mini-2024-07-18")
 * @returns The effective discount to apply
 */
export async function getEffectiveDiscount(
	organizationId: string | null,
	provider: string,
	model: string,
	hardcodedDiscount = 0,
	providerModelName?: string,
): Promise<EffectiveDiscount> {
	try {
		const now = new Date();

		// Build conditions for non-expired discounts
		const notExpiredCondition = or(
			isNull(discountTable.expiresAt),
			gte(discountTable.expiresAt, now),
		);

		// Build model matching condition - match either root model ID or provider model name
		const modelConditions = [eq(discountTable.model, model)];
		if (providerModelName && providerModelName !== model) {
			modelConditions.push(eq(discountTable.model, providerModelName));
		}

		// Query all potentially matching discounts
		// We'll filter in code to determine precedence
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
					// Either global (null org) or specific org
					or(
						isNull(discountTable.organizationId),
						organizationId
							? eq(discountTable.organizationId, organizationId)
							: isNull(discountTable.organizationId),
					),
					// Either matches provider or is null (all providers)
					or(
						eq(discountTable.provider, provider),
						isNull(discountTable.provider),
					),
					// Either matches model (root ID or provider model name) or is null (all models)
					or(...modelConditions, isNull(discountTable.model)),
				),
			);

		// Helper to check if a discount's model matches (root ID or provider model name)
		const modelMatches = (discountModel: string | null): boolean => {
			if (discountModel === null) {
				return false;
			}
			if (discountModel === model) {
				return true;
			}
			if (providerModelName && discountModel === providerModelName) {
				return true;
			}
			return false;
		};

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
					discount: Number(orgProviderModel.discountPercent),
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
					discount: Number(orgProvider.discountPercent),
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
					discount: Number(orgModel.discountPercent),
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
				discount: Number(globalProviderModel.discountPercent),
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
				discount: Number(globalProvider.discountPercent),
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
				discount: Number(globalModel.discountPercent),
				source: "global_model",
				discountId: globalModel.id,
			};
		}

		// 7. Fall back to hardcoded discount
		if (hardcodedDiscount > 0) {
			return {
				discount: hardcodedDiscount,
				source: "hardcoded",
			};
		}

		return {
			discount: 0,
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
