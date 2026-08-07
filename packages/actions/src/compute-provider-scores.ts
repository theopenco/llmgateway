import { Decimal } from "decimal.js";

import type { ResolvedRoutingConfig } from "@llmgateway/shared/routing-config";

export interface ScoringFlags {
	isStreaming: boolean;
	isImageModel: boolean;
	/**
	 * Whether cache support participates in the score. Only true when the
	 * request's estimated prompt tokens reach thresholds.cachePromptTokens.
	 */
	cacheRelevant: boolean;
}

export interface EffectiveScoringWeights {
	price: number;
	uptime: number;
	throughput: number;
	latency: number;
	cache: number;
	total: number;
}

/**
 * Resolve the weights that actually apply to a request: image models swap in
 * the image price weight, latency only counts for streaming requests, and
 * cache support only counts for prompts large enough to benefit from caching.
 */
export function getEffectiveScoringWeights(
	cfg: ResolvedRoutingConfig,
	flags: ScoringFlags,
): EffectiveScoringWeights {
	const { weights } = cfg;
	const price = flags.isImageModel ? weights.imagePrice : weights.price;
	const latency = flags.isStreaming ? weights.latency : 0;
	const cache = flags.cacheRelevant ? weights.cache : 0;
	return {
		price,
		uptime: weights.uptime,
		throughput: weights.throughput,
		latency,
		cache,
		total: price + weights.uptime + weights.throughput + latency + cache,
	};
}

export function calculateUptimePenalty(
	uptime: number,
	threshold: number,
): number {
	if (uptime >= threshold) {
		return 0;
	}
	const deficit = (threshold - uptime) / threshold;
	return Math.pow(deficit * 5, 2);
}

export interface CandidateScoreInput {
	price: Decimal;
	uptime?: number;
	latency?: number;
	throughput?: number;
	cacheSupported: boolean;
	priority: number;
}

export interface CandidateScoreBreakdown {
	/** Final score: baseScore + priorityPenalty + uptimePenalty. Lower wins. */
	score: Decimal;
	baseScore: Decimal;
	/** Per-factor ratio scores before weighting (0 = best candidate). */
	priceScore: Decimal;
	uptimeScore: Decimal;
	throughputScore: Decimal;
	latencyScore: Decimal;
	cacheScore: Decimal;
	/** Per-factor weighted contributions; they sum to baseScore. */
	priceContribution: Decimal;
	uptimeContribution: Decimal;
	throughputContribution: Decimal;
	latencyContribution: Decimal;
	cacheContribution: Decimal;
	priorityPenalty: Decimal;
	uptimePenalty: Decimal;
}

/**
 * The weighted-score core of provider election, extracted so routing and the
 * admin routing-analytics endpoint share one formula. Sub-scores are ratios
 * against the best candidate (so proportional differences are preserved),
 * missing metrics fall back to thresholds.default*, and the caller must
 * guarantee weights.total > 0 (routing falls back to price-only otherwise).
 * Returns one breakdown per input, aligned by index.
 */
