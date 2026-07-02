import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { endUserSessionAuth } from "@/lib/end-user-session-auth.js";
import { getStripe } from "@/routes/payments.js";
import { ensureEndCustomerStripeCustomer } from "@/stripe.js";

import {
	apiKeyPeriodDurationUnits,
	db,
	getApiKeyCurrentPeriodState,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	calculateFees,
	CREDIT_TOP_UP_MAX_AMOUNT,
	CREDIT_TOP_UP_MIN_AMOUNT,
} from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

/**
 * LLM SDK — end-user wallet endpoints, authenticated with the browser's
 * **ephemeral session token** (`es_…`). These let the end-user check their
 * balance and buy credits in-app. The session is bound to exactly one wallet.
 */
export const platformWallet = new OpenAPIHono<ServerTypes>();

platformWallet.use("*", endUserSessionAuth);

const topUpAmountSchema = z
	.number()
	.int()
	.min(
		CREDIT_TOP_UP_MIN_AMOUNT,
		`Minimum top-up amount is $${CREDIT_TOP_UP_MIN_AMOUNT}.`,
	)
	.max(
		CREDIT_TOP_UP_MAX_AMOUNT,
		`Maximum top-up amount is $${CREDIT_TOP_UP_MAX_AMOUNT}.`,
	);

const createTopUp = createRoute({
	method: "post",
	path: "/top-up",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ amount: topUpAmountSchema }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						clientSecret: z.string(),
						totalAmount: z.number(),
						netCredited: z.number(),
						isInternational: z.boolean(),
					}),
				},
			},
			description:
				"Stripe PaymentIntent created for an end-user wallet top-up. Confirm it client-side with the publishable key.",
		},
	},
});

platformWallet.openapi(createTopUp, async (c) => {
	const session = c.get("endUserSession");
	if (!session) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { amount } = c.req.valid("json");

	// International-card surcharge can only be detected from a saved payment
	// method; the Elements PaymentElement collects the card in-widget, so v1
	// prices without it (matching the hosted checkout-session flow).
	const isInternational = false;
	const feeBreakdown = calculateFees({ amount, isInternational });

	// Markup is baked in by discounting credited spend power: the wallet receives
	// `amount / (1 + markup)` of real USD, and the difference is developer margin.
	const markupFraction = session.markupPercent / 100;
	const netCredited = Math.round((amount / (1 + markupFraction)) * 1e6) / 1e6;
	const developerMargin = Math.round((amount - netCredited) * 1e6) / 1e6;
	const platformFee = feeBreakdown.platformFee + feeBreakdown.internationalFee;

	const stripeCustomerId = await ensureEndCustomerStripeCustomer(
		session.endCustomerId,
		session.mode,
	);

	const paymentIntent = await getStripe(session.mode).paymentIntents.create({
		amount: Math.round(feeBreakdown.totalAmount * 100),
		currency: "usd",
		description: `Credit top-up for wallet ${session.walletId}`,
		customer: stripeCustomerId,
		automatic_payment_methods: { enabled: true },
		metadata: {
			kind: "end_user_topup",
			walletId: session.walletId,
			endCustomerId: session.endCustomerId,
			projectId: session.projectId,
			developerOrgId: session.organizationId,
			organizationId: session.organizationId,
			baseAmount: amount.toString(),
			markupPercent: session.markupPercent.toString(),
			platformFee: platformFee.toString(),
			developerMargin: developerMargin.toString(),
			netCredited: netCredited.toString(),
		},
	});

	logger.info("Created end-user top-up intent", {
		walletId: session.walletId,
		amount,
		netCredited,
		developerMargin,
	});

	return c.json({
		clientSecret: paymentIntent.client_secret ?? "",
		totalAmount: feeBreakdown.totalAmount,
		netCredited,
		isInternational,
	});
});

const getBalance = createRoute({
	method: "get",
	path: "/balance",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						balance: z.string(),
						currency: z.string(),
						recentLedger: z.array(
							z.object({
								id: z.string(),
								type: z.string(),
								amount: z.string(),
								balanceAfter: z.string(),
								createdAt: z.string(),
								description: z.string().nullable(),
							}),
						),
						// Spend limits enforced on this session, with the values consumed
						// so far and the reset time of the windowed limit. `null` limit
						// fields mean that cap is not configured (uncapped).
						limits: z.object({
							usageLimit: z.string().nullable(),
							usage: z.string(),
							periodUsageLimit: z.string().nullable(),
							periodUsageDurationValue: z.number().int().nullable(),
							periodUsageDurationUnit: z
								.enum(apiKeyPeriodDurationUnits)
								.nullable(),
							currentPeriodUsage: z.string(),
							currentPeriodStartedAt: z.string().nullable(),
							currentPeriodResetAt: z.string().nullable(),
						}),
					}),
				},
			},
			description: "Current wallet balance and recent ledger entries.",
		},
	},
});

platformWallet.openapi(getBalance, async (c) => {
	const session = c.get("endUserSession");
	if (!session) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const wallet = await db.query.wallet.findFirst({
		where: { id: { eq: session.walletId } },
	});
	if (!wallet) {
		throw new HTTPException(404, { message: "Wallet not found" });
	}

	// Spend limits live on the session token itself (carried forward across
	// rotations), not on the wallet.
	const sessionRecord = await db.query.endUserSession.findFirst({
		where: { id: { eq: session.sessionId } },
	});
	if (!sessionRecord) {
		throw new HTTPException(401, { message: "Invalid session token" });
	}

	const ledger = await db.query.walletLedger.findMany({
		where: { walletId: { eq: session.walletId } },
		orderBy: { createdAt: "desc" },
		limit: 10,
	});

	const currentPeriod = getApiKeyCurrentPeriodState(sessionRecord);

	return c.json({
		balance: wallet.balance,
		currency: wallet.currency,
		recentLedger: ledger.map((row) => ({
			id: row.id,
			type: row.type,
			amount: row.amount,
			balanceAfter: row.balanceAfter,
			createdAt: row.createdAt.toISOString(),
			description: row.description,
		})),
		limits: {
			usageLimit: sessionRecord.usageLimit,
			usage: sessionRecord.usage,
			periodUsageLimit: sessionRecord.periodUsageLimit,
			periodUsageDurationValue: sessionRecord.periodUsageDurationValue,
			periodUsageDurationUnit: sessionRecord.periodUsageDurationUnit,
			currentPeriodUsage: currentPeriod.usage,
			currentPeriodStartedAt: currentPeriod.startedAt
				? currentPeriod.startedAt.toISOString()
				: null,
			currentPeriodResetAt: currentPeriod.resetAt
				? currentPeriod.resetAt.toISOString()
				: null,
		},
	});
});

export default platformWallet;
