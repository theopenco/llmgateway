import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { db, isNotNull, sql, tables } from "@llmgateway/db";

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
			source: tables.log.source,
			totalTokens: sql<string>`COALESCE(SUM(CAST(${tables.log.totalTokens} AS NUMERIC)), 0)`,
			totalRequests: sql<string>`COUNT(*)`,
			lastUsedAt: sql<Date | null>`MAX(${tables.log.createdAt})`,
		})
		.from(tables.log)
		.where(isNotNull(tables.log.source))
		.groupBy(tables.log.source)
		.orderBy(
			sql`COALESCE(SUM(CAST(${tables.log.totalTokens} AS NUMERIC)), 0) DESC`,
		)
		.limit(limit);

	const apps = rows
		.filter((r): r is typeof r & { source: string } => r.source !== null)
		.map((r) => ({
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
