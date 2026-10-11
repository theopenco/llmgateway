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
