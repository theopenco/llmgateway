export interface DiscountData {
	id: string;
	provider: string | null;
	model: string | null;
	discountPercent: string;
	reason: string | null;
	expiresAt: string | null;
	createdAt: string;
}

// Discounts are stored as a 0-1 fraction (e.g. "0.5" = 50% off). Values outside
// (0, 1] are treated as invalid data and ignored to avoid negative or inflated
// prices.
function isValidDiscount(discount?: string | null): boolean {
	if (!discount) {
		return false;
	}
	const n = Number(discount);
	return Number.isFinite(n) && n > 0 && n <= 1;
}

export function getBestDiscount(
	discounts: DiscountData[],
	modelId: string,
): DiscountData | null {
	const valid = discounts.filter((d) => isValidDiscount(d.discountPercent));
	// Precedence: model-specific > fully global
	const modelSpecific = valid.find((d) => d.model === modelId);
	if (modelSpecific) {
		return modelSpecific;
	}

	const fullyGlobal = valid.find(
		(d) => d.provider === null && d.model === null,
	);
	if (fullyGlobal) {
		return fullyGlobal;
	}

	return null;
}

export function getEffectiveProviderDiscount(
	discounts: DiscountData[],
	providerId: string,
	modelId: string,
): string | undefined {
	const valid = discounts.filter((d) => isValidDiscount(d.discountPercent));
	// Precedence: provider+model > provider > model > fully global
	const providerModel = valid.find(
		(d) => d.provider === providerId && d.model === modelId,
	);
	if (providerModel) {
		return providerModel.discountPercent;
	}

	const providerOnly = valid.find(
		(d) => d.provider === providerId && d.model === null,
	);
	if (providerOnly) {
		return providerOnly.discountPercent;
	}

	const modelOnly = valid.find(
		(d) => d.provider === null && d.model === modelId,
	);
	if (modelOnly) {
		return modelOnly.discountPercent;
	}

	const fullyGlobal = valid.find(
		(d) => d.provider === null && d.model === null,
	);
	if (fullyGlobal) {
		return fullyGlobal.discountPercent;
	}

	return undefined;
}

export function discountFraction(discount?: string | null): number {
	return isValidDiscount(discount) ? Number(discount) : 0;
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
