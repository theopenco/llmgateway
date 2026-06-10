import { providers } from "@llmgateway/models";

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

export type ProviderPriorityOverrides = Record<string, number>;

export interface RoutingConfigOverrides {
	enabled?: boolean;
	weights?: RoutingWeightsConfig | null;
	thresholds?: RoutingThresholdsConfig | null;
	retry?: RoutingRetryConfig | null;
	timeouts?: RoutingTimeoutsConfig | null;
	history?: RoutingHistoryConfig | null;
	sticky?: RoutingStickyConfig | null;
	session?: RoutingSessionConfig | null;
	providerPriorities?: ProviderPriorityOverrides | null;
}

export interface ResolvedRoutingConfig {
	weights: Required<RoutingWeightsConfig>;
	thresholds: Required<RoutingThresholdsConfig>;
	retry: Required<RoutingRetryConfig>;
	/**
	 * Timeouts are intentionally kept as the raw project overrides (not
	 * merged with defaults) so that the timeout helpers can apply the
	 * "override -> env var -> built-in default" precedence properly. An
	 * empty object means "no project override".
	 */
	timeouts: RoutingTimeoutsConfig;
	history: Required<RoutingHistoryConfig>;
	sticky: Required<RoutingStickyConfig>;
	session: Required<RoutingSessionConfig>;
	providerPriorities: ProviderPriorityOverrides;
}

export const DEFAULT_ROUTING_WEIGHTS: Required<RoutingWeightsConfig> = {
	price: 0.6,
	imagePrice: 1.0,
	uptime: 0.5,
	throughput: 0.05,
	latency: 0.025,
	cache: 0.2,
};

export const DEFAULT_ROUTING_THRESHOLDS: Required<RoutingThresholdsConfig> = {
	cachePromptTokens: 5000,
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

export function buildProviderPriorityDefaults(): ProviderPriorityOverrides {
	const result: ProviderPriorityOverrides = {};
	for (const provider of providers as ReadonlyArray<{
		id: string;
		priority?: number;
	}>) {
		result[provider.id] = provider.priority ?? 1;
	}
	return result;
}

function clampSticky(
	cfg: Required<RoutingStickyConfig>,
): Required<RoutingStickyConfig> {
	return {
		enabled: Boolean(cfg.enabled),
		ttlSeconds: Math.max(1, Math.floor(cfg.ttlSeconds)),
		uptimeThreshold: Math.max(0, Math.min(100, cfg.uptimeThreshold)),
		scoreMargin: Math.max(0, cfg.scoreMargin),
	};
}

function clampSession(
	cfg: Required<RoutingSessionConfig>,
): Required<RoutingSessionConfig> {
	return {
		enabled: Boolean(cfg.enabled),
		ttlSeconds: Math.max(1, Math.floor(cfg.ttlSeconds)),
		uptimeThreshold: Math.max(0, Math.min(100, cfg.uptimeThreshold)),
	};
}

function clampHistory(
	cfg: Required<RoutingHistoryConfig>,
): Required<RoutingHistoryConfig> {
	const windowMinutes = Math.max(
		1,
		Math.min(ROUTING_HISTORY_MAX_WINDOW_MINUTES, Math.floor(cfg.windowMinutes)),
	);
	const tier1Minutes = Math.max(0, Math.floor(cfg.tier1Minutes));
	const tier2Minutes = Math.max(tier1Minutes, Math.floor(cfg.tier2Minutes));
	return {
		windowMinutes,
		tier1Minutes,
		tier2Minutes,
		tier1Weight: Math.max(0, cfg.tier1Weight),
		tier2Weight: Math.max(0, cfg.tier2Weight),
		tier3Weight: Math.max(0, cfg.tier3Weight),
	};
}

/**
 * Returns true if the resolved history config matches the built-in defaults.
 * Callers use this to skip per-project re-aggregation and read the cheap
 * globally-rolled-up routingUptime/Latency/Throughput columns instead.
 */
export function historyMatchesDefaults(
	cfg: Required<RoutingHistoryConfig>,
): boolean {
	return (
		cfg.windowMinutes === DEFAULT_ROUTING_HISTORY.windowMinutes &&
		cfg.tier1Minutes === DEFAULT_ROUTING_HISTORY.tier1Minutes &&
		cfg.tier2Minutes === DEFAULT_ROUTING_HISTORY.tier2Minutes &&
		cfg.tier1Weight === DEFAULT_ROUTING_HISTORY.tier1Weight &&
		cfg.tier2Weight === DEFAULT_ROUTING_HISTORY.tier2Weight &&
		cfg.tier3Weight === DEFAULT_ROUTING_HISTORY.tier3Weight
	);
}

export function routingHistoryCacheKey(
	cfg: Required<RoutingHistoryConfig>,
): string {
	return [
		cfg.windowMinutes,
		cfg.tier1Minutes,
		cfg.tier2Minutes,
		cfg.tier1Weight,
		cfg.tier2Weight,
		cfg.tier3Weight,
	].join(":");
}

function mergeGroup<T extends Record<string, number | boolean>>(
	defaults: T,
	overrides: Partial<T> | null | undefined,
): T {
	if (!overrides) {
		return { ...defaults };
	}
	const result: Record<string, number | boolean> = { ...defaults };
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined || value === null) {
			continue;
		}
		result[key] = value;
	}
	return result as T;
}

