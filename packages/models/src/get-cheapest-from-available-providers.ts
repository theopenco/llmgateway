import type { ProviderModelMapping } from "./models.js";
import type { AvailableModelProvider, ModelWithPricing } from "./types.js";
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
// Prioritize uptime heavily to avoid unreliable providers
const PRICE_WEIGHT = 0.2;
const UPTIME_WEIGHT = 0.5;
const THROUGHPUT_WEIGHT = 0.2;
const LATENCY_WEIGHT = 0.1;

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
	}>;
	// Optional fields for low-uptime fallback routing
	originalProvider?: string;
	originalProviderUptime?: number;
}

export interface ProviderSelectionResult<T extends AvailableModelProvider> {
	provider: T;
	metadata: RoutingMetadata;
}

/**
 * Get the best provider from a list of available model providers.
 * Considers price, uptime, and latency metrics.
 *
 * @param availableModelProviders - List of available providers
 * @param modelWithPricing - Model pricing information (must have id property)
 * @param metricsMap - Optional map of provider metrics from last N minutes
 * @returns Best provider and routing metadata, or null if none available
 */
export function getCheapestFromAvailableProviders<
	T extends AvailableModelProvider,
>(
	availableModelProviders: T[],
	modelWithPricing: ModelWithPricing & { id: string },
	metricsMap?: Map<string, ProviderMetrics>,
): ProviderSelectionResult<T> | null {
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
		const uptime = providerScore.uptime ?? DEFAULT_UPTIME;
		const uptimeRange = maxUptime - minUptime;
		const uptimeScore =
			uptimeRange > 0 ? (maxUptime - uptime) / uptimeRange : 0;

		// Normalize throughput (0 = fastest, 1 = slowest)
		// Higher throughput is better, so we invert
		const throughput = providerScore.throughput ?? DEFAULT_THROUGHPUT;
		const throughputRange = maxThroughput - minThroughput;
		const throughputScore =
			throughputRange > 0 ? (maxThroughput - throughput) / throughputRange : 0;

		// Normalize latency (0 = fastest, 1 = slowest)
		const latency = providerScore.latency ?? DEFAULT_LATENCY;
		const latencyRange = maxLatency - minLatency;
		const latencyScore =
			latencyRange > 0 ? (latency - minLatency) / latencyRange : 0;

		// Calculate weighted score (lower is better)
		providerScore.score =
			PRICE_WEIGHT * priceScore +
			UPTIME_WEIGHT * uptimeScore +
			THROUGHPUT_WEIGHT * throughputScore +
			LATENCY_WEIGHT * latencyScore;
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
		providerScores: providerScores.map((p) => ({
			providerId: p.provider.providerId,
			score: Number(p.score.toFixed(3)),
			uptime: p.uptime,
			latency: p.latency,
			throughput: p.throughput,
			price: p.price, // Keep full precision for very small prices
		})),
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
	modelWithPricing: ModelWithPricing & { id: string },
): ProviderSelectionResult<T> {
	let cheapestProvider = stableProviders[0];
	let lowestPrice = Number.MAX_VALUE;

	const providerPrices: Array<{ providerId: string; price: number }> = [];

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

		providerPrices.push({
			providerId: provider.providerId,
			price: totalPrice, // Keep full precision for very small prices
		});

		if (totalPrice < lowestPrice) {
			lowestPrice = totalPrice;
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
		})),
	};

	return {
		provider: cheapestProvider,
		metadata,
	};
}
