import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import {
	getDiscountedProviderSelectionPrice,
	getProviderSelectionPrice,
	providerSupportsCaching,
	computeWeightedProviderScores,
	getEffectiveScoringWeights,
	type CachePricingContext,
	type CandidateScoreInput,
	type ScoringFlags,
} from "@llmgateway/actions";
import {
	and,
	db,
	effectiveTtftTotals,
	eq,
	excludeRegionalMappingRows,
	getEffectiveDiscount,
	getProviderMetricsFromHistory,
	getRoutingScoreAdjustment,
	metricsKey,
	gte,
	modelProviderMappingHistoryHourly,
	routingElectionHourly,
	routingExclusionHourly,
} from "@llmgateway/db";
import {
	getProviderDefinition,
	models,
	type ProviderModelMapping,
	type ModelDefinition,
} from "@llmgateway/models";
import {
	deriveStabilityMetrics,
	providerSupportsCachedInput,
} from "@llmgateway/shared";
import { isMappingDeactivated } from "@llmgateway/shared/deactivation";
import {
	applyRoutingPreference,
	getDefaultRoutingConfig,
	type ResolvedRoutingConfig,
} from "@llmgateway/shared/routing-config";
import {
	routingExclusionReasonParent,
	routingSelectionKind,
} from "@llmgateway/shared/routing-telemetry";

import type { ServerTypes } from "@/vars.js";

export const adminRoutingAnalytics = new OpenAPIHono<ServerTypes>();

adminRoutingAnalytics.use("/*", adminMiddleware);

const routingWindowSchema = z.enum(["24h", "3d", "7d"]);

const WINDOW_HOURS: Record<z.infer<typeof routingWindowSchema>, number> = {
	"24h": 24,
	"3d": 72,
	"7d": 168,
};

const scoreBreakdownSchema = z
	.object({
		priceScore: z.number(),
		uptimeScore: z.number(),
		throughputScore: z.number(),
		latencyScore: z.number(),
		cacheScore: z.number(),
		priceContribution: z.number(),
		uptimeContribution: z.number(),
		throughputContribution: z.number(),
		latencyContribution: z.number(),
		cacheContribution: z.number(),
		priorityPenalty: z.number(),
		uptimePenalty: z.number(),
		baseScore: z.number(),
	})
	.openapi({});

const providerHourEntrySchema = z
	.object({
		providerId: z.string(),
		// All traffic, including BYOK.
		requestCount: z.number(),
		// Error counts and metrics cover credit-funded traffic only, as routing does.
		errorCount: z.number(),
		clientErrorCount: z.number(),
		// Derived metric inputs; null when the mapping saw no credit-funded traffic
		// in the hour (routing then falls back to thresholds.default*).
		uptime: z.number().nullable(),
		latency: z.number().nullable(),
		throughput: z.number().nullable(),
		score: z.number().nullable(),
		breakdown: scoreBreakdownSchema.nullable(),
	})
	.openapi({});

const electionKindEntrySchema = z
	.object({
		kind: z.string(),
		requestCount: z.number(),
	})
	.openapi({});

const routingHourSchema = z
	.object({
		hour: z.string(),
		providers: z.array(providerHourEntrySchema),
		elections: z.array(electionKindEntrySchema),
	})
	.openapi({});

const routingMappingSchema = z
	.object({
		providerId: z.string(),
		providerName: z.string(),
		stability: z.string(),
		deactivatedAt: z.string().nullable(),
		priority: z.number(),
		listPrice: z.number(),
		discount: z.number(),
		price: z.number(),
		routingAdjustment: z.number(),
		cacheSupported: z.boolean(),
		routable: z.boolean(),
		excludedReasons: z.array(z.string()),
	})
	.openapi({});

const serviceTierCountsSchema = z
	.object({
		requestCount: z.number(),
		explicit: z.number(),
		implicit: z.number(),
		served: z.number(),
		unconfirmed: z.number(),
	})
	.openapi({});

const exclusionDetailSchema = z
	.object({
		reason: z.string(),
		excludedCount: z.number(),
	})
	.openapi({});

const exclusionEntrySchema = z
	.object({
		reason: z.string(),
		excludedCount: z.number(),
		/**
		 * Finer-grained reasons that break this one down — currently which
		 * compliance rule fired. Recorded alongside the parent, never instead of
		 * it, so they are nested here rather than listed as siblings: a consumer
		 * summing both would count every drop twice.
		 */
		details: z.array(exclusionDetailSchema),
	})
	.openapi({});

/**
 * Turn a flat reason -> count map into top-level entries with their detail
 * reasons nested. A detail whose parent has no row (data written before the
 * detail codes existed, or a partially rerun rollup) stays top-level rather
 * than being attached to an invented parent count.
 */
function toExclusionEntries(
	reasonMap: Map<string, number> | undefined,
): z.infer<typeof exclusionEntrySchema>[] {
	const totals = new Map<string, number>();
	const detailsByParent = new Map<string, Map<string, number>>();
	for (const [reason, excludedCount] of reasonMap ?? []) {
		const parent = routingExclusionReasonParent(reason);
		if (parent && reasonMap?.has(parent)) {
			let details = detailsByParent.get(parent);
			if (!details) {
				details = new Map();
				detailsByParent.set(parent, details);
			}
			details.set(reason, (details.get(reason) ?? 0) + excludedCount);
			continue;
		}
		totals.set(reason, (totals.get(reason) ?? 0) + excludedCount);
	}
	return Array.from(totals, ([reason, excludedCount]) => ({
		reason,
		excludedCount,
		details: Array.from(
			detailsByParent.get(reason) ?? [],
			([detailReason, detailCount]) => ({
				reason: detailReason,
				excludedCount: detailCount,
			}),
		).sort((a, b) => b.excludedCount - a.excludedCount),
	})).sort((a, b) => b.excludedCount - a.excludedCount);
}

/**
 * Runtime eligibility for one mapping: how often it was actually a candidate,
 * how often it was dropped, and which constraint dropped it most. This is what
 * distinguishes "the score lost" from "the score was never consulted" — the
 * static `excludedReasons` above only knows catalogue state.
 */
