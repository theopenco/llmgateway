import { providers } from "@llmgateway/models";

import {
	DEFAULT_ROUTING_HISTORY,
	DEFAULT_ROUTING_RETRY,
	DEFAULT_ROUTING_SESSION,
	DEFAULT_ROUTING_STICKY,
	DEFAULT_ROUTING_THRESHOLDS,
	DEFAULT_ROUTING_TIMEOUTS,
	DEFAULT_ROUTING_WEIGHTS,
	getDefaultCachePricing,
	ROUTING_HISTORY_MAX_WINDOW_MINUTES,
} from "./routing-defaults.js";

import type {
	RoutingHistoryConfig,
	RoutingOrganizationKind,
	RoutingRetryConfig,
	RoutingSessionConfig,
	RoutingStickyConfig,
	RoutingThresholdsConfig,
	RoutingTimeoutsConfig,
	RoutingWeightsConfig,
} from "./routing-defaults.js";

export * from "./routing-defaults.js";

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
	/** Preserve explicit pricing assumptions when applying observed token usage. */
	cachePricingOverrides?: Pick<
		RoutingThresholdsConfig,
		"cacheHitRate" | "cacheOutputRatio"
	>;
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
	orgKind?: RoutingOrganizationKind | null,
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
			{
				...DEFAULT_ROUTING_THRESHOLDS,
				...getDefaultCachePricing(orgKind),
			},
			effectiveOverrides?.thresholds,
		),
		cachePricingOverrides: {
			cacheHitRate: effectiveOverrides?.thresholds?.cacheHitRate,
			cacheOutputRatio: effectiveOverrides?.thresholds?.cacheOutputRatio,
		},
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

/**
 * Per-request routing preference, named after the factor it optimizes. `auto`
 * (the default) uses the full weighted smart-routing score described above. The
 * other kinds collapse the weights onto a single dominant factor (`price`,
 * `throughput`, or `latency`) while keeping a small uptime weight so requests
 * still fall back to other providers when the dominant pick has extremely bad
 * uptime.
 */
export type RoutingPreference = "auto" | "price" | "throughput" | "latency";

/**
 * The dominant factor gets a 90% relative weight and uptime keeps the remaining
 * 10% so an otherwise-winning provider with terrible uptime still loses. The
 * exponential uptime penalty (see getCheapestFromAvailableProviders) applies on
 * top of this regardless of weights, providing the hard fallback for providers
 * below the uptime-penalty threshold.
 */
export const ROUTING_PREFERENCE_WEIGHTS: Record<
	Exclude<RoutingPreference, "auto">,
	Required<RoutingWeightsConfig>
> = {
	price: {
		price: 0.9,
		imagePrice: 0.9,
		uptime: 0.1,
		throughput: 0,
		latency: 0,
		cache: 0,
	},
	throughput: {
		price: 0,
		imagePrice: 0,
		uptime: 0.1,
		throughput: 0.9,
		latency: 0,
		cache: 0,
	},
	// Latency (time-to-first-token) is only measured for streaming requests, so
	// this preference only biases streaming routing; non-streaming requests fall
	// back to scoring on the uptime weight alone.
	latency: {
		price: 0,
		imagePrice: 0,
		uptime: 0.1,
		throughput: 0,
		latency: 0.9,
		cache: 0,
	},
};

/**
 * Returns a routing config whose weights are overridden for the given
 * per-request routing preference. `auto` (or undefined) returns the config
 * unchanged so projects keep their configured/default weighted scoring.
 *
 * A non-`auto` preference also disables epsilon-greedy exploration: the caller
 * explicitly asked to optimize a single factor, so a random ~1% reroute to a
 * non-optimal provider (which runs before scoring) would violate that intent.
 */
export function applyRoutingPreference(
	cfg: ResolvedRoutingConfig,
	preference: RoutingPreference | undefined,
): ResolvedRoutingConfig {
	if (!preference || preference === "auto") {
		return cfg;
	}
	return {
		...cfg,
		weights: { ...ROUTING_PREFERENCE_WEIGHTS[preference] },
		thresholds: { ...cfg.thresholds, explorationRate: 0 },
	};
}

const cachedDefaults = new Map<
	RoutingOrganizationKind,
	ResolvedRoutingConfig
>();

export function getDefaultRoutingConfig(
	orgKind: RoutingOrganizationKind = "default",
): ResolvedRoutingConfig {
	let defaults = cachedDefaults.get(orgKind);
	if (!defaults) {
		defaults = resolveRoutingConfig(
			null,
			buildProviderPriorityDefaults(),
			orgKind,
		);
		cachedDefaults.set(orgKind, defaults);
	}
	// Return a defensive deep clone so callers cannot mutate the cached
	// constants and accidentally poison subsequent routing decisions.
	return structuredClone(defaults);
}
