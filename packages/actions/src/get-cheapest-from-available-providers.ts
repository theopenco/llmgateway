import { Decimal } from "decimal.js";

import { type ProviderMetrics, metricsKey } from "@llmgateway/db";
import {
	getProviderDefinition,
	type AvailableModelProvider,
	type ModelWithPricing,
	type ProviderModelMapping,
} from "@llmgateway/models";
import {
	getDefaultRoutingConfig,
	type ResolvedRoutingConfig,
} from "@llmgateway/shared/routing-config";

interface ProviderScore<T extends AvailableModelProvider> {
	provider: T;
	score: Decimal;
	price: Decimal;
	uptime?: number;
	latency?: number;
	throughput?: number;
	cacheSupported?: boolean;
}

function calculateUptimePenalty(uptime: number, threshold: number): number {
	if (uptime >= threshold) {
		return 0;
	}
	const deficit = (threshold - uptime) / threshold;
	return Math.pow(deficit * 5, 2);
}

function getExplorationRate(cfg: ResolvedRoutingConfig): number {
	const rawExplorationRate = process.env.EXPLORATION_RATE;

	if (rawExplorationRate === undefined || rawExplorationRate.trim() === "") {
		return cfg.thresholds.explorationRate;
	}

	const explorationRate = Number(rawExplorationRate);
	if (
		!Number.isFinite(explorationRate) ||
		explorationRate < 0 ||
		explorationRate > 1
	) {
		throw new Error(
			`Invalid EXPLORATION_RATE: "${rawExplorationRate}". Expected a number between 0 and 1.`,
		);
	}

	return explorationRate;
}

function getEffectivePriority(
	providerId: string,
	cfg: ResolvedRoutingConfig,
): number {
	const override = cfg.providerPriorities[providerId];
	if (typeof override === "number") {
		return override;
	}
	const providerDef = getProviderDefinition(providerId);
	return providerDef?.priority ?? 1;
}

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
	usedApiKeyHash?: string;
	providerScores: Array<{
		providerId: string;
		region?: string;
		score: number;
		uptime?: number;
		latency?: number;
		throughput?: number;
		price: number;
		priority?: number;
		cacheSupported?: boolean;
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
	// Whether the request explicitly included an X-No-Fallback header
	xNoFallbackHeaderSet?: boolean;
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
		region?: string;
		status_code: number;
		error_type: string;
		succeeded: boolean;
		apiKeyHash?: string;
		logId?: string;
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
	/**
	 * Estimated prompt tokens for the request. When provided and at or above
	 * the configured cache prompt threshold, cache support is factored into the
	 * weighted score.
	 */
	promptTokens?: number;
	/**
	 * Sticky-routing session identifier. When provided, the provider (and
	 * region) is chosen deterministically via rendezvous hashing so that all
	 * requests for the same session pin to the same provider, maximizing
	 * upstream prompt-cache hits. Price/uptime scoring is bypassed; the session
	 * only moves to another provider when its pinned provider is no longer in
	 * the available list (e.g. excluded by health filtering or removed by the
	 * retry-fallback loop after the provider failed).
	 */
	sessionId?: string;
	routingConfig?: ResolvedRoutingConfig;
}

/**
 * FNV-1a 32-bit hash mapped to the unit interval [0, 1). Deterministic across
 * processes, no crypto needed.
 */
function hashToUnitInterval(input: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0) / 0xffffffff;
}

/**
 * Rendezvous (highest-random-weight) hashing: deterministically pick one
 * provider for a session. Unlike modulo hashing, removing a provider only
 * reassigns the sessions that were pinned to it — every other session keeps
 * its provider.
 */
function selectStickyProvider<T extends AvailableModelProvider>(
	providers: T[],
	sessionId: string,
): T {
	let best = providers[0];
	let bestWeight = -1;
	for (const provider of providers) {
		const weight = hashToUnitInterval(
			`${sessionId}|${provider.providerId}|${provider.region ?? ""}`,
		);
		if (weight > bestWeight) {
			bestWeight = weight;
			best = provider;
		}
	}
	return best;
}

function findProviderMapping<P extends ModelWithPricing["providers"][number]>(
	providers: P[],
	candidate: AvailableModelProvider,
): P | undefined {
	// Identify a mapping by (providerId, region) — externalId is the upstream
	// id and is never used to disambiguate internal lookups.
	return providers.find(
		(p) =>
			p.providerId === candidate.providerId && p.region === candidate.region,
	);
}