export function computeWeightedProviderScores(
	candidates: CandidateScoreInput[],
	cfg: ResolvedRoutingConfig,
	flags: ScoringFlags,
): CandidateScoreBreakdown[] {
	if (candidates.length === 0) {
		return [];
	}
	const { thresholds } = cfg;
	const weights = getEffectiveScoringWeights(cfg, flags);
	if (weights.total <= 0) {
		// Every contribution would divide by zero and decimal.js yields NaN
		// silently, so surface the caller's mistake instead of returning scores
		// that quietly compare as equal.
		throw new Error(
			"computeWeightedProviderScores requires weights.total > 0; fall back to price-only selection when every weight is zeroed",
		);
	}
	const weightSum = new Decimal(weights.total);

	const minPrice = candidates.reduce(
		(min, c) => (c.price.lt(min) ? c.price : min),
		candidates[0].price,
	);

	// When the cheapest provider is free (minPrice == 0), the price/minPrice ratio
	// is undefined, so without this a free and a paid provider would both score 0
	// on price and the decision would fall to uptime/throughput — letting a paid
	// provider beat a free one even under `routing: "price"`. Rank paid providers
	// against the cheapest *positive* price instead, so a free provider always
	// scores best (0) while paid providers stay ordered among themselves.
	const minPositivePrice = candidates.reduce<Decimal | null>((min, c) => {
		if (c.price.gt(0) && (min === null || c.price.lt(min))) {
			return c.price;
		}
		return min;
	}, null);

	const uptimes = candidates.map((c) => c.uptime ?? thresholds.defaultUptime);
	const maxUptime = Math.max(...uptimes);

	const throughputs = candidates.map(
		(c) => c.throughput ?? thresholds.defaultThroughput,
	);
	const maxThroughput = Math.max(...throughputs);

	const latencies = candidates.map(
		(c) => c.latency ?? thresholds.defaultLatency,
	);
	const minLatency = Math.min(...latencies);

	return candidates.map((candidate) => {
		// Price ratio: 0 = cheapest, 0.5 = 50% more expensive, 1.0 = 2x more expensive
		// This preserves the actual magnitude of price differences
		const priceScore = minPrice.gt(0)
			? candidate.price.div(minPrice).minus(1)
			: candidate.price.gt(0) && minPositivePrice
				? candidate.price.div(minPositivePrice)
				: new Decimal(0);

		// Uptime ratio: 0 = best uptime, proportional penalty for worse uptime
		const uptime = candidate.uptime ?? thresholds.defaultUptime;
		const uptimeScore =
			uptime > 0 ? new Decimal(maxUptime).div(uptime).minus(1) : new Decimal(1);

		const uptimePenalty = new Decimal(
			calculateUptimePenalty(uptime, thresholds.uptimePenalty),
		);

		// Throughput ratio: 0 = fastest, 0.5 = 50% slower, 1.0 = 2x slower
		const throughput = candidate.throughput ?? thresholds.defaultThroughput;
		const throughputScore =
			throughput > 0
				? new Decimal(maxThroughput).div(throughput).minus(1)
				: new Decimal(1);

		// Latency ratio: 0 = fastest, proportional penalty for slower
		// Only consider latency for streaming requests since it's only measured there
		let latencyScore = new Decimal(0);
		if (flags.isStreaming) {
			const latency = candidate.latency ?? thresholds.defaultLatency;
			latencyScore =
				minLatency > 0
					? new Decimal(latency).div(minLatency).minus(1)
					: new Decimal(0);
		}

		// Cache score: 0 when this provider supports prompt caching, 1 otherwise.
		const cacheScore = candidate.cacheSupported
			? new Decimal(0)
			: new Decimal(1);

		const priceContribution = new Decimal(weights.price)
			.div(weightSum)
			.times(priceScore);
		const uptimeContribution = new Decimal(weights.uptime)
			.div(weightSum)
			.times(uptimeScore);
		const throughputContribution = new Decimal(weights.throughput)
			.div(weightSum)
			.times(throughputScore);
		const latencyContribution = new Decimal(weights.latency)
			.div(weightSum)
			.times(latencyScore);
		const cacheContribution = new Decimal(weights.cache)
			.div(weightSum)
			.times(cacheScore);

		const baseScore = priceContribution
			.plus(uptimeContribution)
			.plus(throughputContribution)
			.plus(latencyContribution)
			.plus(cacheContribution);

		// Apply provider priority: lower priority = higher score (less preferred)
		// Priority defaults to 1. We add (1 - priority) as a penalty.
		const priorityPenalty = new Decimal(1).minus(candidate.priority);

		return {
			score: baseScore.plus(priorityPenalty).plus(uptimePenalty),
			baseScore,
			priceScore,
			uptimeScore,
			throughputScore,
			latencyScore,
			cacheScore,
			priceContribution,
			uptimeContribution,
			throughputContribution,
			latencyContribution,
			cacheContribution,
			priorityPenalty,
			uptimePenalty,
		};
	});
}
