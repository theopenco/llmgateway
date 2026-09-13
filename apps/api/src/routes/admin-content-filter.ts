import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import {
	and,
	CONTENT_FILTER_STATS_ALL_CATEGORY,
	contentFilterHourlyStats,
	db,
	desc,
	eq,
	gte,
	inArray,
	ne,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const adminContentFilter = new OpenAPIHono<ServerTypes>();

adminContentFilter.use("/*", adminMiddleware);

const violationsWindowSchema = z.enum(["24h", "7d", "30d"]);

const WINDOW_HOURS: Record<z.infer<typeof violationsWindowSchema>, number> = {
	"24h": 24,
	"7d": 168,
	"30d": 720,
};

const TOP_ORGANIZATIONS = 50;
const TOP_CATEGORIES = 5;

const violationsResponseSchema = z
	.object({
		window: violationsWindowSchema,
		totals: z.object({
			sampledCount: z.number(),
			violationCount: z.number(),
			blockedCount: z.number(),
		}),
		organizations: z.array(
			z.object({
				organizationId: z.string(),
				organizationName: z.string().nullable(),
				plan: z.string().nullable(),
				sampledCount: z.number(),
				violationCount: z.number(),
				blockedCount: z.number(),
				violationRate: z.number(),
				topCategories: z.array(
					z.object({ category: z.string(), violationCount: z.number() }),
				),
			}),
		),
	})
	.openapi({});

const getViolations = createRoute({
	method: "get",
	path: "/content-filter/violations",
	request: {
		query: z.object({
			window: violationsWindowSchema.default("24h").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: violationsResponseSchema },
			},
			description:
				"Organizations ranked by gateway content filter violations over the window, from the hourly rollup.",
		},
	},
});

adminContentFilter.openapi(getViolations, async (c) => {
	const window = c.req.valid("query").window ?? "24h";
	const windowStart = new Date();
	windowStart.setUTCMinutes(0, 0, 0);
	const windowOffsetMs = (WINDOW_HOURS[window] - 1) * 3_600_000;
	windowStart.setTime(windowStart.getTime() - windowOffsetMs);

	const sampled = sql<number>`coalesce(sum(${contentFilterHourlyStats.sampledCount}), 0)::int`;
	const violations = sql<number>`coalesce(sum(${contentFilterHourlyStats.violationCount}), 0)::int`;
	const blocked = sql<number>`coalesce(sum(${contentFilterHourlyStats.blockedCount}), 0)::int`;

	const orgRows = await db
		.select({
			organizationId: contentFilterHourlyStats.organizationId,
			organizationName: tables.organization.name,
			plan: tables.organization.plan,
			sampledCount: sampled,
			violationCount: violations,
			blockedCount: blocked,
		})
		.from(contentFilterHourlyStats)
		.leftJoin(
			tables.organization,
			eq(tables.organization.id, contentFilterHourlyStats.organizationId),
		)
		.where(
			and(
				gte(contentFilterHourlyStats.hourTimestamp, windowStart),
				eq(
					contentFilterHourlyStats.category,
					CONTENT_FILTER_STATS_ALL_CATEGORY,
				),
			),
		)
		.groupBy(
			contentFilterHourlyStats.organizationId,
			tables.organization.name,
			tables.organization.plan,
		)
		.orderBy(desc(violations), desc(sampled))
		.limit(TOP_ORGANIZATIONS);

	const organizationIds = orgRows.map((row) => row.organizationId);
	const categoryRows =
		organizationIds.length > 0
			? await db
					.select({
						organizationId: contentFilterHourlyStats.organizationId,
						category: contentFilterHourlyStats.category,
						violationCount: violations,
					})
					.from(contentFilterHourlyStats)
					.where(
						and(
							gte(contentFilterHourlyStats.hourTimestamp, windowStart),
							ne(
								contentFilterHourlyStats.category,
								CONTENT_FILTER_STATS_ALL_CATEGORY,
							),
							inArray(contentFilterHourlyStats.organizationId, organizationIds),
						),
					)
					.groupBy(
						contentFilterHourlyStats.organizationId,
						contentFilterHourlyStats.category,
					)
			: [];

	const categoriesByOrg = new Map<
		string,
		{ category: string; violationCount: number }[]
	>();
	for (const row of categoryRows) {
		const list = categoriesByOrg.get(row.organizationId) ?? [];
		list.push({
			category: row.category,
			violationCount: Number(row.violationCount),
		});
		categoriesByOrg.set(row.organizationId, list);
	}

	const totals = { sampledCount: 0, violationCount: 0, blockedCount: 0 };
	const organizations = orgRows.map((row) => {
		const sampledCount = Number(row.sampledCount);
		const violationCount = Number(row.violationCount);
		const blockedCount = Number(row.blockedCount);
		totals.sampledCount += sampledCount;
		totals.violationCount += violationCount;
		totals.blockedCount += blockedCount;
		return {
			organizationId: row.organizationId,
			organizationName: row.organizationName ?? null,
			plan: row.plan ?? null,
			sampledCount,
			violationCount,
			blockedCount,
			violationRate: sampledCount > 0 ? violationCount / sampledCount : 0,
			topCategories: (categoriesByOrg.get(row.organizationId) ?? [])
				.sort((a, b) => b.violationCount - a.violationCount)
				.slice(0, TOP_CATEGORIES),
		};
	});

	return c.json({ window, totals, organizations });
});
