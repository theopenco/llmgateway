/**
 * Dependency-free routing defaults shared by the gateway, API, dashboards,
 * marketing pages and docs. Import from `@llmgateway/shared/routing-defaults`
 * in client or content code; `routing-config` re-exports everything here.
 */
export interface RoutingWeightsConfig {
	price?: number;
	imagePrice?: number;
	uptime?: number;
	throughput?: number;
	latency?: number;
	cache?: number;
}

export interface RoutingThresholdsConfig {
	cachePromptTokens?: number;
	/**
	 * Prompt-cache hit rate ([0,1]). Explicit overrides take precedence over
	 * observed project usage; otherwise the cold-start fallback depends on the
	 * workload (DEFAULT_CACHE_PRICING_BY_ORG_KIND).
	 */
	cacheHitRate?: number;
	/**
	 * Output:input ratio for large prompts. Explicit overrides take precedence
	 * over observed project usage; otherwise the default is a cold-start fallback.
	 */
	cacheOutputRatio?: number;
	uptimePenalty?: number;
	defaultUptime?: number;
	defaultLatency?: number;
	defaultThroughput?: number;
	explorationRate?: number;
}

export interface RoutingRetryConfig {
	maxRetries?: number;
	lowUptimeFallbackThreshold?: number;
}

export interface RoutingTimeoutsConfig {
	gatewayMs?: number;
	streamingMs?: number;
	plainMs?: number;
}

export interface RoutingHistoryConfig {
	windowMinutes?: number;
	tier1Minutes?: number;
	tier2Minutes?: number;
	tier1Weight?: number;
	tier2Weight?: number;
	tier3Weight?: number;
}

export interface RoutingStickyConfig {
	/**
	 * When false the project always routes to the current best-scored
	 * provider and never reads / writes the preferred-provider cache.
	 */
	enabled?: boolean;
	ttlSeconds?: number;
	uptimeThreshold?: number;
	scoreMargin?: number;
}

export interface RoutingSessionConfig {
	/**
	 * When false, the project ignores session ids for provider selection:
	 * requests are scored normally instead of being pinned to the session's
	 * provider. Defaults to true.
	 */
	enabled?: boolean;
	/**
	 * How long (seconds) a session stays pinned to its provider. Refreshed on
	 * every request, so the pin lives as long as the session keeps making
	 * requests within this window.
	 */
	ttlSeconds?: number;
	/**
	 * When the pinned provider's uptime drops below this percentage the session
	 * is re-scored and pinned to the current best provider instead. This is the
	 * only thing that breaks an established pin.
	 */
	uptimeThreshold?: number;
}

export const DEFAULT_ROUTING_WEIGHTS: Required<RoutingWeightsConfig> = {
	price: 0.6,
	imagePrice: 1.0,
	uptime: 0.5,
	throughput: 0.3,
	latency: 0.075,
	// Cached input savings already participate in the price score.
	cache: 0,
};

export type RoutingOrganizationKind = "default" | "devpass" | "chat";

/** Cold-start estimates; recognized coding clients use the DevPass profile. */
export const DEFAULT_CACHE_PRICING_BY_ORG_KIND: Record<
	RoutingOrganizationKind,
	Required<Pick<RoutingThresholdsConfig, "cacheHitRate" | "cacheOutputRatio">>
> = {
	default: { cacheHitRate: 0.1, cacheOutputRatio: 0.2 },
	devpass: { cacheHitRate: 0.9, cacheOutputRatio: 0.02 },
	chat: { cacheHitRate: 0.5, cacheOutputRatio: 0.1 },
};

export function getDefaultCachePricing(
	orgKind?: RoutingOrganizationKind | null,
) {
	return { ...DEFAULT_CACHE_PRICING_BY_ORG_KIND[orgKind ?? "default"] };
}

export const DEFAULT_ROUTING_THRESHOLDS: Required<RoutingThresholdsConfig> = {
	cachePromptTokens: 5000,
	...getDefaultCachePricing(),
	uptimePenalty: 95,
	defaultUptime: 100,
	defaultLatency: 1000,
	defaultThroughput: 50,
	explorationRate: 0.01,
};