const mappingEligibilitySchema = z
	.object({
		providerId: z.string(),
		candidateCount: z.number(),
		/** Routing decisions the mapping was dropped from, counted once each. */
		excludedCount: z.number(),
		/**
		 * excluded / candidate, or null when the mapping has no exclusion telemetry
		 * in the window. Candidate totals come from `routing_exclusion_hourly`,
		 * which has no row for a mapping that was never excluded, so null covers
		 * both "always eligible" and "no data" — it is not a claim that the mapping
		 * saw no routing decisions.
		 */
		exclusionRate: z.number().nullable(),
		topReason: z.string().nullable(),
		/**
		 * Per-reason counts. These sum to at least `excludedCount` and often more,
		 * because one decision can trip several constraints on the same mapping.
		 */
		exclusions: z.array(exclusionEntrySchema),
		serviceTier: serviceTierCountsSchema,
	})
	.openapi({});

const electionReasonEntrySchema = z
	.object({
		selectionReason: z.string(),
		kind: z.string(),
		requestCount: z.number(),
	})
	.openapi({});

const providerElectionsSchema = z
	.object({
		providerId: z.string(),
		requestCount: z.number(),
		byKind: z.array(electionKindEntrySchema),
		byReason: z.array(electionReasonEntrySchema),
	})
	.openapi({});

const routingElectionsSchema = z
	.object({
		requestCount: z.number(),
		/** Requests whose provider was decided by the weighted score. */
		scoredCount: z.number(),
		/** Mean candidate-set size the router chose between, null without traffic. */
		averageCandidateCount: z.number().nullable(),
		byKind: z.array(electionKindEntrySchema),
		byReason: z.array(electionReasonEntrySchema),
		/** The same election paths, split by the provider that was picked. */
		byProvider: z.array(providerElectionsSchema),
	})
	.openapi({});

const routingSummaryEntrySchema = z
	.object({
		providerId: z.string(),
		requestCount: z.number(),
		errorCount: z.number(),
		uptime: z.number().nullable(),
		latency: z.number().nullable(),
		throughput: z.number().nullable(),
		score: z.number().nullable(),
		breakdown: scoreBreakdownSchema.nullable(),
	})
	.openapi({});

const effectiveWeightsSchema = z
	.object({
		price: z.number(),
		uptime: z.number(),
		throughput: z.number(),
		latency: z.number(),
		cache: z.number(),
		total: z.number(),
	})
	.openapi({});

const liveProviderMetricsSchema = z
	.object({
		providerId: z.string(),
		uptime: z.number().nullable(),
		latency: z.number().nullable(),
		throughput: z.number().nullable(),
		sampleRequests: z.number(),
	})
	.openapi({});

const scenarioResultSchema = z
	.object({
		/** Routable mappings, best score first. */
		providers: z.array(
			z
				.object({
					providerId: z.string(),
					/** Price the score ranked: discounted, cache-blended, adjusted. */
					price: z.number(),
					score: z.number(),
					breakdown: scoreBreakdownSchema,
				})
				.openapi({}),
		),
		winnerProviderId: z.string().nullable(),
		runnerUpProviderId: z.string().nullable(),
		/** Runner-up score minus winner score, null with fewer than two mappings. */
		margin: z.number().nullable(),
		/**
		 * `price-only` when no candidate has metrics: routing then ranks by
		 * price / priority, and `score` is the premium over the cheapest.
		 */
		method: z.enum(["weighted", "price-only"]),
	})
	.openapi({});

/**
 * One request shape the router scores differently: streaming, cache relevance,
 * org-kind cache assumptions, and per-request routing preference all reshape
 * the formula, so a single score cannot say who wins every request.
 */
const routingScenarioSchema = z
	.object({
		id: z.string(),
		label: z.string(),
		description: z.string(),
		effectiveWeights: effectiveWeightsSchema,
		cachePricing: z
			.object({ hitRate: z.number(), outputRatio: z.number() })
			.nullable(),
		/** Whether an organization's incumbent provider is kept within the sticky margin. */
		hysteresis: z.boolean(),
		/** Routable mappings this request shape never considers. */
		excludedProviderIds: z.array(z.string()),
		/** Scored on the window's plain hourly averages. */
		window: scenarioResultSchema,
		/** Scored on the router's own tier-weighted recent window. */
		live: scenarioResultSchema,
	})
	.openapi({});

const routingAnalyticsResponseSchema = z
	.object({
		model: z
			.object({
				id: z.string(),
				name: z.string().nullable(),
				family: z.string(),
				isImageModel: z.boolean(),
			})
			.openapi({}),
		config: z
			.object({
				weights: z
					.object({
						price: z.number(),
						imagePrice: z.number(),
						uptime: z.number(),
						throughput: z.number(),
						latency: z.number(),
						cache: z.number(),
					})
					.openapi({}),
				effectiveWeights: effectiveWeightsSchema,
				thresholds: z
					.object({
						cachePromptTokens: z.number(),
						cacheHitRate: z.number(),
						cacheOutputRatio: z.number(),
						uptimePenalty: z.number(),
						defaultUptime: z.number(),
						defaultLatency: z.number(),
						defaultThroughput: z.number(),
						explorationRate: z.number(),
					})
					.openapi({}),
				sticky: z
					.object({
						enabled: z.boolean(),
						ttlSeconds: z.number(),
						uptimeThreshold: z.number(),
						scoreMargin: z.number(),
					})
					.openapi({}),
				session: z
					.object({
						enabled: z.boolean(),
						ttlSeconds: z.number(),
						uptimeThreshold: z.number(),
					})
					.openapi({}),
				retry: z
					.object({
						maxRetries: z.number(),
						lowUptimeFallbackThreshold: z.number(),
					})
					.openapi({}),
				history: z
					.object({
						windowMinutes: z.number(),
						tier1Minutes: z.number(),
						tier2Minutes: z.number(),
						tier1Weight: z.number(),
						tier2Weight: z.number(),
						tier3Weight: z.number(),
					})
					.openapi({}),
			})
			.openapi({}),
		window: routingWindowSchema,
		mappings: z.array(routingMappingSchema),
		summary: z.array(routingSummaryEntrySchema),
		hourly: z.array(routingHourSchema),
		elections: routingElectionsSchema,
		eligibility: z.array(mappingEligibilitySchema),
		/** Model-wide exclusion totals, for the reason breakdown. */
		exclusions: z.array(exclusionEntrySchema),
		/** Model-wide service-tier coverage. */
		serviceTier: serviceTierCountsSchema,
		/**
		 * The metrics routing reads right now: the same credits-only,
		 * tier-weighted aggregation the gateway runs over its history window.
		 */
		live: z
			.object({
				windowMinutes: z.number(),
				providers: z.array(liveProviderMetricsSchema),
			})
			.openapi({}),
		scenarios: z.array(routingScenarioSchema),
	})
	.openapi({});

