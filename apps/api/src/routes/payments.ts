import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import Stripe from "stripe";
import { z } from "zod";

import { computeReferralBonus } from "@/lib/referral-bonus.js";
import { ensureStripeCustomer } from "@/stripe.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	calculateFees,
	CREDIT_TOP_UP_MAX_AMOUNT,
	CREDIT_TOP_UP_MIN_AMOUNT,
} from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";
import type {
	ClientErrorStatusCode,
	ServerErrorStatusCode,
} from "hono/utils/http-status";

export type StripeMode = "live" | "test";

const _stripe: Partial<Record<StripeMode, Stripe>> = {};

/**
 * Resolve the Stripe client for the given mode. `live` (default) uses
 * `STRIPE_SECRET_KEY`; `test` uses `STRIPE_SECRET_KEY_TEST` (a Stripe sandbox
 * secret on the same account), so LLM SDK developers can exercise the full
 * top-up flow with test cards without a separate staging deployment.
 */
export function getStripe(mode: StripeMode = "live"): Stripe {
	let client = _stripe[mode];
	if (!client) {
		const envVar =
			mode === "test" ? "STRIPE_SECRET_KEY_TEST" : "STRIPE_SECRET_KEY";
		const secret = process.env[envVar];
		if (!secret) {
			throw new Error(
				`${envVar} environment variable is required for Stripe operations`,
			);
		}
		client = new Stripe(secret, {
			apiVersion: "2025-04-30.basil",
		});
		_stripe[mode] = client;
	}
	return client;
}

export const payments = new OpenAPIHono<ServerTypes>();

const creditTopUpAmountSchema = z
	.number()
	.int()
	.min(
		CREDIT_TOP_UP_MIN_AMOUNT,
		`Minimum top-up amount is $${CREDIT_TOP_UP_MIN_AMOUNT}.`,
	)
	.max(CREDIT_TOP_UP_MAX_AMOUNT, "Maximum top-up amount is $5000.");

/**
 * Resolves the organization a payment operation should target.
 *
 * When an `organizationId` is provided (e.g. the user is acting within a
 * non-default organization they switched to in the dashboard), it is looked up
 * scoped to the user's memberships so a user can only ever target an org they
 * belong to. When omitted, it falls back to the user's first organization for
 * backward compatibility.
 */
async function findUserOrganization(userId: string, organizationId?: string) {
	return await db.query.userOrganization.findFirst({
		where: organizationId ? { userId, organizationId } : { userId },
		with: {
			organization: true,
			user: true,
		},
	});
}

export async function isInternationalPaymentMethod(
	stripePaymentMethodId: string,
): Promise<boolean> {
	const stripePaymentMethod = await getStripe().paymentMethods.retrieve(
		stripePaymentMethodId,
	);
	const country = stripePaymentMethod.card?.country;
	return Boolean(country) && country !== "US";
}

const createPaymentIntent = createRoute({
	method: "post",
	path: "/create-payment-intent",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: creditTopUpAmountSchema,
						stripePaymentMethodId: z.string().optional(),
						organizationId: z.string().optional(),
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
						totalAmount: z.number(),
						isInternational: z.boolean(),
					}),
				},
			},
			description: "Payment intent created successfully",
		},
	},
});

payments.openapi(createPaymentIntent, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Require email verification before buying credits
	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message:
				"Email verification required. Please check your inbox or tap 'Resend Email' in the dashboard.",
		});
	}

	const {
		amount,
		stripePaymentMethodId,
		organizationId: requestedOrganizationId,
	} = c.req.valid("json");

	const userOrganization = await findUserOrganization(
		user.id,
		requestedOrganizationId,
	);

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const stripeCustomerId = await ensureStripeCustomer(organizationId);

	let isInternational = false;
	if (stripePaymentMethodId) {
		const stripePaymentMethod = await getStripe().paymentMethods.retrieve(
			stripePaymentMethodId,
		);

		const paymentMethodCustomer =
			typeof stripePaymentMethod.customer === "string"
				? stripePaymentMethod.customer
				: (stripePaymentMethod.customer?.id ?? null);

		// Freshly created PMs are unattached (customer === null) until the
		// setup_intent.succeeded webhook attaches them. Reject only when the
		// PM is attached to a *different* customer.
		if (paymentMethodCustomer && paymentMethodCustomer !== stripeCustomerId) {
			throw new HTTPException(403, {
				message: "Payment method does not belong to this customer",
			});
		}

		const country = stripePaymentMethod.card?.country;
		isInternational = Boolean(country) && country !== "US";
	}

	const feeBreakdown = calculateFees({
		amount,
		isInternational,
	});

	const paymentIntent = await getStripe().paymentIntents.create({
		amount: Math.round(feeBreakdown.totalAmount * 100),
		currency: "usd",
		description: `Credit purchase for ${amount} USD (including fees)`,
		customer: stripeCustomerId,
		...(stripePaymentMethodId ? { payment_method: stripePaymentMethodId } : {}),
		metadata: {
			organizationId,
			baseAmount: amount.toString(),
			platformFee: feeBreakdown.platformFee.toString(),
			internationalFee: feeBreakdown.internationalFee.toString(),
			isInternational: isInternational.toString(),
			userEmail: user.email,
			userId: user.id,
		},
	});

	return c.json({
		clientSecret: paymentIntent.client_secret ?? "",
		totalAmount: feeBreakdown.totalAmount,
		isInternational,
	});
});