export function resolveRoutingConfig(
	overrides: RoutingConfigOverrides | null | undefined,
	providerPriorityDefaults: ProviderPriorityOverrides,
): ResolvedRoutingConfig {
	const enabled = overrides?.enabled !== false;
	const effectiveOverrides = enabled ? overrides : null;
	const providerPriorities: ProviderPriorityOverrides = {
		...providerPriorityDefaults,
	};
	if (effectiveOverrides?.providerPriorities) {
		for (const [providerId, priority] of Object.entries(
			effectiveOverrides.providerPriorities,
		)) {
			if (typeof priority === "number" && Number.isFinite(priority)) {
				providerPriorities[providerId] = priority;
			}
		}
	}
	// The defaults are the infra ceiling — clamp any override down so a
	// stale or hand-edited DB row can never request a longer timeout than
	// the infra layer will allow.
	const timeoutOverrides: RoutingTimeoutsConfig = {};
	if (effectiveOverrides?.timeouts) {
		for (const [key, value] of Object.entries(effectiveOverrides.timeouts) as [
			keyof RoutingTimeoutsConfig,
			number | undefined,
		][]) {
			if (typeof value === "number" && Number.isFinite(value) && value > 0) {
				const ceiling = DEFAULT_ROUTING_TIMEOUTS[key];
				timeoutOverrides[key] = Math.min(value, ceiling);
			}
		}
	}
	return {
		weights: mergeGroup(DEFAULT_ROUTING_WEIGHTS, effectiveOverrides?.weights),
		thresholds: mergeGroup(
			DEFAULT_ROUTING_THRESHOLDS,
			effectiveOverrides?.thresholds,
		),
		retry: mergeGroup(DEFAULT_ROUTING_RETRY, effectiveOverrides?.retry),
		timeouts: timeoutOverrides,
		history: clampHistory(
			mergeGroup(DEFAULT_ROUTING_HISTORY, effectiveOverrides?.history),
		),
		sticky: clampSticky(
			mergeGroup(DEFAULT_ROUTING_STICKY, effectiveOverrides?.sticky),
		),
		session: clampSession(
			mergeGroup(DEFAULT_ROUTING_SESSION, effectiveOverrides?.session),
		),
		providerPriorities,
	};
}

let cachedDefaults: ResolvedRoutingConfig | null = null;

export function getDefaultRoutingConfig(): ResolvedRoutingConfig {
	if (!cachedDefaults) {
		cachedDefaults = resolveRoutingConfig(
			null,
			buildProviderPriorityDefaults(),
		);
	}
	// Return a defensive deep clone so callers cannot mutate the cached
	// constants and accidentally poison subsequent routing decisions.
	return structuredClone(cachedDefaults);
}
