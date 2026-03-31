import { type ProviderMetrics, metricsKey } from "@llmgateway/db";
import {
	getProviderDefinition,
	type AvailableModelProvider,
	type ModelWithPricing,
	type ProviderModelMapping,
} from "@llmgateway/models";

interface ProviderScore<T extends AvailableModelProvider> {
	provider: T;
	score: number;
	price: number;
	uptime?: number;
	latency?: number;
	throughput?: number;
}

// Scoring weights
// With ratio-based scoring, throughput/latency differences are naturally amplified
// (e.g., 6x faster = score of 5.0), so these weights are kept low to avoid
// dominating price and uptime. Price/uptime differences are typically smaller ratios.
const PRICE_WEIGHT = 0.3;
const IMAGE_PRICE_WEIGHT = 0.5; // Higher weight for image generation models
const UPTIME_WEIGHT = 0.5;
const THROUGHPUT_WEIGHT = 0.05;
const LATENCY_WEIGHT = 0.025;

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

function isTestProcess(): boolean {
	if (process.env.NODE_ENV === "test" || Boolean(process.env.VITEST)) {
		return true;
	}

	return process.argv.some((arg) => arg.toLowerCase().includes("vitest"));
}

export interface RoutingMetadata {
	availableProviders: string[];
	selectedProvider: string;
	selectionReason: string;
	providerScores: Array<{
		providerId: string;
		region?: string;
		score: number;
		uptime?: number;
		latency?: number;
		throughput?: number;
		price: number;
		priority?: number;
		// Populated after retry loop if this provider was attempted and failed
		failed?: boolean;
		status_code?: number;
		error_type?: string;
		// Set when this provider was excluded due to RPM cap
		rate_limited?: boolean;
		// Set when the provider is marked as content-filtered in the provider catalog
		contentFilterProvider?: boolean;
		// Set when the provider was excluded because the gateway content filter matched
		excludedByContentFilter?: boolean;
	}>;
	// Optional fields for low-uptime fallback routing
	originalProvider?: string;
	originalProviderUptime?: number;
	// Set when the originally requested provider was rate-limited and fallback occurred
	originalProviderRateLimited?: boolean;
	// Whether fallback was disabled via X-No-Fallback header
	noFallback?: boolean;
	// Whether the gateway content filter matched for the request before upstream routing
	contentFilterMatched?: boolean;
	// Whether routing excluded content-filter providers in favor of alternatives
	contentFilterRerouted?: boolean;
	// Providers excluded because they are marked as content-filter providers
	contentFilterExcludedProviders?: string[];
	// All provider attempts from retry fallback mechanism (including successful)
	routing?: Array<{
		provider: string;
		model: string;
		status_code: number;
		error_type: string;
		succeeded: boolean;
	}>;
}

export interface ProviderSelectionResult<T extends AvailableModelProvider> {
	provider: T;
	metadata: RoutingMetadata;
}

export interface ProviderSelectionOptions {
	metricsMap?: Map<string, ProviderMetrics>;
	isStreaming?: boolean;
	videoPricing?: VideoPricingContext;
}

export interface VideoPricingContext {
	durationSeconds: number;
	includeAudio: boolean;
	resolution: "default" | "hd" | "1080p" | "4k";
}

function getPerSecondBillingKeys(
	videoPricing: VideoPricingContext,
): Array<keyof NonNullable<ProviderModelMapping["perSecondPrice"]>> {
	if (videoPricing.resolution === "4k") {
		return videoPricing.includeAudio
			? ["4k_audio", "default_audio", "4k", "default"]
			: ["4k_video", "default_video", "4k", "default"];
	}

	if (videoPricing.resolution === "hd") {
		return videoPricing.includeAudio
			? ["hd_audio", "default_audio", "hd", "default"]
			: ["hd_video", "default_video", "hd", "default"];
	}

	if (videoPricing.resolution === "1080p") {
		return videoPricing.includeAudio
			? ["1080p_audio", "hd_audio", "default_audio", "1080p", "hd", "default"]
			: ["1080p_video", "hd_video", "default_video", "1080p", "hd", "default"];
	}

	return videoPricing.includeAudio
		? ["default_audio", "default"]
		: ["default_video", "default"];
}

