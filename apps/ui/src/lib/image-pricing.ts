import { isMappingDeactivated } from "@llmgateway/shared/deactivation";

import { applyDiscount } from "./discount";

import type { ApiModel, ApiModelProviderMapping } from "./fetch-models";

export interface ImageModelRow {
	id: string;
	name: string;
	family: string;
	providerCount: number;
	/** Lowest price of one generated image across active providers, in USD. */
	fromPrice: number | null;
}

function parsePrice(value: string | number | null | undefined): number | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Lowest price of one image on a mapping: its flat per-image tiers, its
 * image-output token price times the smallest resolution's token count, or
 * its flat request price. Null when the price depends on tokens alone.
 */
export function mappingImagePrice(
	mapping: Pick<
		ApiModelProviderMapping,
		| "perImagePrice"
		| "imageOutputPrice"
		| "imageOutputTokensByResolution"
		| "requestPrice"
		| "discount"
	>,
): number | null {
	const flat = Object.values(mapping.perImagePrice ?? {})
		.map(parsePrice)
		.filter((price): price is number => price !== null);
	if (flat.length > 0) {
		return applyDiscount(Math.min(...flat), mapping.discount);
	}
	const tokenPrice = parsePrice(mapping.imageOutputPrice);
	const tokens = Object.values(
		mapping.imageOutputTokensByResolution ?? {},
	).filter((count) => Number.isFinite(count) && count > 0);
	if (tokenPrice !== null && tokens.length > 0) {
		return applyDiscount(tokenPrice * Math.min(...tokens), mapping.discount);
	}
	// Image models billed per request charge that flat price for each image.
	const requestPrice = parsePrice(mapping.requestPrice);
	if (requestPrice !== null && requestPrice > 0) {
		return applyDiscount(requestPrice, mapping.discount);
	}
	return null;
}

/** Image models that can be routed today, cheapest first; unpriced ones last. */
export function buildImageModelRows(
	models: readonly ApiModel[],
	now: Date = new Date(),
): ImageModelRow[] {
	const rows: ImageModelRow[] = [];
	for (const model of models) {
		if (!model.output?.includes("image")) {
			continue;
		}
		const active = model.mappings.filter(
			(mapping) => !isMappingDeactivated(mapping, now),
		);
		if (active.length === 0) {
			continue;
		}
		const prices = active
			.map(mappingImagePrice)
			.filter((price): price is number => price !== null);
		rows.push({
			id: model.id,
			name: model.name ?? model.id,
			family: model.family,
			providerCount: new Set(active.map((mapping) => mapping.providerId)).size,
			fromPrice: prices.length > 0 ? Math.min(...prices) : null,
		});
	}
	return rows.sort((a, b) => {
		if (a.fromPrice === null || b.fromPrice === null) {
			if (a.fromPrice === b.fromPrice) {
				return a.name.localeCompare(b.name);
			}
			return a.fromPrice === null ? 1 : -1;
		}
		return a.fromPrice - b.fromPrice || a.name.localeCompare(b.name);
	});
}

export function formatImagePrice(price: number): string {
	return `$${parseFloat(price.toFixed(4))}`;
}
