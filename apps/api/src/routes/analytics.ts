import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	MAX_ORG_ACTIVITY_RANGE_DAYS,
	rangeDaysInclusive,
	resolveDateRange,
} from "@/lib/date-range.js";
import {
	mapModeSplit,
	modeSplitFields,
	modeSplitSchema,
} from "@/lib/mode-split.js";
import { getOrgProjectIds } from "@/lib/org-projects.js";
import { requireEnterpriseAdmin } from "@/lib/require-enterprise-admin.js";
import { getUserUsageBreakdown } from "@/lib/user-usage-breakdown.js";
import { userHasProjectAccess } from "@/utils/authorization.js";
import { bucketDate, timezoneQueryField } from "@/utils/timezone.js";

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
	projectHourlyModelStats,
	projectHourlyStats,
	sql,
	tables,
} from "@llmgateway/db";
import { models, type ModelDefinition } from "@llmgateway/models";
import { deriveStabilityMetrics } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

export const analytics = new OpenAPIHono<ServerTypes>();

const roleSchema = z.enum(["owner", "admin", "developer"]);

const dateRangeQuery = {
	organizationId: z.string(),
	from: z.string().optional(),
	to: z.string().optional(),
	timezone: timezoneQueryField,
};

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
	clientErrorCount: z.number(),
	...modeSplitSchema,
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
				clientErrorCount: 0,
				creditsRequestCount: 0,
				apiKeysRequestCount: 0,
				creditsCost: 0,
				apiKeysCost: 0,
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
			cost: sql<number>`SUM(cast(${apiKeyHourlyStats.cost} as double precision))`.as(
				"cost",
			),
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
			clientErrorCount:
				sql<number>`SUM(${apiKeyHourlyStats.clientErrorCount})`.as(
					"client_error_count",
				),
			...modeSplitFields(apiKeyHourlyStats),
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
			clientErrorCount: number;
			creditsRequestCount: number;
			apiKeysRequestCount: number;
			creditsCost: number;
			apiKeysCost: number;
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
			clientErrorCount: 0,
			creditsRequestCount: 0,
			apiKeysRequestCount: 0,
			creditsCost: 0,
			apiKeysCost: 0,
		};
		agg.cost += Number(row.cost ?? 0);
		agg.totalTokens += Number(row.totalTokens ?? 0);
		agg.requestCount += Number(row.requestCount ?? 0);
		agg.errorCount += Number(row.errorCount ?? 0);
		agg.clientErrorCount += Number(row.clientErrorCount ?? 0);
		agg.creditsRequestCount += Number(row.creditsRequestCount ?? 0);
		agg.apiKeysRequestCount += Number(row.apiKeysRequestCount ?? 0);
		agg.creditsCost += Number(row.creditsCost ?? 0);
		agg.apiKeysCost += Number(row.apiKeysCost ?? 0);
		usageByCreator.set(creator, agg);
	}

	const result = members
		.map((m) => {
			const agg = usageByCreator.get(m.userId);
			const stability = deriveStabilityMetrics(
				agg?.requestCount ?? 0,
				agg?.errorCount ?? 0,
				agg?.clientErrorCount ?? 0,
			);
			return {
				userId: m.userId,
				name: m.user?.name ?? null,
				email: m.user?.email ?? "",
				role: m.role,
				apiKeyCount: keyCountByCreator.get(m.userId) ?? 0,
				cost: agg?.cost ?? 0,
				totalTokens: agg?.totalTokens ?? 0,
				requestCount: agg?.requestCount ?? 0,
				errorCount: stability.errorsCount,
				clientErrorCount: agg?.clientErrorCount ?? 0,
				creditsRequestCount: agg?.creditsRequestCount ?? 0,
				apiKeysRequestCount: agg?.apiKeysRequestCount ?? 0,
				creditsCost: agg?.creditsCost ?? 0,
				apiKeysCost: agg?.apiKeysCost ?? 0,
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
	...modeSplitSchema,
});

const memberActivityModelSchema = z.object({
	id: z.string(),
	provider: z.string(),
	requestCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	...modeSplitSchema,
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
		clientErrorCount: z.number(),
		cacheCount: z.number(),
		apiKeyCount: z.number(),
		...modeSplitSchema,
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
		clientErrorCount: 0,
		cacheCount: 0,
		apiKeyCount: 0,
		creditsRequestCount: 0,
		apiKeysRequestCount: 0,
		creditsCost: 0,
		apiKeysCost: 0,
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
			cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cost} as double precision)), 0)`.as(
				"cost",
			),
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
			clientErrorCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.clientErrorCount}), 0)`.as(
					"client_error_count",
				),
			cacheCount:
				sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cacheCount}), 0)`.as(
					"cache_count",
				),
			...modeSplitFields(apiKeyHourlyStats),
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
	const stability = deriveStabilityMetrics(
		Number(summaryRow?.requestCount ?? 0),
		Number(summaryRow?.errorCount ?? 0),
		Number(summaryRow?.clientErrorCount ?? 0),
	);
	const summary = {
		cost: Number(summaryRow?.cost ?? 0),
		inputTokens: Number(summaryRow?.inputTokens ?? 0),
		outputTokens: Number(summaryRow?.outputTokens ?? 0),
		totalTokens: Number(summaryRow?.totalTokens ?? 0),
		requestCount: Number(summaryRow?.requestCount ?? 0),
		errorCount: stability.errorsCount,
		clientErrorCount: Number(summaryRow?.clientErrorCount ?? 0),
		cacheCount: Number(summaryRow?.cacheCount ?? 0),
		apiKeyCount: keyIds.length,
		creditsRequestCount: Number(summaryRow?.creditsRequestCount ?? 0),
		apiKeysRequestCount: Number(summaryRow?.apiKeysRequestCount ?? 0),
		creditsCost: Number(summaryRow?.creditsCost ?? 0),
		apiKeysCost: Number(summaryRow?.apiKeysCost ?? 0),
	};

	const modelRows = await db
		.select({
			usedModel: apiKeyHourlyModelStats.usedModel,
			usedProvider: apiKeyHourlyModelStats.usedProvider,
			cost: sql<number>`SUM(cast(${apiKeyHourlyModelStats.cost} as double precision))`.as(
				"cost",
			),
			requestCount: sql<number>`SUM(${apiKeyHourlyModelStats.requestCount})`.as(
				"request_count",
			),
			totalTokens:
				sql<number>`SUM(CAST(${apiKeyHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			...modeSplitFields(apiKeyHourlyModelStats),
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
		.orderBy(
			desc(sql`SUM(cast(${apiKeyHourlyModelStats.cost} as double precision))`),
		);

	const costByModel = modelRows
		.map((r) => ({
			key: r.usedModel,
			cost: Number(r.cost ?? 0),
			requestCount: Number(r.requestCount ?? 0),
			totalTokens: Number(r.totalTokens ?? 0),
			...mapModeSplit(r),
		}))
		.slice(0, 20);

	const providerMap = new Map<
		string,
		{
			cost: number;
			requestCount: number;
			totalTokens: number;
			creditsRequestCount: number;
			apiKeysRequestCount: number;
			creditsCost: number;
			apiKeysCost: number;
		}
	>();
	for (const r of modelRows) {
		const agg = providerMap.get(r.usedProvider) ?? {
			cost: 0,
			requestCount: 0,
			totalTokens: 0,
			creditsRequestCount: 0,
			apiKeysRequestCount: 0,
			creditsCost: 0,
			apiKeysCost: 0,
		};
		agg.cost += Number(r.cost ?? 0);
		agg.requestCount += Number(r.requestCount ?? 0);
		agg.totalTokens += Number(r.totalTokens ?? 0);
		agg.creditsRequestCount += Number(r.creditsRequestCount ?? 0);
		agg.apiKeysRequestCount += Number(r.apiKeysRequestCount ?? 0);
		agg.creditsCost += Number(r.creditsCost ?? 0);
		agg.apiKeysCost += Number(r.apiKeysCost ?? 0);
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
			cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyModelStats.cost} as double precision)), 0)`.as(
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
			...modeSplitFields(apiKeyHourlyModelStats),
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
			...mapModeSplit(row),
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
		...modeSplitSchema,
	}),
	activity: z.array(
		z.object({
			date: z.string(),
			cost: z.number(),
			requestCount: z.number(),
			totalTokens: z.number(),
			...modeSplitSchema,
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
		creditsRequestCount: 0,
		apiKeysRequestCount: 0,
		creditsCost: 0,
		apiKeysCost: 0,
	};
	const emptyActivity = eachDay(fromStr, toStr).map((date) => ({
		date,
		cost: 0,
		requestCount: 0,
		totalTokens: 0,
		creditsRequestCount: 0,
		apiKeysRequestCount: 0,
		creditsCost: 0,
		apiKeysCost: 0,
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
			cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cost} as double precision)), 0)`.as(
				"cost",
			),
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
			...modeSplitFields(apiKeyHourlyStats),
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
		creditsRequestCount: Number(s?.creditsRequestCount ?? 0),
		apiKeysRequestCount: Number(s?.apiKeysRequestCount ?? 0),
		creditsCost: Number(s?.creditsCost ?? 0),
		apiKeysCost: Number(s?.apiKeysCost ?? 0),
	};

	const activityRows = await db
		.select({
			date: bucketDate(apiKeyHourlyStats.hourTimestamp, timeZone, false).as(
				"date",
			),
			cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cost} as double precision)), 0)`.as(
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
			...modeSplitFields(apiKeyHourlyStats),
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
			creditsRequestCount: Number(r?.creditsRequestCount ?? 0),
			apiKeysRequestCount: Number(r?.apiKeysRequestCount ?? 0),
			creditsCost: Number(r?.creditsCost ?? 0),
			apiKeysCost: Number(r?.apiKeysCost ?? 0),
		};
	});

	const modelRows = await db
		.select({
			usedModel: apiKeyHourlyModelStats.usedModel,
			cost: sql<number>`SUM(cast(${apiKeyHourlyModelStats.cost} as double precision))`.as(
				"cost",
			),
			requestCount: sql<number>`SUM(${apiKeyHourlyModelStats.requestCount})`.as(
				"request_count",
			),
			totalTokens:
				sql<number>`SUM(CAST(${apiKeyHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			...modeSplitFields(apiKeyHourlyModelStats),
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
		.orderBy(
			desc(sql`SUM(cast(${apiKeyHourlyModelStats.cost} as double precision))`),
		);
	const topModels = modelRows.slice(0, 5).map((r) => ({
		key: r.usedModel || "unknown",
		cost: Number(r.cost ?? 0),
		requestCount: Number(r.requestCount ?? 0),
		totalTokens: Number(r.totalTokens ?? 0),
		...mapModeSplit(r),
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
	...modeSplitSchema,
});

const orgActivityRowSchema = z.object({
	date: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.number(),
	...modeSplitSchema,
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
				creditsRequestCount: 0,
				apiKeysRequestCount: 0,
				creditsCost: 0,
				apiKeysCost: 0,
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
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cost} as double precision)), 0)`.as(
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
			...modeSplitFields(projectHourlyStats),
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
		creditsRequestCount: number;
		apiKeysRequestCount: number;
		creditsCost: number;
		apiKeysCost: number;
	}
	const breakdownByDate = new Map<string, Map<string, BreakdownAgg>>();

	const addBreakdown = (
		date: string,
		key: string,
		label: string,
		values: Omit<BreakdownAgg, "label">,
	) => {
		let dayMap = breakdownByDate.get(date);
		if (!dayMap) {
			dayMap = new Map();
			breakdownByDate.set(date, dayMap);
		}
		const existing = dayMap.get(key);
		if (existing) {
			existing.cost += values.cost;
			existing.requestCount += values.requestCount;
			existing.totalTokens += values.totalTokens;
			existing.creditsRequestCount += values.creditsRequestCount;
			existing.apiKeysRequestCount += values.apiKeysRequestCount;
			existing.creditsCost += values.creditsCost;
			existing.apiKeysCost += values.apiKeysCost;
		} else {
			dayMap.set(key, { label, ...values });
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
				cost: sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
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
				...modeSplitFields(projectHourlyModelStats),
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
			addBreakdown(date, key, label, {
				cost: Number(row.cost),
				requestCount: Number(row.requestCount),
				totalTokens: Number(row.totalTokens),
				...mapModeSplit(row),
			});
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
				cost: sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cost} as double precision)), 0)`.as(
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
				...modeSplitFields(projectHourlyStats),
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
				{
					cost: Number(row.cost),
					requestCount: Number(row.requestCount),
					totalTokens: Number(row.totalTokens),
					...mapModeSplit(row),
				},
			);
		}
	} else if (groupBy === "user") {
		const rows = await getUserUsageBreakdown({
			projectIds,
			startDate,
			endDate,
			timeZone,
		});

		for (const row of rows) {
			addBreakdown(row.date.slice(0, 10), row.userId, row.name, {
				cost: row.cost,
				requestCount: row.requestCount,
				totalTokens: row.totalTokens,
				creditsRequestCount: row.creditsRequestCount,
				apiKeysRequestCount: row.apiKeysRequestCount,
				creditsCost: row.creditsCost,
				apiKeysCost: row.apiKeysCost,
			});
		}
	} else {
		const rows = await db
			.select({
				date: bucketDate(apiKeyHourlyStats.hourTimestamp, timeZone, false).as(
					"date",
				),
				apiKeyId: apiKeyHourlyStats.apiKeyId,
				description: tables.apiKey.description,
				cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cost} as double precision)), 0)`.as(
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
				...modeSplitFields(apiKeyHourlyStats),
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
			addBreakdown(date, row.apiKeyId, row.description ?? "Deleted key", {
				cost: Number(row.cost),
				requestCount: Number(row.requestCount),
				totalTokens: Number(row.totalTokens),
				...mapModeSplit(row),
			});
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
			creditsRequestCount: Number(totals?.creditsRequestCount ?? 0),
			apiKeysRequestCount: Number(totals?.apiKeysRequestCount ?? 0),
			creditsCost: Number(totals?.creditsCost ?? 0),
			apiKeysCost: Number(totals?.apiKeysCost ?? 0),
			breakdown: dayMap
				? Array.from(dayMap.entries()).map(([key, v]) => ({
						key,
						label: v.label,
						cost: v.cost,
						requestCount: v.requestCount,
						totalTokens: v.totalTokens,
						creditsRequestCount: v.creditsRequestCount,
						apiKeysRequestCount: v.apiKeysRequestCount,
						creditsCost: v.creditsCost,
						apiKeysCost: v.apiKeysCost,
					}))
				: [],
		};
	});

	return c.json({ activity, groupBy });
});
