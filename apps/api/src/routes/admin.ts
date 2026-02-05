import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import {
	and,
	asc,
	db,
	desc,
	eq,
	gte,
	inArray,
	lt,
	or,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const admin = new OpenAPIHono<ServerTypes>();

admin.use("/*", adminMiddleware);

const adminMetricsSchema = z.object({
	totalSignups: z.number(),
	verifiedUsers: z.number(),
	payingCustomers: z.number(),
	totalRevenue: z.number(),
	totalOrganizations: z.number(),
});

const tokenWindowSchema = z.enum(["1d", "7d"]);

const organizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	billingEmail: z.string(),
	plan: z.string(),
	devPlan: z.string(),
	credits: z.string(),
	createdAt: z.string(),
	status: z.string().nullable(),
});

const organizationsListSchema = z.object({
	organizations: z.array(organizationSchema),
	total: z.number(),
	totalCredits: z.string(),
	limit: z.number(),
	offset: z.number(),
});

const orgMetricsSchema = z.object({
	organization: organizationSchema,
	window: tokenWindowSchema,
	startDate: z.string(),
	endDate: z.string(),
	totalRequests: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	inputTokens: z.number(),
	inputCost: z.number(),
	outputTokens: z.number(),
	outputCost: z.number(),
	cachedTokens: z.number(),
	cachedCost: z.number(),
	mostUsedModel: z.string().nullable(),
	mostUsedProvider: z.string().nullable(),
	mostUsedModelRequestCount: z.number(),
});

const transactionSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	type: z.string(),
	amount: z.string().nullable(),
	creditAmount: z.string().nullable(),
	currency: z.string(),
	status: z.string(),
	description: z.string().nullable(),
});

const transactionsListSchema = z.object({
	transactions: z.array(transactionSchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
});

const getMetrics = createRoute({
	method: "get",
	path: "/metrics",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: adminMetricsSchema.openapi({}),
				},
			},
			description: "Admin dashboard metrics.",
		},
	},
});

const sortBySchema = z.enum([
	"name",
	"billingEmail",
	"plan",
	"devPlan",
	"credits",
	"createdAt",
	"status",
]);

const sortOrderSchema = z.enum(["asc", "desc"]);

const getOrganizations = createRoute({
	method: "get",
	path: "/organizations",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			search: z.string().optional(),
			sortBy: sortBySchema.default("createdAt").optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: organizationsListSchema.openapi({}),
				},
			},
			description: "List of organizations.",
		},
	},
});

const getOrganizationMetrics = createRoute({
	method: "get",
	path: "/organizations/{orgId}",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			window: tokenWindowSchema.default("1d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: orgMetricsSchema.openapi({}),
				},
			},
			description: "Organization metrics.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

const getOrganizationTransactions = createRoute({
	method: "get",
	path: "/organizations/{orgId}/transactions",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(25).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: transactionsListSchema.openapi({}),
				},
			},
			description: "Organization transactions.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

admin.openapi(getMetrics, async (c) => {
	// Total signups (all users)
	const [signupsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.user);

	const totalSignups = Number(signupsRow?.count ?? 0);

	// Verified users (email verified)
	const [verifiedRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.user)
		.where(eq(tables.user.emailVerified, true));

	const verifiedUsers = Number(verifiedRow?.count ?? 0);

	// Paying customers: organizations with at least one completed transaction
	const [payingRow] = await db
		.select({
			count:
				sql<number>`COUNT(DISTINCT ${tables.transaction.organizationId})`.as(
					"count",
				),
		})
		.from(tables.transaction)
		.where(eq(tables.transaction.status, "completed"));

	const payingCustomers = Number(payingRow?.count ?? 0);

	// Total revenue (all completed transactions)
	const [revenueRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(eq(tables.transaction.status, "completed"));

	const totalRevenue = Number(revenueRow?.value ?? 0);

	// Total organizations
	const [orgsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.organization);

	const totalOrganizations = Number(orgsRow?.count ?? 0);

	return c.json({
		totalSignups,
		verifiedUsers,
		payingCustomers,
		totalRevenue,
		totalOrganizations,
	});
});

admin.openapi(getOrganizations, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	const offset = query.offset ?? 0;
	const search = query.search;
	const sortBy = query.sortBy ?? "createdAt";
	const sortOrder = query.sortOrder ?? "desc";

	const searchLower = search?.toLowerCase();
	const whereClause = searchLower
		? or(
				sql`LOWER(${tables.organization.name}) LIKE ${`%${searchLower}%`}`,
				sql`LOWER(${tables.organization.billingEmail}) LIKE ${`%${searchLower}%`}`,
				sql`${tables.organization.id} LIKE ${`%${search}%`}`,
			)
		: undefined;

	const [countResult] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
			totalCredits:
				sql<string>`COALESCE(SUM(CAST(${tables.organization.credits} AS NUMERIC)), 0)`.as(
					"totalCredits",
				),
		})
		.from(tables.organization)
		.where(whereClause);

	const total = Number(countResult?.count ?? 0);
	const totalCredits = String(countResult?.totalCredits ?? "0");

	const sortColumnMap = {
		name: tables.organization.name,
		billingEmail: tables.organization.billingEmail,
		plan: tables.organization.plan,
		devPlan: tables.organization.devPlan,
		credits: tables.organization.credits,
		createdAt: tables.organization.createdAt,
		status: tables.organization.status,
	} as const;

	const sortColumn = sortColumnMap[sortBy];
	const orderFn = sortOrder === "asc" ? asc : desc;

	const organizations = await db
		.select({
			id: tables.organization.id,
			name: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
			plan: tables.organization.plan,
			devPlan: tables.organization.devPlan,
			credits: tables.organization.credits,
			createdAt: tables.organization.createdAt,
			status: tables.organization.status,
		})
		.from(tables.organization)
		.where(whereClause)
		.orderBy(orderFn(sortColumn))
		.limit(limit)
		.offset(offset);

	return c.json({
		organizations: organizations.map((org) => ({
			...org,
			credits: String(org.credits),
			createdAt: org.createdAt.toISOString(),
		})),
		total,
		totalCredits,
		limit,
		offset,
	});
});

