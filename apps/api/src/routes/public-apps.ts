import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { db, globalSourceStats, ne, sql } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const publicApps = new OpenAPIHono<ServerTypes>();

const appStatSchema = z.object({
	source: z.string(),
	totalTokens: z.number(),
	totalRequests: z.number(),
	lastUsedAt: z.string().nullable(),
});

const listAppsRoute = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			limit: z
				.string()
				.optional()
				.transform((v) => (v ? Number.parseInt(v, 10) : 100))
				.pipe(z.number().int().min(1).max(500)),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						apps: z.array(appStatSchema),
						totalApps: z.number(),
						totalTokens: z.number(),
						totalRequests: z.number(),
					}),
				},
			},
			description:
				"Aggregated token usage per app/source across all LLM Gateway traffic.",
		},
	},
});

publicApps.openapi(listAppsRoute, async (c) => {
	const { limit } = c.req.valid("query");

	const rows = await db
		.select({
			source: globalSourceStats.source,
			totalTokens: sql<string>`COALESCE(SUM(CAST(${globalSourceStats.totalTokens} AS NUMERIC)), 0)`,
			totalRequests: sql<string>`COALESCE(SUM(${globalSourceStats.requestCount}), 0)`,
			lastUsedAt: sql<Date | null>`MAX(${globalSourceStats.dayTimestamp})`,
		})
		.from(globalSourceStats)
		.where(ne(globalSourceStats.source, "unknown"))
		.groupBy(globalSourceStats.source)
		.orderBy(
			sql`COALESCE(SUM(CAST(${globalSourceStats.totalTokens} AS NUMERIC)), 0) DESC`,
		)
		.limit(limit);

	const apps = rows.map((r) => ({
		source: r.source,
		totalTokens: Number(r.totalTokens) || 0,
		totalRequests: Number(r.totalRequests) || 0,
		lastUsedAt: r.lastUsedAt ? new Date(r.lastUsedAt).toISOString() : null,
	}));

	const totalTokens = apps.reduce((sum, a) => sum + a.totalTokens, 0);
	const totalRequests = apps.reduce((sum, a) => sum + a.totalRequests, 0);

	return c.json({
		apps,
		totalApps: apps.length,
		totalTokens,
		totalRequests,
	});
});