const createSetupIntent = createRoute({
	method: "post",
	path: "/create-setup-intent",
	request: {
		body: {
			required: false,
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().optional(),
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
					}),
				},
			},
			description: "Setup intent created successfully",
		},
	},
});

payments.openapi(createSetupIntent, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Require email verification before adding a card
	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message:
				"Email verification required. Please check your inbox or tap 'Resend Email' in the dashboard.",
		});
	}

	const { organizationId: requestedOrganizationId } = c.req.valid("json") ?? {};

	const userOrganization = await findUserOrganization(
		user.id,
		requestedOrganizationId,
	);

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const stripeCustomerId = await ensureStripeCustomer(organizationId);

	// The customer must be set here so Stripe attaches the payment method
	// atomically when the client confirms the setup. Without it the PM comes
	// out of confirmCardSetup "used but unattached", and create-payment-intent
	// races the setup_intent.succeeded webhook's attach — losing the race
	// makes Stripe reject the PaymentIntent outright.
	const setupIntent = await getStripe().setupIntents.create({
		customer: stripeCustomerId,
		usage: "off_session",
		metadata: {
			organizationId,
		},
	});

	return c.json({
		clientSecret: setupIntent.client_secret ?? "",
	});
});

const getPaymentMethods = createRoute({
	method: "get",
	path: "/payment-methods",
	request: {
		query: z.object({
			organizationId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						paymentMethods: z.array(
							z.object({
								id: z.string(),
								stripePaymentMethodId: z.string(),
								type: z.string(),
								isDefault: z.boolean(),
								cardBrand: z.string().optional(),
								cardLast4: z.string().optional(),
								expiryMonth: z.number().optional(),
								expiryYear: z.number().optional(),
							}),
						),
					}),
				},
			},
			description: "Payment methods retrieved successfully",
		},
	},
});

payments.openapi(getPaymentMethods, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId: requestedOrganizationId } = c.req.valid("query");

	const userOrganization = await findUserOrganization(
		user.id,
		requestedOrganizationId,
	);

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const paymentMethods = await db.query.paymentMethod.findMany({
		where: {
			organizationId,
		},
	});

	const enhancedPaymentMethods = await Promise.all(
		paymentMethods.map(async (pm) => {
			const stripePaymentMethod = await getStripe().paymentMethods.retrieve(
				pm.stripePaymentMethodId,
			);

			let cardDetails = {};
			if (stripePaymentMethod.type === "card" && stripePaymentMethod.card) {
				cardDetails = {
					cardBrand: stripePaymentMethod.card.brand,
					cardLast4: stripePaymentMethod.card.last4,
					expiryMonth: stripePaymentMethod.card.exp_month,
					expiryYear: stripePaymentMethod.card.exp_year,
				};
			}

			return {
				...pm,
				...cardDetails,
			};
		}),
	);

	return c.json({
		paymentMethods: enhancedPaymentMethods,
	});
});

const setDefaultPaymentMethod = createRoute({
	method: "post",
	path: "/payment-methods/default",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						paymentMethodId: z.string(),
						organizationId: z.string().optional(),
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
						success: z.boolean(),
					}),
				},
			},
			description: "Default payment method set successfully",
		},
	},
});

payments.openapi(setDefaultPaymentMethod, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { paymentMethodId, organizationId: requestedOrganizationId } =
		c.req.valid("json");

	const userOrganization = await findUserOrganization(
		user.id,
		requestedOrganizationId,
	);

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const paymentMethod = await db.query.paymentMethod.findFirst({
		where: {
			id: paymentMethodId,
			organizationId,
		},
	});

	if (!paymentMethod) {
		throw new HTTPException(404, {
			message: "Payment method not found",
		});
	}

	await db
		.update(tables.paymentMethod)
		.set({
			isDefault: false,
		})
		.where(eq(tables.paymentMethod.organizationId, organizationId));

	await db
		.update(tables.paymentMethod)
		.set({
			isDefault: true,
		})
		.where(eq(tables.paymentMethod.id, paymentMethodId));

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "payment.method.set_default",
		resourceType: "payment_method",
		resourceId: paymentMethodId,
	});

	return c.json({
		success: true,
	});
});

