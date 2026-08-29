import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { floorToHourStart } from "@/utils/history-window.js";

import {
	and,
	cdb,
	excludeRegionalMappingRows,
	gte,
	inArray,
	lt,
	modelHistoryHourly,
	modelProviderMappingHistoryHourly,
	sql,
} from "@llmgateway/db";
import {
	models as modelDefinitions,
	providers as providerDefinitions,
} from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

export const publicModelStats = new OpenAPIHono<ServerTypes>();

const modelStatRowSchema = z.object({
	modelId: z.string(),
	totalTokens: z.number(),
	totalRequests: z.number(),
	// Percent change of totalTokens vs the previous window of equal length.
	// Null when the model had no traffic in the previous window (new entry).
	trendPercent: z.number().nullable(),
});

const providerStatRowSchema = z.object({
	providerId: z.string(),
	totalTokens: z.number(),
	totalRequests: z.number(),
});

const seriesPointSchema = z.object({
	timestamp: z.string(),
	totalTokens: z.number(),
});

const modelSeriesSchema = z.object({
	modelId: z.string(),
	points: z.array(seriesPointSchema),
});

const listRoute = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			window: z.enum(["24h", "7d", "30d"]).default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						window: z.string(),
						totals: z.object({
							totalTokens: z.number(),
							totalRequests: z.number(),
						}),
						models: z.array(modelStatRowSchema),
						providers: z.array(providerStatRowSchema),
						series: z.array(modelSeriesSchema),
					}),
				},
			},
			description:
				"Aggregated public model usage stats over the requested window: per-model token/request totals with trend vs the previous window, per-provider totals, and a time series for the top models.",
		},
	},
});

// Same rationale as the public provider stats: rankings tolerate several
// minutes of staleness and the worker only appends rows, so a short
// read-through cache collapses the heavy full-window aggregations into at
// most one Postgres round-trip per window value per TTL.
const STATS_CACHE_TTL_SECONDS = 300;

// The time-series chart only plots the highest-volume models; everything else
// still appears in the ranked list.
const SERIES_MODEL_LIMIT = 10;

function windowToStartDate(window: string, now: Date): Date {
	const startDate = new Date(now);
	switch (window) {
		case "24h":
			startDate.setUTCHours(now.getUTCHours() - 24);
			break;
		case "30d":
			startDate.setUTCDate(now.getUTCDate() - 30);
			break;
		case "7d":
		default:
			startDate.setUTCDate(now.getUTCDate() - 7);
			break;
	}
	return startDate;
}

