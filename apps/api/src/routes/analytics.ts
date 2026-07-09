import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { userHasProjectAccess } from "@/utils/authorization.js";
import {
	bucketDate,
	formatInTimeZone,
	timezoneQueryField,
	zonedTimeToUtc,
} from "@/utils/timezone.js";

import {
	and,
	apiKeyHourlyModelStats,
	apiKeyHourlyStats,
	db,
	desc,
	eq,
	gte,
	inArray,
	lte,
	ne,
	projectHourlyModelStats,
	projectHourlyStats,
	sql,
	tables,
} from "@llmgateway/db";
import { models, type ModelDefinition } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

export const analytics = new OpenAPIHono<ServerTypes>();

const roleSchema = z.enum(["owner", "admin", "developer"]);

const dateRangeQuery = {
	organizationId: z.string(),
	from: z.string().optional(),
	to: z.string().optional(),
	timezone: timezoneQueryField,
};

// Resolve the query window and the local calendar day-labels used to pad the
// series. from/to are interpreted as wall-clock days in the caller's timezone
// (defaulting to UTC), so the returned fromStr/toStr always line up with the
// day buckets the SQL produces.
function resolveDateRange(
	from: string | undefined,
	to: string | undefined,
	timeZone: string,
): {
	startDate: Date;
	endDate: Date;
	fromStr: string;
	toStr: string;
} {
	if (from && to) {
		if (
			Number.isNaN(Date.parse(from + "T00:00:00Z")) ||
			Number.isNaN(Date.parse(to + "T00:00:00Z"))
		) {
			throw new HTTPException(400, {
				message: "Invalid from/to date (expected YYYY-MM-DD)",
			});
		}
		const startDate = zonedTimeToUtc(from + "T00:00:00.000", timeZone);
		const endDate = zonedTimeToUtc(to + "T23:59:59.999", timeZone);
		return { startDate, endDate, fromStr: from, toStr: to };
	}
	const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
	const endDate = new Date();
	const startDate = new Date(endDate.getTime() - sevenDaysMs);
	return {
		startDate,
		endDate,
		fromStr: formatInTimeZone(startDate, timeZone, false),
		toStr: formatInTimeZone(endDate, timeZone, false),
	};
}

/**
 * Ensures the authenticated user is an owner/admin of an enterprise
 * organization. Member-level usage analytics expose every member's spend, so
 * they are restricted to organization administrators on the enterprise plan.
 */
async function requireEnterpriseAdmin(
	userId: string,
	organizationId: string,
): Promise<{ role: z.infer<typeof roleSchema> }> {
	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
	});

	if (!userOrganization) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	if (userOrganization.role === "developer") {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can view member usage",
		});
	}

	const organization = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});

	if (!organization || organization.status === "deleted") {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	if (organization.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Member analytics require an enterprise plan",
		});
	}

	return { role: userOrganization.role };
}

async function getOrgProjectIds(organizationId: string): Promise<string[]> {
	const projects = await db
		.select({ id: tables.project.id })
		.from(tables.project)
		.where(
			and(
				eq(tables.project.organizationId, organizationId),
				ne(tables.project.status, "deleted"),
			),
		);
	return projects.map((p) => p.id);
}

const memberUsageSchema = z.object({
	userId: z.string(),
	name: z.string().nullable(),
	email: z.string(),
	role: roleSchema,
	apiKeyCount: z.number(),
	cost: z.number(),
	totalTokens: z.number(),
	requestCount: z.number(),
	errorCount: z.number(),
});

const getMembersUsage = createRoute({
	method: "get",
	path: "/members",
	request: {
		query: z.object(dateRangeQuery),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						members: z.array(memberUsageSchema),
						plan: z.string(),
					}),
				},
			},
			description: "Per-member usage statistics for the organization.",
		},
	},
});