const deletePaymentMethod = createRoute({
	method: "delete",
	path: "/payment-methods/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
		query: z.object({
			organizationId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
			description: "Payment method deleted successfully",
		},
	},
});

payments.openapi(deletePaymentMethod, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.valid("param");
	const { organizationId: requestedOrganizationId } = c.req.valid("query");

	const userOrganization = await findUserOrganization(
		user.id,
		requestedOrganizationId,
	);

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const paymentMethod = await db.query.paymentMethod.findFirst({
		where: {
			id,
			organizationId,
		},
	});

	if (!paymentMethod) {
		throw new HTTPException(404, {
			message: "Payment method not found",
		});
	}

	if (paymentMethod.isDefault) {
		const otherMethods = await db.query.paymentMethod.findMany({
			where: { organizationId },
		});
		if (otherMethods.length > 1) {
			throw new HTTPException(400, {
				message:
					"Cannot delete the default payment method. Please set another payment method as default first.",
			});
		}
	}

	// Get card details before deleting for audit log
	let cardLast4: string | undefined;
	try {
		const stripePaymentMethod = await getStripe().paymentMethods.retrieve(
			paymentMethod.stripePaymentMethodId,
		);
		cardLast4 = stripePaymentMethod.card?.last4;
	} catch {}

	await getStripe().paymentMethods.detach(paymentMethod.stripePaymentMethodId);

	await db.delete(tables.paymentMethod).where(eq(tables.paymentMethod.id, id));

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "payment.method.delete",
		resourceType: "payment_method",
		resourceId: id,
		metadata: {
			cardLast4,
		},
	});

	return c.json({
		success: true,
	});
});

const topUpWithSavedMethod = createRoute({
	method: "post",
	path: "/top-up-with-saved-method",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: creditTopUpAmountSchema,
						paymentMethodId: z.string(),
						organizationId: z.string().optional(),
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
						success: z.boolean(),
					}),
				},
			},
			description: "Payment processed successfully",
		},
	},
});

