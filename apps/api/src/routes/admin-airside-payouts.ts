import { OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	carrierNames,
	payoutStatementSchema,
	serializePayoutStatement,
} from "@/lib/airside-payouts.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";

import {
	and,
	db,
	desc,
	eq,
	inArray,
	sql,
	tables,
	type SQL,
} from "@llmgateway/db";
import {
	AIRSIDE_PAYOUT_SETTLE_MS,
	AIRSIDE_PAYOUT_STATUSES,
	type AirsidePayoutStatus,
} from "@llmgateway/shared/airside-billing";

import type { ServerTypes } from "@/vars.js";

const SETTLE_HOURS = AIRSIDE_PAYOUT_SETTLE_MS / (60 * 60 * 1000);

/**
 * Payout statements of payout-mode Airside carriers. The worker opens and
 * refreshes drafts; admins adjust and approve them, wire the payout outside
 * the platform, and mark it paid here for tracking.
 */
export const adminAirsidePayouts = new OpenAPIHono<ServerTypes>();

adminAirsidePayouts.use("/*", adminMiddleware);

const statement = tables.airsidePayoutStatement;

const adminPayoutStatementSchema = payoutStatementSchema.extend({
	company: z.object({ id: z.string(), name: z.string() }),
	approvedByEmail: z.string().nullable(),
	paidByEmail: z.string().nullable(),
});

const statementResponse = {
	200: {
		content: {
			"application/json": {
				schema: z.object({ statement: adminPayoutStatementSchema }),
			},
		},
		description: "The updated statement.",
	},
};

type StatementRow = typeof statement.$inferSelect;

async function serializeAdminStatements(rows: StatementRow[]) {
	const companyIds = [...new Set(rows.map((row) => row.providerCompanyId))];
	const userIds = [
		...new Set(
			rows
				.flatMap((row) => [row.approvedBy, row.paidBy])
				.filter((id): id is string => !!id),
		),
	];
	const [names, companies, users] = await Promise.all([
		carrierNames(rows),
		companyIds.length
			? db
					.select({
						id: tables.providerCompany.id,
						name: tables.providerCompany.name,
					})
					.from(tables.providerCompany)
					.where(inArray(tables.providerCompany.id, companyIds))
			: [],
		userIds.length
			? db
					.select({ id: tables.user.id, email: tables.user.email })
					.from(tables.user)
					.where(inArray(tables.user.id, userIds))
			: [],
	]);
	const companyNames = new Map(companies.map((row) => [row.id, row.name]));
	const emails = new Map(users.map((row) => [row.id, row.email]));
	return rows.map((row) => ({
		...serializePayoutStatement(row, names),
		company: {
			id: row.providerCompanyId,
			name: companyNames.get(row.providerCompanyId) ?? row.providerCompanyId,
		},
		approvedByEmail: row.approvedBy
			? (emails.get(row.approvedBy) ?? null)
			: null,
		paidByEmail: row.paidBy ? (emails.get(row.paidBy) ?? null) : null,
	}));
}

/**
 * Applies `changes` only while the statement is in `from`, so two admins
 * acting at once cannot both transition it.
 */
async function transition(
	id: string,
	from: AirsidePayoutStatus,
	changes: Partial<typeof statement.$inferInsert>,
	conflictMessage: string,
	guard?: SQL,
) {
	const [row] = await db
		.update(statement)
		.set(changes)
		.where(and(eq(statement.id, id), eq(statement.status, from), guard))
		.returning();
	if (!row) {
		const exists = await db.query.airsidePayoutStatement.findFirst({
			where: { id: { eq: id } },
			columns: { id: true },
		});
		if (!exists) {
			throw new HTTPException(404, { message: "Statement not found" });
		}
		throw new HTTPException(409, { message: conflictMessage });
	}
	const [serialized] = await serializeAdminStatements([row]);
	return serialized;
}