interface HourlyTotals {
	requestCount: number;
	clientErrorCount: number;
	gatewayErrorCount: number;
	upstreamErrorCount: number;
	totalDuration: number;
	totalOutputTokens: number;
	totalTimeToFirstToken: number;
	timeToFirstTokenCount: number;
	totalTimeToFirstReasoningToken: number;
	timeToFirstReasoningTokenCount: number;
	serviceTierExplicitCount: number;
	serviceTierImplicitCount: number;
	serviceTierServedCount: number;
	serviceTierUnconfirmedCount: number;
}

function emptyTotals(): HourlyTotals {
	return {
		requestCount: 0,
		clientErrorCount: 0,
		gatewayErrorCount: 0,
		upstreamErrorCount: 0,
		totalDuration: 0,
		totalOutputTokens: 0,
		totalTimeToFirstToken: 0,
		timeToFirstTokenCount: 0,
		totalTimeToFirstReasoningToken: 0,
		timeToFirstReasoningTokenCount: 0,
		serviceTierExplicitCount: 0,
		serviceTierImplicitCount: 0,
		serviceTierServedCount: 0,
		serviceTierUnconfirmedCount: 0,
	};
}

function addRow(
	totals: HourlyTotals,
	row: typeof modelProviderMappingHistoryHourly.$inferSelect,
): void {
	totals.requestCount += row.logsCount;
	totals.clientErrorCount += row.clientErrorsCount;
	totals.gatewayErrorCount += row.gatewayErrorsCount;
	totals.upstreamErrorCount += row.upstreamErrorsCount;
	totals.totalDuration += row.totalDuration;
	totals.totalOutputTokens += row.totalOutputTokens;
	totals.totalTimeToFirstToken += row.totalTimeToFirstToken;
	totals.timeToFirstTokenCount += row.timeToFirstTokenCount;
	totals.totalTimeToFirstReasoningToken += row.totalTimeToFirstReasoningToken;
	totals.timeToFirstReasoningTokenCount += row.timeToFirstReasoningTokenCount;
	totals.serviceTierExplicitCount += row.serviceTierExplicitCount;
	totals.serviceTierImplicitCount += row.serviceTierImplicitCount;
	totals.serviceTierServedCount += row.serviceTierServedCount;
	totals.serviceTierUnconfirmedCount += row.serviceTierUnconfirmedCount;
}

function serviceTierCounts(
	totals: HourlyTotals,
): z.infer<typeof serviceTierCountsSchema> {
	return {
		requestCount: totals.requestCount,
		explicit: totals.serviceTierExplicitCount,
		implicit: totals.serviceTierImplicitCount,
		served: totals.serviceTierServedCount,
		unconfirmed: totals.serviceTierUnconfirmedCount,
	};
}

interface DerivedMetrics {
	uptime: number | null;
	latency: number | null;
	throughput: number | null;
}

// Mirrors rowToMetrics in packages/db/src/provider-metrics-history.ts, minus
// the tier weighting: routing weights recent minutes higher, while this view
// deliberately smooths each bucket into a plain hourly average.
function nestedMap<K, V>(
	outer: Map<K, Map<string, V>>,
	key: K,
): Map<string, V> {
	let inner = outer.get(key);
	if (!inner) {
		inner = new Map();
		outer.set(key, inner);
	}
	return inner;
}

function totalsFor(
	totals: Map<string, HourlyTotals>,
	providerId: string,
): HourlyTotals {
	let bucket = totals.get(providerId);
	if (!bucket) {
		bucket = emptyTotals();
		totals.set(providerId, bucket);
	}
	return bucket;
}

function deriveMetrics(totals: HourlyTotals): DerivedMetrics {
	if (totals.requestCount <= 0) {
		return { uptime: null, latency: null, throughput: null };
	}
	const { uptime } = deriveStabilityMetrics({
		logsCount: totals.requestCount,
		clientErrorsCount: totals.clientErrorCount,
		gatewayErrorsCount: totals.gatewayErrorCount,
		upstreamErrorsCount: totals.upstreamErrorCount,
	});
	const { total: effectiveTtft, count: effectiveTtftCount } =
		effectiveTtftTotals(totals);
	const latency =
		effectiveTtft > 0 && effectiveTtftCount > 0
			? effectiveTtft / effectiveTtftCount
			: null;
	const throughput =
		totals.totalDuration > 0
			? (totals.totalOutputTokens / totals.totalDuration) * 1000
			: null;
	return { uptime, latency, throughput };
}

function round(value: number, decimals: number): number {
	const factor = Math.pow(10, decimals);
	return Math.round(value * factor) / factor;
}

interface MappingInfo {
	providerId: string;
	providerName: string;
	stability: string;
	deactivatedAt: string | null;
	priority: number;
	/** Catalogue selection price, before any discount. */
	listPrice: number;
	/** Platform-wide discount fraction applied to listPrice (0 when none). */
	discount: number;
	/** Selection price after discounts: listPrice * (1 - discount). */
	price: number;
	/**
	 * Signed routing-score multiplier plus Airside margin adjustment; the score
	 * uses price * (1 + routingAdjustment), matching live election.
	 */
	routingAdjustment: number;
	cacheSupported: boolean;
	routable: boolean;
	excludedReasons: string[];
}

type AnalyticsMapping = Pick<
	ProviderModelMapping,
	| "externalId"
	| "inputPrice"
	| "outputPrice"
	| "cachedInputPrice"
	| "requestPrice"
	| "perSecondPrice"
	| "perImagePrice"
	| "pricingTiers"
	| "peakPricing"
	| "regions"
	| "stability"
	| "deactivatedAt"
> & { providerId: string; status?: string; providerName?: string };

