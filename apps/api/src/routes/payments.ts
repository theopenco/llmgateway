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

	const paymentIntent = await getStripe().paymentIntents.create({
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
