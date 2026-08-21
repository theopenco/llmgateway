import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import { and, asc, db, desc, eq, gte, sql, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * Admin visibility into who is hitting the anti-abuse limits (endpoint RPM,
 * USD spend caps, top-up velocity) and how hard, backed by the
 * `org_limit_hit_daily` aggregates the worker flushes. Read-only — groundwork
 * for future outreach, no actions here.
 */

export const adminLimitHits = new OpenAPIHono<ServerTypes>();

adminLimitHits.use("/*", adminMiddleware);

const limitTypeSchema = z.enum([
	"rpm",
	"spend_cap_daily",
	"spend_cap_monthly",
	"topup_velocity",
	"concurrency",
]);

const t = tables.orgLimitHitDaily;

function sinceUtcDay(days: number, now = Date.now()): Date {
	const today = new Date(now);
	const startOfToday = Date.UTC(
		today.getUTCFullYear(),
		today.getUTCMonth(),
		today.getUTCDate(),
	);
	const windowMs = (days - 1) * 86_400_000;
	return new Date(startOfToday - windowMs);
}

function toIso(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

const orgLimitHitsSummarySchema = z.object({
	organizationId: z.string(),
	organizationName: z.string(),
	billingEmail: z.string().nullable(),
	plan: z.string(),
	kind: z.string(),
	organizationCreatedAt: z.string(),
	totalHits: z.number(),
	rpmHits: z.number(),
	concurrencyHits: z.number(),
	spendCapHits: z.number(),
	topUpHits: z.number(),
	topUpBlockedUsd: z.number(),
	daysActive: z.number(),
	lastHitAt: z.string(),
});

const listLimitHits = createRoute({
	method: "get",
	path: "/limit-hits",
	request: {
		query: z.object({
			days: z.coerce.number().min(1).max(90).default(7).optional(),
			limitType: limitTypeSchema.optional(),
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organizations: z.array(orgLimitHitsSummarySchema),
						total: z.number(),
						days: z.number(),
						limit: z.number(),
						offset: z.number(),
					}),
				},
			},
			description:
				"Organizations that hit anti-abuse limits in the window, hardest hitters first.",
		},
	},
});

adminLimitHits.openapi(listLimitHits, async (c) => {
	const query = c.req.valid("query");
	const days = query.days ?? 7;
	const limit = query.limit ?? 50;
	const offset = query.offset ?? 0;
	const since = sinceUtcDay(days);

	const whereClause = and(
		gte(t.day, since),
		query.limitType ? eq(t.limitType, query.limitType) : undefined,
	);

	const totalHitsExpr = sql<number>`SUM(${t.hitCount})::int`;
	const rows = await db
		.select({
			organizationId: t.organizationId,
			organizationName: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
			plan: tables.organization.plan,
			kind: tables.organization.kind,
			organizationCreatedAt: tables.organization.createdAt,
			totalHits: totalHitsExpr,
			rpmHits: sql<number>`SUM(CASE WHEN ${t.limitType} = 'rpm' THEN ${t.hitCount} ELSE 0 END)::int`,
			concurrencyHits: sql<number>`SUM(CASE WHEN ${t.limitType} = 'concurrency' THEN ${t.hitCount} ELSE 0 END)::int`,
			spendCapHits: sql<number>`SUM(CASE WHEN ${t.limitType} IN ('spend_cap_daily', 'spend_cap_monthly') THEN ${t.hitCount} ELSE 0 END)::int`,
			topUpHits: sql<number>`SUM(CASE WHEN ${t.limitType} = 'topup_velocity' THEN ${t.hitCount} ELSE 0 END)::int`,
			topUpBlockedUsd: sql<string>`COALESCE(SUM(CASE WHEN ${t.limitType} = 'topup_velocity' THEN CAST(${t.blockedUsd} AS NUMERIC) ELSE 0 END), 0)`,
			daysActive: sql<number>`COUNT(DISTINCT ${t.day})::int`,
			lastHitAt: sql<Date | string>`MAX(${t.updatedAt})`,
		})
		.from(t)
		.innerJoin(
			tables.organization,
			eq(tables.organization.id, t.organizationId),
		)
		.where(whereClause)
		.groupBy(
			t.organizationId,
			tables.organization.name,
			tables.organization.billingEmail,
			tables.organization.plan,
			tables.organization.kind,
			tables.organization.createdAt,
		)
		.orderBy(desc(totalHitsExpr), asc(t.organizationId))
		.limit(limit)
		.offset(offset);

	const totalRows = await db
		.select({
			total: sql<number>`COUNT(DISTINCT ${t.organizationId})::int`,
		})
		.from(t)
		.where(whereClause);

	return c.json({
		organizations: rows.map((row) => ({
			...row,
			organizationCreatedAt: toIso(row.organizationCreatedAt),
			topUpBlockedUsd: Number(row.topUpBlockedUsd) || 0,
			lastHitAt: toIso(row.lastHitAt),
		})),
		total: totalRows[0]?.total ?? 0,
		days,
		limit,
		offset,
	});
});

const orgLimitHitRowSchema = z.object({
	day: z.string(),
	limitType: limitTypeSchema,
	endpointKey: z.string(),
	hitCount: z.number(),
	blockedUsd: z.number(),
	updatedAt: z.string(),
});

const getOrganizationLimitHits = createRoute({
	method: "get",
	path: "/organizations/{orgId}/limit-hits",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			days: z.coerce.number().min(1).max(90).default(30).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						hits: z.array(orgLimitHitRowSchema),
						days: z.number(),
					}),
				},
			},
			description: "Daily limit-hit breakdown for one organization.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminLimitHits.openapi(getOrganizationLimitHits, async (c) => {
	const { orgId } = c.req.valid("param");
	const days = c.req.valid("query").days ?? 30;

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});
	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const rows = await db
		.select({
			day: t.day,
			limitType: t.limitType,
			endpointKey: t.endpointKey,
			hitCount: t.hitCount,
			blockedUsd: t.blockedUsd,
			updatedAt: t.updatedAt,
		})
		.from(t)
		.where(and(eq(t.organizationId, orgId), gte(t.day, sinceUtcDay(days))))
		.orderBy(
			desc(t.day),
			desc(t.hitCount),
			asc(t.limitType),
			asc(t.endpointKey),
		);

	return c.json({
		hits: rows.map((row) => ({
			...row,
			day: toIso(row.day),
			blockedUsd: Number(row.blockedUsd) || 0,
			updatedAt: toIso(row.updatedAt),
		})),
		days,
	});
});
