import { OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { endUserSessionAuth } from "@/lib/end-user-session-auth.js";
import { getStripe } from "@/routes/payments.js";
import { ensureEndCustomerStripeCustomer } from "@/stripe.js";
import { createRoute } from "@/utils/create-route.js";

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
					schema: z.object({
						amount: topUpAmountSchema,
						paymentMethodId: z.string().startsWith("pm_"),
					}),
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
						paymentIntentId: z.string(),
						platformFee: z.number(),
						internationalFee: z.number(),
						totalAmount: z.number(),
						netCredited: z.number(),
						bonusCredited: z.number(),
						isInternational: z.boolean(),
					}),
				},
			},
			description:
				"Card-priced wallet top-up quote. Review the fees, then call confirm-top-up.",
		},
	},
});

platformWallet.openapi(createTopUp, async (c) => {
	const session = c.get("endUserSession");
	if (!session) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { amount, paymentMethodId } = c.req.valid("json");
	const stripe = getStripe(session.mode);
	const method = await stripe.paymentMethods.retrieve(paymentMethodId);
	if (method.type !== "card" || !method.card?.country) {
		throw new HTTPException(400, {
			message: "A card with a known issuing country is required",
		});
	}
	const stripeCustomerId = await ensureEndCustomerStripeCustomer(
		session.endCustomerId,
		session.mode,
	);
	const methodCustomerId =
		typeof method.customer === "string" ? method.customer : method.customer?.id;
	if (methodCustomerId && methodCustomerId !== stripeCustomerId) {
		throw new HTTPException(400, {
			message: "Payment method belongs to another customer",
		});
	}
	const isInternational = method.card.country !== "US";
	const feeBreakdown = calculateFees({ amount, isInternational });
	const netCredited = new Decimal(amount)
		.div(new Decimal(session.markupPercent).div(100).plus(1))
		.toDecimalPlaces(6)
		.toNumber();
	const developerMargin = new Decimal(amount)
		.minus(netCredited)
		.toDecimalPlaces(6)
		.toNumber();
	const platformFee = new Decimal(feeBreakdown.platformFee)
		.plus(feeBreakdown.internationalFee)
		.toString();
	const bonusCredited =
		session.mode === "test"
			? 0
			: new Decimal(netCredited)
					.mul(session.bonusPercent)
					.div(100)
					.toDecimalPlaces(6)
					.toNumber();
	const paymentIntent = await stripe.paymentIntents.create({
		amount: new Decimal(feeBreakdown.totalAmount).mul(100).toNumber(),
		currency: "usd",
		description: `${session.brandName} — credit top-up (wallet ${session.walletId})`,
		customer: stripeCustomerId,
		payment_method: paymentMethodId,
		payment_method_types: ["card"],
		// Only the server may confirm: clients must not swap in a differently priced card.
		confirmation_method: "manual",
		...(session.statementDescriptorSuffix
			? { statement_descriptor_suffix: session.statementDescriptorSuffix }
			: {}),
		metadata: {
			kind: "end_user_topup",
			paymentMethodId,
			walletId: session.walletId,
			endCustomerId: session.endCustomerId,
			projectId: session.projectId,
			developerOrgId: session.organizationId,
			organizationId: session.organizationId,
			baseAmount: amount.toString(),
			markupPercent: session.markupPercent.toString(),
			// The ledger's platformFee includes both fees; retain the surcharge separately too.
			platformFee,
			internationalFee: feeBreakdown.internationalFee.toString(),
			isInternational: String(isInternational),
			developerMargin: developerMargin.toString(),
			netCredited: netCredited.toString(),
			bonusPercent: session.bonusPercent.toString(),
			bonusCredited: bonusCredited.toString(),
		},
	});
	logger.info("Created end-user top-up intent", {
		walletId: session.walletId,
		amount,
		netCredited,
		developerMargin,
		bonusCredited,
	});
	return c.json({
		clientSecret: paymentIntent.client_secret ?? "",
		paymentIntentId: paymentIntent.id,
		totalAmount: feeBreakdown.totalAmount,
		platformFee: feeBreakdown.platformFee,
		internationalFee: feeBreakdown.internationalFee,
		netCredited,
		bonusCredited,
		isInternational,
	});
});

const confirmTopUp = createRoute({
	method: "post",
	path: "/confirm-top-up",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ paymentIntentId: z.string().startsWith("pi_") }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ clientSecret: z.string(), status: z.string() }),
				},
			},
			description:
				"Confirm the quoted card payment; handle requires_action with Stripe.js, then confirm again.",
		},
	},
});

platformWallet.openapi(confirmTopUp, async (c) => {
	const session = c.get("endUserSession");
	if (!session) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { paymentIntentId } = c.req.valid("json");
	const stripe = getStripe(session.mode);
	let intent = await stripe.paymentIntents.retrieve(paymentIntentId);
	if (
		intent.metadata.kind !== "end_user_topup" ||
		intent.metadata.walletId !== session.walletId ||
		intent.confirmation_method !== "manual" ||
		!intent.metadata.paymentMethodId
	) {
		throw new HTTPException(404, { message: "Top-up not found" });
	}
	if (intent.status === "requires_confirmation") {
		intent = await stripe.paymentIntents.confirm(paymentIntentId, {
			use_stripe_sdk: true,
			payment_method: intent.metadata.paymentMethodId,
		});
	}
	return c.json({
		clientSecret: intent.client_secret ?? "",
		status: intent.status,
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