async function buildMappingInfos(model: {
	id: string;
	stability?: ModelDefinition["stability"];
	providers: readonly ProviderModelMapping[];
}): Promise<{ info: MappingInfo; source: AnalyticsMapping }[]> {
	const listings = await db.query.modelProviderMapping.findMany({
		where: {
			modelId: model.id,
			source: "airside",
			region: { isNull: true },
		},
		with: { provider: true },
	});
	const ownedProviders = new Set(listings.map((row) => row.providerId));
	const mappings: AnalyticsMapping[] = [
		...model.providers.filter(
			(mapping) => !ownedProviders.has(mapping.providerId),
		),
		...listings.map((row) => ({
			providerId: row.providerId,
			externalId: row.externalId,
			providerName: row.provider?.name,
			status: row.status,
			inputPrice: row.inputPrice ?? undefined,
			outputPrice: row.outputPrice ?? undefined,
			cachedInputPrice: row.cachedInputPrice ?? undefined,
			requestPrice: row.requestPrice ?? undefined,
			stability: row.stability,
			deactivatedAt: row.deactivatedAt ?? undefined,
		})),
	];
	const activeCarriers = await db.query.providerClaim.findMany({
		where: {
			kind: "custom",
			status: "active",
			customBaseUrl: { isNotNull: true },
		},
		columns: { providerId: true },
	});
	const activeCarrierIds = new Set(
		activeCarriers.map((carrier) => carrier.providerId),
	);
	return await Promise.all(
		mappings.map(async (mapping) => {
			const providerDef = getProviderDefinition(mapping.providerId);
			const modelStability =
				"stability" in model
					? (model.stability as string | undefined)
					: undefined;
			const stability = mapping.stability ?? modelStability ?? "stable";
			const priority = providerDef?.priority ?? 1;
			const excludedReasons: string[] = [];
			if (mapping.status && mapping.status !== "active") {
				excludedReasons.push("listing inactive");
			}
			if (!providerDef && !activeCarrierIds.has(mapping.providerId)) {
				excludedReasons.push("carrier inactive or unapproved");
			}
			// Only a deactivation date that has actually passed excludes a mapping.
			// Routing itself compares against the date, so a scheduled (future)
			// deactivation still elects and serves traffic — flagging it here would
			// show the mapping as unroutable and drop it from the score table while
			// it is demonstrably receiving requests.
			if (isMappingDeactivated(mapping)) {
				excludedReasons.push("deactivated");
			}
			if (stability === "unstable" || stability === "experimental") {
				excludedReasons.push(`stability: ${stability}`);
			}
			if (priority <= 0) {
				excludedReasons.push("priority disabled");
			}
			// Routing scores the discounted price, so this page has to as well or
			// the score it shows would not be the score that elected the provider.
			// This view is not scoped to an organization, so only platform-wide
			// (global) discounts are resolved — an org-specific discount can still
			// shift that org's price below what is shown here.
			const { price, discount } = await getDiscountedProviderSelectionPrice(
				mapping,
				model.id,
				{
					providerDiscountResolver: async (provider, modelId) =>
						(await getEffectiveDiscount(null, provider.providerId, modelId))
							.discount,
				},
			);
			const rawAdjustment = Number(
				await getRoutingScoreAdjustment(mapping.providerId, model.id),
			);
			const routingAdjustment =
				Number.isFinite(rawAdjustment) && rawAdjustment >= -1
					? rawAdjustment
					: 0;
			const info: MappingInfo = {
				providerId: mapping.providerId,
				providerName:
					mapping.providerName ?? providerDef?.name ?? mapping.providerId,
				stability,
				deactivatedAt: mapping.deactivatedAt
					? mapping.deactivatedAt.toISOString()
					: null,
				priority,
				listPrice: getProviderSelectionPrice(mapping).toNumber(),
				discount: discount.toNumber(),
				price: price.toNumber(),
				routingAdjustment,
				cacheSupported: providerSupportsCaching(mapping),
				routable: excludedReasons.length === 0,
				excludedReasons,
			};
			return { info, source: mapping };
		}),
	);
}

type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;

interface ScoredEntry {
	/** Rounded for display. */
	score: number;
	/** Unrounded, so near-ties still rank the way routing does. */
	rawScore: Decimal;
	breakdown: ScoreBreakdown;
}

// The common case: a streaming text request with a prompt below the cache
// threshold, matching how most chat traffic is elected.
const STREAMING_FLAGS = { isStreaming: true, cacheRelevant: false } as const;

function scoreEntries(
	routableMappings: MappingInfo[],
	metricsByProvider: Map<string, DerivedMetrics>,
	cfg: ResolvedRoutingConfig,
	flags: ScoringFlags,
	/** Pre-adjustment selection prices; defaults to each mapping's price. */
	prices?: Map<string, Decimal>,
): Map<string, ScoredEntry> {
	const candidates: CandidateScoreInput[] = routableMappings.map((mapping) => {
		const metrics = metricsByProvider.get(mapping.providerId);
		const price = prices?.get(mapping.providerId) ?? new Decimal(mapping.price);
		return {
			price: price.times(1 + mapping.routingAdjustment),
			uptime: metrics?.uptime ?? undefined,
			latency: metrics?.latency ?? undefined,
			throughput: metrics?.throughput ?? undefined,
			cacheSupported: mapping.cacheSupported,
			priority: mapping.priority,
		};
	});
	const breakdowns = computeWeightedProviderScores(candidates, cfg, flags);
	const result = new Map<string, ScoredEntry>();
	for (const [index, mapping] of routableMappings.entries()) {
		const b = breakdowns[index];
		result.set(mapping.providerId, {
			score: b.score.toDecimalPlaces(3).toNumber(),
			rawScore: b.score,
			breakdown: {
				priceScore: round(b.priceScore.toNumber(), 4),
				uptimeScore: round(b.uptimeScore.toNumber(), 4),
				throughputScore: round(b.throughputScore.toNumber(), 4),
				latencyScore: round(b.latencyScore.toNumber(), 4),
				cacheScore: round(b.cacheScore.toNumber(), 4),
				priceContribution: round(b.priceContribution.toNumber(), 4),
				uptimeContribution: round(b.uptimeContribution.toNumber(), 4),
				throughputContribution: round(b.throughputContribution.toNumber(), 4),
				latencyContribution: round(b.latencyContribution.toNumber(), 4),
				cacheContribution: round(b.cacheContribution.toNumber(), 4),
				priorityPenalty: round(b.priorityPenalty.toNumber(), 4),
				uptimePenalty: round(b.uptimePenalty.toNumber(), 4),
				baseScore: round(b.baseScore.toNumber(), 4),
			},
		});
	}
	return result;
}

interface ScenarioDefinition {
	id: string;
	label: string;
	description: string;
	cfg: ResolvedRoutingConfig;
	isStreaming: boolean;
	cacheRelevant: boolean;
	/** Sessions pin per session instead of using org-level hysteresis. */
	session: boolean;
	/** Coding plans only route to mappings with a cached input price. */
	cachedInputOnly: boolean;
}

