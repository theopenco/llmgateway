import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { and, db, eq, gte, lt, sql, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const admin = new OpenAPIHono<ServerTypes>();

const adminMetricsSchema = z.object({
	totalCreditsIssued: z.number(),
	totalRevenue: z.number(),
	netProfit: z.number(),
	totalSignups: z.number(),
	verifiedUsers: z.number(),
	payingCustomers: z.number(),
	revenuePerCustomerPerMonth: z.number(),
	peakLoadSuccessRate: z.number(),
	customerInfraReplacementRate: z.number(),
});

const tokenWindowSchema = z.enum(["7d", "30d"]);

const adminTokenMetricsSchema = z.object({
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

function isAdminEmail(email: string | null | undefined): boolean {
	const adminEmailsEnv = process.env.ADMIN_EMAILS || "";
	const adminEmails = adminEmailsEnv
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean);

	if (!email || adminEmails.length === 0) {
		return false;
	}

	return adminEmails.includes(email.toLowerCase());
}

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

const getTokenMetrics = createRoute({
	method: "get",
	path: "/tokens",
	request: {
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: adminTokenMetricsSchema.openapi({}),
				},
			},
			description: "Admin token usage metrics.",
		},
	},
});

admin.openapi(getMetrics, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	if (!isAdminEmail(authUser.email)) {
		throw new HTTPException(403, {
			message: "Admin access required",
		});
	}

	const now = new Date();

	// Total credits issued (completed credit top-ups, including bonuses)
	const [creditsRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.type, "credit_topup"),
				eq(tables.transaction.status, "completed"),
			),
		);

	const totalCreditsIssued = Number(creditsRow?.value ?? 0);

	// Total revenue (all completed transactions – subscriptions + credit top-ups)
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

	// Total usage cost from logs (what customers have actually consumed)
	const [usageCostRow] = await db
		.select({
			value: sql<number>`COALESCE(SUM(${tables.log.cost}), 0)`.as("value"),
		})
		.from(tables.log);

	const totalUsageCost = Number(usageCostRow?.value ?? 0);

	// Simple net profit approximation: revenue minus metered usage cost
	const netProfit = totalRevenue - totalUsageCost;

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

	// Revenue per customer per month (last 30 days)
	const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

	const [recentRevenueRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				gte(tables.transaction.createdAt, thirtyDaysAgo),
			),
		);

	const recentRevenue = Number(recentRevenueRow?.value ?? 0);

	const [recentPayingRow] = await db
		.select({
			count:
				sql<number>`COUNT(DISTINCT ${tables.transaction.organizationId})`.as(
					"count",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				gte(tables.transaction.createdAt, thirtyDaysAgo),
			),
		);

	const recentPayingCustomers = Number(recentPayingRow?.count ?? 0);

	const revenuePerCustomerPerMonth =
		recentPayingCustomers > 0 ? recentRevenue / recentPayingCustomers : 0;

	// Requests successfully served under recent peak load (approximate: last 24 hours)
	const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

	const [requestsRow] = await db
		.select({
			total: sql<number>`COUNT(*)`.as("total"),
			successful:
				sql<number>`SUM(CASE WHEN ${tables.log.hasError} = false THEN 1 ELSE 0 END)`.as(
					"successful",
				),
		})
		.from(tables.log)
		.where(gte(tables.log.createdAt, twentyFourHoursAgo));

	const totalRequests = Number(requestsRow?.total ?? 0);
	const successfulRequests = Number(requestsRow?.successful ?? 0);

	const peakLoadSuccessRate =
		totalRequests > 0 ? successfulRequests / totalRequests : 0;

	// Customer infra replacement rate: organizations with retentionLevel "retain"
	const [totalOrgsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.organization);

	const totalOrgs = Number(totalOrgsRow?.count ?? 0);

	const [retainedOrgsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.organization)
		.where(eq(tables.organization.retentionLevel, "retain"));

	const retainedOrgs = Number(retainedOrgsRow?.count ?? 0);

	const customerInfraReplacementRate =
		totalOrgs > 0 ? retainedOrgs / totalOrgs : 0;

	return c.json({
		totalCreditsIssued,
		totalRevenue,
		netProfit,
		totalSignups,
		verifiedUsers,
		payingCustomers,
		revenuePerCustomerPerMonth,
		peakLoadSuccessRate,
		customerInfraReplacementRate,
	});
});

admin.openapi(getTokenMetrics, async (c) => {
	const authUser = c.get("user");

	if (!authUser) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	if (!isAdminEmail(authUser.email)) {
		throw new HTTPException(403, {
			message: "Admin access required",
		});
	}

	const query = c.req.valid("query");
	const windowParam = query.window ?? "7d";

	const now = new Date();
	const days = windowParam === "30d" ? 30 : 7;
	const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

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
			and(gte(tables.log.createdAt, startDate), lt(tables.log.createdAt, now)),
		)
		.groupBy(tables.log.usedModel, tables.log.usedProvider);

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

	for (const row of rows) {
		totalRequests += row.requestsCount;
		totalTokens += row.totalTokens;
		totalCost += row.totalCost;
		inputTokens += row.inputTokens;
		inputCost += row.inputCost;
		outputTokens += row.outputTokens;
		outputCost += row.outputCost;
		cachedTokens += row.cachedTokens;
		cachedCost += row.cachedCost;

		if (row.requestsCount > mostUsedModelRequestCount) {
			mostUsedModelRequestCount = row.requestsCount;
			mostUsedModel = row.usedModel;
			mostUsedProvider = row.usedProvider;
		}
	}

	return c.json({
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

export default admin;
