import { OpenAPIHono } from "@hono/zod-openapi";
import { z } from "zod";

import {
	getBucketUnitForWindow,
	getTokenWindowStartDate,
	getWindowBucketTimestamps,
} from "@/lib/stats-window.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import {
	and,
	CONTENT_FILTER_STATS_ALL_CATEGORY,
	contentFilterHourlyStats,
	db,
	desc,
	eq,
	gte,
	ne,
	sql,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const adminContentFilterClassifiers = new OpenAPIHono<ServerTypes>();

adminContentFilterClassifiers.use("/*", adminMiddleware);

const windowSchema = z.enum(["24h", "7d", "30d"]);

// The shared stats-window helpers name the 24-hour window "1d".
const STATS_WINDOW: Record<z.infer<typeof windowSchema>, string> = {
	"24h": "1d",
	"7d": "7d",
	"30d": "30d",
};

const stats = contentFilterHourlyStats;
const sampledCount = sql<number>`coalesce(sum(${stats.sampledCount}), 0)::int`;
const violationCount = sql<number>`coalesce(sum(${stats.violationCount}), 0)::int`;

const classifierKey = {
	classifier: z.string(),
	// Input the internal classifier read; empty for the other classifiers.
	internalScope: z.string(),
};

const classifiersResponseSchema = z
	.object({
		window: windowSchema,
		bucketTimestamps: z.array(z.string()),
		classifiers: z.array(
			z.object({
				...classifierKey,
				sampledCount: z.number(),
				violationCount: z.number(),
				blockedCount: z.number(),
				violationRate: z.number(),
				// Sampled requests this classifier decided versus shadowed.
				decidingSampledCount: z.number(),
				shadowSampledCount: z.number(),
				avgDurationMs: z.number().nullable(),
				organizationCount: z.number(),
			}),
		),
		categories: z.array(
			z.object({
				...classifierKey,
				category: z.string(),
				violationCount: z.number(),
			}),
		),
		series: z.array(
			z.object({
				...classifierKey,
				bucket: z.string(),
				sampledCount: z.number(),
				violationCount: z.number(),
			}),
		),
	})
	.openapi({});

const getClassifiers = createRoute({
	method: "get",
	path: "/content-filter/classifiers",
	request: {
		query: z.object({
			window: windowSchema.default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: classifiersResponseSchema } },
			description:
				"Flag rates and violation categories per content filter classifier, deciding and shadow runs combined, from the hourly rollup.",
		},
	},
});

adminContentFilterClassifiers.openapi(getClassifiers, async (c) => {
	const window = c.req.valid("query").window ?? "7d";
	const statsWindow = STATS_WINDOW[window];
	const windowStart = getTokenWindowStartDate(statsWindow);
	const bucketUnit = getBucketUnitForWindow(statsWindow);
	const inWindow = gte(stats.hourTimestamp, windowStart);
	const isTotal = eq(stats.category, CONTENT_FILTER_STATS_ALL_CATEGORY);
	const bucketExpr = sql<string>`to_char(date_trunc(${bucketUnit}, ${stats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

	// Grouped by classifier, not role: a classifier's verdicts count the same
	// whether it decided or shadowed, so rates stay comparable across setups.
	const [totals, categories, series] = await Promise.all([
		db
			.select({
				classifier: stats.classifier,
				internalScope: stats.internalScope,
				sampledCount,
				violationCount,
				blockedCount: sql<number>`coalesce(sum(${stats.blockedCount}), 0)::int`,
				decidingSampledCount: sql<number>`coalesce(sum(${stats.sampledCount}) filter (where ${stats.role} = 'deciding'), 0)::int`,
				shadowSampledCount: sql<number>`coalesce(sum(${stats.sampledCount}) filter (where ${stats.role} = 'shadow'), 0)::int`,
				durationSumMs: sql<number>`coalesce(sum(${stats.durationSumMs}), 0)::double precision`,
				durationCount: sql<number>`coalesce(sum(${stats.durationCount}), 0)::int`,
				organizationCount: sql<number>`count(distinct ${stats.organizationId})::int`,
			})
			.from(stats)
			.where(and(inWindow, isTotal))
			.groupBy(stats.classifier, stats.internalScope)
			.orderBy(desc(sampledCount)),
		db
			.select({
				classifier: stats.classifier,
				internalScope: stats.internalScope,
				category: stats.category,
				violationCount,
			})
			.from(stats)
			.where(
				and(inWindow, ne(stats.category, CONTENT_FILTER_STATS_ALL_CATEGORY)),
			)
			.groupBy(stats.classifier, stats.internalScope, stats.category)
			.orderBy(desc(violationCount)),
		db
			.select({
				classifier: stats.classifier,
				internalScope: stats.internalScope,
				bucket: bucketExpr,
				sampledCount,
				violationCount,
			})
			.from(stats)
			.where(and(inWindow, isTotal))
			.groupBy(stats.classifier, stats.internalScope, sql`3`)
			.orderBy(sql`3`),
	]);

	return c.json({
		window,
		bucketTimestamps: getWindowBucketTimestamps(
			statsWindow,
			new Date(),
			bucketUnit,
		),
		classifiers: totals.map((row) => {
			const sampled = Number(row.sampledCount);
			const violations = Number(row.violationCount);
			const durationCount = Number(row.durationCount);
			return {
				classifier: row.classifier,
				internalScope: row.internalScope,
				sampledCount: sampled,
				violationCount: violations,
				blockedCount: Number(row.blockedCount),
				violationRate: sampled > 0 ? violations / sampled : 0,
				decidingSampledCount: Number(row.decidingSampledCount),
				shadowSampledCount: Number(row.shadowSampledCount),
				avgDurationMs:
					durationCount > 0
						? Math.round(Number(row.durationSumMs) / durationCount)
						: null,
				organizationCount: Number(row.organizationCount),
			};
		}),
		categories: categories.map((row) => ({
			classifier: row.classifier,
			internalScope: row.internalScope,
			category: row.category,
			violationCount: Number(row.violationCount),
		})),
		series: series.map((row) => ({
			classifier: row.classifier,
			internalScope: row.internalScope,
			bucket: row.bucket,
			sampledCount: Number(row.sampledCount),
			violationCount: Number(row.violationCount),
		})),
	});
});