export function getProviderSelectionPrice(
	providerInfo:
		| Pick<
				ProviderModelMapping,
				| "discount"
				| "inputPrice"
				| "outputPrice"
				| "perSecondPrice"
				| "requestPrice"
		  >
		| undefined,
	videoPricing?: VideoPricingContext,
): number {
	const discount = providerInfo?.discount ?? 0;
	const discountMultiplier = 1 - discount;
	const inputPrice = providerInfo?.inputPrice;
	const outputPrice = providerInfo?.outputPrice;
	const requestPrice = providerInfo?.requestPrice;
	const hasAnyTokenPrice =
		inputPrice !== undefined || outputPrice !== undefined;
	const hasPositiveTokenPrice = (inputPrice ?? 0) > 0 || (outputPrice ?? 0) > 0;

	if (providerInfo?.perSecondPrice && videoPricing) {
		for (const billingKey of getPerSecondBillingKeys(videoPricing)) {
			const perSecondPrice = providerInfo.perSecondPrice[billingKey];
			if (perSecondPrice !== undefined) {
				return (
					perSecondPrice * videoPricing.durationSeconds * discountMultiplier
				);
			}
		}
	}

	if (hasPositiveTokenPrice) {
		return (((inputPrice ?? 0) + (outputPrice ?? 0)) / 2) * discountMultiplier;
	}

	if (requestPrice !== undefined && !hasPositiveTokenPrice) {
		return requestPrice * discountMultiplier;
	}

	if (hasAnyTokenPrice) {
		return (((inputPrice ?? 0) + (outputPrice ?? 0)) / 2) * discountMultiplier;
	}

	return 0;
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
	const videoPricing = options?.videoPricing;
	// Use higher price weight for image generation models
	const isImageModel = modelWithPricing.output?.includes("image") ?? false;
	const effectivePriceWeight = isImageModel ? IMAGE_PRICE_WEIGHT : PRICE_WEIGHT;
	if (availableModelProviders.length === 0) {
		return null;
	}

	// Filter out unstable and experimental providers
	const stableProviders = availableModelProviders.filter((provider) => {
		const providerInfo = modelWithPricing.providers.find(
			(p) =>
				p.providerId === provider.providerId && p.region === provider.region,
		);
		const providerStability = providerInfo?.stability;
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
	if (!isTestProcess() && Math.random() < EXPLORATION_RATE) {
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
		return selectByPriceOnly(stableProviders, modelWithPricing, videoPricing);
	}

	// Calculate scores for each provider
	const providerScores: ProviderScore<T>[] = [];

	for (const provider of stableProviders) {
		const providerInfo = modelWithPricing.providers.find(
			(p) =>
				p.providerId === provider.providerId && p.region === provider.region,
		);
		const price = getProviderSelectionPrice(providerInfo, videoPricing);

		const mKey = metricsKey(
			modelWithPricing.id,
			provider.providerId,
			provider.region,
		);
		const metrics = metricsMap.get(mKey);

		providerScores.push({
			provider,
			score: 0, // Will be calculated below
			price,
			uptime: metrics?.uptime,
			latency: metrics?.averageLatency,
			throughput: metrics?.throughput,
		});
	}

	// Find best values for ratio-based scoring
	// Instead of min-max normalization (which loses magnitude of differences),
	// we use ratios against the best value so actual proportional differences
	// are preserved. e.g., a provider 50% cheaper scores much better than one 5% cheaper.
	const prices = providerScores.map((p) => p.price);
	const minPrice = Math.min(...prices);

	const uptimes = providerScores.map((p) => p.uptime ?? DEFAULT_UPTIME);
	const maxUptime = Math.max(...uptimes);

	const throughputs = providerScores.map(
		(p) => p.throughput ?? DEFAULT_THROUGHPUT,
	);
	const maxThroughput = Math.max(...throughputs);

	const latencies = providerScores.map((p) => p.latency ?? DEFAULT_LATENCY);
	const minLatency = Math.min(...latencies);

	// Calculate ratio-based scores
	for (const providerScore of providerScores) {
		// Price ratio: 0 = cheapest, 0.5 = 50% more expensive, 1.0 = 2x more expensive
		// This preserves the actual magnitude of price differences
		/* eslint-disable no-mixed-operators */
		const priceScore = minPrice > 0 ? providerScore.price / minPrice - 1 : 0;
		/* eslint-enable no-mixed-operators */

		// Uptime ratio: 0 = best uptime, proportional penalty for worse uptime
		const uptime = providerScore.uptime ?? DEFAULT_UPTIME;
		/* eslint-disable no-mixed-operators */
		const uptimeScore = uptime > 0 ? maxUptime / uptime - 1 : 1;
		/* eslint-enable no-mixed-operators */

		// Calculate exponential penalty for truly unstable providers
		const uptimePenalty = calculateUptimePenalty(uptime);

		// Throughput ratio: 0 = fastest, 0.5 = 50% slower, 1.0 = 2x slower
		// This preserves the actual magnitude of throughput differences
		const throughput = providerScore.throughput ?? DEFAULT_THROUGHPUT;
		/* eslint-disable no-mixed-operators */
		const throughputScore = throughput > 0 ? maxThroughput / throughput - 1 : 1;
		/* eslint-enable no-mixed-operators */

		// Latency ratio: 0 = fastest, proportional penalty for slower
		// Only consider latency for streaming requests since it's only measured there
		let latencyScore = 0;
		if (isStreaming) {
			const latency = providerScore.latency ?? DEFAULT_LATENCY;
			/* eslint-disable no-mixed-operators */
			latencyScore = minLatency > 0 ? latency / minLatency - 1 : 0;
			/* eslint-enable no-mixed-operators */
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
		/* eslint-disable no-mixed-operators */
		const baseScore =
			(effectivePriceWeight / weightSum) * priceScore +
			(UPTIME_WEIGHT / weightSum) * uptimeScore +
			(THROUGHPUT_WEIGHT / weightSum) * throughputScore +
			(effectiveLatencyWeight / weightSum) * latencyScore;
		/* eslint-enable no-mixed-operators */

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
				region: p.provider.region,
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
	videoPricing?: VideoPricingContext,
): ProviderSelectionResult<T> {
	let cheapestProvider = stableProviders[0];
	let lowestEffectivePrice = Number.MAX_VALUE;

	const providerPrices: Array<{
		providerId: string;
		region?: string;
		price: number;
		effectivePrice: number;
		priority: number;
	}> = [];

	for (const provider of stableProviders) {
		const providerInfo = modelWithPricing.providers.find(
			(p) =>
				p.providerId === provider.providerId && p.region === provider.region,
		);
		const totalPrice = getProviderSelectionPrice(providerInfo, videoPricing);

		// Apply provider priority: lower priority = effectively higher price
		const providerDef = getProviderDefinition(provider.providerId);
		const priority = providerDef?.priority ?? 1;
		const effectivePrice = priority > 0 ? totalPrice / priority : totalPrice;

		providerPrices.push({
			providerId: provider.providerId,
			region: provider.region,
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
			region: p.region,
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
