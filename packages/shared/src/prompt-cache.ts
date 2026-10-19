import Decimal from "decimal.js";

export const MIN_CACHE_RATE_REQUESTS = 5;

export interface CacheCounts {
	requestCount: number;
	inputTokens: number;
	cachedTokens: number;
}

export function promptCacheRate(counts: CacheCounts): number | null {
	return counts.requestCount >= MIN_CACHE_RATE_REQUESTS &&
		counts.inputTokens > 0
		? (100 * counts.cachedTokens) / counts.inputTokens
		: null;
}

export function cacheRateStatus(counts: CacheCounts): string | null {
	if (counts.inputTokens === 0) {
		return "No input tokens";
	}
	return counts.requestCount < MIN_CACHE_RATE_REQUESTS
		? "Insufficient traffic"
		: null;
}

export type UsageMetric = "cost" | "requestCount" | "totalTokens" | "cacheRate";
export type UsageBucket = "hour" | "day";
export type UsageGroup = "model" | "project" | "apiKey" | "user";
export interface UsageCounts extends CacheCounts {
	cost: number;
	totalTokens: number;
	creditsCost: number;
	apiKeysCost: number;
	creditsRequestCount: number;
	apiKeysRequestCount: number;
}
export interface UsageSeries extends UsageCounts {
	key: string;
	label: string;
}
export interface UsageTimeseries {
	bucket: UsageBucket;
	series: { key: string; label: string }[];
	points: {
		timestamp: string;
		incomplete: boolean;
		totals: UsageCounts;
		entries: UsageSeries[];
	}[];
	filters: {
		models: { key: string; label: string }[];
		apiKeys: { key: string; label: string }[];
	};
}

export function resolveUsageBucket(
	option: "auto" | UsageBucket,
	metric: UsageMetric,
	days: number,
): UsageBucket {
	if (option === "day" || days > 30) {
		return "day";
	}
	return option === "hour" || metric === "cacheRate" || days <= 1
		? "hour"
		: "day";
}

/**
 * Cached input usually bills at a small fraction of the input price; above
 * this share a cached price is more likely a typo or the wrong unit.
 */
export const UNUSUAL_CACHED_INPUT_SHARE = 0.5;

function parsePrice(value: string | null | undefined): Decimal | null {
	if (value === null || value === undefined || value.trim() === "") {
		return null;
	}
	try {
		const price = new Decimal(value.trim());
		return price.isFinite() && price.gt(0) ? price : null;
	} catch {
		return null;
	}
}

/**
 * A warning when a cached input price is unusually close to the input price.
 * Both prices must share a unit (per token or per million).
 */
export function cachedInputPriceWarning(
	inputPrice: string | null | undefined,
	cachedInputPrice: string | null | undefined,
): string | null {
	const input = parsePrice(inputPrice);
	const cached = parsePrice(cachedInputPrice);
	if (!input || !cached) {
		return null;
	}
	const share = cached.div(input);
	if (share.lte(UNUSUAL_CACHED_INPUT_SHARE)) {
		return null;
	}
	const percent = share.times(100).toDecimalPlaces(0).toString();
	return share.gte(1)
		? `Cached input costs ${percent}% of the input price. Cached input is usually much cheaper; check the price and its unit.`
		: `Cached input costs ${percent}% of the input price. It is usually much cheaper (often 10–25%); check the price and its unit.`;
}
