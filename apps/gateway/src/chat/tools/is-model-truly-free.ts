import type { ModelDefinition } from "@llmgateway/models";

/**
 * Checks if a model is truly free (has free flag AND no per-request or per-second pricing)
 */
export function isModelTrulyFree(modelInfo: ModelDefinition): boolean {
	if (!modelInfo.free) {
		return false;
	}
	return !modelInfo.providers.some((provider) => {
		const hasRequestPrice =
			provider.requestPrice !== undefined && Number(provider.requestPrice) > 0;
		const hasPerSecondPrice = Object.values(provider.perSecondPrice ?? {}).some(
			(price) => Number(price) > 0,
		);
		return hasRequestPrice || hasPerSecondPrice;
	});
}

/**
 * Recursively asserts that every price-bearing field of a value is zero. A
 * field counts as a price when its key contains "price" (case-insensitive);
 * once inside such a field, every nested scalar must be zero (covers
 * `perSecondPrice` records and per-region price overrides). Robust to new
 * price fields without enumerating them.
 */
function allPricesZero(value: unknown, underPriceKey = false): boolean {
	if (value === undefined || value === null) {
		return true;
	}
	if (typeof value === "number") {
		return !underPriceKey || value === 0;
	}
	if (typeof value === "string") {
		return !underPriceKey || Number(value) === 0;
	}
	if (Array.isArray(value)) {
		return value.every((item) => allPricesZero(item, underPriceKey));
	}
	if (typeof value === "object") {
		return Object.entries(value).every(([key, val]) =>
			allPricesZero(val, underPriceKey || /price/i.test(key)),
		);
	}
	return true;
}

/**
 * Strict free check for test-mode (sandbox) end-user wallets: the model must be
 * flagged free AND *every* provider mapping must be zero-priced on every billable
 * dimension. This is intentionally stricter than `isModelTrulyFree` (which
 * ignores per-token prices) so a test wallet cannot pin a paid provider mapping
 * of an otherwise-free model (e.g. `embercloud/glm-4.7-flash`) and incur real
 * provider cost — even via downstream retry/fallback to a paid mapping.
 */
export function isModelFreeForTestWallet(modelInfo: ModelDefinition): boolean {
	if (!modelInfo.free) {
		return false;
	}
	return modelInfo.providers.every((provider) => allPricesZero(provider));
}