payments.openapi(topUpWithSavedMethod, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Require email verification before buying credits
	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message:
				"Email verification required. Please check your inbox or tap 'Resend Email' in the dashboard.",
		});
	}

	const {
		amount,
		paymentMethodId,
		organizationId: requestedOrganizationId,
	}: {
		amount: number;
		paymentMethodId: string;
		organizationId?: string;
	} = c.req.valid("json");

	const paymentMethod = await db.query.paymentMethod.findFirst({
		where: {
			id: paymentMethodId,
		},
	});

	if (!paymentMethod) {
		throw new HTTPException(404, {
			message: "Payment method not found",
		});
	}

	const userOrganization = await findUserOrganization(
		user.id,
		requestedOrganizationId,
	);

	if (
		!userOrganization ||
		!userOrganization.organization ||
		userOrganization.organization.id !== paymentMethod.organizationId
	) {
		throw new HTTPException(403, {
			message: "Unauthorized access to payment method",
		});
	}

	const stripeCustomerId = userOrganization.organization.stripeCustomerId;

	if (!stripeCustomerId) {
		throw new HTTPException(400, {
			message: "No Stripe customer ID found for this organization",
		});
	}

	const isInternational = await isInternationalPaymentMethod(
		paymentMethod.stripePaymentMethodId,
	);

	const feeBreakdown = calculateFees({
		amount,
		isInternational,
	});

	let paymentIntent: Stripe.PaymentIntent;

	try {
		paymentIntent = await getStripe().paymentIntents.create({
			amount: Math.round(feeBreakdown.totalAmount * 100),
			currency: "usd",
			description: `Credit purchase for ${amount} USD (including fees)`,
			payment_method: paymentMethod.stripePaymentMethodId,
			customer: stripeCustomerId,
			confirm: true,
			off_session: true,
			metadata: {
				organizationId: userOrganization.organization.id,
				baseAmount: amount.toString(),
				platformFee: feeBreakdown.platformFee.toString(),
				internationalFee: feeBreakdown.internationalFee.toString(),
				isInternational: isInternational.toString(),
				userEmail: user.email,
				userId: user.id,
			},
		});
	} catch (err) {
		if (err instanceof Stripe.errors.StripeCardError) {
			const declineCode = err.decline_code;
			const stripeMessage = err.message;
			let userMessage = stripeMessage;

			if (declineCode === "do_not_honor" || declineCode === "generic_decline") {
				userMessage =
					"Your bank declined the payment. Please contact your card issuer or try a different payment method.";
			} else if (declineCode === "insufficient_funds") {
				userMessage =
					"Your card has insufficient funds. Please try a different payment method.";
			} else if (declineCode === "expired_card") {
				userMessage =
					"Your card has expired. Please update your payment method.";
			} else if (declineCode === "lost_card" || declineCode === "stolen_card") {
				userMessage =
					"This card cannot be used. Please use a different payment method.";
			} else if (declineCode === "incorrect_cvc") {
				userMessage =
					"The security code is incorrect. Please check your card details and try again.";
			}

			throw new HTTPException(402, {
				message: userMessage,
			});
		}

		if (err instanceof Stripe.errors.StripeError) {
			logger.error("Stripe error on credit top-up", err, {
				organizationId: userOrganization.organization.id,
				userId: user.id,
				paymentMethodId,
				amount,
				stripeType: err.type,
				stripeCode: err.code,
				stripeStatusCode: err.statusCode,
				stripeRequestId: err.requestId,
			});

			throw new HTTPException(
				(err.statusCode ?? 400) as
					| ClientErrorStatusCode
					| ServerErrorStatusCode,
				{
					message: err.message,
				},
			);
		}

		throw err;
	}

	if (paymentIntent.status !== "succeeded") {
		throw new HTTPException(400, {
			message: `Payment failed: ${paymentIntent.status}`,
		});
	}

	await logAuditEvent({
		organizationId: userOrganization.organization.id,
		userId: user.id,
		action: "payment.credit_topup",
		resourceType: "payment",
		resourceId: paymentIntent.id,
		metadata: {
			amount,
			paymentMethodId,
		},
	});

	return c.json({
		success: true,
	});
});
const createCheckoutSession = createRoute({
	method: "post",
	path: "/create-checkout-session",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: creditTopUpAmountSchema,
						returnUrl: z.string().url().optional(),
						organizationId: z.string().optional(),
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
						checkoutUrl: z.string(),
					}),
				},
			},
			description: "Stripe Checkout session created successfully",
		},
	},
});

payments.openapi(createCheckoutSession, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message:
				"Email verification required. Please check your inbox or tap 'Resend Email' in the dashboard.",
		});
	}

	const {
		amount,
		returnUrl,
		organizationId: requestedOrganizationId,
	} = c.req.valid("json");

	const userOrganization = await findUserOrganization(
		user.id,
		requestedOrganizationId,
	);

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;
	const stripeCustomerId = await ensureStripeCustomer(organizationId);

	const feeBreakdown = calculateFees({ amount });

	const allowedOrigins = [
		process.env.UI_URL,
		process.env.PLAYGROUND_URL,
		process.env.CODE_URL,
	].filter(Boolean);

	const defaultBillingUrl = `${process.env.UI_URL ?? "http://localhost:3002"}/dashboard/${organizationId}/org/billing`;

	const isAllowedReturn = (() => {
		if (!returnUrl) {
			return false;
		}
		try {
			const parsed = new URL(returnUrl);
			return allowedOrigins.some(
				(origin) => origin && parsed.origin === new URL(origin).origin,
			);
		} catch {
			return false;
		}
	})();

	const successUrl = `${defaultBillingUrl}?success=true`;
	let cancelUrl: string;
	if (isAllowedReturn && returnUrl) {
		const separator = returnUrl.includes("?") ? "&" : "?";
		cancelUrl = `${returnUrl}${separator}canceled=true`;
	} else {
		cancelUrl = `${defaultBillingUrl}?canceled=true`;
	}

	// IMPORTANT: Metadata is intentionally set on the session only, NOT via
	// payment_intent_data.metadata. This prevents handlePaymentIntentSucceeded
	// from also processing this payment (it returns early when baseAmount is
	// missing from the PaymentIntent metadata). Adding payment_intent_data.metadata
	// here would cause double-crediting. See handleCreditTopUpCheckout in stripe.ts.
	const session = await getStripe().checkout.sessions.create({
		customer: stripeCustomerId,
		mode: "payment",
		line_items: [
			{
				price_data: {
					currency: "usd",
					product_data: {
						name: `Credit Top-Up ($${amount})`,
						description: `$${amount} in credits for your LLMGateway account`,
					},
					unit_amount: Math.round(feeBreakdown.totalAmount * 100),
				},
				quantity: 1,
			},
		],
		success_url: successUrl,
		cancel_url: cancelUrl,
		metadata: {
			organizationId,
			type: "credit_topup",
			baseAmount: amount.toString(),
			platformFee: feeBreakdown.platformFee.toString(),
			userEmail: user.email,
			userId: user.id,
		},
	});

	if (!session.url) {
		throw new HTTPException(500, {
			message: "Failed to generate checkout URL",
		});
	}

	return c.json({
		checkoutUrl: session.url,
	});
});