const BASE_SCENARIO = {
	...STREAMING_FLAGS,
	session: false,
	cachedInputOnly: false,
} as const;

/**
 * The request shapes the router scores differently, all under default routing
 * config.
 */
function buildScenarios(): ScenarioDefinition[] {
	const cfg = getDefaultRoutingConfig();
	const scenarios: ScenarioDefinition[] = [
		{
			id: "streaming",
			label: "Streaming",
			description:
				"Streaming request with a prompt below the cache threshold, on default weights.",
			cfg,
			...BASE_SCENARIO,
		},
		{
			id: "non-streaming",
			label: "Non-streaming",
			description:
				"Latency is only measured on streams, so its weight drops out.",
			cfg,
			...BASE_SCENARIO,
			isStreaming: false,
		},
		{
			id: "cached-api",
			label: "Large prompt",
			description: `Prompt of ${cfg.thresholds.cachePromptTokens}+ tokens: cached input reads are priced in.`,
			cfg,
			...BASE_SCENARIO,
			cacheRelevant: true,
		},
		{
			id: "coding-session",
			label: "DevPass session",
			description:
				"Coding-plan session: only mappings with a cached input price, mostly cached input, little output.",
			cfg: getDefaultRoutingConfig("devpass"),
			...BASE_SCENARIO,
			cacheRelevant: true,
			session: true,
			cachedInputOnly: true,
		},
		{
			id: "chat-session",
			label: "Chat session",
			description: "Session on the chat cache profile.",
			cfg: getDefaultRoutingConfig("chat"),
			...BASE_SCENARIO,
			cacheRelevant: true,
			session: true,
		},
	];
	for (const preference of ["price", "throughput", "latency"] as const) {
		scenarios.push({
			id: preference,
			label: `routing: ${preference}`,
			description: `Request with routing: "${preference}": ${preference} weighted 90%, uptime 10%.`,
			cfg: applyRoutingPreference(cfg, preference),
			...BASE_SCENARIO,
		});
	}
	return scenarios;
}

// Matches how the gateway turns the resolved thresholds into cache pricing.
function scenarioCachePricing(
	scenario: ScenarioDefinition,
): CachePricingContext | null {
	if (!scenario.cacheRelevant) {
		return null;
	}
	return {
		hitRate: Math.min(1, Math.max(0, scenario.cfg.thresholds.cacheHitRate)),
		outputRatio: Math.max(0, scenario.cfg.thresholds.cacheOutputRatio),
	};
}

function hasMetrics(metrics: DerivedMetrics | undefined): boolean {
	return (
		metrics !== undefined &&
		(metrics.uptime !== null ||
			metrics.latency !== null ||
			metrics.throughput !== null)
	);
}

function priceOnlyEntries(
	candidates: MappingInfo[],
	routingPrices: Map<string, Decimal>,
): Map<string, ScoredEntry> {
	// Mirrors selectByPriceOnly: routing price divided by priority.
	const effective = new Map(
		candidates.map((mapping) => {
			const price = routingPrices.get(mapping.providerId)!;
			return [
				mapping.providerId,
				mapping.priority > 0 ? price.div(mapping.priority) : price,
			] as const;
		}),
	);
	const values = Array.from(effective.values());
	const min = Decimal.min(...values);
	const positive = values.filter((value) => value.gt(0));
	const minPositive = positive.length > 0 ? Decimal.min(...positive) : null;
	const result = new Map<string, ScoredEntry>();
	for (const [providerId, value] of effective) {
		// Expressed as the premium over the cheapest, like the price factor.
		const premium = min.gt(0)
			? value.div(min).minus(1)
			: value.gt(0) && minPositive
				? value.div(minPositive)
				: new Decimal(0);
		const rounded = round(premium.toNumber(), 4);
		result.set(providerId, {
			score: premium.toDecimalPlaces(3).toNumber(),
			// Rank on the effective price itself so ties resolve as routing does.
			rawScore: value,
			breakdown: {
				priceScore: rounded,
				uptimeScore: 0,
				throughputScore: 0,
				latencyScore: 0,
				cacheScore: 0,
				priceContribution: rounded,
				uptimeContribution: 0,
				throughputContribution: 0,
				latencyContribution: 0,
				cacheContribution: 0,
				priorityPenalty: 0,
				uptimePenalty: 0,
				baseScore: rounded,
			},
		});
	}
	return result;
}

function rankScenario(
	candidates: MappingInfo[],
	metricsByProvider: Map<string, DerivedMetrics>,
	cfg: ResolvedRoutingConfig,
	flags: ScoringFlags,
	prices: Map<string, Decimal>,
	/** Live routing falls back to price-only when no candidate has metrics. */
	priceOnlyWithoutMetrics: boolean,
): z.infer<typeof scenarioResultSchema> {
	const routingPrices = new Map(
		candidates.map((mapping) => [
			mapping.providerId,
			(prices.get(mapping.providerId) ?? new Decimal(mapping.price)).times(
				1 + mapping.routingAdjustment,
			),
		]),
	);
	const priceOnly =
		priceOnlyWithoutMetrics &&
		candidates.length > 0 &&
		!candidates.some((mapping) =>
			hasMetrics(metricsByProvider.get(mapping.providerId)),
		);
	const scores = priceOnly
		? priceOnlyEntries(candidates, routingPrices)
		: scoreEntries(candidates, metricsByProvider, cfg, flags, prices);
	const ranked = candidates
		.map((mapping) => {
			const scored = scores.get(mapping.providerId)!;
			return {
				providerId: mapping.providerId,
				price: routingPrices.get(mapping.providerId)!.toNumber(),
				score: scored.score,
				breakdown: scored.breakdown,
				rawScore: scored.rawScore,
			};
		})
		.sort((a, b) => a.rawScore.comparedTo(b.rawScore));
	const [winner, runnerUp] = ranked;
	return {
		providers: ranked.map(({ providerId, price, score, breakdown }) => ({
			providerId,
			price,
			score,
			breakdown,
		})),
		winnerProviderId: winner?.providerId ?? null,
		runnerUpProviderId: runnerUp?.providerId ?? null,
		margin:
			winner && runnerUp
				? priceOnly
					? round(runnerUp.score - winner.score, 3)
					: runnerUp.rawScore
							.minus(winner.rawScore)
							.toDecimalPlaces(3)
							.toNumber()
				: null,
		method: priceOnly ? "price-only" : "weighted",
	};
}

