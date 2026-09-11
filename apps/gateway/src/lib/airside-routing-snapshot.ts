import { logger } from "@llmgateway/logger";

import { findAirsideRoutingSettings } from "./cached-queries.js";

export interface AirsideRoutingSnapshot {
	providerMarginPercent: number | null;
	providerDiscountPercent: number | null;
}

export async function getAirsideRoutingSnapshot(
	provider: string,
	model?: string,
): Promise<AirsideRoutingSnapshot> {
	try {
		const settings = await findAirsideRoutingSettings(provider, model);
		return {
			providerMarginPercent: settings?.marginPercent ?? null,
			providerDiscountPercent: settings?.discountPercent ?? null,
		};
	} catch (error) {
		logger.error(
			"Failed to snapshot Airside routing settings",
			error instanceof Error ? error : new Error(String(error)),
		);
		return {
			providerMarginPercent: null,
			providerDiscountPercent: null,
		};
	}
}