const calculateFeesRoute = createRoute({
	method: "post",
	path: "/calculate-fees",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: creditTopUpAmountSchema,
						paymentMethodId: z.string().optional(),
						organizationId: z.string().optional(),
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
						baseAmount: z.number(),
						platformFee: z.number(),
						internationalFee: z.number(),
						totalAmount: z.number(),
						isInternational: z.boolean(),
						bonusAmount: z.number().optional(),
						finalCreditAmount: z.number().optional(),
						bonusEnabled: z.boolean(),
						bonusEligible: z.boolean(),
						bonusIneligibilityReason: z.string().optional(),
						bonusType: z.enum(["first_purchase", "referral"]).optional(),
					}),
				},
			},
			description: "Fee calculation completed successfully",
		},
	},
});

payments.openapi(calculateFeesRoute, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const {
		amount,
		paymentMethodId,
		organizationId: requestedOrganizationId,
	}: {
		amount: number;
		paymentMethodId?: string;
		organizationId?: string;
	} = c.req.valid("json");

	const userOrganization = await findUserOrganization(
		user.id,
		requestedOrganizationId,
	);

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	let isInternational = false;
	if (paymentMethodId) {
		const paymentMethod = await db.query.paymentMethod.findFirst({
			where: {
				id: paymentMethodId,
				organizationId: userOrganization.organization.id,
			},
		});

		if (paymentMethod) {
			isInternational = await isInternationalPaymentMethod(
				paymentMethod.stripePaymentMethodId,
			);
		}
	}

	const feeBreakdown = calculateFees({
		amount,
		isInternational,
	});

	// Calculate bonus for first-time credit purchases
	let bonusAmount = 0;
	let finalCreditAmount = amount;
	let bonusEligible = false;
	let bonusIneligibilityReason: string | undefined;
	let bonusType: "first_purchase" | "referral" | undefined;

	const firstBonusMultiplier = process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER
		? parseFloat(process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER)
		: 0;

	const firstBonusEnabled = firstBonusMultiplier > 1;

	// Referral signup bonus applies to the referred org's first top-up and takes
	// precedence over the env-driven first-time bonus. Mirrors stripe.ts so the
	// estimate matches the credits actually granted by the webhook.
	const referralBonusAmount = await computeReferralBonus(
		userOrganization.organization.id,
		amount,
	);
	const referralBonusPossible = referralBonusAmount > 0;

	const bonusEnabled = firstBonusEnabled || referralBonusPossible;

	if (bonusEnabled) {
		if (!userOrganization.user || !userOrganization.user.emailVerified) {
			bonusIneligibilityReason = "email_not_verified";
		} else {
			const previousPurchases = await db.query.transaction.findMany({
				where: {
					organizationId: { eq: userOrganization.organization.id },
					type: { eq: "credit_topup" },
					status: { eq: "completed" },
				},
				orderBy: { createdAt: "asc" },
				limit: 1,
			});

			if (previousPurchases.length === 0 && referralBonusPossible) {
				bonusEligible = true;
				bonusType = "referral";
				bonusAmount = referralBonusAmount;
				finalCreditAmount = amount + bonusAmount;
			} else if (previousPurchases.length === 0 && firstBonusEnabled) {
				bonusEligible = true;
				bonusType = "first_purchase";
				const potentialBonus = amount * (firstBonusMultiplier - 1);
				const maxBonus = 50;
				bonusAmount = Math.min(potentialBonus, maxBonus);
				finalCreditAmount = amount + bonusAmount;
			} else if (previousPurchases.length > 0) {
				bonusIneligibilityReason = "already_purchased";
			}
		}
	}

	return c.json({
		...feeBreakdown,
		isInternational,
		bonusAmount: bonusAmount > 0 ? bonusAmount : undefined,
		finalCreditAmount: bonusAmount > 0 ? finalCreditAmount : undefined,
		bonusEnabled,
		bonusEligible,
		bonusIneligibilityReason,
		bonusType,
	});
});