admin.openapi(getOrganizationMetrics, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const windowParam = query.window ?? "1d";

	// Fetch organization
	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	// Get projects for this organization
	const projects = await db
		.select({ id: tables.project.id })
		.from(tables.project)
		.where(eq(tables.project.organizationId, orgId));

	const projectIds = projects.map((p) => p.id);

	const now = new Date();
	const days = windowParam === "7d" ? 7 : 1;
	const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

	let totalRequests = 0;
	let totalTokens = 0;
	let totalCost = 0;
	let inputTokens = 0;
	let inputCost = 0;
	let outputTokens = 0;
	let outputCost = 0;
	let cachedTokens = 0;
	let cachedCost = 0;
	let mostUsedModel: string | null = null;
	let mostUsedProvider: string | null = null;
	let mostUsedModelRequestCount = 0;

	if (projectIds.length > 0) {
		const rows = await db
			.select({
				usedModel: tables.log.usedModel,
				usedProvider: tables.log.usedProvider,
				requestsCount: sql<number>`COUNT(*)`.as("requestsCount"),
				inputTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.promptTokens} AS INTEGER)), 0)`.as(
						"inputTokens",
					),
				outputTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.completionTokens} AS INTEGER)), 0)`.as(
						"outputTokens",
					),
				cachedTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.cachedTokens} AS INTEGER)), 0)`.as(
						"cachedTokens",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.totalTokens} AS INTEGER)), 0)`.as(
						"totalTokens",
					),
				totalCost: sql<number>`COALESCE(SUM(${tables.log.cost}), 0)`.as(
					"totalCost",
				),
				inputCost: sql<number>`COALESCE(SUM(${tables.log.inputCost}), 0)`.as(
					"inputCost",
				),
				outputCost: sql<number>`COALESCE(SUM(${tables.log.outputCost}), 0)`.as(
					"outputCost",
				),
				cachedCost:
					sql<number>`COALESCE(SUM(${tables.log.cachedInputCost}), 0)`.as(
						"cachedCost",
					),
			})
			.from(tables.log)
			.where(
				and(
					inArray(tables.log.projectId, projectIds),
					gte(tables.log.createdAt, startDate),
					lt(tables.log.createdAt, now),
				),
			)
			.groupBy(tables.log.usedModel, tables.log.usedProvider);

		for (const row of rows) {
			totalRequests += Number(row.requestsCount) || 0;
			totalTokens += Number(row.totalTokens) || 0;
			totalCost += Number(row.totalCost) || 0;
			inputTokens += Number(row.inputTokens) || 0;
			inputCost += Number(row.inputCost) || 0;
			outputTokens += Number(row.outputTokens) || 0;
			outputCost += Number(row.outputCost) || 0;
			cachedTokens += Number(row.cachedTokens) || 0;
			cachedCost += Number(row.cachedCost) || 0;

			const rowRequestCount = Number(row.requestsCount) || 0;
			if (rowRequestCount > mostUsedModelRequestCount) {
				mostUsedModelRequestCount = rowRequestCount;
				mostUsedModel = row.usedModel;
				mostUsedProvider = row.usedProvider;
			}
		}
	}

	return c.json({
		organization: {
			id: org.id,
			name: org.name,
			billingEmail: org.billingEmail,
			plan: org.plan,
			devPlan: org.devPlan,
			credits: String(org.credits),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
		},
		window: windowParam,
		startDate: startDate.toISOString(),
		endDate: now.toISOString(),
		totalRequests,
		totalTokens,
		totalCost,
		inputTokens,
		inputCost,
		outputTokens,
		outputCost,
		cachedTokens,
		cachedCost,
		mostUsedModel,
		mostUsedProvider,
		mostUsedModelRequestCount,
	});
});

admin.openapi(getOrganizationTransactions, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const limit = query.limit ?? 25;
	const offset = query.offset ?? 0;

	// Verify organization exists
	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	// Get total count
	const [countResult] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.transaction)
		.where(eq(tables.transaction.organizationId, orgId));

	const total = Number(countResult?.count ?? 0);

	// Fetch paginated transactions for this organization
	const transactions = await db
		.select({
			id: tables.transaction.id,
			createdAt: tables.transaction.createdAt,
			type: tables.transaction.type,
			amount: tables.transaction.amount,
			creditAmount: tables.transaction.creditAmount,
			currency: tables.transaction.currency,
			status: tables.transaction.status,
			description: tables.transaction.description,
		})
		.from(tables.transaction)
		.where(eq(tables.transaction.organizationId, orgId))
		.orderBy(desc(tables.transaction.createdAt))
		.limit(limit)
		.offset(offset);

	return c.json({
		transactions: transactions.map((t) => ({
			id: t.id,
			createdAt: t.createdAt.toISOString(),
			type: t.type,
			amount: t.amount ? String(t.amount) : null,
			creditAmount: t.creditAmount ? String(t.creditAmount) : null,
			currency: t.currency,
			status: t.status,
			description: t.description,
		})),
		total,
		limit,
		offset,
	});
});

export default admin;