function sumByKind(byReason: Map<string, number>): Map<string, number> {
	const byKind = new Map<string, number>();
	for (const [selectionReason, requestCount] of byReason) {
		const kind = routingSelectionKind(selectionReason);
		byKind.set(kind, (byKind.get(kind) ?? 0) + requestCount);
	}
	return byKind;
}

function kindEntries(
	byKind: Map<string, number>,
): z.infer<typeof electionKindEntrySchema>[] {
	return Array.from(byKind, ([kind, requestCount]) => ({
		kind,
		requestCount,
	})).sort((a, b) => b.requestCount - a.requestCount);
}

function reasonEntries(
	byReason: Map<string, number>,
): z.infer<typeof electionReasonEntrySchema>[] {
	return Array.from(byReason, ([selectionReason, requestCount]) => ({
		selectionReason,
		kind: routingSelectionKind(selectionReason),
		requestCount,
	})).sort((a, b) => b.requestCount - a.requestCount);
}

const getRoutingAnalytics = createRoute({
	method: "get",
	path: "/routing-analytics",
	request: {
		query: z.object({
			modelId: z.string(),
			window: routingWindowSchema.default("3d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: routingAnalyticsResponseSchema,
				},
			},
			description:
				"Hourly per-provider routing inputs (uptime, latency, throughput, price, priority) and the resulting weighted routing score for every mapping of a model.",
		},
		404: {
			description: "Model not found.",
		},
	},
});

