import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	getBucketUnitForWindow,
	getWindowBucketTimestamps,
	tokenWindowSchema,
} from "@/lib/stats-window.js";
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
const violationsSortSchema = z.enum(["violations", "rate"]);

const WINDOW_HOURS: Record<z.infer<typeof violationsWindowSchema>, number> = {
	"24h": 24,
	"7d": 168,
	"30d": 720,
};

const TOP_ORGANIZATIONS = 50;
const TOP_CATEGORIES = 5;
const TOP_ORGANIZATION_CATEGORIES = 10;

const sampled = sql<number>`coalesce(sum(${contentFilterHourlyStats.sampledCount}), 0)::int`;
const violations = sql<number>`coalesce(sum(${contentFilterHourlyStats.violationCount}), 0)::int`;
const blocked = sql<number>`coalesce(sum(${contentFilterHourlyStats.blockedCount}), 0)::int`;
// Zero rather than NULL for unsampled orgs so a DESC sort does not float
// them to the top.
const violationRate = sql<number>`coalesce(sum(${contentFilterHourlyStats.violationCount})::float / nullif(sum(${contentFilterHourlyStats.sampledCount}), 0), 0)`;

const violationsResponseSchema = z
	.object({
		window: violationsWindowSchema,
		sort: violationsSortSchema,
		minSampled: z.number(),
		totals: z.object({
			sampledCount: z.number(),
			violationCount: z.number(),
			blockedCount: z.number(),
		}),
		organizations: z.array(
			z.object({
				organizationId: z.string(),
				organizationName: z.string().nullable(),
				billingEmail: z.string().nullable(),
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
			// "rate" ranks by violations / sampled; pair it with minSampled so a
			// single flagged request cannot put a one-request org at 100%.
			sort: violationsSortSchema.default("violations").optional(),
			minSampled: z.coerce.number().int().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: violationsResponseSchema },
			},
			description:
				"Organizations ranked by gateway content filter violations or violation rate over the window, from the hourly rollup.",
		},
	},
});

