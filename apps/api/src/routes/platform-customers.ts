import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { platformSecretAuth } from "@/lib/platform-secret-auth.js";

import { db, inArray, sql, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * LLM SDK — per-end-customer analytics for the developer's backend
 * (authenticated with the platform secret key). Lets developers list their
 * end-users with wallet balances and lifetime spend, and drill into one
 * customer's usage ledger.
 */
export const platformCustomers = new OpenAPIHono<ServerTypes>();

platformCustomers.use("*", platformSecretAuth);

const walletSummarySchema = z
	.object({
		id: z.string(),
		balance: z.string(),
		currency: z.string(),
		status: z.enum(["active", "frozen"]),
	})
	.nullable();

const customerSchema = z.object({
	id: z.string(),
	externalId: z.string(),
	email: z.string().nullable(),
	name: z.string().nullable(),
	status: z.enum(["active", "blocked", "deleted"]),
	createdAt: z.string(),
	wallet: walletSummarySchema,
	/** Total real USD spent on AI (sum of usage debits). */
	lifetimeSpend: z.string(),
	/** Total real USD credited to the wallet from top-ups. */
	lifetimeToppedUp: z.string(),
});

/**
 * Aggregate lifetime spend (usage debits) and credited top-ups per wallet from
 * the ledger, in a single grouped query.
 */
async function aggregateByWallet(
	walletIds: string[],
): Promise<Map<string, { spend: string; toppedUp: string }>> {
	if (walletIds.length === 0) {
		return new Map();
	}
	const rows = await db
		.select({
			walletId: tables.walletLedger.walletId,
			spend: sql<string>`COALESCE(SUM(CASE WHEN ${tables.walletLedger.type} = 'usage_debit' THEN -${tables.walletLedger.amount} ELSE 0 END), 0)`,
			toppedUp: sql<string>`COALESCE(SUM(CASE WHEN ${tables.walletLedger.type} = 'topup' THEN ${tables.walletLedger.netCredited} ELSE 0 END), 0)`,
		})
		.from(tables.walletLedger)
		.where(inArray(tables.walletLedger.walletId, walletIds))
		.groupBy(tables.walletLedger.walletId);

	return new Map(
		rows.map((r) => [
			r.walletId,
			{ spend: String(r.spend), toppedUp: String(r.toppedUp) },
		]),
	);
}

const listCustomers = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			limit: z.coerce.number().int().min(1).max(200).optional(),
			offset: z.coerce.number().int().min(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ customers: z.array(customerSchema) }),
				},
			},
			description:
				"End customers for the project with wallet balances + spend.",
		},
	},
});

platformCustomers.openapi(listCustomers, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { limit = 50, offset = 0 } = c.req.valid("query");

	const customers = await db.query.endCustomer.findMany({
		// Scope to the key's mode so a test key never sees live customers/wallets.
		where: {
			projectId: { eq: platformKey.projectId },
			mode: { eq: platformKey.mode },
		},
		with: { wallet: true },
		orderBy: { createdAt: "desc" },
		limit,
		offset,
	});

	const agg = await aggregateByWallet(
		customers.map((cust) => cust.wallet?.id).filter((id): id is string => !!id),
	);

	return c.json({
		customers: customers.map((cust) => {
			const a = cust.wallet ? agg.get(cust.wallet.id) : undefined;
			return {
				id: cust.id,
				externalId: cust.externalId,
				email: cust.email,
				name: cust.name,
				status: cust.status,
				createdAt: cust.createdAt.toISOString(),
				wallet: cust.wallet
					? {
							id: cust.wallet.id,
							balance: cust.wallet.balance,
							currency: cust.wallet.currency,
							status: cust.wallet.status,
						}
					: null,
				lifetimeSpend: a?.spend ?? "0",
				lifetimeToppedUp: a?.toppedUp ?? "0",
			};
		}),
	});
});

const ledgerEntrySchema = z.object({
	id: z.string(),
	type: z.string(),
	amount: z.string(),
	balanceAfter: z.string(),
	createdAt: z.string(),
	description: z.string().nullable(),
});

const getCustomer = createRoute({
	method: "get",
	path: "/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: {
				"application/json": {
					schema: customerSchema.extend({
						recentLedger: z.array(ledgerEntrySchema),
					}),
				},
			},
			description: "A single end customer with wallet + recent ledger.",
		},
	},
});

platformCustomers.openapi(getCustomer, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const cust = await db.query.endCustomer.findFirst({
		where: {
			id: { eq: id },
			projectId: { eq: platformKey.projectId },
			mode: { eq: platformKey.mode },
		},
		with: { wallet: true },
	});
	if (!cust) {
		throw new HTTPException(404, {
			message: "Customer not found in this project",
		});
	}

	const agg = await aggregateByWallet(cust.wallet ? [cust.wallet.id] : []);
	const a = cust.wallet ? agg.get(cust.wallet.id) : undefined;

	const ledger = cust.wallet
		? await db.query.walletLedger.findMany({
				where: { walletId: { eq: cust.wallet.id } },
				orderBy: { createdAt: "desc" },
				limit: 20,
			})
		: [];

	return c.json({
		id: cust.id,
		externalId: cust.externalId,
		email: cust.email,
		name: cust.name,
		status: cust.status,
		createdAt: cust.createdAt.toISOString(),
		wallet: cust.wallet
			? {
					id: cust.wallet.id,
					balance: cust.wallet.balance,
					currency: cust.wallet.currency,
					status: cust.wallet.status,
				}
			: null,
		lifetimeSpend: a?.spend ?? "0",
		lifetimeToppedUp: a?.toppedUp ?? "0",
		recentLedger: ledger.map((row) => ({
			id: row.id,
			type: row.type,
			amount: row.amount,
			balanceAfter: row.balanceAfter,
			createdAt: row.createdAt.toISOString(),
			description: row.description,
		})),
	});
});

export default platformCustomers;