analytics.openapi(getMembersUsage, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId, from, to, timezone } = c.req.valid("query");
	await requireEnterpriseAdmin(authUser.id, organizationId);

	const timeZone = timezone ?? "UTC";
	const { startDate, endDate } = resolveDateRange(from, to, timeZone);
	const projectIds = await getOrgProjectIds(organizationId);

	const members = await db.query.userOrganization.findMany({
		where: { organizationId: { eq: organizationId } },
		with: {
			user: {
				columns: { id: true, email: true, name: true },
			},
		},
	});

	if (projectIds.length === 0) {
		return c.json({
			members: members.map((m) => ({
				userId: m.userId,
				name: m.user?.name ?? null,
				email: m.user?.email ?? "",
				role: m.role,
				apiKeyCount: 0,
				cost: 0,
				totalTokens: 0,
				requestCount: 0,
				errorCount: 0,
			})),
			plan: "enterprise",
		});
	}

	const keys = await db
		.select({
			id: tables.apiKey.id,
			createdBy: tables.apiKey.createdBy,
		})
		.from(tables.apiKey)
		.where(inArray(tables.apiKey.projectId, projectIds));

	const keyToCreator = new Map<string, string>();
	const keyCountByCreator = new Map<string, number>();
	for (const key of keys) {
		keyToCreator.set(key.id, key.createdBy);
		keyCountByCreator.set(
			key.createdBy,
			(keyCountByCreator.get(key.createdBy) ?? 0) + 1,
		);
	}

	const usageRows = await db
		.select({
			apiKeyId: apiKeyHourlyStats.apiKeyId,
			cost: sql<number>`SUM(${apiKeyHourlyStats.cost})`.as("cost"),
			totalTokens:
				sql<number>`SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			requestCount: sql<number>`SUM(${apiKeyHourlyStats.requestCount})`.as(
				"request_count",
			),
			errorCount: sql<number>`SUM(${apiKeyHourlyStats.errorCount})`.as(
				"error_count",
			),
		})
		.from(apiKeyHourlyStats)
		.where(
			and(
				inArray(apiKeyHourlyStats.projectId, projectIds),
				gte(apiKeyHourlyStats.hourTimestamp, startDate),
				lte(apiKeyHourlyStats.hourTimestamp, endDate),
			),
		)
		.groupBy(apiKeyHourlyStats.apiKeyId);

	const usageByCreator = new Map<
		string,
		{
			cost: number;
			totalTokens: number;
			requestCount: number;
			errorCount: number;
		}
	>();
	for (const row of usageRows) {
		const creator = keyToCreator.get(row.apiKeyId);
		if (!creator) {
			continue;
		}
		const agg = usageByCreator.get(creator) ?? {
			cost: 0,
			totalTokens: 0,
			requestCount: 0,
			errorCount: 0,
		};
		agg.cost += Number(row.cost ?? 0);
		agg.totalTokens += Number(row.totalTokens ?? 0);
		agg.requestCount += Number(row.requestCount ?? 0);
		agg.errorCount += Number(row.errorCount ?? 0);
		usageByCreator.set(creator, agg);
	}

	const result = members
		.map((m) => {
			const agg = usageByCreator.get(m.userId);
			return {
				userId: m.userId,
				name: m.user?.name ?? null,
				email: m.user?.email ?? "",
				role: m.role,
				apiKeyCount: keyCountByCreator.get(m.userId) ?? 0,
				cost: agg?.cost ?? 0,
				totalTokens: agg?.totalTokens ?? 0,
				requestCount: agg?.requestCount ?? 0,
				errorCount: agg?.errorCount ?? 0,
			};
		})
		.sort((a, b) => b.cost - a.cost);

	return c.json({ members: result, plan: "enterprise" });
});

const breakdownEntrySchema = z.object({
	key: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.number(),
});

const memberActivityModelSchema = z.object({
	id: z.string(),
	provider: z.string(),
	requestCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
});

const memberActivityRowSchema = z.object({
	date: z.string(),
	modelBreakdown: z.array(memberActivityModelSchema),
});

const memberDetailSchema = z.object({
	member: z.object({
		userId: z.string(),
		name: z.string().nullable(),
		email: z.string(),
		role: roleSchema,
	}),
	summary: z.object({
		cost: z.number(),
		inputTokens: z.number(),
		outputTokens: z.number(),
		totalTokens: z.number(),
		requestCount: z.number(),
		errorCount: z.number(),
		cacheCount: z.number(),
		apiKeyCount: z.number(),
	}),
	topModels: z.array(breakdownEntrySchema),
	topProviders: z.array(breakdownEntrySchema),
	costByModel: z.array(breakdownEntrySchema),
	activity: z.array(memberActivityRowSchema),
});

const getMemberDetail = createRoute({
	method: "get",
	path: "/members/{userId}",
	request: {
		params: z.object({ userId: z.string() }),
		query: z.object(dateRangeQuery),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: memberDetailSchema,
				},
			},
			description: "Detailed usage statistics for a single member.",
		},
		404: {
			description: "Member not found.",
		},
	},
});

analytics.openapi(getMemberDetail, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { userId } = c.req.valid("param");
	const { organizationId, from, to, timezone } = c.req.valid("query");
	await requireEnterpriseAdmin(authUser.id, organizationId);

	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: organizationId },
		},
		with: {
			user: { columns: { id: true, email: true, name: true } },
		},
	});

	if (!membership) {
		throw new HTTPException(404, { message: "Member not found" });
	}

	const timeZone = timezone ?? "UTC";
	const { startDate, endDate, fromStr, toStr } = resolveDateRange(
		from,
		to,
		timeZone,
	);
	const projectIds = await getOrgProjectIds(organizationId);

	if (rangeDaysInclusive(fromStr, toStr) > MAX_ORG_ACTIVITY_RANGE_DAYS) {
		throw new HTTPException(400, {
			message: `Date range too large (max ${MAX_ORG_ACTIVITY_RANGE_DAYS} days)`,
		});
	}

	const emptyActivity = eachDay(fromStr, toStr).map((date) => ({
		date,
		modelBreakdown: [],
	}));

	const member = {
		userId: membership.userId,
		name: membership.user?.name ?? null,
		email: membership.user?.email ?? "",
		role: membership.role,
	};

	const emptySummary = {
		cost: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		requestCount: 0,
		errorCount: 0,
		cacheCount: 0,
		apiKeyCount: 0,
	};

	if (projectIds.length === 0) {
		return c.json({
			member,
			summary: emptySummary,
			topModels: [],
			topProviders: [],
			costByModel: [],
			activity: emptyActivity,
		});
	}

	const memberKeys = await db
		.select({ id: tables.apiKey.id })
		.from(tables.apiKey)
		.where(
			and(
				inArray(tables.apiKey.projectId, projectIds),
				eq(tables.apiKey.createdBy, userId),
			),
		);
	const keyIds = memberKeys.map((k) => k.id);

	if (keyIds.length === 0) {
		return c.json({
			member,
			summary: emptySummary,
			topModels: [],
			topProviders: [],
			costByModel: [],
			activity: emptyActivity,
		});
	}

	const summaryRows = await db
		.select({
			cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as("cost"),
			inputTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.inputTokens} AS NUMERIC)), 0)`.as(
					"input_tokens",
				),
			outputTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.outputTokens} AS NUMERIC)), 0)`.as(
					"output_tokens",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
			requestCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
					"request_count",
				),
			errorCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.errorCount}), 0)`.as(
					"error_count",
				),
			cacheCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cacheCount}), 0)`.as(
					"cache_count",
				),
		})
		.from(apiKeyHourlyStats)
		.where(
			and(
				inArray(apiKeyHourlyStats.apiKeyId, keyIds),
				gte(apiKeyHourlyStats.hourTimestamp, startDate),
				lte(apiKeyHourlyStats.hourTimestamp, endDate),
			),
		);

	const summaryRow = summaryRows[0];
	const summary = {
		cost: Number(summaryRow?.cost ?? 0),
		inputTokens: Number(summaryRow?.inputTokens ?? 0),
		outputTokens: Number(summaryRow?.outputTokens ?? 0),
		totalTokens: Number(summaryRow?.totalTokens ?? 0),
		requestCount: Number(summaryRow?.requestCount ?? 0),
		errorCount: Number(summaryRow?.errorCount ?? 0),
		cacheCount: Number(summaryRow?.cacheCount ?? 0),
		apiKeyCount: keyIds.length,
	};

	const modelRows = await db
		.select({
			usedModel: apiKeyHourlyModelStats.usedModel,
			usedProvider: apiKeyHourlyModelStats.usedProvider,
			cost: sql<number>`SUM(${apiKeyHourlyModelStats.cost})`.as("cost"),
			requestCount: sql<number>`SUM(${apiKeyHourlyModelStats.requestCount})`.as(
				"request_count",
			),
			totalTokens:
				sql<number>`SUM(CAST(${apiKeyHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
		})
		.from(apiKeyHourlyModelStats)
		.where(
			and(
				inArray(apiKeyHourlyModelStats.apiKeyId, keyIds),
				gte(apiKeyHourlyModelStats.hourTimestamp, startDate),
				lte(apiKeyHourlyModelStats.hourTimestamp, endDate),
			),
		)
		.groupBy(
			apiKeyHourlyModelStats.usedModel,
			apiKeyHourlyModelStats.usedProvider,
		)
		.orderBy(desc(sql`SUM(${apiKeyHourlyModelStats.cost})`));

	const costByModel = modelRows
		.map((r) => ({
			key: r.usedModel,
			cost: Number(r.cost ?? 0),
			requestCount: Number(r.requestCount ?? 0),
			totalTokens: Number(r.totalTokens ?? 0),
		}))
		.slice(0, 20);

	const providerMap = new Map<
		string,
		{ cost: number; requestCount: number; totalTokens: number }
	>();
	for (const r of modelRows) {
		const agg = providerMap.get(r.usedProvider) ?? {
			cost: 0,
			requestCount: 0,
			totalTokens: 0,
		};
		agg.cost += Number(r.cost ?? 0);
		agg.requestCount += Number(r.requestCount ?? 0);
		agg.totalTokens += Number(r.totalTokens ?? 0);
		providerMap.set(r.usedProvider, agg);
	}
	const topProviders = [...providerMap.entries()]
		.map(([key, v]) => ({ key, ...v }))
		.sort((a, b) => b.cost - a.cost)
		.slice(0, 5);

	const topModels = costByModel.slice(0, 5);

	const activityRows = await db
		.select({
			date: bucketDate(
				apiKeyHourlyModelStats.hourTimestamp,
				timeZone,
				false,
			).as("date"),
			usedModel: apiKeyHourlyModelStats.usedModel,
			usedProvider: apiKeyHourlyModelStats.usedProvider,
			cost: sql<number>`COALESCE(SUM(${apiKeyHourlyModelStats.cost}), 0)`.as(
				"cost",
			),
			requestCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyModelStats.requestCount}), 0)`.as(
					"request_count",
				),
			inputTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.inputTokens} AS NUMERIC)), 0)`.as(
					"input_tokens",
				),
			outputTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.outputTokens} AS NUMERIC)), 0)`.as(
					"output_tokens",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
		})
		.from(apiKeyHourlyModelStats)
		.where(
			and(
				inArray(apiKeyHourlyModelStats.apiKeyId, keyIds),
				gte(apiKeyHourlyModelStats.hourTimestamp, startDate),
				lte(apiKeyHourlyModelStats.hourTimestamp, endDate),
			),
		)
		.groupBy(
			sql`1, ${apiKeyHourlyModelStats.usedModel}, ${apiKeyHourlyModelStats.usedProvider}`,
		)
		.orderBy(sql`1 ASC`);

	const breakdownByDate = new Map<
		string,
		z.infer<typeof memberActivityModelSchema>[]
	>();
	for (const row of activityRows) {
		const date = String(row.date).slice(0, 10);
		const list = breakdownByDate.get(date) ?? [];
		list.push({
			id: row.usedModel || "unknown",
			provider: row.usedProvider || "unknown",
			cost: Number(row.cost ?? 0),
			requestCount: Number(row.requestCount ?? 0),
			inputTokens: Number(row.inputTokens ?? 0),
			outputTokens: Number(row.outputTokens ?? 0),
			totalTokens: Number(row.totalTokens ?? 0),
		});
		breakdownByDate.set(date, list);
	}

	const activity = eachDay(fromStr, toStr).map((date) => ({
		date,
		modelBreakdown: breakdownByDate.get(date) ?? [],
	}));

	return c.json({
		member,
		summary,
		topModels,
		topProviders,
		costByModel,
		activity,
	});
});

const selfUsageSchema = z.object({
	summary: z.object({
		cost: z.number(),
		inputTokens: z.number(),
		outputTokens: z.number(),
		totalTokens: z.number(),
		requestCount: z.number(),
		errorCount: z.number(),
		apiKeyCount: z.number(),
	}),
	activity: z.array(
		z.object({
			date: z.string(),
			cost: z.number(),
			requestCount: z.number(),
			totalTokens: z.number(),
		}),
	),
	topModels: z.array(breakdownEntrySchema),
});

const getSelfUsage = createRoute({
	method: "get",
	path: "/me",
	request: {
		query: z.object({
			organizationId: z.string(),
			projectId: z.string(),
			from: z.string().optional(),
			to: z.string().optional(),
			timezone: timezoneQueryField,
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: selfUsageSchema,
				},
			},
			description:
				"The authenticated user's own usage within a project (own API keys only). No admin gate — self-service.",
		},
	},
});

// Self-service: a project-scoped member (developer) can always see their OWN
// usage for a project they have access to — their keys, their numbers, nothing
// else. Attributed via api_key.created_by.
analytics.openapi(getSelfUsage, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId, from, to, timezone } = c.req.valid("query");

	if (!(await userHasProjectAccess(authUser.id, projectId))) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	const timeZone = timezone ?? "UTC";
	const { startDate, endDate, fromStr, toStr } = resolveDateRange(
		from,
		to,
		timeZone,
	);

	if (rangeDaysInclusive(fromStr, toStr) > MAX_ORG_ACTIVITY_RANGE_DAYS) {
		throw new HTTPException(400, {
			message: `Date range too large (max ${MAX_ORG_ACTIVITY_RANGE_DAYS} days)`,
		});
	}

	const emptySummary = {
		cost: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		requestCount: 0,
		errorCount: 0,
		apiKeyCount: 0,
	};
	const emptyActivity = eachDay(fromStr, toStr).map((date) => ({
		date,
		cost: 0,
		requestCount: 0,
		totalTokens: 0,
	}));

	const myKeys = await db
		.select({ id: tables.apiKey.id })
		.from(tables.apiKey)
		.where(
			and(
				eq(tables.apiKey.projectId, projectId),
				eq(tables.apiKey.createdBy, authUser.id),
			),
		);
	const keyIds = myKeys.map((k) => k.id);

	if (keyIds.length === 0) {
		return c.json({
			summary: emptySummary,
			activity: emptyActivity,
			topModels: [],
		});
	}

	const summaryRows = await db
		.select({
			cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as("cost"),
			inputTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.inputTokens} AS NUMERIC)), 0)`.as(
					"input_tokens",
				),
			outputTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.outputTokens} AS NUMERIC)), 0)`.as(
					"output_tokens",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
			requestCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
					"request_count",
				),
			errorCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.errorCount}), 0)`.as(
					"error_count",
				),
		})
		.from(apiKeyHourlyStats)
		.where(
			and(
				inArray(apiKeyHourlyStats.apiKeyId, keyIds),
				gte(apiKeyHourlyStats.hourTimestamp, startDate),
				lte(apiKeyHourlyStats.hourTimestamp, endDate),
			),
		);
	const s = summaryRows[0];
	const summary = {
		cost: Number(s?.cost ?? 0),
		inputTokens: Number(s?.inputTokens ?? 0),
		outputTokens: Number(s?.outputTokens ?? 0),
		totalTokens: Number(s?.totalTokens ?? 0),
		requestCount: Number(s?.requestCount ?? 0),
		errorCount: Number(s?.errorCount ?? 0),
		apiKeyCount: keyIds.length,
	};

	const activityRows = await db
		.select({
			date: bucketDate(apiKeyHourlyStats.hourTimestamp, timeZone, false).as(
				"date",
			),
			cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as("cost"),
			requestCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
		})
		.from(apiKeyHourlyStats)
		.where(
			and(
				inArray(apiKeyHourlyStats.apiKeyId, keyIds),
				gte(apiKeyHourlyStats.hourTimestamp, startDate),
				lte(apiKeyHourlyStats.hourTimestamp, endDate),
			),
		)
		.groupBy(sql`1`)
		.orderBy(sql`1 ASC`);
	const byDate = new Map(
		activityRows.map((r) => [String(r.date).slice(0, 10), r]),
	);
	const activity = eachDay(fromStr, toStr).map((date) => {
		const r = byDate.get(date);
		return {
			date,
			cost: Number(r?.cost ?? 0),
			requestCount: Number(r?.requestCount ?? 0),
			totalTokens: Number(r?.totalTokens ?? 0),
		};
	});

	const modelRows = await db
		.select({
			usedModel: apiKeyHourlyModelStats.usedModel,
			cost: sql<number>`SUM(${apiKeyHourlyModelStats.cost})`.as("cost"),
			requestCount: sql<number>`SUM(${apiKeyHourlyModelStats.requestCount})`.as(
				"request_count",
			),
			totalTokens:
				sql<number>`SUM(CAST(${apiKeyHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
		})
		.from(apiKeyHourlyModelStats)
		.where(
			and(
				inArray(apiKeyHourlyModelStats.apiKeyId, keyIds),
				gte(apiKeyHourlyModelStats.hourTimestamp, startDate),
				lte(apiKeyHourlyModelStats.hourTimestamp, endDate),
			),
		)
		.groupBy(apiKeyHourlyModelStats.usedModel)
		.orderBy(desc(sql`SUM(${apiKeyHourlyModelStats.cost})`));
	const topModels = modelRows.slice(0, 5).map((r) => ({
		key: r.usedModel || "unknown",
		cost: Number(r.cost ?? 0),
		requestCount: Number(r.requestCount ?? 0),
		totalTokens: Number(r.totalTokens ?? 0),
	}));

	return c.json({ summary, activity, topModels });
});

const modelNameById = new Map<string, string>(
	(models as ModelDefinition[]).map((m) => [m.id, m.name ?? m.id]),
);

// Recover the canonical model id (drop provider prefix + version tag) so the
// same model routed through different providers collapses into one series at
// the org level.
function canonicalModelId(usedModel: string): string {
	const slashIdx = usedModel.indexOf("/");
	const withoutProvider =
		slashIdx === -1 ? usedModel : usedModel.slice(slashIdx + 1);
	const colonIdx = withoutProvider.indexOf(":");
	return colonIdx === -1 ? withoutProvider : withoutProvider.slice(0, colonIdx);
}

// Daily buckets are padded one calendar day at a time, so cap the window to a
// year to keep the response bounded and — crucially — to keep the returned
// buckets covering exactly the same range the SQL totals do (no silent
// truncation of an over-large span).
const MAX_ORG_ACTIVITY_RANGE_DAYS = 366;

function rangeDaysInclusive(fromStr: string, toStr: string): number {
	const from = Date.parse(`${fromStr}T00:00:00Z`);
	const to = Date.parse(`${toStr}T00:00:00Z`);
	return Math.round((to - from) / 86_400_000) + 1;
}

// Inclusive list of UTC calendar dates between two YYYY-MM-DD strings, used to
// pad the activity series so charts render a continuous axis even on idle days.
// Callers must validate the span first (see MAX_ORG_ACTIVITY_RANGE_DAYS).
function eachDay(fromStr: string, toStr: string): string[] {
	const slots: string[] = [];
	const cur = new Date(`${fromStr}T00:00:00Z`);
	const end = new Date(`${toStr}T00:00:00Z`);
	while (cur.getTime() <= end.getTime()) {
		slots.push(cur.toISOString().slice(0, 10));
		cur.setUTCDate(cur.getUTCDate() + 1);
	}
	return slots;
}

const orgGroupBySchema = z.enum(["model", "project", "apiKey", "user"]);

const orgActivityBreakdownSchema = z.object({
	key: z.string(),
	label: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.number(),
});

const orgActivityRowSchema = z.object({
	date: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.number(),
	breakdown: z.array(orgActivityBreakdownSchema),
});

const getOrgActivity = createRoute({
	method: "get",
	path: "/activity",
	request: {
		query: z.object({
			...dateRangeQuery,
			groupBy: orgGroupBySchema.optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						activity: z.array(orgActivityRowSchema),
						groupBy: orgGroupBySchema,
					}),
				},
			},
			description:
				"Organization-wide activity (daily) with a breakdown by the requested dimension, read from the hourly rollup tables.",
		},
	},
});

analytics.openapi(getOrgActivity, async (c) => {
	const authUser = c.get("user");
	if (!authUser) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const {
		organizationId,
		from,
		to,
		timezone,
		groupBy: groupByParam,
	} = c.req.valid("query");
	await requireEnterpriseAdmin(authUser.id, organizationId);

	const groupBy = groupByParam ?? "model";
	const timeZone = timezone ?? "UTC";
	const { startDate, endDate, fromStr, toStr } = resolveDateRange(
		from,
		to,
		timeZone,
	);
	const projectIds = await getOrgProjectIds(organizationId);

	if (rangeDaysInclusive(fromStr, toStr) > MAX_ORG_ACTIVITY_RANGE_DAYS) {
		throw new HTTPException(400, {
			message: `Date range too large (max ${MAX_ORG_ACTIVITY_RANGE_DAYS} days)`,
		});
	}

	if (projectIds.length === 0) {
		return c.json({
			activity: eachDay(fromStr, toStr).map((date) => ({
				date,
				cost: 0,
				requestCount: 0,
				totalTokens: 0,
				breakdown: [],
			})),
			groupBy,
		});
	}

	// Daily org-wide totals (the source of truth for the summary, independent of
	// the top-N breakdown the client charts).
	const totalsRows = await db
		.select({
			date: bucketDate(projectHourlyStats.hourTimestamp, timeZone, false).as(
				"date",
			),
			cost: sql<number>`COALESCE(SUM(${projectHourlyStats.cost}), 0)`.as(
				"cost",
			),
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
		})
		.from(projectHourlyStats)
		.where(
			and(
				inArray(projectHourlyStats.projectId, projectIds),
				gte(projectHourlyStats.hourTimestamp, startDate),
				lte(projectHourlyStats.hourTimestamp, endDate),
			),
		)
		.groupBy(sql`1`)
		.orderBy(sql`1 ASC`);

	const totalsByDate = new Map(
		totalsRows.map((r) => [String(r.date).slice(0, 10), r]),
	);

	interface BreakdownAgg {
		label: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
	}
	const breakdownByDate = new Map<string, Map<string, BreakdownAgg>>();

	const addBreakdown = (
		date: string,
		key: string,
		label: string,
		cost: number,
		requestCount: number,
		totalTokens: number,
	) => {
		let dayMap = breakdownByDate.get(date);
		if (!dayMap) {
			dayMap = new Map();
			breakdownByDate.set(date, dayMap);
		}
		const existing = dayMap.get(key);
		if (existing) {
			existing.cost += cost;
			existing.requestCount += requestCount;
			existing.totalTokens += totalTokens;
		} else {
			dayMap.set(key, { label, cost, requestCount, totalTokens });
		}
	};

	if (groupBy === "model") {
		const rows = await db
			.select({
				date: bucketDate(
					projectHourlyModelStats.hourTimestamp,
					timeZone,
					false,
				).as("date"),
				usedModel: projectHourlyModelStats.usedModel,
				cost: sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as(
					"cost",
				),
				requestCount:
					sql<number>`COALESCE(SUM(${projectHourlyModelStats.requestCount}), 0)`.as(
						"request_count",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
						"total_tokens",
					),
			})
			.from(projectHourlyModelStats)
			.where(
				and(
					inArray(projectHourlyModelStats.projectId, projectIds),
					gte(projectHourlyModelStats.hourTimestamp, startDate),
					lte(projectHourlyModelStats.hourTimestamp, endDate),
				),
			)
			.groupBy(sql`1, ${projectHourlyModelStats.usedModel}`)
			.orderBy(sql`1 ASC`);

		for (const row of rows) {
			const date = String(row.date).slice(0, 10);
			const usedModel = row.usedModel || "unknown";
			const key = canonicalModelId(usedModel);
			const label = modelNameById.get(key) ?? key;
			addBreakdown(
				date,
				key,
				label,
				Number(row.cost),
				Number(row.requestCount),
				Number(row.totalTokens),
			);
		}
	} else if (groupBy === "project") {
		const projectNames = new Map(
			(
				await db
					.select({ id: tables.project.id, name: tables.project.name })
					.from(tables.project)
					.where(inArray(tables.project.id, projectIds))
			).map((p) => [p.id, p.name] as const),
		);

		const rows = await db
			.select({
				date: bucketDate(projectHourlyStats.hourTimestamp, timeZone, false).as(
					"date",
				),
				projectId: projectHourlyStats.projectId,
				cost: sql<number>`COALESCE(SUM(${projectHourlyStats.cost}), 0)`.as(
					"cost",
				),
				requestCount:
					sql<number>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
						"request_count",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
						"total_tokens",
					),
			})
			.from(projectHourlyStats)
			.where(
				and(
					inArray(projectHourlyStats.projectId, projectIds),
					gte(projectHourlyStats.hourTimestamp, startDate),
					lte(projectHourlyStats.hourTimestamp, endDate),
				),
			)
			.groupBy(sql`1, ${projectHourlyStats.projectId}`)
			.orderBy(sql`1 ASC`);

		for (const row of rows) {
			const date = String(row.date).slice(0, 10);
			addBreakdown(
				date,
				row.projectId,
				projectNames.get(row.projectId) ?? "Unknown project",
				Number(row.cost),
				Number(row.requestCount),
				Number(row.totalTokens),
			);
		}
	} else if (groupBy === "user") {
		// Attribute each key's usage to the member who created it
		// (api_key.created_by), matching the Teams page member breakdown.
		const rows = await db
			.select({
				date: bucketDate(apiKeyHourlyStats.hourTimestamp, timeZone, false).as(
					"date",
				),
				userId: tables.apiKey.createdBy,
				cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as(
					"cost",
				),
				requestCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
						"request_count",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
						"total_tokens",
					),
			})
			.from(apiKeyHourlyStats)
			.innerJoin(
				tables.apiKey,
				eq(tables.apiKey.id, apiKeyHourlyStats.apiKeyId),
			)
			.where(
				and(
					inArray(apiKeyHourlyStats.projectId, projectIds),
					inArray(tables.apiKey.keyType, ["user", "end_user_customer"]),
					gte(apiKeyHourlyStats.hourTimestamp, startDate),
					lte(apiKeyHourlyStats.hourTimestamp, endDate),
				),
			)
			.groupBy(sql`1, ${tables.apiKey.createdBy}`)
			.orderBy(sql`1 ASC`);

		const creatorIds = Array.from(new Set(rows.map((row) => row.userId)));
		const userLabels = new Map(
			creatorIds.length
				? (
						await db
							.select({
								id: tables.user.id,
								name: tables.user.name,
								email: tables.user.email,
							})
							.from(tables.user)
							.where(inArray(tables.user.id, creatorIds))
					).map((u) => [u.id, u.name ?? u.email] as const)
				: [],
		);

		for (const row of rows) {
			const date = String(row.date).slice(0, 10);
			addBreakdown(
				date,
				row.userId,
				userLabels.get(row.userId) ?? "Unknown user",
				Number(row.cost),
				Number(row.requestCount),
				Number(row.totalTokens),
			);
		}
	} else {
		const rows = await db
			.select({
				date: bucketDate(apiKeyHourlyStats.hourTimestamp, timeZone, false).as(
					"date",
				),
				apiKeyId: apiKeyHourlyStats.apiKeyId,
				description: tables.apiKey.description,
				cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as(
					"cost",
				),
				requestCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
						"request_count",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
						"total_tokens",
					),
			})
			.from(apiKeyHourlyStats)
			.leftJoin(tables.apiKey, eq(tables.apiKey.id, apiKeyHourlyStats.apiKeyId))
			.where(
				and(
					inArray(apiKeyHourlyStats.projectId, projectIds),
					inArray(tables.apiKey.keyType, ["user", "end_user_customer"]),
					gte(apiKeyHourlyStats.hourTimestamp, startDate),
					lte(apiKeyHourlyStats.hourTimestamp, endDate),
				),
			)
			.groupBy(
				sql`1, ${apiKeyHourlyStats.apiKeyId}, ${tables.apiKey.description}`,
			)
			.orderBy(sql`1 ASC`);

		for (const row of rows) {
			const date = String(row.date).slice(0, 10);
			addBreakdown(
				date,
				row.apiKeyId,
				row.description ?? "Deleted key",
				Number(row.cost),
				Number(row.requestCount),
				Number(row.totalTokens),
			);
		}
	}

	const activity = eachDay(fromStr, toStr).map((date) => {
		const totals = totalsByDate.get(date);
		const dayMap = breakdownByDate.get(date);
		return {
			date,
			cost: Number(totals?.cost ?? 0),
			requestCount: Number(totals?.requestCount ?? 0),
			totalTokens: Number(totals?.totalTokens ?? 0),
			breakdown: dayMap
				? Array.from(dayMap.entries()).map(([key, v]) => ({
						key,
						label: v.label,
						cost: v.cost,
						requestCount: v.requestCount,
						totalTokens: v.totalTokens,
					}))
				: [],
		};
	});

	return c.json({ activity, groupBy });
});