adminRoutingAnalytics.openapi(getRoutingAnalytics, async (c) => {
	const query = c.req.valid("query");
	const window = query.window ?? "3d";
	const hours = WINDOW_HOURS[window];

	const staticModel = models.find((m) => m.id === query.modelId);
	const databaseModel = staticModel
		? undefined
		: await db.query.model.findFirst({
				where: { id: query.modelId, status: "active" },
			});
	const model =
		staticModel ??
		(databaseModel
			? {
					id: databaseModel.id,
					name: databaseModel.name,
					family: databaseModel.family,
					stability: databaseModel.stability ?? undefined,
					output: databaseModel.output,
					providers: [],
				}
			: undefined);
	if (!model) {
		throw new HTTPException(404, {
			message: `Model ${query.modelId} not found`,
		});
	}

	const cfg = getDefaultRoutingConfig();
	const isImageModel =
		"output" in model
			? ((model.output as string[] | undefined)?.includes("image") ?? false)
			: false;
	const resolvedMappings = await buildMappingInfos(model);
	const mappings = resolvedMappings.map(({ info }) => info);
	const routableMappings = mappings.filter((m) => m.routable);

	const hourEnd = new Date();
	hourEnd.setUTCMinutes(0, 0, 0);
	const windowMs = (hours - 1) * 3_600_000;
	const windowStart = new Date(hourEnd.getTime() - windowMs);

	const [rows, electionRows, exclusionRows, liveMetrics] = await Promise.all([
		db
			.select()
			.from(modelProviderMappingHistoryHourly)
			.where(
				and(
					eq(modelProviderMappingHistoryHourly.modelId, model.id),
					gte(modelProviderMappingHistoryHourly.hourTimestamp, windowStart),
					// This view reports per provider, and the region-less root row
					// already carries the provider's regional traffic.
					excludeRegionalMappingRows(modelProviderMappingHistoryHourly),
				),
			),
		db
			.select()
			.from(routingElectionHourly)
			.where(
				and(
					eq(routingElectionHourly.modelId, model.id),
					gte(routingElectionHourly.hourTimestamp, windowStart),
				),
			),
		db
			.select()
			.from(routingExclusionHourly)
			.where(
				and(
					eq(routingExclusionHourly.modelId, model.id),
					gte(routingExclusionHourly.hourTimestamp, windowStart),
				),
			),
		// The gateway's own routing input: same aggregation, window and cache.
		getProviderMetricsFromHistory(
			mappings.map((mapping) => ({
				modelId: model.id,
				providerId: mapping.providerId,
			})),
			cfg.history,
		),
	]);

	// Sum rows into per-(hour, provider) and per-provider window totals. The
	// unique key is (mappingId, hour, usedMode), so a provider can contribute
	// multiple rows to the same bucket.
	//
	// Traffic totals count every request. Metric totals feed uptime, latency,
	// throughput and scores, and mirror the router, which reads credit-funded
	// traffic only: a customer's failing BYOK key must not sink the mapping.
	// Legacy "unknown" rows predate the usedMode split and stay in.
	const hourlyTotals = new Map<number, Map<string, HourlyTotals>>();
	const windowTotals = new Map<string, HourlyTotals>();
	const hourlyMetricTotals = new Map<number, Map<string, HourlyTotals>>();
	const windowMetricTotals = new Map<string, HourlyTotals>();
	for (const row of rows) {
		const hourMs = row.hourTimestamp.getTime();
		addRow(totalsFor(nestedMap(hourlyTotals, hourMs), row.providerId), row);
		addRow(totalsFor(windowTotals, row.providerId), row);
		if (row.usedMode !== "api-keys") {
			addRow(
				totalsFor(nestedMap(hourlyMetricTotals, hourMs), row.providerId),
				row,
			);
			addRow(totalsFor(windowMetricTotals, row.providerId), row);
		}
	}

	// Election rows: window totals per selection reason, plus a per-hour breakdown
	// by kind for the stacked view over time.
	const electionsByReason = new Map<string, number>();
	const electionsByKindPerHour = new Map<number, Map<string, number>>();
	const electionsByProviderReason = new Map<string, Map<string, number>>();
	let electionRequestCount = 0;
	let electionCandidateTotal = 0;
	for (const row of electionRows) {
		electionRequestCount += row.requestCount;
		electionCandidateTotal += row.candidateCount;
		electionsByReason.set(
			row.selectionReason,
			(electionsByReason.get(row.selectionReason) ?? 0) + row.requestCount,
		);
		let providerReasons = electionsByProviderReason.get(row.providerId);
		if (!providerReasons) {
			providerReasons = new Map();
			electionsByProviderReason.set(row.providerId, providerReasons);
		}
		providerReasons.set(
			row.selectionReason,
			(providerReasons.get(row.selectionReason) ?? 0) + row.requestCount,
		);
		const hourMs = row.hourTimestamp.getTime();
		let kindMap = electionsByKindPerHour.get(hourMs);
		if (!kindMap) {
			kindMap = new Map();
			electionsByKindPerHour.set(hourMs, kindMap);
		}
		const kind = routingSelectionKind(row.selectionReason);
		kindMap.set(kind, (kindMap.get(kind) ?? 0) + row.requestCount);
	}

	const electionsByKind = sumByKind(electionsByReason);

	// Exclusion rows: per-provider reason totals. `candidateCount` and
	// `excludedDecisionCount` are repeated on every reason row for a mapping-hour,
	// so both are reduced per (hour, provider) with max() before being summed
	// across hours — summing them alongside the reasons would multiply them by the
	// number of reasons that fired. max() rather than "first row wins" because the
	// query has no ORDER BY, and a partially rerun aggregation can leave two rows
	// of one bucket disagreeing; taking the largest keeps the denominator
	// deterministic either way.
	const exclusionsByProvider = new Map<string, Map<string, number>>();
	const candidateCountByBucket = new Map<string, number>();
	const excludedDecisionsByBucket = new Map<string, number>();
	const providerByBucket = new Map<string, string>();
	for (const row of exclusionRows) {
		let reasonMap = exclusionsByProvider.get(row.providerId);
		if (!reasonMap) {
			reasonMap = new Map();
			exclusionsByProvider.set(row.providerId, reasonMap);
		}
		reasonMap.set(
			row.reason,
			(reasonMap.get(row.reason) ?? 0) + row.excludedCount,
		);
		const bucketKey = `${row.hourTimestamp.getTime()}:${row.providerId}`;
		providerByBucket.set(bucketKey, row.providerId);
		candidateCountByBucket.set(
			bucketKey,
			Math.max(candidateCountByBucket.get(bucketKey) ?? 0, row.candidateCount),
		);
		excludedDecisionsByBucket.set(
			bucketKey,
			Math.max(
				excludedDecisionsByBucket.get(bucketKey) ?? 0,
				row.excludedDecisionCount,
			),
		);
	}

	const candidateCountByProvider = new Map<string, number>();
	const excludedDecisionsByProvider = new Map<string, number>();
	for (const [bucketKey, providerId] of providerByBucket) {
		candidateCountByProvider.set(
			providerId,
			(candidateCountByProvider.get(providerId) ?? 0) +
				(candidateCountByBucket.get(bucketKey) ?? 0),
		);
		excludedDecisionsByProvider.set(
			providerId,
			(excludedDecisionsByProvider.get(providerId) ?? 0) +
				(excludedDecisionsByBucket.get(bucketKey) ?? 0),
		);
	}

	const hourly: z.infer<typeof routingHourSchema>[] = [];
	for (let i = 0; i < hours; i++) {
		const hourOffsetMs = i * 3_600_000;
		const hour = new Date(windowStart.getTime() + hourOffsetMs);
		const providerMap = hourlyTotals.get(hour.getTime());
		const metricProviderMap = hourlyMetricTotals.get(hour.getTime());
		const metricsByProvider = new Map<string, DerivedMetrics>();
		for (const mapping of mappings) {
			metricsByProvider.set(
				mapping.providerId,
				deriveMetrics(
					metricProviderMap?.get(mapping.providerId) ?? emptyTotals(),
				),
			);
		}
		const scores = scoreEntries(routableMappings, metricsByProvider, cfg, {
			...STREAMING_FLAGS,
			isImageModel,
		});
		hourly.push({
			hour: hour.toISOString(),
			providers: mappings.map((mapping) => {
				const totals = providerMap?.get(mapping.providerId) ?? emptyTotals();
				const metricTotals =
					metricProviderMap?.get(mapping.providerId) ?? emptyTotals();
				const metrics = metricsByProvider.get(mapping.providerId)!;
				const scored = scores.get(mapping.providerId);
				return {
					providerId: mapping.providerId,
					requestCount: totals.requestCount,
					errorCount:
						metricTotals.gatewayErrorCount + metricTotals.upstreamErrorCount,
					clientErrorCount: metricTotals.clientErrorCount,
					uptime: metrics.uptime !== null ? round(metrics.uptime, 2) : null,
					latency: metrics.latency !== null ? round(metrics.latency, 0) : null,
					throughput:
						metrics.throughput !== null ? round(metrics.throughput, 2) : null,
					score: scored?.score ?? null,
					breakdown: scored?.breakdown ?? null,
				};
			}),
			elections: Array.from(
				electionsByKindPerHour.get(hour.getTime()) ?? [],
				([kind, requestCount]) => ({ kind, requestCount }),
			).sort((a, b) => b.requestCount - a.requestCount),
		});
	}

	const windowMetricsByProvider = new Map<string, DerivedMetrics>();
	for (const mapping of mappings) {
		windowMetricsByProvider.set(
			mapping.providerId,
			deriveMetrics(
				windowMetricTotals.get(mapping.providerId) ?? emptyTotals(),
			),
		);
	}
	const windowScores = scoreEntries(
		routableMappings,
		windowMetricsByProvider,
		cfg,
		{ ...STREAMING_FLAGS, isImageModel },
	);
	const summary = mappings.map((mapping) => {
		const totals = windowTotals.get(mapping.providerId) ?? emptyTotals();
		const metricTotals =
			windowMetricTotals.get(mapping.providerId) ?? emptyTotals();
		const metrics = windowMetricsByProvider.get(mapping.providerId)!;
		const scored = windowScores.get(mapping.providerId);
		return {
			providerId: mapping.providerId,
			requestCount: totals.requestCount,
			errorCount:
				metricTotals.gatewayErrorCount + metricTotals.upstreamErrorCount,
			uptime: metrics.uptime !== null ? round(metrics.uptime, 2) : null,
			latency: metrics.latency !== null ? round(metrics.latency, 0) : null,
			throughput:
				metrics.throughput !== null ? round(metrics.throughput, 2) : null,
			score: scored?.score ?? null,
			breakdown: scored?.breakdown ?? null,
		};
	});

	const liveMetricsByProvider = new Map<string, DerivedMetrics>();
	for (const mapping of mappings) {
		const metrics = liveMetrics.get(metricsKey(model.id, mapping.providerId));
		liveMetricsByProvider.set(mapping.providerId, {
			uptime: metrics?.uptime ?? null,
			latency: metrics?.averageLatency ?? null,
			throughput: metrics?.throughput ?? null,
		});
	}

	const cachedInputProviders = new Set(
		resolvedMappings
			.filter(({ source }) => providerSupportsCachedInput(source))
			.map(({ info }) => info.providerId),
	);
	const scenarios = buildScenarios().map((scenario) => {
		const cachePricing = scenarioCachePricing(scenario);
		// Without cache pricing the selection price is the mapping's discounted
		// price; with it the cached-input blend and output ratio reshape it.
		const prices = new Map<string, Decimal>();
		if (cachePricing) {
			for (const { info, source } of resolvedMappings) {
				prices.set(
					info.providerId,
					getProviderSelectionPrice(
						source,
						undefined,
						undefined,
						cachePricing,
					).times(new Decimal(1).minus(info.discount)),
				);
			}
		}
		const flags = {
			isStreaming: scenario.isStreaming,
			isImageModel,
			cacheRelevant: scenario.cacheRelevant,
		};
		const candidates = scenario.cachedInputOnly
			? routableMappings.filter((mapping) =>
					cachedInputProviders.has(mapping.providerId),
				)
			: routableMappings;
		return {
			id: scenario.id,
			label: scenario.label,
			description: scenario.description,
			effectiveWeights: getEffectiveScoringWeights(scenario.cfg, flags),
			cachePricing,
			hysteresis: !scenario.session && scenario.cfg.sticky.enabled,
			excludedProviderIds: routableMappings
				.filter((mapping) => !candidates.includes(mapping))
				.map((mapping) => mapping.providerId),
			// The window is smoothed history, scored like the hourly charts.
			window: rankScenario(
				candidates,
				windowMetricsByProvider,
				scenario.cfg,
				flags,
				prices,
				false,
			),
			live: rankScenario(
				candidates,
				liveMetricsByProvider,
				scenario.cfg,
				flags,
				prices,
				true,
			),
		};
	});

	const effectiveWeights = getEffectiveScoringWeights(cfg, {
		...STREAMING_FLAGS,
		isImageModel,
	});

	// Exclusions can land on provider ids outside the catalogue mappings (e.g.
	// `custom` provider keys in auto routing). The model-wide totals include
	// them, so the per-provider breakdown must too or those reasons show a
	// total with nothing behind it.
	const eligibilityProviderIds = new Set([
		...mappings.map((mapping) => mapping.providerId),
		...exclusionsByProvider.keys(),
	]);
	const eligibility = Array.from(eligibilityProviderIds, (providerId) => {
		const exclusions = toExclusionEntries(exclusionsByProvider.get(providerId));
		// One request can drop a mapping for several reasons at once, so the
		// per-reason counts in `exclusions` sum to more than the requests the
		// mapping was actually unavailable for. `excludedCount` is the decision
		// count the aggregator recorded separately: each request counted once,
		// whatever it tripped. Deriving the rate from the reason sum instead would
		// report a mapping that served most of its requests as 0% eligible.
		const excludedCount = excludedDecisionsByProvider.get(providerId) ?? 0;
		const candidateCount = candidateCountByProvider.get(providerId) ?? 0;
		return {
			providerId,
			candidateCount,
			excludedCount,
			exclusionRate:
				candidateCount > 0
					? round(Math.min(excludedCount / candidateCount, 1), 4)
					: null,
			topReason: exclusions[0]?.reason ?? null,
			exclusions,
			serviceTier: serviceTierCounts(
				windowTotals.get(providerId) ?? emptyTotals(),
			),
		};
	});

	const modelExclusionTotals = new Map<string, number>();
	for (const reasonMap of exclusionsByProvider.values()) {
		for (const [reason, excludedCount] of reasonMap) {
			modelExclusionTotals.set(
				reason,
				(modelExclusionTotals.get(reason) ?? 0) + excludedCount,
			);
		}
	}

	const modelServiceTierTotals = emptyTotals();
	for (const totals of windowTotals.values()) {
		modelServiceTierTotals.requestCount += totals.requestCount;
		modelServiceTierTotals.serviceTierExplicitCount +=
			totals.serviceTierExplicitCount;
		modelServiceTierTotals.serviceTierImplicitCount +=
			totals.serviceTierImplicitCount;
		modelServiceTierTotals.serviceTierServedCount +=
			totals.serviceTierServedCount;
		modelServiceTierTotals.serviceTierUnconfirmedCount +=
			totals.serviceTierUnconfirmedCount;
	}

	return c.json({
		model: {
			id: model.id,
			name:
				"name" in model ? ((model.name as string | undefined) ?? null) : null,
			family: model.family,
			isImageModel,
		},
		config: {
			weights: cfg.weights,
			effectiveWeights,
			thresholds: cfg.thresholds,
			sticky: cfg.sticky,
			session: cfg.session,
			retry: cfg.retry,
			history: cfg.history,
		},
		window,
		mappings,
		summary,
		hourly,
		elections: {
			requestCount: electionRequestCount,
			scoredCount: electionsByKind.get("scored") ?? 0,
			averageCandidateCount:
				electionRequestCount > 0
					? round(electionCandidateTotal / electionRequestCount, 2)
					: null,
			byKind: kindEntries(electionsByKind),
			byReason: reasonEntries(electionsByReason),
			byProvider: Array.from(
				electionsByProviderReason,
				([providerId, byReason]) => {
					let requestCount = 0;
					for (const count of byReason.values()) {
						requestCount += count;
					}
					return {
						providerId,
						requestCount,
						byKind: kindEntries(sumByKind(byReason)),
						byReason: reasonEntries(byReason),
					};
				},
			).sort((a, b) => b.requestCount - a.requestCount),
		},
		eligibility,
		exclusions: toExclusionEntries(modelExclusionTotals),
		serviceTier: serviceTierCounts(modelServiceTierTotals),
		live: {
			windowMinutes: cfg.history.windowMinutes,
			providers: mappings.map((mapping) => {
				const metrics = liveMetricsByProvider.get(mapping.providerId)!;
				return {
					providerId: mapping.providerId,
					uptime: metrics.uptime !== null ? round(metrics.uptime, 2) : null,
					latency: metrics.latency !== null ? round(metrics.latency, 0) : null,
					throughput:
						metrics.throughput !== null ? round(metrics.throughput, 2) : null,
					sampleRequests:
						liveMetrics.get(metricsKey(model.id, mapping.providerId))
							?.totalRequests ?? 0,
				};
			}),
		},
		scenarios,
	});
});
