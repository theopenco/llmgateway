import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { and, db, eq, sql, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const admin = new OpenAPIHono<ServerTypes>();

const adminMetricsSchema = z.object({
	totalCreditsIssued: z.number(),
	totalRevenue: z.number(),
	netProfit: z.number(),
	totalSignups: z.number(),
	verifiedUsers: z.number(),
	payingCustomers: z.number(),
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

	return c.json({
		totalCreditsIssued,
		totalRevenue,
		netProfit,
		totalSignups,
		verifiedUsers,
		payingCustomers,
	});
});

export default admin;
