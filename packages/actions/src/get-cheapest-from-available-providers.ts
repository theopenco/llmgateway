import {
	getProviderDefinition,
	type ProviderModelMapping,
	type AvailableModelProvider,
	type ModelWithPricing,
} from "@llmgateway/models";

import type { ProviderMetrics } from "@llmgateway/db";

interface ProviderScore<T extends AvailableModelProvider> {
	provider: T;
	score: number;
	price: number;
	uptime?: number;
	latency?: number;
	throughput?: number;
}

// Scoring weights (totaling 1.0)
const PRICE_WEIGHT = 0.2;
const IMAGE_PRICE_WEIGHT = 0.4; // 2x weight for image generation models
const UPTIME_WEIGHT = 0.5;
const THROUGHPUT_WEIGHT = 0.2;
const LATENCY_WEIGHT = 0.1;

// Uptime threshold below which exponential penalty kicks in
const UPTIME_PENALTY_THRESHOLD = 95;

/**
 * Calculate exponential penalty for low uptime.
 * - 95-100% uptime: no penalty (returns 0)
 * - Below 95%: exponential penalty that increases rapidly
 *   - 90% -> ~0.07 penalty
 *   - 80% -> ~0.62 penalty
 *   - 70% -> ~1.73 penalty
 *   - 60% -> ~3.39 penalty
 *   - 50% -> ~5.61 penalty
 */
function calculateUptimePenalty(uptime: number): number {
	if (uptime >= UPTIME_PENALTY_THRESHOLD) {
		return 0;
	}
	// Calculate how far below threshold (0-95 range, normalized to 0-1)
	const deficit =
		(UPTIME_PENALTY_THRESHOLD - uptime) / UPTIME_PENALTY_THRESHOLD;
	// Quadratic penalty: small dips = small penalty, large dips = large penalty
	return Math.pow(deficit * 5, 2);
}

// Default values for providers with no metrics
const DEFAULT_UPTIME = 100; // Assume 100% uptime if no data to avoid penalizing known-good providers
const DEFAULT_LATENCY = 1000; // Assume 1000ms latency if no data
const DEFAULT_THROUGHPUT = 50; // Assume 50 tokens/second if no data

// Epsilon-greedy exploration: 1% chance to randomly explore
const EXPLORATION_RATE = 0.01;

export interface RoutingMetadata {
	availableProviders: string[];
	selectedProvider: string;
	selectionReason: string;
	providerScores: Array<{
		providerId: string;
		score: number;
		uptime?: number;
		latency?: number;
		throughput?: number;
		price: number;
		priority?: number;
	}>;
	// Optional fields for low-uptime fallback routing
	originalProvider?: string;
	originalProviderUptime?: number;
	// Whether fallback was disabled via X-No-Fallback header
	noFallback?: boolean;
}

export interface ProviderSelectionResult<T extends AvailableModelProvider> {
	provider: T;
	metadata: RoutingMetadata;
}

export interface ProviderSelectionOptions {
	metricsMap?: Map<string, ProviderMetrics>;
	isStreaming?: boolean;
}

/**
 * Get the best provider from a list of available model providers.
 * Considers price, uptime, throughput, and latency metrics.
 *
 * @param availableModelProviders - List of available providers
 * @param modelWithPricing - Model pricing information (must have id property)
 * @param options - Optional settings including metricsMap and isStreaming flag
 * @returns Best provider and routing metadata, or null if none available
 */
export function getCheapestFromAvailableProviders<
	T extends AvailableModelProvider,
