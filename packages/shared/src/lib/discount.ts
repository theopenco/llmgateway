// Discounts are stored as a 0-1 fraction (e.g. "0.5" = 50% off). Values outside
// (0, 1] are treated as invalid data and ignored to avoid negative or inflated
// prices.
export function isValidDiscount(discount?: string | null): boolean {
	if (!discount) {
		return false;
	}
	const n = Number(discount);
	return Number.isFinite(n) && n > 0 && n <= 1;
}

export function discountFraction(discount?: string | null): number {
	return isValidDiscount(discount) ? Number(discount) : 0;
}