const listPayouts = createRoute({
	method: "get",
	path: "/airside/payouts",
	request: {
		query: z.object({ status: z.enum(AIRSIDE_PAYOUT_STATUSES).optional() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						statements: z.array(adminPayoutStatementSchema),
					}),
				},
			},
			description: "Payout statements, newest period first.",
		},
	},
});

adminAirsidePayouts.openapi(listPayouts, async (c) => {
	const { status } = c.req.valid("query");
	const rows = await db
		.select()
		.from(statement)
		.where(status ? eq(statement.status, status) : undefined)
		.orderBy(desc(statement.periodStart), statement.providerId);
	return c.json({ statements: await serializeAdminStatements(rows) });
});

const updatePayout = createRoute({
	method: "patch",
	path: "/airside/payouts/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// Signed USD, e.g. "-12.50"; added to gross minus fee.
						adjustmentAmount: z
							.string()
							.regex(/^-?\d{1,9}(\.\d{1,2})?$/, "Use a USD amount like -12.50"),
						adjustmentNote: z.string().trim().max(1000).nullable(),
					}),
				},
			},
		},
	},
	responses: statementResponse,
});

adminAirsidePayouts.openapi(updatePayout, async (c) => {
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const amount = new Decimal(body.adjustmentAmount);
	const note = body.adjustmentNote || null;
	if (!amount.isZero() && !note) {
		throw new HTTPException(400, {
			message: "Explain the adjustment: the carrier sees the note.",
		});
	}
	return c.json({
		statement: await transition(
			id,
			"draft",
			{ adjustmentAmount: amount.toFixed(2), adjustmentNote: note },
			"Only a draft statement can be adjusted. Reopen it first.",
		),
	});
});

const approvePayout = createRoute({
	method: "post",
	path: "/airside/payouts/{id}/approve",
	request: { params: z.object({ id: z.string() }) },
	responses: statementResponse,
});

adminAirsidePayouts.openapi(approvePayout, async (c) => {
	const { id } = c.req.valid("param");
	const user = c.get("user");
	return c.json({
		statement: await transition(
			id,
			"draft",
			{ status: "approved", approvedAt: new Date(), approvedBy: user?.id },
			`Only a draft statement can be approved, once it was recomputed ${SETTLE_HOURS} hours after its period closed.`,
			sql`${statement.computedAt} >= ${statement.periodEnd} + make_interval(hours => ${SETTLE_HOURS}::int)`,
		),
	});
});

const reopenPayout = createRoute({
	method: "post",
	path: "/airside/payouts/{id}/reopen",
	request: { params: z.object({ id: z.string() }) },
	responses: statementResponse,
});

// Back to draft: the worker recomputes it and adjustments are editable again.
adminAirsidePayouts.openapi(reopenPayout, async (c) => {
	const { id } = c.req.valid("param");
	return c.json({
		statement: await transition(
			id,
			"approved",
			{ status: "draft", approvedAt: null, approvedBy: null },
			"Only an approved, unpaid statement can be reopened.",
		),
	});
});

const markPayoutPaid = createRoute({
	method: "post",
	path: "/airside/payouts/{id}/mark-paid",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// The payout the admin wired; a statement reopened and
						// re-approved since then no longer matches.
						payoutAmount: z.string().regex(/^-?\d{1,9}(\.\d{1,2})?$/),
						paymentReference: z.string().trim().max(200).nullable(),
					}),
				},
			},
		},
	},
	responses: statementResponse,
});

adminAirsidePayouts.openapi(markPayoutPaid, async (c) => {
	const { id } = c.req.valid("param");
	const { payoutAmount, paymentReference } = c.req.valid("json");
	const user = c.get("user");
	return c.json({
		statement: await transition(
			id,
			"approved",
			{
				status: "paid",
				paidAt: new Date(),
				paidBy: user?.id,
				paymentReference: paymentReference || null,
			},
			"Only an approved statement can be marked paid, for the amount it shows. Reload and check the amount.",
			sql`${statement.grossAmount} - ${statement.gatewayFeeAmount} + ${statement.adjustmentAmount} = ${new Decimal(payoutAmount).toFixed(2)}::numeric`,
		),
	});
});
