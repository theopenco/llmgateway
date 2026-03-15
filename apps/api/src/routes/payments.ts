import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import Stripe from "stripe";
import { z } from "zod";

import { ensureStripeCustomer } from "@/stripe.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";
import { calculateFees } from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
	if (!_stripe) {
		if (!process.env.STRIPE_SECRET_KEY) {
			throw new Error(
				"STRIPE_SECRET_KEY environment variable is required for Stripe operations",
			);
		}
		_stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
			apiVersion: "2025-04-30.basil",
		});
	}
	return _stripe;
}

export const payments = new OpenAPIHono<ServerTypes>();

const createPaymentIntent = createRoute({
	method: "post",
	path: "/create-payment-intent",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: z.number().int().min(5),
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

	const { amount } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const stripeCustomerId = await ensureStripeCustomer(organizationId);

	const feeBreakdown = calculateFees({
		amount,
	});

	const paymentIntent = await getStripe().paymentIntents.create({
		amount: Math.round(feeBreakdown.totalAmount * 100),
		currency: "usd",
		description: `Credit purchase for ${amount} USD (including fees)`,
		customer: stripeCustomerId,
		metadata: {
			organizationId,
			baseAmount: amount.toString(),
			platformFee: feeBreakdown.platformFee.toString(),
			userEmail: user.email,
			userId: user.id,
		},
	});

	return c.json({
		clientSecret: paymentIntent.client_secret ?? "",
	});
});

const createSetupIntent = createRoute({
	method: "post",
	path: "/create-setup-intent",
	request: {},
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

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const organizationId = userOrganization.organization.id;

	const setupIntent = await getStripe().setupIntents.create({
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
	request: {},
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

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

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

	const { paymentMethodId } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

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

	const { id } = c.req.param();

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

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
						amount: z.number().int().min(5),
						paymentMethodId: z.string(),
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
	}: { amount: number; paymentMethodId: string } = c.req.valid("json");

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

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

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

	const feeBreakdown = calculateFees({
		amount,
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
						amount: z.number().int().min(5),
						returnUrl: z.string().url().optional(),
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

	const { amount, returnUrl } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

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

	let successUrl: string;
	let cancelUrl: string;

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

	if (isAllowedReturn && returnUrl) {
		const separator = returnUrl.includes("?") ? "&" : "?";
		successUrl = `${returnUrl}${separator}success=true`;
		cancelUrl = `${returnUrl}${separator}canceled=true`;
	} else {
		successUrl = `${defaultBillingUrl}?success=true`;
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
						amount: z.number().int().min(5),
						paymentMethodId: z.string().optional(),
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
						totalAmount: z.number(),
						bonusAmount: z.number().optional(),
						finalCreditAmount: z.number().optional(),
						bonusEnabled: z.boolean(),
						bonusEligible: z.boolean(),
						bonusIneligibilityReason: z.string().optional(),
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

	const { amount }: { amount: number } = c.req.valid("json");

	const userOrganization = await db.query.userOrganization.findFirst({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
			user: true,
		},
	});

	if (!userOrganization || !userOrganization.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const feeBreakdown = calculateFees({
		amount,
	});

	// Calculate bonus for first-time credit purchases
	let bonusAmount = 0;
	let finalCreditAmount = amount;
	let bonusEnabled = false;
	let bonusEligible = false;
	let bonusIneligibilityReason: string | undefined;

	const bonusMultiplier = process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER
		? parseFloat(process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER)
		: 0;

	bonusEnabled = bonusMultiplier > 1;

	if (bonusEnabled) {
		// Check email verification
		if (!userOrganization.user || !userOrganization.user.emailVerified) {
			bonusIneligibilityReason = "email_not_verified";
		} else {
			// Check if this is the first credit purchase
			const previousPurchases = await db.query.transaction.findFirst({
				where: {
					organizationId: { eq: userOrganization.organization.id },
					type: { eq: "credit_topup" },
					status: { eq: "completed" },
				},
			});

			if (previousPurchases) {
				bonusIneligibilityReason = "already_purchased";
			} else {
				// This is the first credit purchase, apply bonus
				bonusEligible = true;
				const potentialBonus = amount * (bonusMultiplier - 1);
				const maxBonus = 50; // Max $50 bonus

				bonusAmount = Math.min(potentialBonus, maxBonus);
				finalCreditAmount = amount + bonusAmount;
			}
		}
	}

	return c.json({
		...feeBreakdown,
		bonusAmount: bonusAmount > 0 ? bonusAmount : undefined,
		finalCreditAmount: bonusAmount > 0 ? finalCreditAmount : undefined,
		bonusEnabled,
		bonusEligible,
		bonusIneligibilityReason,
	});
});