>(
	availableModelProviders: T[],
	modelWithPricing: ModelWithPricing & { id: string; output?: string[] },
	options?: ProviderSelectionOptions,
): ProviderSelectionResult<T> | null {
	const metricsMap = options?.metricsMap;
	const isStreaming = options?.isStreaming ?? false;
	// Use higher price weight for image generation models
	const isImageModel = modelWithPricing.output?.includes("image") ?? false;
	const effectivePriceWeight = isImageModel ? IMAGE_PRICE_WEIGHT : PRICE_WEIGHT;
	if (availableModelProviders.length === 0) {
		return null;
	}

	// Filter out unstable and experimental providers
	const stableProviders = availableModelProviders.filter((provider) => {
		const providerInfo = modelWithPricing.providers.find(
			(p) => p.providerId === provider.providerId,
		);
		const providerStability =
			providerInfo && "stability" in providerInfo
				? (providerInfo as ProviderModelMapping).stability
				: undefined;
		const modelStability =
			"stability" in modelWithPricing
				? (modelWithPricing as { stability?: string }).stability
				: undefined;
		const effectiveStability = providerStability ?? modelStability;
		return (
			effectiveStability !== "unstable" && effectiveStability !== "experimental"
		);
	});

	if (stableProviders.length === 0) {
		return null;
	}

	// Epsilon-greedy exploration: randomly select a provider 1% of the time
	// This ensures all providers get periodic traffic and build up metrics
	// Skip during tests to keep behavior deterministic
	const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;
	if (!isTest && Math.random() < EXPLORATION_RATE) {
		const randomProvider =
			stableProviders[Math.floor(Math.random() * stableProviders.length)];
		return {
			provider: randomProvider,
			metadata: {
				availableProviders: stableProviders.map((p) => p.providerId),
				selectedProvider: randomProvider.providerId,
				selectionReason: "random-exploration",
				providerScores: [],
			},
		};
	}

	// If no metrics provided, fall back to price-only selection
	if (!metricsMap || metricsMap.size === 0) {
		return selectByPriceOnly(stableProviders, modelWithPricing);
	}

	// Calculate scores for each provider
	const providerScores: ProviderScore<T>[] = [];

	for (const provider of stableProviders) {
		const providerInfo = modelWithPricing.providers.find(
			(p) => p.providerId === provider.providerId,
		);
		const discount = (providerInfo as ProviderModelMapping)?.discount || 0;
		const discountMultiplier = 1 - discount;
		const price =
			(((providerInfo?.inputPrice || 0) + (providerInfo?.outputPrice || 0)) /
				2) *
			discountMultiplier;

		const metricsKey = `${modelWithPricing.id}:${provider.providerId}`;
		const metrics = metricsMap.get(metricsKey);

		providerScores.push({
			provider,
			score: 0, // Will be calculated below
			price,
			uptime: metrics?.uptime,
			latency: metrics?.averageLatency,
			throughput: metrics?.throughput,
		});
	}

	// Find min/max values for normalization
	const prices = providerScores.map((p) => p.price);
	const minPrice = Math.min(...prices);
	const maxPrice = Math.max(...prices);

	const uptimes = providerScores.map((p) => p.uptime ?? DEFAULT_UPTIME);
	const minUptime = Math.min(...uptimes);
	const maxUptime = Math.max(...uptimes);

	const throughputs = providerScores.map(
		(p) => p.throughput ?? DEFAULT_THROUGHPUT,
	);
	const minThroughput = Math.min(...throughputs);
	const maxThroughput = Math.max(...throughputs);

	const latencies = providerScores.map((p) => p.latency ?? DEFAULT_LATENCY);
	const minLatency = Math.min(...latencies);
	const maxLatency = Math.max(...latencies);

	// Calculate normalized scores
	for (const providerScore of providerScores) {
		// Normalize price (0 = cheapest, 1 = most expensive)
		const priceRange = maxPrice - minPrice;
		const priceScore =
			priceRange > 0 ? (providerScore.price - minPrice) / priceRange : 0;

		// Normalize uptime (0 = best uptime, 1 = worst uptime)
		// Uses relative comparison between providers
		const uptime = providerScore.uptime ?? DEFAULT_UPTIME;
		const uptimeRange = maxUptime - minUptime;
		const uptimeScore =
			uptimeRange > 0 ? (maxUptime - uptime) / uptimeRange : 0;

		// Calculate exponential penalty for truly unstable providers
		const uptimePenalty = calculateUptimePenalty(uptime);

		// Normalize throughput (0 = fastest, 1 = slowest)
		// Higher throughput is better, so we invert
		const throughput = providerScore.throughput ?? DEFAULT_THROUGHPUT;
		const throughputRange = maxThroughput - minThroughput;
		const throughputScore =
			throughputRange > 0 ? (maxThroughput - throughput) / throughputRange : 0;

		// Normalize latency (0 = fastest, 1 = slowest)
		// Only consider latency for streaming requests since it's only measured there
		let latencyScore = 0;
		if (isStreaming) {
			const latency = providerScore.latency ?? DEFAULT_LATENCY;
			const latencyRange = maxLatency - minLatency;
			latencyScore =
				latencyRange > 0 ? (latency - minLatency) / latencyRange : 0;
		}

		// Calculate base weighted score (lower is better)
		// When not streaming, latency weight (0.1) is redistributed to other factors
		// Image generation models use 2x price weight
		const effectiveLatencyWeight = isStreaming ? LATENCY_WEIGHT : 0;
		const weightSum =
			effectivePriceWeight +
			UPTIME_WEIGHT +
			THROUGHPUT_WEIGHT +
			effectiveLatencyWeight;
		const baseScore =
			(effectivePriceWeight / weightSum) * priceScore +
			(UPTIME_WEIGHT / weightSum) * uptimeScore +
			(THROUGHPUT_WEIGHT / weightSum) * throughputScore +
			(effectiveLatencyWeight / weightSum) * latencyScore;

		// Apply provider priority: lower priority = higher score (less preferred)
		// Priority defaults to 1. We add (1 - priority) as a penalty.
		// e.g., priority 0.8 adds 0.2 penalty, priority 1.0 adds 0 penalty
		const providerDef = getProviderDefinition(
			providerScore.provider.providerId,
		);
		const priority = providerDef?.priority ?? 1;
		const priorityPenalty = 1 - priority;

		// Final score = base weighted score + priority penalty + exponential uptime penalty
		// The uptime penalty heavily penalizes providers with <95% uptime
		providerScore.score = baseScore + priorityPenalty + uptimePenalty;
	}

	// Select provider with lowest score
	let bestProvider = providerScores[0];
	for (const providerScore of providerScores) {
		if (providerScore.score < bestProvider.score) {
			bestProvider = providerScore;
		}
	}

	// Build routing metadata
	const metadata: RoutingMetadata = {
		availableProviders: providerScores.map((p) => p.provider.providerId),
		selectedProvider: bestProvider.provider.providerId,
		selectionReason: metricsMap ? "weighted-score" : "price-only",
		providerScores: providerScores.map((p) => {
			const providerDef = getProviderDefinition(p.provider.providerId);
			const priority = providerDef?.priority ?? 1;
			return {
				providerId: p.provider.providerId,
				score: Number(p.score.toFixed(3)),
				uptime: p.uptime,
				latency: p.latency,
				throughput: p.throughput,
				price: p.price, // Keep full precision for very small prices
				priority,
			};
		}),
	};

	return {
		provider: bestProvider.provider,
		metadata,
	};
}

