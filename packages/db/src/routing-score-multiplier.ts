import { and, eq, getTableName, isNull, or } from "drizzle-orm";

import { swrWrap } from "@llmgateway/cache";

import { computeAirsideAdjustment } from "./airside-routing.js";
import { cdb } from "./cdb.js";
import {
	providerRoutingSettings as providerRoutingSettingsTable,
	routingScoreMultiplier as routingScoreMultiplierTable,
} from "./schema.js";

const providerRoutingSettingsTableName = getTableName(
	providerRoutingSettingsTable,
);
const routingScoreMultiplierTableName = getTableName(
	routingScoreMultiplierTable,
);

export interface EffectiveRoutingScoreMultiplier {
	scoreMultiplier: string;
	source: "provider_model" | "provider" | "model" | "none";
	multiplierId?: string;
}

/** Approved carrier discounts and margins, with model overrides. */
export async function getAirsideRoutingSettings(
	provider: string,
	model?: string,
): Promise<{ discountPercent: number; marginPercent: number } | null> {
	const rows = await swrWrap(
		`airsideRouting:${JSON.stringify([provider, model])}`,
		[providerRoutingSettingsTableName],
		async () =>
			await cdb
				.select({
					modelId: providerRoutingSettingsTable.modelId,
					discountPercent: providerRoutingSettingsTable.discountPercent,
					marginPercent: providerRoutingSettingsTable.marginPercent,
				})
				.from(providerRoutingSettingsTable)
				.where(
					and(
						eq(providerRoutingSettingsTable.providerId, provider),
						model
							? or(
									eq(providerRoutingSettingsTable.modelId, model),
									isNull(providerRoutingSettingsTable.modelId),
								)
							: isNull(providerRoutingSettingsTable.modelId),
					),
				),
	);
	const row =
		(model
			? rows.find((candidate) => candidate.modelId === model)
			: undefined) ?? rows.find((candidate) => candidate.modelId === null);
	if (!row) {
		return null;
	}
	return {
		discountPercent: Number(row.discountPercent),
		marginPercent: Number(row.marginPercent),
	};
}

export async function getAirsideRoutingAdjustment(
	provider: string,
	model?: string,
): Promise<number> {
	const settings = await getAirsideRoutingSettings(provider, model);
	if (!settings) {
		return 0;
	}
	return computeAirsideAdjustment(
		// The customer discount is already included in the selection price.
		0,
		settings.marginPercent,
	);
}

export async function getEffectiveRoutingScoreMultiplier(
	provider: string,
	model: string,
): Promise<EffectiveRoutingScoreMultiplier> {
	return await swrWrap(
		`routingScoreMultiplier:${provider}:${model}`,
		[routingScoreMultiplierTableName],
		async () => {
			const rows = await cdb
				.select({
					id: routingScoreMultiplierTable.id,
					provider: routingScoreMultiplierTable.provider,
					model: routingScoreMultiplierTable.model,
					scoreMultiplier: routingScoreMultiplierTable.scoreMultiplier,
					expiresAt: routingScoreMultiplierTable.expiresAt,
				})
				.from(routingScoreMultiplierTable)
				.where(
					and(
						or(
							eq(routingScoreMultiplierTable.provider, provider),
							isNull(routingScoreMultiplierTable.provider),
						),
						or(
							eq(routingScoreMultiplierTable.model, model),
							isNull(routingScoreMultiplierTable.model),
						),
					),
				);

			const now = Date.now();
			const multipliers = rows.filter(
				(row) =>
					row.expiresAt === null || new Date(row.expiresAt).getTime() >= now,
			);
			const providerModel = multipliers.find(
				(row) => row.provider === provider && row.model === model,
			);
			if (providerModel) {
				return {
					scoreMultiplier: providerModel.scoreMultiplier,
					source: "provider_model" as const,
					multiplierId: providerModel.id,
				};
			}

			const providerOnly = multipliers.find(
				(row) => row.provider === provider && row.model === null,
			);
			if (providerOnly) {
				return {
					scoreMultiplier: providerOnly.scoreMultiplier,
					source: "provider" as const,
					multiplierId: providerOnly.id,
				};
			}

			const modelOnly = multipliers.find(
				(row) => row.provider === null && row.model === model,
			);
			if (modelOnly) {
				return {
					scoreMultiplier: modelOnly.scoreMultiplier,
					source: "model" as const,
					multiplierId: modelOnly.id,
				};
			}

			return { scoreMultiplier: "0", source: "none" as const };
		},
	);
}

/**
 * Signed routing-price adjustment used in provider election: the admin
 * prioritization multiplier plus the carrier's Airside margin adjustment
 * (-0.3 routes the mapping as if it cost 0.7x its price).
 */
export async function getRoutingScoreAdjustment(
	provider: string,
	model: string,
): Promise<string> {
	const [multiplier, airsideAdjustment] = await Promise.all([
		getEffectiveRoutingScoreMultiplier(provider, model),
		getAirsideRoutingAdjustment(provider, model),
	]);
	return String(Number(multiplier.scoreMultiplier) + airsideAdjustment);
}
