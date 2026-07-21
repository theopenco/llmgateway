import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	floorToHourStart,
	pickMappingHistoryTable,
} from "@/utils/history-window.js";

import { and, cdb, gte, sql } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const publicProvidersStats = new OpenAPIHono<ServerTypes>();

const providerStatRowSchema = z.object({
	providerId: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	throughput: z.number().nullable(),
	uptime: z.number().nullable(),
	updatedAt: z.string().nullable(),
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
						providers: z.array(providerStatRowSchema),
						window: z.string(),
					}),
				},
			},
			description:
				"Aggregated per-provider performance stats (uptime, latency, throughput) over the requested window.",
		},
	},
});

// The provider grid tolerates several minutes of staleness (the UI itself sets
// a 5-minute staleTime), and the worker only appends new minute rows, so a
// short read-through cache turns the heavy full-window aggregation into at most
// one Postgres hit per window value per TTL instead of one per request.
const STATS_CACHE_TTL_SECONDS = 300;

function windowToStartDate(window: string): Date {
	const now = new Date();
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

publicProvidersStats.openapi(listRoute, async (c) => {
	const { window = "7d" } = c.req.valid("query");

	// Every supported window except 24h is longer than the hourly threshold, so
	// 7d/30d aggregate the hourly rollup (~60x fewer rows) instead of scanning
	// millions of minute rows. The bucket boundary is floored to the hour so the
	// range filter lines up with the hourly rows; the in-progress current hour
	// the worker hasn't rolled up yet is negligible for a multi-day window.
	const hourly = window !== "24h";
	const { table: mph, bucket: mphTs } = pickMappingHistoryTable(hourly);
	const startDate = hourly
		? floorToHourStart(windowToStartDate(window))
		: windowToStartDate(window);

	const rows = await cdb
		.select({
			providerId: mph.providerId,
			logsCount: sql<string>`COALESCE(SUM(${mph.logsCount}), 0)`,
			errorsCount: sql<string>`COALESCE(SUM(${mph.errorsCount}), 0)`,
			cachedCount: sql<string>`COALESCE(SUM(${mph.cachedCount}), 0)`,
			totalTimeToFirstToken: sql<string>`COALESCE(SUM(${mph.totalTimeToFirstToken}), 0)`,
			totalOutputTokens: sql<string>`COALESCE(SUM(${mph.totalOutputTokens}), 0)`,
			totalDuration: sql<string>`COALESCE(SUM(${mph.totalDuration}), 0)`,
			updatedAt: sql<Date | null>`MAX(${mphTs})`,
		})
		.from(mph)
		.where(and(gte(mphTs, startDate)))
		.groupBy(mph.providerId)
		// Pin a stable, window-scoped cache tag. Without it Drizzle keys the
		// cache on the rendered SQL + params, and `startDate` is derived from
		// `now` on every request, so the key would never repeat and the heavy
		// aggregation would run against Postgres each time. autoInvalidate is off
		// so the result expires on the TTL alone rather than being busted by the
		// worker's continuous minute-row inserts.
		.$withCache({
			tag: `publicProviderStats:${window}`,
			autoInvalidate: false,
			config: { ex: STATS_CACHE_TTL_SECONDS },
		});

	const providers = rows.map((r) => {
		const logsCount = Number(r.logsCount) || 0;
		const errorsCount = Number(r.errorsCount) || 0;
		const cachedCount = Number(r.cachedCount) || 0;
		const totalTimeToFirstToken = Number(r.totalTimeToFirstToken) || 0;
		const totalOutputTokens = Number(r.totalOutputTokens) || 0;
		const totalDuration = Number(r.totalDuration) || 0;

		const nonCachedLogs = logsCount - cachedCount;
		const avgTimeToFirstToken =
			nonCachedLogs > 0 ? totalTimeToFirstToken / nonCachedLogs : null;

		const throughput =
			totalDuration > 0 ? (totalOutputTokens / totalDuration) * 1000 : null;

		const uptime =
			logsCount > 0 ? ((logsCount - errorsCount) / logsCount) * 100 : null;

		return {
			providerId: r.providerId,
			logsCount,
			errorsCount,
			cachedCount,
			avgTimeToFirstToken,
			throughput,
			uptime,
			updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
		};
	});

	return c.json({ providers, window });
});