export const DEFAULT_ROUTING_RETRY: Required<RoutingRetryConfig> = {
	maxRetries: 2,
	lowUptimeFallbackThreshold: 90,
};

export const DEFAULT_ROUTING_TIMEOUTS: Required<RoutingTimeoutsConfig> = {
	gatewayMs: 1_500_000,
	streamingMs: 1_200_000,
	plainMs: 600_000,
};

/**
 * Defaults mirror apps/gateway/src/lib/preferred-provider.ts so projects
 * that don't override anything see identical sticky-routing behavior to
 * what the env-var fallbacks produce.
 */
export const DEFAULT_ROUTING_STICKY: Required<RoutingStickyConfig> = {
	enabled: true,
	ttlSeconds: 3600,
	uptimeThreshold: 85,
	scoreMargin: 0.15,
};

export const DEFAULT_ROUTING_SESSION: Required<RoutingSessionConfig> = {
	enabled: true,
	ttlSeconds: 3600,
	uptimeThreshold: 85,
};

/**
 * Defaults mirror apps/worker/src/services/stats-calculator.ts so projects
 * that don't override anything see identical behavior to the global rollup.
 */
export const DEFAULT_ROUTING_HISTORY: Required<RoutingHistoryConfig> = {
	windowMinutes: 60,
	tier1Minutes: 1,
	tier2Minutes: 5,
	tier1Weight: 10,
	tier2Weight: 3,
	tier3Weight: 1,
};

export const ROUTING_HISTORY_MAX_WINDOW_MINUTES = 120;

/**
 * Upper bound on the throughput sub-score (maxThroughput / throughput - 1).
 * The ratio is unbounded as throughput approaches zero, so a single slow or
 * sparsely sampled window could otherwise dominate the weighted score. A cap of
 * 3 means anything 4x slower than the fastest candidate is penalised equally.
 */
export const MAX_THROUGHPUT_SCORE = 3;

const ROUTING_CONTENT_VALUES = {
	weights: DEFAULT_ROUTING_WEIGHTS,
	thresholds: DEFAULT_ROUTING_THRESHOLDS,
	cachePricing: DEFAULT_CACHE_PRICING_BY_ORG_KIND,
	retry: DEFAULT_ROUTING_RETRY,
	timeouts: DEFAULT_ROUTING_TIMEOUTS,
	history: DEFAULT_ROUTING_HISTORY,
	historyMaxWindowMinutes: ROUTING_HISTORY_MAX_WINDOW_MINUTES,
	sticky: DEFAULT_ROUTING_STICKY,
	session: DEFAULT_ROUTING_SESSION,
	maxThroughputScore: MAX_THROUGHPUT_SCORE,
};

const ROUTING_DEFAULT_TOKEN = /%routing\.([A-Za-z0-9.]+)%/g;

/**
 * Replaces `%routing.<path>%` tokens in docs, blog posts and other content with
 * the live default, e.g. `%routing.weights.throughput%`. Paths mirror the
 * routing config groups (weights, thresholds, retry, timeouts, history, sticky,
 * session, cachePricing.<orgKind>) plus `historyMaxWindowMinutes` and
 * `maxThroughputScore`. Unknown paths throw so typos fail the content build.
 */
export function interpolateRoutingDefaults(text: string): string {
	return text.replace(ROUTING_DEFAULT_TOKEN, (token, path: string) => {
		let value: unknown = ROUTING_CONTENT_VALUES;
		for (const key of path.split(".")) {
			value =
				value !== null &&
				typeof value === "object" &&
				Object.prototype.hasOwnProperty.call(value, key)
					? (value as Record<string, unknown>)[key]
					: undefined;
		}
		if (typeof value === "number") {
			return value.toLocaleString("en-US", { maximumFractionDigits: 6 });
		}
		if (typeof value === "boolean") {
			return String(value);
		}
		throw new Error(`Unknown routing default ${token}`);
	});
}