/**
 * Fallback function for price-only selection (original behavior)
 */
function selectByPriceOnly<T extends AvailableModelProvider>(
	stableProviders: T[],
	modelWithPricing: ModelWithPricing & { id: string; output?: string[] },
): ProviderSelectionResult<T> {
	let cheapestProvider = stableProviders[0];
	let lowestEffectivePrice = Number.MAX_VALUE;

	const providerPrices: Array<{
		providerId: string;
		price: number;
		effectivePrice: number;
		priority: number;
	}> = [];

	for (const provider of stableProviders) {
		const providerInfo = modelWithPricing.providers.find(
			(p) => p.providerId === provider.providerId,
		);
		const discount = (providerInfo as ProviderModelMapping)?.discount || 0;
		const discountMultiplier = 1 - discount;
		const totalPrice =
			(((providerInfo?.inputPrice || 0) + (providerInfo?.outputPrice || 0)) /
				2) *
			discountMultiplier;

		// Apply provider priority: lower priority = effectively higher price
		const providerDef = getProviderDefinition(provider.providerId);
		const priority = providerDef?.priority ?? 1;
		const effectivePrice = priority > 0 ? totalPrice / priority : totalPrice;

		providerPrices.push({
			providerId: provider.providerId,
			price: totalPrice,
			effectivePrice,
			priority,
		});

		if (effectivePrice < lowestEffectivePrice) {
			lowestEffectivePrice = effectivePrice;
			cheapestProvider = provider;
		}
	}

	const metadata: RoutingMetadata = {
		availableProviders: stableProviders.map((p) => p.providerId),
		selectedProvider: cheapestProvider.providerId,
		selectionReason: "price-only-no-metrics",
		providerScores: providerPrices.map((p) => ({
			providerId: p.providerId,
			score: 0,
			price: p.price,
			priority: p.priority,
		})),
	};

	return {
		provider: cheapestProvider,
		metadata,
	};
}
