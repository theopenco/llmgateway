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
 * Lowest price of one request for one image on a mapping: its cheapest flat
 * per-image tier, or its image-output token price times the smallest
 * resolution's token count, plus any flat request charge. Null when the price
 * depends on tokens alone.
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
	const requestPrice = parsePrice(mapping.requestPrice) ?? 0;
	const flat = Object.values(mapping.perImagePrice ?? {})
		.map(parsePrice)
		.filter((price): price is number => price !== null);
	const tokenPrice = parsePrice(mapping.imageOutputPrice);
	const tokens = Object.values(
		mapping.imageOutputTokensByResolution ?? {},
	).filter((count) => Number.isFinite(count) && count > 0);

	let imagePrice: number | null = null;
	if (flat.length > 0) {
		imagePrice = Math.min(...flat);
	} else if (tokenPrice !== null && tokens.length > 0) {
		imagePrice = tokenPrice * Math.min(...tokens);
	} else if (requestPrice > 0) {
		imagePrice = 0;
	}
	if (imagePrice === null) {
		return null;
	}
	// A flat request charge is billed on top of the image itself.
	return applyDiscount(imagePrice + requestPrice, mapping.discount);
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
