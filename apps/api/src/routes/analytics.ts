import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

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
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const analytics = new OpenAPIHono<ServerTypes>();

const roleSchema = z.enum(["owner", "admin", "developer"]);

const dateRangeQuery = {
	organizationId: z.string(),
	from: z.string().optional(),
	to: z.string().optional(),
};

function resolveDateRange(
	from?: string,
	to?: string,
): {
	startDate: Date;
	endDate: Date;
} {
	if (from && to) {
		const startDate = new Date(from + "T00:00:00Z");
		const endDate = new Date(to + "T00:00:00Z");
		if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
			throw new HTTPException(400, {
				message: "Invalid from/to date (expected YYYY-MM-DD)",
			});
		}
		startDate.setUTCHours(0, 0, 0, 0);
		endDate.setUTCHours(23, 59, 59, 999);
		return { startDate, endDate };
	}
	const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
	const endDate = new Date();
	const startDate = new Date(endDate.getTime() - sevenDaysMs);
	return { startDate, endDate };
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

	const { organizationId, from, to } = c.req.valid("query");
	await requireEnterpriseAdmin(authUser.id, organizationId);

	const { startDate, endDate } = resolveDateRange(from, to);
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
	const { organizationId, from, to } = c.req.valid("query");
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

	const { startDate, endDate } = resolveDateRange(from, to);
	const projectIds = await getOrgProjectIds(organizationId);

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

	return c.json({
		member,
		summary,
		topModels,
		topProviders,
		costByModel,
	});
});
