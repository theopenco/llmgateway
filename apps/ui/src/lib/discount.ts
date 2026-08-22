import { discountFraction, isValidDiscount } from "@llmgateway/shared";

export interface DiscountData {
	id: string;
	provider: string | null;
	model: string | null;
	discountPercent: string;
	reason: string | null;
	expiresAt: string | null;
	createdAt: string;
}

// Discounts are always keyed by the canonical model id — the provider-specific
// externalId is reserved for upstream requests and is never persisted as a
// discount target.
export function findEffectiveProviderDiscount(
	discounts: DiscountData[],
	providerId: string,
	modelId: string,
): DiscountData | null {
	const valid = discounts.filter((d) => isValidDiscount(d.discountPercent));
	// Precedence: provider+model > provider > model > fully global
	const providerModel = valid.find(
		(d) => d.provider === providerId && d.model === modelId,
	);
	if (providerModel) {
		return providerModel;
	}

	const providerOnly = valid.find(
		(d) => d.provider === providerId && d.model === null,
	);
	if (providerOnly) {
		return providerOnly;
	}

	const modelOnly = valid.find(
		(d) => d.provider === null && d.model === modelId,
	);
	if (modelOnly) {
		return modelOnly;
	}

	const fullyGlobal = valid.find(
		(d) => d.provider === null && d.model === null,
	);
	if (fullyGlobal) {
		return fullyGlobal;
	}

	return null;
}

// The banner on a model page advertises the best deal a user can actually get
// for that model right now, so it takes the highest effective discount across
// the providers passed in. Callers pass only routable (non-deactivated)
// providers, otherwise the banner would promise a price nobody can be served.
export function getBestDiscount(
	discounts: DiscountData[],
	modelId: string,
	providerIds: string[],
): DiscountData | null {
	let best: DiscountData | null = null;
	for (const providerId of providerIds) {
		const match = findEffectiveProviderDiscount(discounts, providerId, modelId);
		if (
			match &&
			(!best || Number(match.discountPercent) > Number(best.discountPercent))
		) {
			best = match;
		}
	}
	return best;
}

export function getEffectiveProviderDiscount(
	discounts: DiscountData[],
	providerId: string,
	modelId: string,
): string | undefined {
	return (
		findEffectiveProviderDiscount(discounts, providerId, modelId)
			?.discountPercent ?? undefined
	);
}

export function applyDiscount(value: number, discount?: string | null): number {
	return value * (1 - discountFraction(discount));
}

// Converts a per-token price (e.g. "2.5e-6") to a per-million-token price.
export function perMillion(
	price: string | number | null | undefined,
): number | null {
	if (price === null || price === undefined || price === "") {
		return null;
	}
	const n = typeof price === "number" ? price : parseFloat(price);
	return Number.isFinite(n) ? n * 1e6 : null;
}

export { discountFraction, isValidDiscount } from "@llmgateway/shared";
