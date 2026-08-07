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
	getEffectiveDiscount,
	gte,
	modelProviderMappingHistoryHourly,
} from "@llmgateway/db";
import {
	getProviderDefinition,
	models,
	type ProviderModelMapping,
} from "@llmgateway/models";
import { getDefaultRoutingConfig } from "@llmgateway/shared/routing-config";

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

const routingHourSchema = z
	.object({
		hour: z.string(),
		providers: z.array(providerHourEntrySchema),
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
	const routingErrors = Math.max(
		totals.errorCount - totals.clientErrorCount,
		0,
	);
	const uptime = Math.max(
		0,
		((totals.requestCount - routingErrors) / totals.requestCount) * 100,
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
	return await Promise.all(
		model.providers.map(async (mapping: ProviderModelMapping) => {
			const providerDef = getProviderDefinition(mapping.providerId);
			const modelStability =
				"stability" in model
					? (model.stability as string | undefined)
					: undefined;
			const stability = mapping.stability ?? modelStability ?? "stable";
			const priority = providerDef?.priority ?? 1;
			const excludedReasons: string[] = [];
			if (mapping.deactivatedAt) {
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
				providerName: providerDef?.name ?? mapping.providerId,
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

	const rows = await db
		.select()
		.from(modelProviderMappingHistoryHourly)
		.where(
			and(
				eq(modelProviderMappingHistoryHourly.modelId, model.id),
				gte(modelProviderMappingHistoryHourly.hourTimestamp, windowStart),
			),
		);

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
	});
});
