import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";
import { createRouter } from "@/utils/router.js";

import {
	and,
	contentFilterHourlyErrorStats,
	db,
	desc,
	eq,
	gte,
	max,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const adminContentFilterErrors = createRouter<ServerTypes>();

adminContentFilterErrors.use("/*", adminMiddleware);

const errorsWindowSchema = z.enum(["24h", "7d", "30d"]);
const kindSchema = z.enum([
	"upstream_4xx",
	"upstream_5xx",
	"timeout",
	"network",
	"bad_response",
	"unexpected",
]);

const WINDOW_HOURS: Record<z.infer<typeof errorsWindowSchema>, number> = {
	"24h": 24,
	"7d": 168,
	"30d": 720,
};

const TOP_BUCKETS = 50;
const TOP_ORGANIZATIONS = 50;

const stats = contentFilterHourlyErrorStats;
const errorCount = sql<number>`coalesce(sum(${stats.errorCount}), 0)::int`;

const bucketSchema = z.object({
	classifier: z.string(),
	source: z.string(),
	kind: kindSchema.or(z.string()),
	inputType: z.string(),
	status: z.number(),
	code: z.string(),
	errorCount: z.number(),
	lastMessage: z.string(),
	lastRequestId: z.string(),
	lastSeenAt: z.string(),
});

const errorsResponseSchema = z
	.object({
		window: errorsWindowSchema,
		kind: kindSchema.optional(),
		// Hours the window covers, oldest first, so quiet hours chart as zero.
		bucketTimestamps: z.array(z.string()),
		totals: z.object({
			errorCount: z.number(),
			byKind: z.array(z.object({ kind: z.string(), errorCount: z.number() })),
			bySource: z.array(
				z.object({ source: z.string(), errorCount: z.number() }),
			),
		}),
		series: z.array(
			z.object({
				bucket: z.string(),
				kind: z.string(),
				errorCount: z.number(),
			}),
		),
		// Distinct failure shapes, most frequent first.
		buckets: z.array(bucketSchema),
		organizations: z.array(
			z.object({
				organizationId: z.string(),
				organizationName: z.string().nullable(),
				plan: z.string().nullable(),
				errorCount: z.number(),
				topKind: z.string(),
				lastRequestId: z.string(),
				lastSeenAt: z.string(),
			}),
		),
	})
	.openapi({});

const getErrors = createRoute({
	method: "get",
	path: "/content-filter/errors",
	request: {
		query: z.object({
			window: errorsWindowSchema.default("24h").optional(),
			kind: kindSchema.optional(),
		}),
	},
	responses: {
		200: {
			content: { "application/json": { schema: errorsResponseSchema } },
			description:
				"Failed moderation calls over the window, grouped by failure shape and by organization, from the hourly rollup.",
		},
	},
});

function windowStartFor(window: z.infer<typeof errorsWindowSchema>): Date {
	const start = new Date();
	start.setUTCMinutes(0, 0, 0);
	const offsetMs = (WINDOW_HOURS[window] - 1) * 3_600_000;
	start.setTime(start.getTime() - offsetMs);
	return start;
}

function hourTimestamps(start: Date): string[] {
	const now = Date.now();
	const buckets: string[] = [];
	for (let ms = start.getTime(); ms <= now; ms += 3_600_000) {
		buckets.push(new Date(ms).toISOString());
	}
	return buckets;
}

const bucketExpr = sql<string>`to_char(${stats.hourTimestamp}, 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const lastSeenAt = max(stats.lastSeenAt);
// The sample belonging to the latest hour in the group.
const lastMessage = sql<string>`(array_agg(${stats.lastMessage} order by ${stats.lastSeenAt} desc))[1]`;
const lastRequestId = sql<string>`(array_agg(${stats.lastRequestId} order by ${stats.lastSeenAt} desc))[1]`;

adminContentFilterErrors.openapi(getErrors, async (c) => {
	const query = c.req.valid("query");
	const window = query.window ?? "24h";
	const windowStart = windowStartFor(window);
	const scope = and(
		gte(stats.hourTimestamp, windowStart),
		query.kind ? eq(stats.kind, query.kind) : undefined,
	);

	const [byKind, bySource, series, buckets, organizations] = await Promise.all([
		db
			.select({ kind: stats.kind, errorCount })
			.from(stats)
			.where(scope)
			.groupBy(stats.kind)
			.orderBy(desc(errorCount)),
		db
			.select({ source: stats.source, errorCount })
			.from(stats)
			.where(scope)
			.groupBy(stats.source)
			.orderBy(desc(errorCount)),
		db
			.select({ bucket: bucketExpr, kind: stats.kind, errorCount })
			.from(stats)
			.where(scope)
			.groupBy(stats.hourTimestamp, stats.kind)
			.orderBy(stats.hourTimestamp),
		db
			.select({
				classifier: stats.classifier,
				source: stats.source,
				kind: stats.kind,
				inputType: stats.inputType,
				status: stats.status,
				code: stats.code,
				errorCount,
				lastMessage,
				lastRequestId,
				lastSeenAt,
			})
			.from(stats)
			.where(scope)
			.groupBy(
				stats.classifier,
				stats.source,
				stats.kind,
				stats.inputType,
				stats.status,
				stats.code,
			)
			.orderBy(desc(errorCount), desc(lastSeenAt))
			.limit(TOP_BUCKETS),
		db
			.select({
				organizationId: stats.organizationId,
				organizationName: tables.organization.name,
				plan: tables.organization.plan,
				errorCount,
				// Weighted mode: the kind with the most errors for the org.
				topKind: sql<string>`(array_agg(${stats.kind} order by ${stats.errorCount} desc))[1]`,
				lastRequestId,
				lastSeenAt,
			})
			.from(stats)
			.leftJoin(
				tables.organization,
				eq(tables.organization.id, stats.organizationId),
			)
			.where(scope)
			.groupBy(
				stats.organizationId,
				tables.organization.name,
				tables.organization.plan,
			)
			.orderBy(desc(errorCount), desc(lastSeenAt))
			.limit(TOP_ORGANIZATIONS),
	]);

	const toIso = (value: Date | string | null) =>
		value === null ? "" : new Date(value).toISOString();

	return c.json({
		window,
		...(query.kind ? { kind: query.kind } : {}),
		bucketTimestamps: hourTimestamps(windowStart),
		totals: {
			errorCount: byKind.reduce((sum, row) => sum + Number(row.errorCount), 0),
			byKind: byKind.map((row) => ({
				kind: row.kind,
				errorCount: Number(row.errorCount),
			})),
			bySource: bySource.map((row) => ({
				source: row.source,
				errorCount: Number(row.errorCount),
			})),
		},
		series: series.map((row) => ({
			bucket: row.bucket,
			kind: row.kind,
			errorCount: Number(row.errorCount),
		})),
		buckets: buckets.map((row) => ({
			classifier: row.classifier,
			source: row.source,
			kind: row.kind,
			inputType: row.inputType,
			status: Number(row.status),
			code: row.code,
			errorCount: Number(row.errorCount),
			lastMessage: row.lastMessage,
			lastRequestId: row.lastRequestId,
			lastSeenAt: toIso(row.lastSeenAt),
		})),
		organizations: organizations.map((row) => ({
			organizationId: row.organizationId,
			organizationName: row.organizationName,
			plan: row.plan,
			errorCount: Number(row.errorCount),
			topKind: row.topKind,
			lastRequestId: row.lastRequestId,
			lastSeenAt: toIso(row.lastSeenAt),
		})),
	});
});