adminContentFilter.openapi(getViolations, async (c) => {
	const query = c.req.valid("query");
	const window = query.window ?? "24h";
	const sort = query.sort ?? "violations";
	const minSampled = query.minSampled ?? 0;
	const windowStart = new Date();
	windowStart.setUTCMinutes(0, 0, 0);
	const windowOffsetMs = (WINDOW_HOURS[window] - 1) * 3_600_000;
	windowStart.setTime(windowStart.getTime() - windowOffsetMs);

	const orgRows = await db
		.select({
			organizationId: contentFilterHourlyStats.organizationId,
			organizationName: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
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
			tables.organization.billingEmail,
			tables.organization.plan,
		)
		.having(minSampled > 0 ? gte(sampled, minSampled) : undefined)
		.orderBy(
			...(sort === "rate"
				? [desc(violationRate), desc(violations), desc(sampled)]
				: [desc(violations), desc(sampled)]),
		)
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

	// Window-wide, independent of the ranked list cap and sample floor.
	const [globalTotals] = await db
		.select({
			sampledCount: sampled,
			violationCount: violations,
			blockedCount: blocked,
		})
		.from(contentFilterHourlyStats)
		.where(
			and(
				gte(contentFilterHourlyStats.hourTimestamp, windowStart),
				eq(
					contentFilterHourlyStats.category,
					CONTENT_FILTER_STATS_ALL_CATEGORY,
				),
			),
		);
	const totals = {
		sampledCount: Number(globalTotals?.sampledCount ?? 0),
		violationCount: Number(globalTotals?.violationCount ?? 0),
		blockedCount: Number(globalTotals?.blockedCount ?? 0),
	};
	const organizations = orgRows.map((row) => {
		const sampledCount = Number(row.sampledCount);
		const violationCount = Number(row.violationCount);
		const blockedCount = Number(row.blockedCount);
		return {
			organizationId: row.organizationId,
			organizationName: row.organizationName ?? null,
			billingEmail: row.billingEmail ?? null,
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

	return c.json({ window, sort, minSampled, totals, organizations });
});

const activityResponseSchema = z
	.object({
		window: tokenWindowSchema,
		bucket: z.enum(["hour", "day"]),
		totals: z.object({
			sampledCount: z.number(),
			violationCount: z.number(),
			blockedCount: z.number(),
			violationRate: z.number(),
		}),
		topCategories: z.array(
			z.object({ category: z.string(), violationCount: z.number() }),
		),
		data: z.array(
			z.object({
				timestamp: z.string(),
				sampledCount: z.number(),
				violationCount: z.number(),
				blockedCount: z.number(),
			}),
		),
	})
	.openapi({});

const getOrganizationActivity = createRoute({
	method: "get",
	path: "/organizations/{orgId}/content-filter",
	request: {
		params: z.object({ orgId: z.string() }),
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: activityResponseSchema },
			},
			description:
				"One organization's gateway content filter activity over time: sampled, violating and blocked requests per bucket, plus window totals and top categories.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminContentFilter.openapi(getOrganizationActivity, async (c) => {
	const { orgId } = c.req.valid("param");
	const window = c.req.valid("query").window ?? "7d";
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
		columns: { id: true },
	});
	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const bucket = getBucketUnitForWindow(window);
	// Filter from the first bucket boundary rather than the raw window start so
	// the leading bucket is not zeroed by rows that fall just before it.
	const bucketTimestamps = getWindowBucketTimestamps(window);
	const startDate = new Date(bucketTimestamps[0] ?? Date.now());
	const bucketExpr = sql<string>`to_char(date_trunc(${sql.raw(`'${bucket}'`)}, ${contentFilterHourlyStats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
	const orgWindow = and(
		eq(contentFilterHourlyStats.organizationId, orgId),
		gte(contentFilterHourlyStats.hourTimestamp, startDate),
	);

	const [series, categories] = await Promise.all([
		db
			.select({
				bucket: bucketExpr,
				sampledCount: sampled,
				violationCount: violations,
				blockedCount: blocked,
			})
			.from(contentFilterHourlyStats)
			.where(
				and(
					orgWindow,
					eq(
						contentFilterHourlyStats.category,
						CONTENT_FILTER_STATS_ALL_CATEGORY,
					),
				),
			)
			.groupBy(bucketExpr),
		db
			.select({
				category: contentFilterHourlyStats.category,
				violationCount: violations,
			})
			.from(contentFilterHourlyStats)
			.where(
				and(
					orgWindow,
					ne(
						contentFilterHourlyStats.category,
						CONTENT_FILTER_STATS_ALL_CATEGORY,
					),
				),
			)
			.groupBy(contentFilterHourlyStats.category)
			.orderBy(desc(violations))
			.limit(TOP_ORGANIZATION_CATEGORIES),
	]);

	const byBucket = new Map(
		series.map((row) => [new Date(row.bucket).toISOString(), row]),
	);
	const totals = { sampledCount: 0, violationCount: 0, blockedCount: 0 };
	const data = bucketTimestamps.map((timestamp) => {
		const row = byBucket.get(timestamp);
		const point = {
			timestamp,
			sampledCount: Number(row?.sampledCount ?? 0),
			violationCount: Number(row?.violationCount ?? 0),
			blockedCount: Number(row?.blockedCount ?? 0),
		};
		totals.sampledCount += point.sampledCount;
		totals.violationCount += point.violationCount;
		totals.blockedCount += point.blockedCount;
		return point;
	});

	return c.json({
		window,
		bucket,
		totals: {
			...totals,
			violationRate:
				totals.sampledCount > 0
					? totals.violationCount / totals.sampledCount
					: 0,
		},
		topCategories: categories.map((row) => ({
			category: row.category,
			violationCount: Number(row.violationCount),
		})),
		data,
	});
});
