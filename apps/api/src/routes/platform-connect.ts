import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { platformSecretAuth } from "@/lib/platform-secret-auth.js";
import { getStripe } from "@/routes/payments.js";

import { and, db, eq, shortid, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { ServerTypes } from "@/vars.js";

/**
 * LLM SDK — developer margin payouts via Stripe Connect.
 *
 * End-user top-ups are collected on LLM Gateway's Stripe account; the developer's
 * markup accrues to `organization.endUserMarginBalance`. These endpoints let the
 * developer onboard an Express connected account and transfer their accrued
 * margin out. Authenticated with the platform secret key.
 *
 * NOTE: live operation requires Stripe Connect enabled on the platform account.
 */
export const platformConnect = new OpenAPIHono<ServerTypes>();

platformConnect.use("*", platformSecretAuth);

// Connect onboarding and payouts move real money on the live platform account,
// and test-mode top-ups never accrue payable margin. Reject test keys outright
// so a sandbox key can't touch live Connect state or payouts.
platformConnect.use("*", async (c, next) => {
	const platformKey = c.get("platformKey");
	if (platformKey?.mode === "test") {
		throw new HTTPException(403, {
			message:
				"Connect onboarding and payouts are not available in test mode. Use a live secret key.",
		});
	}
	await next();
});

/** Minimum balance (USD) before a payout can be requested. */
const MIN_PAYOUT_AMOUNT = 1;

async function getOrg(organizationId: string) {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});
	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}
	return org;
}

const onboard = createRoute({
	method: "post",
	path: "/onboard",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						refreshUrl: z.string().url(),
						returnUrl: z.string().url(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ accountId: z.string(), url: z.string() }),
				},
			},
			description:
				"A Stripe Connect onboarding link. Redirect the developer to `url`.",
		},
	},
});

platformConnect.openapi(onboard, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { refreshUrl, returnUrl } = c.req.valid("json");

	const org = await getOrg(platformKey.organizationId);

	let accountId = org.stripeConnectAccountId;
	if (!accountId) {
		const account = await getStripe().accounts.create({
			type: "express",
			metadata: { organizationId: org.id },
		});
		accountId = account.id;
		await db
			.update(tables.organization)
			.set({ stripeConnectAccountId: accountId })
			.where(eq(tables.organization.id, org.id));
	}

	const link = await getStripe().accountLinks.create({
		account: accountId,
		refresh_url: refreshUrl,
		return_url: returnUrl,
		type: "account_onboarding",
	});

	return c.json({ accountId, url: link.url });
});

const status = createRoute({
	method: "get",
	path: "/status",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						accountId: z.string().nullable(),
						onboarded: z.boolean(),
						payoutsEnabled: z.boolean(),
						marginBalance: z.string(),
					}),
				},
			},
			description: "Connect onboarding status and the payable margin balance.",
		},
	},
});

platformConnect.openapi(status, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const org = await getOrg(platformKey.organizationId);

	let payoutsEnabled = false;
	if (org.stripeConnectAccountId) {
		const account = await getStripe().accounts.retrieve(
			org.stripeConnectAccountId,
		);
		payoutsEnabled = Boolean(account.payouts_enabled);

		// Keep the cached onboarded flag in sync.
		if (payoutsEnabled !== org.stripeConnectOnboarded) {
			await db
				.update(tables.organization)
				.set({ stripeConnectOnboarded: payoutsEnabled })
				.where(eq(tables.organization.id, org.id));
		}
	}

	return c.json({
		accountId: org.stripeConnectAccountId,
		onboarded: payoutsEnabled,
		payoutsEnabled,
		marginBalance: org.endUserMarginBalance,
	});
});

const createPayout = createRoute({
	method: "post",
	path: "/payouts",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						transferId: z.string(),
						amount: z.string(),
						marginBalance: z.string(),
					}),
				},
			},
			description:
				"Transferred the accrued end-user margin to the connected account.",
		},
	},
});

platformConnect.openapi(createPayout, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const org = await getOrg(platformKey.organizationId);

	if (!org.stripeConnectAccountId || !org.stripeConnectOnboarded) {
		throw new HTTPException(400, {
			message:
				"Connect onboarding is not complete. Call /v1/connect/onboard first.",
		});
	}

	const marginBalance = Number(org.endUserMarginBalance ?? "0");
	if (marginBalance < MIN_PAYOUT_AMOUNT) {
		throw new HTTPException(400, {
			message: `Nothing to pay out (minimum $${MIN_PAYOUT_AMOUNT}).`,
		});
	}

	// Transfer whole cents; decrement the balance by exactly what we moved.
	const amountCents = Math.floor(marginBalance * 100);
	const amount = amountCents / 100;

	// Reserve the funds first with a conditional decrement so this can't race the
	// auto-payout worker (or a concurrent request) into an overpayment. Only
	// proceed if we actually claimed the amount.
	const reserved = await db
		.update(tables.organization)
		.set({
			endUserMarginBalance: sql`${tables.organization.endUserMarginBalance} - ${amount}`,
		})
		.where(
			and(
				eq(tables.organization.id, org.id),
				sql`${tables.organization.endUserMarginBalance} >= ${amount}`,
			),
		)
		.returning();

	if (reserved.length === 0) {
		throw new HTTPException(409, {
			message: "Margin balance changed; please retry.",
		});
	}

	// Unique per-payout reference. The idempotency key MUST NOT be derived from
	// the amount alone: two distinct payouts of the same cents value (here or via
	// the auto-payout worker) within Stripe's idempotency window would collide,
	// silently replaying the first transfer (no money moves) while we still debit
	// the margin balance — losing the developer's funds. A fresh ref per
	// reservation keeps single-call network retries safe (the Stripe SDK reuses
	// this key) while letting genuinely distinct payouts through.
	const payoutRef = shortid();

	let transfer: { id: string };
	try {
		transfer = await getStripe().transfers.create(
			{
				amount: amountCents,
				currency: "usd",
				destination: org.stripeConnectAccountId,
				metadata: {
					organizationId: org.id,
					kind: "end_user_margin_payout",
					payoutRef,
				},
			},
			{ idempotencyKey: `margin_payout_${org.id}_${payoutRef}` },
		);
	} catch (err) {
		// Transfer failed — restore the reserved funds.
		await db
			.update(tables.organization)
			.set({
				endUserMarginBalance: sql`${tables.organization.endUserMarginBalance} + ${amount}`,
			})
			.where(eq(tables.organization.id, org.id));
		throw err;
	}

	await db.insert(tables.transaction).values({
		organizationId: org.id,
		type: "end_user_margin_payout",
		amount: String(amount),
		creditAmount: String(amount),
		status: "completed",
		description: `End-user margin payout (transfer ${transfer.id})`,
	});

	logger.info(`Paid out ${amount} end-user margin for organization ${org.id}`);

	const updated = await getOrg(org.id);

	return c.json({
		transferId: transfer.id,
		amount: String(amount),
		marginBalance: updated.endUserMarginBalance,
	});
});

export default platformConnect;
