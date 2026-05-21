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

export type ProviderPriorityOverrides = Record<string, number>;

export interface RoutingConfigOverrides {
	enabled?: boolean;
	weights?: RoutingWeightsConfig | null;
	thresholds?: RoutingThresholdsConfig | null;
	retry?: RoutingRetryConfig | null;
	timeouts?: RoutingTimeoutsConfig | null;
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
	gatewayMs: 300_000,
	streamingMs: 240_000,
	plainMs: 180_000,
};

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
	const timeoutOverrides: RoutingTimeoutsConfig = {};
	if (effectiveOverrides?.timeouts) {
		for (const [key, value] of Object.entries(effectiveOverrides.timeouts) as [
			keyof RoutingTimeoutsConfig,
			number | undefined,
		][]) {
			if (typeof value === "number" && Number.isFinite(value) && value > 0) {
				timeoutOverrides[key] = value;
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
	return cachedDefaults;
}
