import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { and, db, gte, modelProviderMappingHistory, sql } from "@llmgateway/db";

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
	const startDate = windowToStartDate(window);

	const rows = await db
		.select({
			providerId: modelProviderMappingHistory.providerId,
			logsCount: sql<string>`COALESCE(SUM(${modelProviderMappingHistory.logsCount}), 0)`,
			errorsCount: sql<string>`COALESCE(SUM(${modelProviderMappingHistory.errorsCount}), 0)`,
			cachedCount: sql<string>`COALESCE(SUM(${modelProviderMappingHistory.cachedCount}), 0)`,
			totalTimeToFirstToken: sql<string>`COALESCE(SUM(${modelProviderMappingHistory.totalTimeToFirstToken}), 0)`,
			totalOutputTokens: sql<string>`COALESCE(SUM(${modelProviderMappingHistory.totalOutputTokens}), 0)`,
			totalDuration: sql<string>`COALESCE(SUM(${modelProviderMappingHistory.totalDuration}), 0)`,
			updatedAt: sql<Date | null>`MAX(${modelProviderMappingHistory.minuteTimestamp})`,
		})
		.from(modelProviderMappingHistory)
		.where(and(gte(modelProviderMappingHistory.minuteTimestamp, startDate)))
		.groupBy(modelProviderMappingHistory.providerId);

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