publicModelStats.openapi(listRoute, async (c) => {
	const { window = "7d" } = c.req.valid("query");

	// Public rankings only need hourly resolution. The hourly tables are refreshed
	// every minute, including the current hour, and avoid scanning the much larger
	// minute tables for the 24h window.
	const now = new Date();
	const mh = modelHistoryHourly;
	const mhTs = mh.hourTimestamp;
	const mph = modelProviderMappingHistoryHourly;
	const mphTs = mph.hourTimestamp;
	const startDate = floorToHourStart(windowToStartDate(window, now));
	// The previous window of equal length, used for the trend comparison.
	const windowMs = now.getTime() - startDate.getTime();
	const prevStartDate = new Date(startDate.getTime() - windowMs);

	const currentRows = await cdb
		.select({
			modelId: mh.modelId,
			totalTokens: sql<string>`COALESCE(SUM(${mh.totalTokens}), 0)`,
			totalRequests: sql<string>`COALESCE(SUM(${mh.logsCount}), 0)`,
		})
		.from(mh)
		.where(and(gte(mhTs, startDate)))
		.groupBy(mh.modelId)
		// Stable window-scoped cache tag; see public-providers-stats for why the
		// tag is pinned (the ever-moving startDate would otherwise defeat the
		// cache) and why autoInvalidate is off.
		.$withCache({
			tag: `publicModelStats:current:v1:${window}`,
			autoInvalidate: false,
			config: { ex: STATS_CACHE_TTL_SECONDS },
		});

	const previousRows = await cdb
		.select({
			modelId: mh.modelId,
			totalTokens: sql<string>`COALESCE(SUM(${mh.totalTokens}), 0)`,
		})
		.from(mh)
		.where(and(gte(mhTs, prevStartDate), lt(mhTs, startDate)))
		.groupBy(mh.modelId)
		.$withCache({
			tag: `publicModelStats:previous:v1:${window}`,
			autoInvalidate: false,
			config: { ex: STATS_CACHE_TTL_SECONDS },
		});

	const providerRows = await cdb
		.select({
			providerId: mph.providerId,
			totalTokens: sql<string>`COALESCE(SUM(${mph.totalTokens}), 0)`,
			totalRequests: sql<string>`COALESCE(SUM(${mph.logsCount}), 0)`,
		})
		.from(mph)
		// The region-less root row already carries a mapping's regional traffic,
		// so summing every row per provider would count it twice.
		.where(and(gte(mphTs, startDate), excludeRegionalMappingRows(mph)))
		.groupBy(mph.providerId)
		.$withCache({
			tag: `publicModelStats:providers:v2:${window}`,
			autoInvalidate: false,
			config: { ex: STATS_CACHE_TTL_SECONDS },
		});

	// Only catalogue models are public; traffic recorded for anything else
	// (e.g. custom org models) must not leak into a public ranking. Gateway
	// pseudo-models like "auto" and "custom" are routing surfaces rather than
	// real models, so they are excluded too.
	const knownModelIds = new Set<string>(
		modelDefinitions.filter((m) => m.family !== "llmgateway").map((m) => m.id),
	);
	const knownProviderIds = new Set<string>(
		providerDefinitions
			.filter((p) => p.name !== "LLM Gateway")
			.map((p) => p.id),
	);

	const previousByModel = new Map<string, number>();
	for (const row of previousRows) {
		previousByModel.set(row.modelId, Number(row.totalTokens) || 0);
	}

	const models = currentRows
		.filter((row) => knownModelIds.has(row.modelId))
		.map((row) => {
			const totalTokens = Number(row.totalTokens) || 0;
			const previousTokens = previousByModel.get(row.modelId) ?? 0;
			return {
				modelId: row.modelId,
				totalTokens,
				totalRequests: Number(row.totalRequests) || 0,
				trendPercent:
					previousTokens > 0
						? ((totalTokens - previousTokens) / previousTokens) * 100
						: null,
			};
		})
		.filter((row) => row.totalTokens > 0)
		.sort((a, b) => b.totalTokens - a.totalTokens);

	const providers = providerRows
		.filter((row) => knownProviderIds.has(row.providerId))
		.map((row) => ({
			providerId: row.providerId,
			totalTokens: Number(row.totalTokens) || 0,
			totalRequests: Number(row.totalRequests) || 0,
		}))
		.filter((row) => row.totalTokens > 0)
		.sort((a, b) => b.totalTokens - a.totalTokens);

	const totals = {
		totalTokens: models.reduce((sum, m) => sum + m.totalTokens, 0),
		totalRequests: models.reduce((sum, m) => sum + m.totalRequests, 0),
	};

	// Chart series for the top models only, bucketed by hour for the 24h and
	// 7d windows (24 / 168 dense chart bars) and by day for 30d.
	const topModelIds = models
		.slice(0, SERIES_MODEL_LIMIT)
		.map((row) => row.modelId);

	let series: Array<{
		modelId: string;
		points: Array<{ timestamp: string; totalTokens: number }>;
	}> = [];

	if (topModelIds.length > 0) {
		const seriesBucket =
			window === "30d"
				? sql<Date>`date_trunc('day', ${mhTs})`
				: sql<Date>`date_trunc('hour', ${mhTs})`;
		const seriesRows = await cdb
			.select({
				modelId: mh.modelId,
				bucket: seriesBucket,
				totalTokens: sql<string>`COALESCE(SUM(${mh.totalTokens}), 0)`,
			})
			.from(mh)
			.where(and(gte(mhTs, startDate), inArray(mh.modelId, topModelIds)))
			.groupBy(mh.modelId, seriesBucket)
			.orderBy(seriesBucket)
			// The top-model set can shift within the TTL, so a tag keyed on the
			// window alone may briefly serve a series for the previous set; that
			// self-heals when the TTL lapses and is invisible in practice because
			// the ranked list above it comes from the same cached snapshot.
			.$withCache({
				tag: `publicModelStats:series:v2:${window}`,
				autoInvalidate: false,
				config: { ex: STATS_CACHE_TTL_SECONDS },
			});

		const pointsByModel = new Map<
			string,
			Array<{ timestamp: string; totalTokens: number }>
		>();
		for (const row of seriesRows) {
			const points = pointsByModel.get(row.modelId) ?? [];
			points.push({
				timestamp: new Date(row.bucket).toISOString(),
				totalTokens: Number(row.totalTokens) || 0,
			});
			pointsByModel.set(row.modelId, points);
		}
		series = topModelIds.map((modelId) => ({
			modelId,
			points: pointsByModel.get(modelId) ?? [],
		}));
	}

	return c.json({ window, totals, models, providers, series });
});
