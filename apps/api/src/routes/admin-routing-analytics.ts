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
	type CandidateScoreInput,
} from "@llmgateway/actions";
import {
	and,
	db,
	effectiveTtftTotals,
	eq,
	excludeRegionalMappingRows,
	getEffectiveDiscount,
	gte,
	modelProviderMappingHistoryHourly,
	routingElectionHourly,
	routingExclusionHourly,
} from "@llmgateway/db";
import {
	getProviderDefinition,
	models,
	providers,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { deriveStabilityMetrics } from "@llmgateway/shared";
import { isMappingDeactivated } from "@llmgateway/shared/deactivation";
import { getDefaultRoutingConfig } from "@llmgateway/shared/routing-config";
import { routingSelectionKind } from "@llmgateway/shared/routing-telemetry";

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
		requestCount: z.number(),
		errorCount: z.number(),
		clientErrorCount: z.number(),
		// Derived metric inputs; null when the mapping saw no traffic in the hour
		// (routing then falls back to thresholds.default*).
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

const exclusionEntrySchema = z
	.object({
		reason: z.string(),
		excludedCount: z.number(),
	})
	.openapi({});

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

const routingElectionsSchema = z
	.object({
		requestCount: z.number(),
		/** Requests whose provider was decided by the weighted score. */
		scoredCount: z.number(),
		/** Mean candidate-set size the router chose between, null without traffic. */
		averageCandidateCount: z.number().nullable(),
		byKind: z.array(electionKindEntrySchema),
		byReason: z.array(electionReasonEntrySchema),
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
				effectiveWeights: z
					.object({
						price: z.number(),
						uptime: z.number(),
						throughput: z.number(),
						latency: z.number(),
						cache: z.number(),
						total: z.number(),
					})
					.openapi({}),
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
	})
	.openapi({});

interface HourlyTotals {
	requestCount: number;
	errorCount: number;
	clientErrorCount: number;
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
		errorCount: 0,
		clientErrorCount: 0,
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
	totals.errorCount += row.errorsCount;
	totals.clientErrorCount += row.clientErrorsCount;
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
function deriveMetrics(totals: HourlyTotals): DerivedMetrics {
	if (totals.requestCount <= 0) {
		return { uptime: null, latency: null, throughput: null };
	}
	const { uptime } = deriveStabilityMetrics(
		totals.requestCount,
		totals.errorCount,
		totals.clientErrorCount,
	);
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
	/** Selection price the score is computed from: listPrice * (1 - discount). */
	price: number;
	cacheSupported: boolean;
	routable: boolean;
	excludedReasons: string[];
}

async function buildMappingInfos(
	model: (typeof models)[number],
): Promise<MappingInfo[]> {
	const historicalMappings = await db.query.modelProviderMapping.findMany({
		where: {
			modelId: { eq: model.id },
			providerId: { notIn: providers.map((provider) => provider.id) },
			source: { eq: "catalogue" },
			region: { isNull: true },
		},
		with: { provider: true },
	});
	const mappings: ProviderModelMapping[] = [
		...model.providers,
		...historicalMappings.map((mapping) => ({
			providerId: mapping.providerId,
			externalId: mapping.externalId,
			streaming: mapping.streaming,
			inputPrice: mapping.inputPrice ?? undefined,
			outputPrice: mapping.outputPrice ?? undefined,
			cachedInputPrice: mapping.cachedInputPrice ?? undefined,
			requestPrice: mapping.requestPrice ?? undefined,
			deactivatedAt: mapping.deactivatedAt ?? undefined,
			stability: mapping.stability,
		})),
	];
	const historicalNames = new Map(
		historicalMappings.map((mapping) => [
			mapping.providerId,
			mapping.provider?.name ?? mapping.providerId,
		]),
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
			if (!providerDef) {
				excludedReasons.push("removed from catalogue");
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
			return {
				providerId: mapping.providerId,
				providerName:
					providerDef?.name ??
					historicalNames.get(mapping.providerId) ??
					mapping.providerId,
				stability,
				deactivatedAt: mapping.deactivatedAt
					? mapping.deactivatedAt.toISOString()
					: null,
				priority,
				listPrice: getProviderSelectionPrice(mapping).toNumber(),
				discount: discount.toNumber(),
				price: price.toNumber(),
				cacheSupported: providerSupportsCaching(mapping),
				routable: excludedReasons.length === 0,
				excludedReasons,
			};
		}),
	);
}

function scoreEntries(
	routableMappings: MappingInfo[],
	metricsByProvider: Map<string, DerivedMetrics>,
	cfg: ReturnType<typeof getDefaultRoutingConfig>,
	isImageModel: boolean,
): Map<
	string,
	{ score: number; breakdown: z.infer<typeof scoreBreakdownSchema> }
> {
	const candidates: CandidateScoreInput[] = routableMappings.map((mapping) => {
		const metrics = metricsByProvider.get(mapping.providerId);
		return {
			price: new Decimal(mapping.price),
			uptime: metrics?.uptime ?? undefined,
			latency: metrics?.latency ?? undefined,
			throughput: metrics?.throughput ?? undefined,
			cacheSupported: mapping.cacheSupported,
			priority: mapping.priority,
		};
	});
	const breakdowns = computeWeightedProviderScores(candidates, cfg, {
		// Score as the common case: a streaming text request with a prompt below
		// the cache threshold, matching how most chat traffic is elected.
		isStreaming: true,
		isImageModel,
		cacheRelevant: false,
	});
	const result = new Map<
		string,
		{ score: number; breakdown: z.infer<typeof scoreBreakdownSchema> }
	>();
	for (const [index, mapping] of routableMappings.entries()) {
		const b = breakdowns[index];
		result.set(mapping.providerId, {
			score: b.score.toDecimalPlaces(3).toNumber(),
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

	const model = models.find((m) => m.id === query.modelId);
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
	const mappings = await buildMappingInfos(model);
	const routableMappings = mappings.filter((m) => m.routable);

	const hourEnd = new Date();
	hourEnd.setUTCMinutes(0, 0, 0);
	const windowMs = (hours - 1) * 3_600_000;
	const windowStart = new Date(hourEnd.getTime() - windowMs);

	const [rows, electionRows, exclusionRows] = await Promise.all([
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
	]);

	// Sum rows into per-(hour, provider) and per-provider window totals. The
	// unique key is (mappingId, hour), so a provider whose mapping id changed
	// mid-window can contribute multiple rows to the same bucket.
	const hourlyTotals = new Map<number, Map<string, HourlyTotals>>();
	const windowTotals = new Map<string, HourlyTotals>();
	for (const row of rows) {
		const hourMs = row.hourTimestamp.getTime();
		let providerMap = hourlyTotals.get(hourMs);
		if (!providerMap) {
			providerMap = new Map();
			hourlyTotals.set(hourMs, providerMap);
		}
		let bucket = providerMap.get(row.providerId);
		if (!bucket) {
			bucket = emptyTotals();
			providerMap.set(row.providerId, bucket);
		}
		addRow(bucket, row);
		let windowBucket = windowTotals.get(row.providerId);
		if (!windowBucket) {
			windowBucket = emptyTotals();
			windowTotals.set(row.providerId, windowBucket);
		}
		addRow(windowBucket, row);
	}

	// Election rows: window totals per selection reason, plus a per-hour breakdown
	// by kind for the stacked view over time.
	const electionsByReason = new Map<string, number>();
	const electionsByKindPerHour = new Map<number, Map<string, number>>();
	let electionRequestCount = 0;
	let electionCandidateTotal = 0;
	for (const row of electionRows) {
		electionRequestCount += row.requestCount;
		electionCandidateTotal += row.candidateCount;
		electionsByReason.set(
			row.selectionReason,
			(electionsByReason.get(row.selectionReason) ?? 0) + row.requestCount,
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

	const electionsByKind = new Map<string, number>();
	for (const [selectionReason, requestCount] of electionsByReason) {
		const kind = routingSelectionKind(selectionReason);
		electionsByKind.set(kind, (electionsByKind.get(kind) ?? 0) + requestCount);
	}

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
		const metricsByProvider = new Map<string, DerivedMetrics>();
		for (const mapping of mappings) {
			metricsByProvider.set(
				mapping.providerId,
				deriveMetrics(providerMap?.get(mapping.providerId) ?? emptyTotals()),
			);
		}
		const scores = scoreEntries(
			routableMappings,
			metricsByProvider,
			cfg,
			isImageModel,
		);
		hourly.push({
			hour: hour.toISOString(),
			providers: mappings.map((mapping) => {
				const totals = providerMap?.get(mapping.providerId) ?? emptyTotals();
				const metrics = metricsByProvider.get(mapping.providerId)!;
				const scored = scores.get(mapping.providerId);
				return {
					providerId: mapping.providerId,
					requestCount: totals.requestCount,
					errorCount: totals.errorCount,
					clientErrorCount: totals.clientErrorCount,
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
			deriveMetrics(windowTotals.get(mapping.providerId) ?? emptyTotals()),
		);
	}
	const windowScores = scoreEntries(
		routableMappings,
		windowMetricsByProvider,
		cfg,
		isImageModel,
	);
	const summary = mappings.map((mapping) => {
		const totals = windowTotals.get(mapping.providerId) ?? emptyTotals();
		const metrics = windowMetricsByProvider.get(mapping.providerId)!;
		const scored = windowScores.get(mapping.providerId);
		return {
			providerId: mapping.providerId,
			requestCount: totals.requestCount,
			errorCount: totals.errorCount,
			uptime: metrics.uptime !== null ? round(metrics.uptime, 2) : null,
			latency: metrics.latency !== null ? round(metrics.latency, 0) : null,
			throughput:
				metrics.throughput !== null ? round(metrics.throughput, 2) : null,
			score: scored?.score ?? null,
			breakdown: scored?.breakdown ?? null,
		};
	});

	const effectiveWeights = getEffectiveScoringWeights(cfg, {
		isStreaming: true,
		isImageModel,
		cacheRelevant: false,
	});

	const eligibility = mappings.map((mapping) => {
		const reasonMap = exclusionsByProvider.get(mapping.providerId);
		const exclusions = Array.from(
			reasonMap ?? [],
			([reason, excludedCount]) => ({
				reason,
				excludedCount,
			}),
		).sort((a, b) => b.excludedCount - a.excludedCount);
		// One request can drop a mapping for several reasons at once, so the
		// per-reason counts in `exclusions` sum to more than the requests the
		// mapping was actually unavailable for. `excludedCount` is the decision
		// count the aggregator recorded separately: each request counted once,
		// whatever it tripped. Deriving the rate from the reason sum instead would
		// report a mapping that served most of its requests as 0% eligible.
		const excludedCount =
			excludedDecisionsByProvider.get(mapping.providerId) ?? 0;
		const candidateCount =
			candidateCountByProvider.get(mapping.providerId) ?? 0;
		return {
			providerId: mapping.providerId,
			candidateCount,
			excludedCount,
			exclusionRate:
				candidateCount > 0
					? round(Math.min(excludedCount / candidateCount, 1), 4)
					: null,
			topReason: exclusions[0]?.reason ?? null,
			exclusions,
			serviceTier: serviceTierCounts(
				windowTotals.get(mapping.providerId) ?? emptyTotals(),
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
			byKind: Array.from(electionsByKind, ([kind, requestCount]) => ({
				kind,
				requestCount,
			})).sort((a, b) => b.requestCount - a.requestCount),
			byReason: Array.from(
				electionsByReason,
				([selectionReason, requestCount]) => ({
					selectionReason,
					kind: routingSelectionKind(selectionReason),
					requestCount,
				}),
			).sort((a, b) => b.requestCount - a.requestCount),
		},
		eligibility,
		exclusions: Array.from(modelExclusionTotals, ([reason, excludedCount]) => ({
			reason,
			excludedCount,
		})).sort((a, b) => b.excludedCount - a.excludedCount),
		serviceTier: serviceTierCounts(modelServiceTierTotals),
	});
});