function providerSupportsCaching(
	providerInfo:
		| {
				cachedInputPrice?: string;
				pricingTiers?: ProviderModelMapping["pricingTiers"];
				regions?: ProviderModelMapping["regions"];
		  }
		| undefined,
): boolean {
	if (!providerInfo) {
		return false;
	}
	if (providerInfo.cachedInputPrice !== undefined) {
		return true;
	}
	if (
		providerInfo.pricingTiers?.some(
			(tier) => tier.cachedInputPrice !== undefined,
		)
	) {
		return true;
	}
	if (
		providerInfo.regions?.some(
			(region) =>
				region.cachedInputPrice !== undefined ||
				region.pricingTiers?.some(
					(tier) => tier.cachedInputPrice !== undefined,
				),
		)
	) {
		return true;
	}
	return false;
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
				"inputPrice" | "outputPrice" | "perSecondPrice" | "requestPrice"
		  >
		| undefined,
	videoPricing?: VideoPricingContext,
): Decimal {
	const inputPrice = providerInfo?.inputPrice;
	const outputPrice = providerInfo?.outputPrice;
	const requestPrice = providerInfo?.requestPrice;
	const hasAnyTokenPrice =
		inputPrice !== undefined || outputPrice !== undefined;
	const hasPositiveTokenPrice =
		new Decimal(inputPrice ?? "0").gt(0) ||
		new Decimal(outputPrice ?? "0").gt(0);

	if (providerInfo?.perSecondPrice && videoPricing) {
		for (const billingKey of getPerSecondBillingKeys(videoPricing)) {
			const perSecondPrice = providerInfo.perSecondPrice[billingKey];
			if (perSecondPrice !== undefined) {
				return new Decimal(perSecondPrice).times(videoPricing.durationSeconds);
			}
		}
	}

	if (hasPositiveTokenPrice) {
		return new Decimal(inputPrice ?? "0").plus(outputPrice ?? "0").div(2);
	}

	if (requestPrice !== undefined && !hasPositiveTokenPrice) {
		return new Decimal(requestPrice);
	}

	if (hasAnyTokenPrice) {
		return new Decimal(inputPrice ?? "0").plus(outputPrice ?? "0").div(2);
	}

	return new Decimal(0);
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
	const promptTokens = options?.promptTokens;
	const cfg = options?.routingConfig ?? getDefaultRoutingConfig();
	const { weights, thresholds } = cfg;
	// Use higher price weight for image generation models
	const isImageModel = modelWithPricing.output?.includes("image") ?? false;
	const effectivePriceWeight = isImageModel
		? weights.imagePrice
		: weights.price;
	const cacheSupportRelevant =
		promptTokens !== undefined && promptTokens >= thresholds.cachePromptTokens;
	if (availableModelProviders.length === 0) {
		return null;
	}

	// Filter out unstable and experimental providers, plus providers explicitly
	// disabled via routing override (priority 0).
	const stableProviders = availableModelProviders.filter((provider) => {
		const providerInfo = findProviderMapping(
			modelWithPricing.providers,
			provider,
		);
		const providerStability = providerInfo?.stability;
		const modelStability =
			"stability" in modelWithPricing
				? (modelWithPricing as { stability?: string }).stability
				: undefined;
		const effectiveStability = providerStability ?? modelStability;
		if (
			effectiveStability === "unstable" ||
			effectiveStability === "experimental"
		) {
			return false;
		}
		return getEffectivePriority(provider.providerId, cfg) > 0;
	});

	if (stableProviders.length === 0) {
		return null;
	}

	// Sticky routing: when a session id is provided (and session stickiness is
	// enabled for the project), pin the session to a single provider via
	// rendezvous hashing. Bypasses scoring and exploration so the upstream
	// prompt cache stays warm; the session only moves if its provider leaves
	// the available list (health filtering or retry-fallback exclusion).
	const sessionId = options?.sessionId?.trim();
	if (sessionId && cfg.session.enabled) {
		const stickyProvider = selectStickyProvider(stableProviders, sessionId);
		return {
			provider: stickyProvider,
			metadata: {
				availableProviders: stableProviders.map((p) => p.providerId),
				selectedProvider: stickyProvider.providerId,
				selectionReason: "session-sticky",
				providerScores: stableProviders.map((provider) => {
					const providerInfo = findProviderMapping(
						modelWithPricing.providers,
						provider,
					);
					const providerDef = getProviderDefinition(provider.providerId);
					const priority = providerDef?.priority ?? 1;
					const metrics = metricsMap?.get(
						metricsKey(
							modelWithPricing.id,
							provider.providerId,
							provider.region,
						),
					);

					return {
						providerId: provider.providerId,
						region: provider.region,
						score: 0,
						uptime: metrics?.uptime,
						latency: metrics?.averageLatency,
						throughput: metrics?.throughput,
						price: getProviderSelectionPrice(
							providerInfo,
							videoPricing,
						).toNumber(),
						priority,
						cacheSupported: providerSupportsCaching(
							providerInfo as ProviderModelMapping | undefined,
						),
					};
				}),
			},
		};
	}

	// Epsilon-greedy exploration: randomly select a provider some % of the time
	// (configurable per project via thresholds.explorationRate). Skip during tests
	// to keep behavior deterministic.
	if (!isTestProcess() && Math.random() < getExplorationRate(cfg)) {
		const randomProvider =
			stableProviders[Math.floor(Math.random() * stableProviders.length)];
		return {
			provider: randomProvider,
			metadata: {
				availableProviders: stableProviders.map((p) => p.providerId),
				selectedProvider: randomProvider.providerId,
				selectionReason: "random-exploration",
				providerScores: stableProviders.map((provider) => {
					const providerInfo = findProviderMapping(
						modelWithPricing.providers,
						provider,
					);
					const priority = getEffectivePriority(provider.providerId, cfg);
					const metrics = metricsMap?.get(
						metricsKey(
							modelWithPricing.id,
							provider.providerId,
							provider.region,
						),
					);

					return {
						providerId: provider.providerId,
						region: provider.region,
						score: 0,
						uptime: metrics?.uptime,
						latency: metrics?.averageLatency,
						throughput: metrics?.throughput,
						price: getProviderSelectionPrice(
							providerInfo,
							videoPricing,
						).toNumber(),
						priority,
						cacheSupported: providerSupportsCaching(
							providerInfo as ProviderModelMapping | undefined,
						),
					};
				}),
			},
		};
	}

	// If no metrics provided, fall back to price-only selection
	if (!metricsMap || metricsMap.size === 0) {
		return selectByPriceOnly(
			stableProviders,
			modelWithPricing,
			videoPricing,
			cfg,
		);
	}

	// If the project zeroed out every scoring weight, the weighted-score path
	// would divide by zero. Fall back to price-only selection (still honoring
	// per-provider priority overrides and the priority-0 disable).
	const effectiveLatencyWeight = isStreaming ? weights.latency : 0;
	const effectiveCacheWeight = cacheSupportRelevant ? weights.cache : 0;
	const totalWeight =
		effectivePriceWeight +
		weights.uptime +
		weights.throughput +
		effectiveLatencyWeight +
		effectiveCacheWeight;
	if (totalWeight <= 0) {
		return selectByPriceOnly(
			stableProviders,
			modelWithPricing,
			videoPricing,
			cfg,
		);
	}

	// Calculate scores for each provider
	const providerScores: ProviderScore<T>[] = [];

	for (const provider of stableProviders) {
		const providerInfo = findProviderMapping(
			modelWithPricing.providers,
			provider,
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
			score: new Decimal(0), // Will be calculated below
			price,
			uptime: metrics?.uptime,
			latency: metrics?.averageLatency,
			throughput: metrics?.throughput,
			cacheSupported: providerSupportsCaching(
				providerInfo as ProviderModelMapping | undefined,
			),
		});
	}

	// Find best values for ratio-based scoring
	// Instead of min-max normalization (which loses magnitude of differences),
	// we use ratios against the best value so actual proportional differences
	// are preserved. e.g., a provider 50% cheaper scores much better than one 5% cheaper.
	const minPrice = providerScores.reduce(
		(min, p) => (p.price.lt(min) ? p.price : min),
		providerScores[0].price,
	);

	const uptimes = providerScores.map(
		(p) => p.uptime ?? thresholds.defaultUptime,
	);
	const maxUptime = Math.max(...uptimes);

	const throughputs = providerScores.map(
		(p) => p.throughput ?? thresholds.defaultThroughput,
	);
	const maxThroughput = Math.max(...throughputs);

	const latencies = providerScores.map(
		(p) => p.latency ?? thresholds.defaultLatency,
	);
	const minLatency = Math.min(...latencies);

	// Calculate ratio-based scores
	for (const providerScore of providerScores) {
		// Price ratio: 0 = cheapest, 0.5 = 50% more expensive, 1.0 = 2x more expensive
		// This preserves the actual magnitude of price differences
		const priceScore = minPrice.gt(0)
			? providerScore.price.div(minPrice).minus(1)
			: new Decimal(0);

		// Uptime ratio: 0 = best uptime, proportional penalty for worse uptime
		const uptime = providerScore.uptime ?? thresholds.defaultUptime;
		const uptimeScore =
			uptime > 0 ? new Decimal(maxUptime).div(uptime).minus(1) : new Decimal(1);

		// Calculate exponential penalty for truly unstable providers
		const uptimePenalty = new Decimal(
			calculateUptimePenalty(uptime, thresholds.uptimePenalty),
		);

		// Throughput ratio: 0 = fastest, 0.5 = 50% slower, 1.0 = 2x slower
		// This preserves the actual magnitude of throughput differences
		const throughput = providerScore.throughput ?? thresholds.defaultThroughput;
		const throughputScore =
			throughput > 0
				? new Decimal(maxThroughput).div(throughput).minus(1)
				: new Decimal(1);

		// Latency ratio: 0 = fastest, proportional penalty for slower
		// Only consider latency for streaming requests since it's only measured there
		let latencyScore = new Decimal(0);
		if (isStreaming) {
			const latency = providerScore.latency ?? thresholds.defaultLatency;
			latencyScore =
				minLatency > 0
					? new Decimal(latency).div(minLatency).minus(1)
					: new Decimal(0);
		}

		// Cache score: 0 when this provider supports prompt caching, 1 otherwise.
		// Only weighted in when the prompt is large enough for caching to matter.
		const cacheScore = providerScore.cacheSupported
			? new Decimal(0)
			: new Decimal(1);

		// Calculate base weighted score (lower is better)
		// When not streaming, latency weight is redistributed to other factors
		// Image generation models use a higher price weight, and cache weight is
		// dropped for short prompts where caching has no measurable effect.
		// totalWeight is guaranteed > 0 above (zero-total falls back to
		// price-only selection earlier in this function).
		const weightSum = new Decimal(totalWeight);
		const baseScore = new Decimal(effectivePriceWeight)
			.div(weightSum)
			.times(priceScore)
			.plus(new Decimal(weights.uptime).div(weightSum).times(uptimeScore))
			.plus(
				new Decimal(weights.throughput).div(weightSum).times(throughputScore),
			)
			.plus(
				new Decimal(effectiveLatencyWeight).div(weightSum).times(latencyScore),
			)
			.plus(new Decimal(effectiveCacheWeight).div(weightSum).times(cacheScore));

		// Apply provider priority: lower priority = higher score (less preferred)
		// Priority defaults to 1. We add (1 - priority) as a penalty.
		const priority = getEffectivePriority(
			providerScore.provider.providerId,
			cfg,
		);
		const priorityPenalty = new Decimal(1).minus(priority);

		// Final score = base weighted score + priority penalty + exponential uptime penalty
		// The uptime penalty heavily penalizes providers with <95% uptime
		providerScore.score = baseScore.plus(priorityPenalty).plus(uptimePenalty);
	}

	// Select provider with lowest score
	let bestProvider = providerScores[0];
	for (const providerScore of providerScores) {
		if (providerScore.score.lt(bestProvider.score)) {
			bestProvider = providerScore;
		}
	}

	// Build routing metadata
	const metadata: RoutingMetadata = {
		availableProviders: providerScores.map((p) => p.provider.providerId),
		selectedProvider: bestProvider.provider.providerId,
		selectionReason: metricsMap ? "weighted-score" : "price-only",
		providerScores: providerScores.map((p) => {
			const priority = getEffectivePriority(p.provider.providerId, cfg);
			return {
				providerId: p.provider.providerId,
				region: p.provider.region,
				score: p.score.toDecimalPlaces(3).toNumber(),
				uptime: p.uptime,
				latency: p.latency,
				throughput: p.throughput,
				price: p.price.toNumber(), // Keep full precision for very small prices
				priority,
				cacheSupported: p.cacheSupported,
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
	videoPricing: VideoPricingContext | undefined,
	cfg: ResolvedRoutingConfig,
): ProviderSelectionResult<T> {
	let cheapestProvider = stableProviders[0];
	let lowestEffectivePrice: Decimal | null = null;

	const providerPrices: Array<{
		providerId: string;
		region?: string;
		price: Decimal;
		effectivePrice: Decimal;
		priority: number;
	}> = [];

	for (const provider of stableProviders) {
		const providerInfo = findProviderMapping(
			modelWithPricing.providers,
			provider,
		);
		const totalPrice = getProviderSelectionPrice(providerInfo, videoPricing);

		// Apply provider priority: lower priority = effectively higher price
		const priority = getEffectivePriority(provider.providerId, cfg);
		const effectivePrice = priority > 0 ? totalPrice.div(priority) : totalPrice;

		providerPrices.push({
			providerId: provider.providerId,
			region: provider.region,
			price: totalPrice,
			effectivePrice,
			priority,
		});

		if (
			lowestEffectivePrice === null ||
			effectivePrice.lt(lowestEffectivePrice)
		) {
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
			price: p.price.toNumber(),
			priority: p.priority,
		})),
	};

	return {
		provider: cheapestProvider,
		metadata,
	};
}
