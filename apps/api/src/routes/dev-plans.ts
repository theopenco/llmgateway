import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { ensureStripeCustomer, finalizeDevPlanSetupSession } from "@/stripe.js";
import { findDefaultOrganization } from "@/utils/default-org.js";
import { resolveDevPassBillingDetails } from "@/utils/devpass-billing.js";
import { generateAndEmailInvoice } from "@/utils/invoice.js";
import { getOrCreatePersonalOrg } from "@/utils/personal-org.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	cdb,
	db,
	tables,
	eq,
	sql,
	and,
	or,
	lt,
	isNull,
	shortid,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	DEV_PLAN_PRICES,
	getProratedCreditDelta,
	type DevPlanCycle,
	type DevPlanTier,
} from "@llmgateway/shared";

import { getStripe } from "./payments.js";

import type { ServerTypes } from "@/vars.js";
import type Stripe from "stripe";

export const devPlans = new OpenAPIHono<ServerTypes>();

// Helper to get or create API key for personal org
async function getOrCreatePersonalOrgApiKey(
	orgId: string,
	projectId: string,
	userId: string,
): Promise<string> {
	// Check for existing API key
	const existingKey = await db.query.apiKey.findFirst({
		where: {
			projectId: {
				eq: projectId,
			},
			status: {
				ne: "deleted",
			},
		},
	});

	if (existingKey) {
		return existingKey.token;
	}

	// Create new API key
	const prefix =
		process.env.NODE_ENV === "development" ? `llmgdev_` : "llmgtwy_";
	const token = prefix + shortid(40);

	await db.insert(tables.apiKey).values({
		token,
		projectId,
		description: "Dev Plan API Key",
		createdBy: userId,
	});

	return token;
}

// Find the user's personal org without creating one. Used by the billing
// payment-method routes, which only apply to users that already have a DevPass.
async function findPersonalOrg(userId: string) {
	const userOrgs = await db.query.userOrganization.findMany({
		where: { userId },
		with: { organization: true },
	});
	return (
		userOrgs.find((uo) => uo.organization?.kind === "devpass")?.organization ??
		null
	);
}

function getDevPlanPriceId(
	tier: DevPlanTier,
	cycle: DevPlanCycle = "monthly",
): string | undefined {
	const monthlyKeys: Record<DevPlanTier, string> = {
		lite: "STRIPE_DEV_PLAN_LITE_PRICE_ID",
		pro: "STRIPE_DEV_PLAN_PRO_PRICE_ID",
		max: "STRIPE_DEV_PLAN_MAX_PRICE_ID",
	};
	const annualKeys: Record<DevPlanTier, string> = {
		lite: "STRIPE_DEV_PLAN_LITE_ANNUAL_PRICE_ID",
		pro: "STRIPE_DEV_PLAN_PRO_ANNUAL_PRICE_ID",
		max: "STRIPE_DEV_PLAN_MAX_ANNUAL_PRICE_ID",
	};
	const key = cycle === "annual" ? annualKeys[tier] : monthlyKeys[tier];
	return process.env[key];
}

function getStripeId(value: string | { id?: string } | null | undefined) {
	if (!value) {
		return null;
	}
	if (typeof value === "string") {
		return value;
	}
	return value.id ?? null;
}

function getInvoicePaymentIntentId(invoice: Stripe.Invoice) {
	const invoiceWithPaymentIntent = invoice as Stripe.Invoice & {
		payment_intent?: string | { id?: string } | null;
	};
	return getStripeId(invoiceWithPaymentIntent.payment_intent);
}

function getRemainingBillingPeriodFraction(
	subscriptionItem: Stripe.SubscriptionItem,
) {
	const nowSeconds = Date.now() / 1000;
	const periodStart = subscriptionItem.current_period_start;
	const periodEnd = subscriptionItem.current_period_end;
	const periodSeconds = periodEnd - periodStart;

	if (periodSeconds <= 0) {
		return 0;
	}

	return Math.min(1, Math.max(0, (periodEnd - nowSeconds) / periodSeconds));
}

function getDevPlanUpgradeAmountCents(
	currentTier: DevPlanTier,
	newTier: DevPlanTier,
	remainingFraction: number,
) {
	const fullDeltaCents =
		(DEV_PLAN_PRICES[newTier] - DEV_PLAN_PRICES[currentTier]) * 100;
	return Math.max(0, Math.round(fullDeltaCents * remainingFraction));
}

function getDevPlanTierChangeCreditPreview(
	currentTier: DevPlanTier,
	newTier: DevPlanTier,
	remainingFraction: number,
	currentCreditsLimit: number,
) {
	const isUpgrade = DEV_PLAN_PRICES[newTier] > DEV_PLAN_PRICES[currentTier];
	const proratedCreditDelta = isUpgrade
		? getProratedCreditDelta(currentTier, newTier, remainingFraction)
		: 0;

	return {
		currentCreditsLimit,
		proratedCreditDelta,
		newCreditsLimit: currentCreditsLimit + proratedCreditDelta,
	};
}

async function cleanupFailedUpgradeInvoice(params: {
	invoiceId: string | null;
	invoiceItemId: string | null;
	finalized: boolean;
}) {
	const stripe = getStripe();
	try {
		if (params.invoiceId) {
			if (params.finalized) {
				await stripe.invoices.voidInvoice(params.invoiceId);
			} else {
				await stripe.invoices.del(params.invoiceId);
			}
			return;
		}

		if (params.invoiceItemId) {
			await stripe.invoiceItems.del(params.invoiceItemId);
		}
	} catch (cleanupError) {
		logger.warn("Failed to clean up failed dev plan upgrade invoice", {
			error:
				cleanupError instanceof Error
					? cleanupError.message
					: String(cleanupError),
			invoiceId: params.invoiceId,
			invoiceItemId: params.invoiceItemId,
		});
	}
}

async function collectDevPlanUpgradeCharge(params: {
	subscription: Stripe.Subscription;
	organizationId: string;
	currentTier: DevPlanTier;
	newTier: DevPlanTier;
	remainingFraction: number;
}) {
	const stripe = getStripe();
	const customerId = getStripeId(params.subscription.customer);

	if (!customerId) {
		throw new HTTPException(500, {
			message: "Subscription customer not found",
		});
	}

	const amountCents = getDevPlanUpgradeAmountCents(
		params.currentTier,
		params.newTier,
		params.remainingFraction,
	);

	if (amountCents <= 0) {
		return null;
	}

	const metadata = {
		organizationId: params.organizationId,
		subscriptionType: "dev_plan",
		devPlanChange: "upgrade",
		fromTier: params.currentTier,
		toTier: params.newTier,
		remainingFraction: params.remainingFraction.toString(),
	};

	let invoiceItemId: string | null = null;
	let invoiceId: string | null = null;
	let finalized = false;

	try {
		const invoiceItem = await stripe.invoiceItems.create({
			customer: customerId,
			subscription: params.subscription.id,
			amount: amountCents,
			currency: "usd",
			description: `Dev Plan upgrade from ${params.currentTier.toUpperCase()} to ${params.newTier.toUpperCase()}`,
			metadata,
		});
		invoiceItemId = invoiceItem.id ?? null;

		const invoice = await stripe.invoices.create({
			customer: customerId,
			subscription: params.subscription.id,
			collection_method: "charge_automatically",
			auto_advance: false,
			metadata,
			expand: ["payment_intent"],
		});
		if (!invoice.id) {
			throw new HTTPException(500, {
				message: "Upgrade invoice was not created",
			});
		}
		invoiceId = invoice.id;

		const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id, {
			auto_advance: false,
			expand: ["payment_intent"],
		});
		if (!finalizedInvoice.id) {
			throw new HTTPException(500, {
				message: "Upgrade invoice was not finalized",
			});
		}
		finalized = true;

		const paidInvoice = await stripe.invoices.pay(finalizedInvoice.id, {
			off_session: true,
			expand: ["payment_intent"],
		});

		if (paidInvoice.status !== "paid") {
			throw new HTTPException(402, {
				message:
					"Upgrade payment could not be collected. Update your payment method and try again.",
			});
		}

		return {
			amount: amountCents / 100,
			invoiceId: paidInvoice.id ?? invoiceId,
			paymentIntentId: getInvoicePaymentIntentId(paidInvoice),
		};
	} catch (error) {
		await cleanupFailedUpgradeInvoice({
			invoiceId,
			invoiceItemId,
			finalized,
		});

		if (error instanceof HTTPException) {
			throw error;
		}

		throw new HTTPException(402, {
			message:
				"Upgrade payment could not be collected. Update your payment method and try again.",
		});
	}
}

// Get or create personal organization for user
const getPersonalOrg = createRoute({
	method: "get",
	path: "/personal-org",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						id: z.string(),
						name: z.string(),
						kind: z.enum(["default", "chat", "devpass"]),
						devPlan: z.enum(["none", "lite", "pro", "max"]),
						devPlanCreditsUsed: z.string(),
						devPlanCreditsLimit: z.string(),
						devPlanBillingCycleStart: z.string().nullable(),
						devPlanCancelled: z.boolean(),
						devPlanExpiresAt: z.string().nullable(),
						credits: z.string(),
					}),
				},
			},
			description: "Personal organization retrieved or created",
		},
	},
});

devPlans.openapi(getPersonalOrg, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const org = await getOrCreatePersonalOrg(user);

	return c.json({
		id: org.id,
		name: org.name,
		kind: org.kind,
		devPlan: org.devPlan,
		devPlanCreditsUsed: org.devPlanCreditsUsed,
		devPlanCreditsLimit: org.devPlanCreditsLimit,
		devPlanBillingCycleStart:
			org.devPlanBillingCycleStart?.toISOString() ?? null,
		devPlanCancelled: org.devPlanCancelled,
		devPlanExpiresAt: org.devPlanExpiresAt?.toISOString() ?? null,
		credits: org.credits,
	});
});

// Subscribe to a dev plan
const subscribe = createRoute({
	method: "post",
	path: "/subscribe",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						tier: z.enum(["lite", "pro", "max"]),
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

devPlans.openapi(subscribe, async (c) => {
	const user = c.get("user");
	const { tier } = c.req.valid("json");

	// Dev plans are billed monthly only; the Stripe monthly cycle drives credit
	// refreshes. (Legacy annual subscriptions are still serviced on read.)
	const cycle: DevPlanCycle = "monthly";

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Require email verification
	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message: "Email verification required",
		});
	}

	// Get or create personal org
	const personalOrg = await getOrCreatePersonalOrg(user);

	// Check if already has an active dev plan subscription
	if (
		personalOrg.devPlan !== "none" &&
		personalOrg.devPlanStripeSubscriptionId
	) {
		throw new HTTPException(400, {
			message:
				"Already have an active dev plan. Please upgrade or cancel first.",
		});
	}

	const priceId = getDevPlanPriceId(tier, cycle);
	if (!priceId) {
		throw new HTTPException(500, {
			message: `STRIPE_DEV_PLAN_${tier.toUpperCase()}_PRICE_ID environment variable is not set`,
		});
	}

	try {
		const stripeCustomerId = await ensureStripeCustomer(personalOrg.id);

		// We use `mode: "setup"` (not "subscription") so the card is collected
		// but the customer is NOT charged at checkout. After redirect we check
		// the card fingerprint against existing DevPass orgs; if it conflicts
		// we reject the activation without ever creating a Stripe subscription
		// or charging the user. The shared metadata carries everything the
		// finalize step needs to create the subscription server-side.
		const session = await getStripe().checkout.sessions.create({
			customer: stripeCustomerId,
			mode: "setup",
			payment_method_types: ["card"],
			success_url: `${process.env.CODE_URL ?? "http://localhost:3004"}/dashboard?setup_session_id={CHECKOUT_SESSION_ID}`,
			cancel_url: `${process.env.CODE_URL ?? "http://localhost:3004"}/dashboard?canceled=true`,
			metadata: {
				organizationId: personalOrg.id,
				subscriptionType: "dev_plan",
				devPlan: tier,
				devPlanCycle: cycle,
				priceId,
				userEmail: user.email,
			},
			setup_intent_data: {
				metadata: {
					organizationId: personalOrg.id,
					subscriptionType: "dev_plan",
					devPlan: tier,
					devPlanCycle: cycle,
					priceId,
					userEmail: user.email,
				},
			},
		});

		if (!session.url) {
			throw new HTTPException(500, {
				message: "Failed to generate checkout URL",
			});
		}

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "dev_plan.subscribe",
			resourceType: "dev_plan",
			metadata: {
				tier,
				cycle,
			},
		});

		return c.json({
			checkoutUrl: session.url,
		});
	} catch (error) {
		logger.error(
			"Stripe checkout session error for dev plan",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: `Failed to create checkout session: ${error}`,
		});
	}
});

// Finalize a dev plan setup session — called by the dashboard after the user
// returns from Stripe Checkout. Verifies the card fingerprint and creates the
// subscription server-side, or rejects with 409 if the card is already used
// by another DevPass org (no charge is made in that case).
const finalize = createRoute({
	method: "post",
	path: "/finalize",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						sessionId: z.string().min(1),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.union([
						z.object({
							status: z.enum(["ok", "already_processed"]),
						}),
						z.object({
							status: z.literal("requires_action"),
							subscriptionId: z.string(),
							clientSecret: z.string(),
							paymentMethodId: z.string().optional(),
						}),
						z.object({
							status: z.literal("payment_pending"),
							subscriptionId: z.string(),
							subscriptionStatus: z.string().optional(),
							invoiceId: z.string().optional(),
							invoiceStatus: z.string().nullable().optional(),
							paymentIntentStatus: z.string().optional(),
							hasClientSecret: z.boolean().optional(),
						}),
					]),
				},
			},
			description: "Dev plan subscription finalized",
		},
		409: {
			content: {
				"application/json": {
					schema: z.object({
						error: z.literal("duplicate_card"),
						message: z.string(),
					}),
				},
			},
			description: "Card already in use by another DevPass account",
		},
	},
});

devPlans.openapi(finalize, async (c) => {
	const user = c.get("user");
	const { sessionId } = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrgs = await db.query.userOrganization.findMany({
		where: { userId: user.id },
		with: { organization: true },
	});
	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	let result;
	try {
		result = await finalizeDevPlanSetupSession(sessionId);
	} catch (error) {
		logger.error(
			`Failed to finalize dev plan session ${sessionId}`,
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to finalize subscription",
		});
	}

	switch (result.status) {
		case "ok":
		case "already_processed":
			return c.json({ status: result.status }, 200);
		case "requires_action":
			return c.json(
				{
					status: result.status,
					subscriptionId: result.subscriptionId,
					clientSecret: result.clientSecret,
					paymentMethodId: result.paymentMethodId,
				},
				200,
			);
		case "payment_pending":
			return c.json(
				{
					status: result.status,
					subscriptionId: result.subscriptionId,
					subscriptionStatus: result.subscriptionStatus,
					invoiceId: result.invoiceId,
					invoiceStatus: result.invoiceStatus,
					paymentIntentStatus: result.paymentIntentStatus,
					hasClientSecret: result.hasClientSecret,
				},
				200,
			);
		case "duplicate_card":
			return c.json(
				{
					error: "duplicate_card" as const,
					message:
						"This card is already associated with another DevPass account. Please use a different payment method.",
				},
				409,
			);
		case "no_payment_method":
			throw new HTTPException(400, {
				message: "No payment method found on the checkout session",
			});
		case "invalid_session":
			throw new HTTPException(400, {
				message: `Invalid checkout session: ${result.reason}`,
			});
	}
});

// Cancel dev plan subscription
const cancel = createRoute({
	method: "post",
	path: "/cancel",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
			description: "Dev plan subscription cancelled successfully",
		},
	},
});

devPlans.openapi(cancel, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Find personal org
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (!personalOrg.devPlanStripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	try {
		await getStripe().subscriptions.update(
			personalOrg.devPlanStripeSubscriptionId,
			{
				cancel_at_period_end: true,
			},
		);

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "dev_plan.cancel",
			resourceType: "dev_plan",
			resourceId: personalOrg.devPlanStripeSubscriptionId,
			metadata: {
				tier: personalOrg.devPlan,
			},
		});

		// Wait for webhook to process
		await new Promise((resolve) => {
			setTimeout(resolve, 3000);
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		logger.error(
			"Stripe dev plan cancellation error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to cancel dev plan subscription",
		});
	}
});

// Resume cancelled dev plan subscription
const resume = createRoute({
	method: "post",
	path: "/resume",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
					}),
				},
			},
			description: "Dev plan subscription resumed successfully",
		},
	},
});

devPlans.openapi(resume, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (!personalOrg.devPlanStripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No dev plan subscription found",
		});
	}

	try {
		const subscription = await getStripe().subscriptions.retrieve(
			personalOrg.devPlanStripeSubscriptionId,
		);

		if (!subscription.cancel_at_period_end) {
			throw new HTTPException(400, {
				message: "Subscription is not cancelled",
			});
		}

		await getStripe().subscriptions.update(
			personalOrg.devPlanStripeSubscriptionId,
			{
				cancel_at_period_end: false,
			},
		);

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "dev_plan.resume",
			resourceType: "dev_plan",
			resourceId: personalOrg.devPlanStripeSubscriptionId,
			metadata: {
				tier: personalOrg.devPlan,
			},
		});

		// Wait for webhook to process
		await new Promise((resolve) => {
			setTimeout(resolve, 3000);
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		logger.error(
			"Stripe dev plan resume error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to resume dev plan subscription",
		});
	}
});

const changeTierPreviewBodySchema = z.object({
	newTier: z.enum(["lite", "pro", "max"]),
});

const changeTierBodySchema = changeTierPreviewBodySchema.extend({
	expectedAmountDueCents: z.number().int().nonnegative().optional(),
});

const tierChangePreviewResponseSchema = z.object({
	currentTier: z.enum(["lite", "pro", "max"]),
	newTier: z.enum(["lite", "pro", "max"]),
	isUpgrade: z.boolean(),
	amountDueCents: z.number().int().nonnegative(),
	currency: z.literal("USD"),
	remainingFraction: z.number(),
	currentCreditsLimit: z.number(),
	proratedCreditDelta: z.number(),
	newCreditsLimit: z.number(),
	billingPeriodStart: z.string(),
	billingPeriodEnd: z.string(),
});

// Preview the exact charge and credit change for a dev plan tier change.
const changeTierPreview = createRoute({
	method: "post",
	path: "/change-tier-preview",
	request: {
		body: {
			content: {
				"application/json": {
					schema: changeTierPreviewBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: tierChangePreviewResponseSchema,
				},
			},
			description: "Dev plan tier change preview",
		},
	},
});

devPlans.openapi(changeTierPreview, async (c) => {
	const user = c.get("user");
	const { newTier } = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const personalOrg = await findPersonalOrg(user.id);

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (!personalOrg.devPlanStripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	if (personalOrg.devPlan === newTier) {
		throw new HTTPException(400, {
			message: `Already on ${newTier} plan`,
		});
	}

	if (personalOrg.devPlan === "none") {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	const currentTier: DevPlanTier = personalOrg.devPlan;
	const isUpgrade = DEV_PLAN_PRICES[newTier] > DEV_PLAN_PRICES[currentTier];
	const subscription = await getStripe().subscriptions.retrieve(
		personalOrg.devPlanStripeSubscriptionId,
	);
	const subscriptionItem = subscription.items.data[0];

	if (!subscriptionItem) {
		throw new HTTPException(500, {
			message: "Subscription item not found",
		});
	}

	const remainingFraction = getRemainingBillingPeriodFraction(subscriptionItem);
	const amountDueCents = isUpgrade
		? getDevPlanUpgradeAmountCents(currentTier, newTier, remainingFraction)
		: 0;
	const creditPreview = getDevPlanTierChangeCreditPreview(
		currentTier,
		newTier,
		remainingFraction,
		parseFloat(personalOrg.devPlanCreditsLimit),
	);

	return c.json({
		currentTier,
		newTier,
		isUpgrade,
		amountDueCents,
		currency: "USD" as const,
		remainingFraction,
		currentCreditsLimit: creditPreview.currentCreditsLimit,
		proratedCreditDelta: creditPreview.proratedCreditDelta,
		newCreditsLimit: creditPreview.newCreditsLimit,
		billingPeriodStart: new Date(
			subscriptionItem.current_period_start * 1000,
		).toISOString(),
		billingPeriodEnd: new Date(
			subscriptionItem.current_period_end * 1000,
		).toISOString(),
	});
});

// Upgrade or downgrade dev plan tier
const changeTier = createRoute({
	method: "post",
	path: "/change-tier",
	request: {
		body: {
			content: {
				"application/json": {
					schema: changeTierBodySchema,
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
			description: "Dev plan tier changed successfully",
		},
	},
});

devPlans.openapi(changeTier, async (c) => {
	const user = c.get("user");
	const { newTier, expectedAmountDueCents } = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (!personalOrg.devPlanStripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	if (personalOrg.devPlan === newTier) {
		throw new HTTPException(400, {
			message: `Already on ${newTier} plan`,
		});
	}

	if (personalOrg.devPlan === "none") {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	const currentTier: DevPlanTier = personalOrg.devPlan;
	const subscriptionId = personalOrg.devPlanStripeSubscriptionId;

	// Preserve the subscriber's existing billing cadence so an annual
	// subscriber doesn't silently get switched to monthly when changing tier.
	const existingCycle: DevPlanCycle = personalOrg.devPlanCycle;
	const newPriceId = getDevPlanPriceId(newTier, existingCycle);
	if (!newPriceId) {
		const envSuffix =
			existingCycle === "annual" ? "_ANNUAL_PRICE_ID" : "_PRICE_ID";
		throw new HTTPException(500, {
			message: `STRIPE_DEV_PLAN_${newTier.toUpperCase()}${envSuffix} environment variable is not set`,
		});
	}

	const isUpgrade = DEV_PLAN_PRICES[newTier] > DEV_PLAN_PRICES[currentTier];

	// Tracks whether this request won the atomic per-cycle claim, so a failure
	// after the claim can release it (a declined charge shouldn't burn the user's
	// one change for the cycle).
	let claimedCycleThisCall = false;

	try {
		const subscription =
			await getStripe().subscriptions.retrieve(subscriptionId);

		// A subscription Stripe has fully ended (`canceled`, or expired before its
		// first payment) can no longer have its price/items changed: Stripe rejects
		// the update with `invalid_canceled_subscription_fields`, which previously
		// surfaced as a generic 500. This state is normally transient — the
		// `customer.subscription.deleted` webhook resets the org's dev plan to
		// "none", after which this handler short-circuits earlier — but a downgrade
		// (which has no active-status guard below) reaching Stripe before that
		// webhook lands, or if it was missed, would hit the rejected update. Bail
		// out early with a clear message and without claiming the per-cycle change.
		if (
			subscription.status === "canceled" ||
			subscription.status === "incomplete_expired"
		) {
			throw new HTTPException(409, {
				message:
					"Your dev plan subscription has ended. Subscribe again to choose a new plan.",
			});
		}

		if (
			isUpgrade &&
			subscription.status !== "active" &&
			subscription.status !== "trialing"
		) {
			throw new HTTPException(402, {
				message:
					"Upgrade payment could not be collected. Update your payment method and try again.",
			});
		}

		const subscriptionItem = subscription.items.data[0];
		const subscriptionItemId = subscriptionItem?.id;
		const currentPriceId = subscriptionItem?.price.id;

		if (!subscriptionItem || !subscriptionItemId || !currentPriceId) {
			throw new HTTPException(500, {
				message: "Subscription item not found",
			});
		}

		// Allow only one tier change per billing cycle. Repeatedly downgrading and
		// re-upgrading within a cycle re-charges the user for a tier they still
		// effectively hold and churns the prorated credit accounting. Claim the
		// cycle atomically *before* any Stripe call: a single conditional UPDATE
		// advances the marker to this cycle's Stripe period start only if it hasn't
		// been claimed yet (NULL or an earlier cycle). Anchoring to the Stripe
		// period (stable across mid-cycle price swaps, since proration is
		// suppressed) — rather than a transaction row's createdAt — both avoids a
		// read-then-write race between concurrent requests and prevents
		// misattributing a change near a renewal boundary to the wrong cycle.
		const cycleStart = new Date(subscriptionItem.current_period_start * 1000);
		const claimed = await db
			.update(tables.organization)
			.set({ devPlanLastTierChangeCycleStart: cycleStart })
			.where(
				and(
					eq(tables.organization.id, personalOrg.id),
					or(
						isNull(tables.organization.devPlanLastTierChangeCycleStart),
						lt(tables.organization.devPlanLastTierChangeCycleStart, cycleStart),
					),
				),
			)
			.returning({ id: tables.organization.id });
		if (claimed.length === 0) {
			throw new HTTPException(409, {
				message:
					"You can only change your plan once per billing cycle. Your next change takes effect at renewal.",
			});
		}
		claimedCycleThisCall = true;

		const remainingFraction =
			getRemainingBillingPeriodFraction(subscriptionItem);
		const amountDueCents = isUpgrade
			? getDevPlanUpgradeAmountCents(currentTier, newTier, remainingFraction)
			: 0;

		if (
			typeof expectedAmountDueCents === "number" &&
			expectedAmountDueCents !== amountDueCents
		) {
			throw new HTTPException(409, {
				message:
					"The upgrade amount changed before payment. Refresh the preview and try again.",
			});
		}

		// Tier changes suppress Stripe's default proration invoice so we can
		// charge the prorated upgrade amount with DevPass-specific metadata and
		// grant the matching prorated credit delta. Downgrades issue no refund.
		const updated = await getStripe().subscriptions.update(subscriptionId, {
			items: [
				{
					id: subscriptionItemId,
					price: newPriceId,
				},
			],
			proration_behavior: "none",
			payment_behavior: "allow_incomplete",
			metadata: {
				...subscription.metadata,
				devPlan: newTier,
				devPlanCycle: existingCycle,
			},
		});

		if (
			isUpgrade &&
			updated.status !== "active" &&
			updated.status !== "trialing"
		) {
			throw new HTTPException(402, {
				message:
					"Upgrade payment could not be collected. Update your payment method and try again.",
			});
		}

		const paidUpgrade = isUpgrade
			? await collectDevPlanUpgradeCharge({
					subscription: updated,
					organizationId: personalOrg.id,
					currentTier,
					newTier,
					remainingFraction,
				}).catch(async (error: unknown) => {
					try {
						await getStripe().subscriptions.update(subscriptionId, {
							items: [
								{
									id: subscriptionItemId,
									price: currentPriceId,
								},
							],
							proration_behavior: "none",
							payment_behavior: "allow_incomplete",
							metadata: {
								...subscription.metadata,
								devPlan: currentTier,
								devPlanCycle: existingCycle,
							},
						});
					} catch (rollbackError) {
						logger.error(
							"Failed to roll back dev plan tier after upgrade payment failure",
							rollbackError instanceof Error
								? rollbackError
								: new Error(String(rollbackError)),
						);
					}

					throw error;
				})
			: null;

		if (isUpgrade) {
			const creditPreview = getDevPlanTierChangeCreditPreview(
				currentTier,
				newTier,
				remainingFraction,
				parseFloat(personalOrg.devPlanCreditsLimit),
			);

			// Reflect the new tier immediately, and persist Stripe's actual period
			// end as the renewal date (a mid-cycle upgrade preserves the billing
			// anchor, so the UI shouldn't project a fresh cycle from the upgrade
			// date). The credit grant is applied separately below, gated on winning
			// the transaction insert.
			await db
				.update(tables.organization)
				.set({
					devPlan: newTier,
					devPlanExpiresAt: new Date(
						subscriptionItem.current_period_end * 1000,
					),
				})
				.where(eq(tables.organization.id, personalOrg.id));

			if (paidUpgrade) {
				// Insert the unique-stripeInvoiceId marker and apply the credit grant
				// in one transaction so they commit together. onConflictDoNothing makes
				// this idempotent against the webhook fallback: only the path that wins
				// the insert grants the credits and emails the invoice, so a concurrent
				// `invoice.payment_succeeded` webhook can't double-apply the credit
				// delta, produce a second transaction row, or send a duplicate email.
				// Atomicity matters because both paths short-circuit on the existing
				// marker — a crash between insert and grant would otherwise leave the
				// invoice recorded with the credit never applied.
				const upgradeTransaction = await db.transaction(async (tx) => {
					const [created] = await tx
						.insert(tables.transaction)
						.values({
							organizationId: personalOrg.id,
							type: "dev_plan_upgrade",
							amount: paidUpgrade.amount.toString(),
							creditAmount: creditPreview.proratedCreditDelta.toString(),
							currency: "USD",
							status: "completed",
							stripePaymentIntentId: paidUpgrade.paymentIntentId,
							stripeInvoiceId: paidUpgrade.invoiceId,
							description: `Changed from ${currentTier} to ${newTier} plan`,
						})
						.onConflictDoNothing()
						.returning();

					if (created) {
						// Add the prorated credit delta on top of the existing allowance.
						// Never recompute the limit from the tier's base allotment: that
						// discards credits carried into this period by earlier mid-cycle
						// changes (e.g. a downgrade then re-upgrade), which would shrink the
						// allowance below the user's accumulated usage and hide the granted
						// credit.
						await tx
							.update(tables.organization)
							.set({
								devPlanCreditsLimit: sql`${tables.organization.devPlanCreditsLimit} + ${creditPreview.proratedCreditDelta}`,
							})
							.where(eq(tables.organization.id, personalOrg.id));
					}

					return created;
				});

				if (upgradeTransaction) {
					try {
						const billingDetails =
							await resolveDevPassBillingDetails(personalOrg);
						await generateAndEmailInvoice({
							invoiceNumber: upgradeTransaction.id,
							invoiceDate: new Date(),
							organizationName: personalOrg.name,
							organizationId: personalOrg.id,
							...billingDetails,
							lineItems: [
								{
									description: `Dev Plan upgrade from ${currentTier.toUpperCase()} to ${newTier.toUpperCase()} ($${creditPreview.proratedCreditDelta} credits included)`,
									amount: paidUpgrade.amount,
								},
							],
							currency: "USD",
						});
					} catch (e) {
						logger.error(
							"Invoice email failed (DevPass upgrade invoice); suppressing failure",
							e as Error,
						);
					}
				}
			}
		} else {
			// Downgrade: keep the current cycle's credits (limit and used) intact;
			// the lower tier — and its smaller allotment — takes effect at the
			// next renewal. No proration invoice is generated, so record the
			// tier-change transaction here.
			await db
				.update(tables.organization)
				.set({
					devPlan: newTier,
				})
				.where(eq(tables.organization.id, personalOrg.id));

			await db.insert(tables.transaction).values({
				organizationId: personalOrg.id,
				type: "dev_plan_downgrade",
				description: `Changed from ${currentTier} to ${newTier} plan`,
				status: "completed",
			});
		}

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "dev_plan.change_tier",
			resourceType: "dev_plan",
			resourceId: personalOrg.devPlanStripeSubscriptionId,
			metadata: {
				changes: {
					tier: { old: currentTier, new: newTier },
				},
			},
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		// Release the per-cycle claim if we won it but the change didn't complete,
		// so a transient failure (e.g. a declined upgrade charge) doesn't lock the
		// user out of changing tiers until renewal. Restores the prior marker value
		// read before the claim.
		if (claimedCycleThisCall) {
			await db
				.update(tables.organization)
				.set({
					devPlanLastTierChangeCycleStart:
						personalOrg.devPlanLastTierChangeCycleStart,
				})
				.where(eq(tables.organization.id, personalOrg.id))
				.catch((rollbackError) => {
					logger.error(
						"Failed to release dev plan tier-change cycle claim after error",
						rollbackError instanceof Error
							? rollbackError
							: new Error(String(rollbackError)),
					);
				});
		}
		if (error instanceof HTTPException) {
			throw error;
		}
		logger.error(
			"Stripe dev plan tier change error",
			error instanceof Error ? error : new Error(String(error)),
		);
		// Stripe returns StripeCardError / StripeInvalidRequestError when an
		// upgrade can't be collected (declined card, no payment method on file,
		// etc.). Surface this to the caller as a 402 instead of a generic 500
		// so the UI can prompt the user to update billing.
		const errCode =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code?: unknown }).code)
				: undefined;
		if (errCode === "card_declined" || errCode === "invoice_payment_required") {
			throw new HTTPException(402, {
				message:
					"Upgrade payment could not be collected. Update your payment method and try again.",
			});
		}
		throw new HTTPException(500, {
			message: "Failed to change dev plan tier",
		});
	}
});

// Get dev plan status
const getStatus = createRoute({
	method: "get",
	path: "/status",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						hasPersonalOrg: z.boolean(),
						devPlan: z.enum(["none", "lite", "pro", "max"]),
						devPlanCycle: z.enum(["monthly", "annual"]),
						devPlanCreditsUsed: z.string(),
						devPlanCreditsLimit: z.string(),
						devPlanCreditsRemaining: z.string(),
						devPlanBillingCycleStart: z.string().nullable(),
						devPlanCancelled: z.boolean(),
						devPlanExpiresAt: z.string().nullable(),
						regularCredits: z.string(),
						organizationId: z.string().nullable(),
						projectId: z.string().nullable(),
						apiKey: z.string().nullable(),
						devPlanAllowAllModels: z.boolean(),
						retentionLevel: z.enum(["retain", "none"]),
						defaultRoutingStrategy: z.enum([
							"auto",
							"price",
							"throughput",
							"latency",
						]),
					}),
				},
			},
			description: "Dev plan status retrieved successfully",
		},
	},
});

devPlans.openapi(getStatus, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;

	if (!personalOrg) {
		return c.json({
			hasPersonalOrg: false,
			devPlan: "none" as const,
			devPlanCycle: "monthly" as const,
			devPlanCreditsUsed: "0",
			devPlanCreditsLimit: "0",
			devPlanCreditsRemaining: "0",
			devPlanBillingCycleStart: null,
			devPlanCancelled: false,
			devPlanExpiresAt: null,
			regularCredits: "0",
			organizationId: null,
			projectId: null,
			apiKey: null,
			devPlanAllowAllModels: false,
			retentionLevel: "none" as const,
			defaultRoutingStrategy: "auto" as const,
		});
	}

	const creditsUsed = parseFloat(personalOrg.devPlanCreditsUsed);
	const creditsLimit = parseFloat(personalOrg.devPlanCreditsLimit);
	const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);

	// Get API key and project if user has an active dev plan
	let apiKey: string | null = null;
	let projectId: string | null = null;
	let defaultRoutingStrategy: "auto" | "price" | "throughput" | "latency" =
		"auto";
	if (personalOrg.devPlan !== "none") {
		// Find the default project for this org. Order by createdAt asc so we
		// always return the original "Default Project" rather than whichever
		// row Postgres happens to surface first.
		const project = await db.query.project.findFirst({
			where: {
				organizationId: {
					eq: personalOrg.id,
				},
			},
			orderBy: {
				createdAt: "asc",
			},
		});

		if (project) {
			projectId = project.id;
			defaultRoutingStrategy = project.defaultRoutingStrategy;
			apiKey = await getOrCreatePersonalOrgApiKey(
				personalOrg.id,
				project.id,
				user.id,
			);
		}
	}

	return c.json({
		hasPersonalOrg: true,
		devPlan: personalOrg.devPlan,
		devPlanCycle: personalOrg.devPlanCycle,
		devPlanCreditsUsed: personalOrg.devPlanCreditsUsed,
		devPlanCreditsLimit: personalOrg.devPlanCreditsLimit,
		devPlanCreditsRemaining: creditsRemaining.toFixed(2),
		devPlanBillingCycleStart:
			personalOrg.devPlanBillingCycleStart?.toISOString() ?? null,
		devPlanCancelled: personalOrg.devPlanCancelled,
		devPlanExpiresAt: personalOrg.devPlanExpiresAt?.toISOString() ?? null,
		regularCredits: personalOrg.credits,
		organizationId: personalOrg.id,
		projectId,
		apiKey,
		devPlanAllowAllModels: personalOrg.devPlanAllowAllModels,
		retentionLevel: personalOrg.retentionLevel,
		defaultRoutingStrategy,
	});
});

// Update dev plan settings
const updateSettings = createRoute({
	method: "patch",
	path: "/settings",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						devPlanAllowAllModels: z.boolean().optional(),
						retentionLevel: z.enum(["retain", "none"]).optional(),
						// Coding plans optimize for prompt caching, so only the
						// default weighted routing or the price strategy are allowed.
						defaultRoutingStrategy: z.enum(["auto", "price"]).optional(),
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
						devPlanAllowAllModels: z.boolean(),
						retentionLevel: z.enum(["retain", "none"]),
						defaultRoutingStrategy: z.enum([
							"auto",
							"price",
							"throughput",
							"latency",
						]),
					}),
				},
			},
			description: "Dev plan settings updated successfully",
		},
	},
});

devPlans.openapi(updateSettings, async (c) => {
	const user = c.get("user");
	const { devPlanAllowAllModels, retentionLevel, defaultRoutingStrategy } =
		c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Find personal org
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (personalOrg.devPlan === "none") {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	const updateData: {
		devPlanAllowAllModels?: boolean;
		retentionLevel?: "retain" | "none";
	} = {};

	if (devPlanAllowAllModels !== undefined) {
		updateData.devPlanAllowAllModels = devPlanAllowAllModels;
	}
	if (retentionLevel !== undefined) {
		updateData.retentionLevel = retentionLevel;
	}

	const changes: Record<string, { old: unknown; new: unknown }> = {};

	if (Object.keys(updateData).length > 0) {
		await db
			.update(tables.organization)
			.set(updateData)
			.where(eq(tables.organization.id, personalOrg.id));

		if (
			devPlanAllowAllModels !== undefined &&
			devPlanAllowAllModels !== personalOrg.devPlanAllowAllModels
		) {
			changes.devPlanAllowAllModels = {
				old: personalOrg.devPlanAllowAllModels,
				new: devPlanAllowAllModels,
			};
		}
		if (
			retentionLevel !== undefined &&
			retentionLevel !== personalOrg.retentionLevel
		) {
			changes.retentionLevel = {
				old: personalOrg.retentionLevel,
				new: retentionLevel,
			};
		}
	}

	// The default routing strategy lives on the project, not the org. Apply it to
	// the org's default project (the same one surfaced by the status endpoint).
	let effectiveRoutingStrategy: "auto" | "price" | "throughput" | "latency" =
		"auto";
	const defaultProject = await db.query.project.findFirst({
		where: {
			organizationId: {
				eq: personalOrg.id,
			},
		},
		orderBy: {
			createdAt: "asc",
		},
	});
	if (defaultProject) {
		effectiveRoutingStrategy = defaultProject.defaultRoutingStrategy;
		if (
			defaultRoutingStrategy !== undefined &&
			defaultRoutingStrategy !== defaultProject.defaultRoutingStrategy
		) {
			// Cached client so the gateway's project-cache invalidates and the new
			// default routing strategy takes effect immediately (see projects.ts).
			await cdb
				.update(tables.project)
				.set({ defaultRoutingStrategy })
				.where(eq(tables.project.id, defaultProject.id));
			changes.defaultRoutingStrategy = {
				old: defaultProject.defaultRoutingStrategy,
				new: defaultRoutingStrategy,
			};
			effectiveRoutingStrategy = defaultRoutingStrategy;
		}
	}

	if (Object.keys(changes).length > 0) {
		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "dev_plan.update_settings",
			resourceType: "dev_plan",
			metadata: { changes },
		});
	}

	return c.json({
		success: true,
		devPlanAllowAllModels:
			devPlanAllowAllModels ?? personalOrg.devPlanAllowAllModels,
		retentionLevel: retentionLevel ?? personalOrg.retentionLevel,
		defaultRoutingStrategy: effectiveRoutingStrategy,
	});
});

// Billing details used on DevPass invoices. By default these mirror the owner's
// default LLM Gateway org; they can be overridden with DevPass-specific values.
const billingFieldsSchema = z.object({
	billingEmail: z.string(),
	billingCompany: z.string().nullable(),
	billingAddress: z.string().nullable(),
	billingTaxId: z.string().nullable(),
	billingNotes: z.string().nullable(),
});

function pickBillingFields(org: {
	billingEmail: string;
	billingCompany: string | null;
	billingAddress: string | null;
	billingTaxId: string | null;
	billingNotes: string | null;
}) {
	return {
		billingEmail: org.billingEmail,
		billingCompany: org.billingCompany,
		billingAddress: org.billingAddress,
		billingTaxId: org.billingTaxId,
		billingNotes: org.billingNotes,
	};
}

const getBillingDetails = createRoute({
	method: "get",
	path: "/billing-details",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						devPlanBillingOverride: z.boolean(),
						own: billingFieldsSchema,
						default: billingFieldsSchema,
					}),
				},
			},
			description: "DevPass billing details retrieved successfully",
		},
	},
});

devPlans.openapi(getBillingDetails, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const personalOrg = await findPersonalOrg(user.id);
	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	const defaultOrg = await findDefaultOrganization(user.id, user.email);

	return c.json({
		devPlanBillingOverride: personalOrg.devPlanBillingOverride,
		own: pickBillingFields(personalOrg),
		default: pickBillingFields(defaultOrg ?? personalOrg),
	});
});

const updateBillingDetails = createRoute({
	method: "patch",
	path: "/billing-details",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						devPlanBillingOverride: z.boolean().optional(),
						billingEmail: z.string().email().optional(),
						billingCompany: z.string().optional(),
						billingAddress: z.string().optional(),
						billingTaxId: z.string().optional(),
						billingNotes: z.string().optional(),
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
						devPlanBillingOverride: z.boolean(),
						own: billingFieldsSchema,
						default: billingFieldsSchema,
					}),
				},
			},
			description: "DevPass billing details updated successfully",
		},
	},
});

devPlans.openapi(updateBillingDetails, async (c) => {
	const user = c.get("user");
	const {
		devPlanBillingOverride,
		billingEmail,
		billingCompany,
		billingAddress,
		billingTaxId,
		billingNotes,
	} = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const personalOrg = await findPersonalOrg(user.id);
	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	const updateData: {
		devPlanBillingOverride?: boolean;
		billingEmail?: string;
		billingCompany?: string;
		billingAddress?: string;
		billingTaxId?: string;
		billingNotes?: string;
	} = {};

	if (devPlanBillingOverride !== undefined) {
		updateData.devPlanBillingOverride = devPlanBillingOverride;
	}
	if (billingEmail !== undefined) {
		updateData.billingEmail = billingEmail;
	}
	if (billingCompany !== undefined) {
		updateData.billingCompany = billingCompany;
	}
	if (billingAddress !== undefined) {
		updateData.billingAddress = billingAddress;
	}
	if (billingTaxId !== undefined) {
		updateData.billingTaxId = billingTaxId;
	}
	if (billingNotes !== undefined) {
		updateData.billingNotes = billingNotes;
	}

	let updatedOrg = personalOrg;
	if (Object.keys(updateData).length > 0) {
		const [updated] = await db
			.update(tables.organization)
			.set(updateData)
			.where(eq(tables.organization.id, personalOrg.id))
			.returning();
		updatedOrg = updated;

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "dev_plan.update_billing_details",
			resourceType: "dev_plan",
			metadata: { fields: Object.keys(updateData) },
		});
	}

	const defaultOrg = await findDefaultOrganization(user.id, user.email);

	return c.json({
		devPlanBillingOverride: updatedOrg.devPlanBillingOverride,
		own: pickBillingFields(updatedOrg),
		default: pickBillingFields(defaultOrg ?? updatedOrg),
	});
});

// List past DevPass invoices (plan start, renewals and upgrades) with the
// amount charged and the virtual credits granted for each billing event.
const getInvoices = createRoute({
	method: "get",
	path: "/invoices",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						invoices: z.array(
							z.object({
								id: z.string(),
								type: z.enum([
									"dev_plan_start",
									"dev_plan_renewal",
									"dev_plan_upgrade",
								]),
								date: z.string(),
								amount: z.string().nullable(),
								creditAmount: z.string().nullable(),
								currency: z.string(),
								status: z.enum(["pending", "completed", "failed"]),
								description: z.string().nullable(),
							}),
						),
					}),
				},
			},
			description: "DevPass invoices retrieved successfully",
		},
	},
});

devPlans.openapi(getInvoices, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const personalOrg = await findPersonalOrg(user.id);
	if (!personalOrg) {
		return c.json({ invoices: [] });
	}

	const transactions = await db.query.transaction.findMany({
		where: {
			organizationId: { eq: personalOrg.id },
			type: { in: ["dev_plan_start", "dev_plan_renewal", "dev_plan_upgrade"] },
		},
		orderBy: {
			createdAt: "desc",
		},
	});

	const invoices = transactions.map((t) => ({
		id: t.id,
		type: t.type as "dev_plan_start" | "dev_plan_renewal" | "dev_plan_upgrade",
		date: t.createdAt.toISOString(),
		amount: t.amount,
		creditAmount: t.creditAmount,
		currency: t.currency,
		status: t.status,
		description: t.description,
	}));

	return c.json({ invoices });
});

// Rotate the dev-plan API key — invalidates the current key and issues a new one
const rotateApiKey = createRoute({
	method: "post",
	path: "/rotate-api-key",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						apiKey: z.string(),
					}),
				},
			},
			description: "API key rotated successfully",
		},
	},
});

devPlans.openapi(rotateApiKey, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const personalOrg = userOrgs.find(
		(uo) => uo.organization?.kind === "devpass",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (personalOrg.devPlan === "none") {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	const project = await db.query.project.findFirst({
		where: {
			organizationId: {
				eq: personalOrg.id,
			},
		},
		orderBy: {
			createdAt: "asc",
		},
	});

	if (!project) {
		throw new HTTPException(404, {
			message: "Default project not found",
		});
	}

	const newToken =
		(process.env.NODE_ENV === "development" ? "llmgdev_" : "llmgtwy_") +
		shortid(40);

	await db.transaction(async (tx) => {
		await tx
			.update(tables.apiKey)
			.set({ status: "deleted" })
			.where(eq(tables.apiKey.projectId, project.id));

		await tx.insert(tables.apiKey).values({
			token: newToken,
			projectId: project.id,
			description: "Dev Plan API Key",
			createdBy: user.id,
		});
	});

	await logAuditEvent({
		organizationId: personalOrg.id,
		userId: user.id,
		action: "dev_plan.rotate_api_key",
		resourceType: "api_key",
		resourceId: project.id,
	});

	return c.json({
		apiKey: newToken,
	});
});

// Get the card currently backing the DevPass subscription
const getPaymentMethod = createRoute({
	method: "get",
	path: "/payment-method",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						card: z
							.object({
								brand: z.string(),
								last4: z.string(),
								expiryMonth: z.number(),
								expiryYear: z.number(),
							})
							.nullable(),
					}),
				},
			},
			description: "Current DevPass payment method retrieved",
		},
	},
});

devPlans.openapi(getPaymentMethod, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const personalOrg = await findPersonalOrg(user.id);

	if (!personalOrg?.devPlanStripeSubscriptionId) {
		return c.json({ card: null });
	}

	const subscription = await getStripe().subscriptions.retrieve(
		personalOrg.devPlanStripeSubscriptionId,
		{ expand: ["default_payment_method"] },
	);

	const defaultPaymentMethod = subscription.default_payment_method;
	if (!defaultPaymentMethod) {
		return c.json({ card: null });
	}

	const paymentMethod =
		typeof defaultPaymentMethod === "string"
			? await getStripe().paymentMethods.retrieve(defaultPaymentMethod)
			: defaultPaymentMethod;

	if (paymentMethod.type !== "card" || !paymentMethod.card) {
		return c.json({ card: null });
	}

	return c.json({
		card: {
			brand: paymentMethod.card.brand,
			last4: paymentMethod.card.last4,
			expiryMonth: paymentMethod.card.exp_month,
			expiryYear: paymentMethod.card.exp_year,
		},
	});
});

// Create a SetupIntent to collect a new card for the DevPass subscription. The
// card is confirmed client-side via Stripe Elements, then attached to the
// subscription through /dev-plans/update-payment-method.
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
			description: "SetupIntent created successfully",
		},
	},
});

devPlans.openapi(createSetupIntent, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const personalOrg = await findPersonalOrg(user.id);

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (personalOrg.devPlan === "none") {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	const stripeCustomerId = await ensureStripeCustomer(personalOrg.id);

	const setupIntent = await getStripe().setupIntents.create({
		customer: stripeCustomerId,
		payment_method_types: ["card"],
		usage: "off_session",
		metadata: {
			organizationId: personalOrg.id,
			subscriptionType: "dev_plan_update",
		},
	});

	if (!setupIntent.client_secret) {
		throw new HTTPException(500, {
			message: "Failed to create setup intent",
		});
	}

	return c.json({
		clientSecret: setupIntent.client_secret,
	});
});

// Attach a newly confirmed card as the DevPass subscription's payment method.
// Rejects with 409 if the card is already used by another DevPass account, to
// preserve the one-card-per-account guarantee enforced at signup.
const updatePaymentMethod = createRoute({
	method: "post",
	path: "/update-payment-method",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						paymentMethodId: z.string().min(1),
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
			description: "Payment method updated successfully",
		},
		409: {
			content: {
				"application/json": {
					schema: z.object({
						error: z.literal("duplicate_card"),
						message: z.string(),
					}),
				},
			},
			description: "Card already in use by another DevPass account",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({
						error: z.literal("invalid_payment_method"),
						message: z.string(),
					}),
				},
			},
			description: "Payment method is not a card with a fingerprint",
		},
	},
});

devPlans.openapi(updatePaymentMethod, async (c) => {
	const user = c.get("user");
	const { paymentMethodId } = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const personalOrg = await findPersonalOrg(user.id);

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (!personalOrg.devPlanStripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active dev plan subscription found",
		});
	}

	const stripeCustomerId = await ensureStripeCustomer(personalOrg.id);

	const paymentMethod =
		await getStripe().paymentMethods.retrieve(paymentMethodId);

	// Only card payment methods carry the fingerprint we rely on to enforce the
	// one-card-per-account rule. Reject anything else up front so we never store
	// a null fingerprint or point the subscription at an unverifiable method.
	const fingerprint =
		paymentMethod.type === "card"
			? (paymentMethod.card?.fingerprint ?? null)
			: null;

	if (!fingerprint) {
		return c.json(
			{
				error: "invalid_payment_method" as const,
				message: "Payment method must be a card with a fingerprint.",
			},
			400,
		);
	}

	// Enforce one card per DevPass account: reject a card already linked to a
	// different org and detach it so it isn't silently left on this customer.
	const conflictingOrg = await db.query.organization.findFirst({
		where: {
			devPlanCardFingerprint: { eq: fingerprint },
			id: { ne: personalOrg.id },
		},
	});
	if (conflictingOrg) {
		try {
			await getStripe().paymentMethods.detach(paymentMethodId);
		} catch (err) {
			logger.warn(
				`Failed to detach duplicate dev plan card ${paymentMethodId}`,
				{ error: err instanceof Error ? err.message : String(err) },
			);
		}
		return c.json(
			{
				error: "duplicate_card" as const,
				message:
					"This card is already associated with another DevPass account. Please use a different payment method.",
			},
			409,
		);
	}

	// confirmCardSetup already attaches the card to the customer; attach again
	// defensively in case it isn't, ignoring the already-attached error.
	try {
		await getStripe().paymentMethods.attach(paymentMethodId, {
			customer: stripeCustomerId,
		});
	} catch (err) {
		logger.warn(
			`Attach dev plan card ${paymentMethodId} (likely already attached)`,
			{
				error: err instanceof Error ? err.message : String(err),
			},
		);
	}

	await getStripe().customers.update(stripeCustomerId, {
		invoice_settings: { default_payment_method: paymentMethodId },
	});

	await getStripe().subscriptions.update(
		personalOrg.devPlanStripeSubscriptionId,
		{ default_payment_method: paymentMethodId },
	);

	await db
		.update(tables.organization)
		.set({ devPlanCardFingerprint: fingerprint })
		.where(eq(tables.organization.id, personalOrg.id));

	await logAuditEvent({
		organizationId: personalOrg.id,
		userId: user.id,
		action: "dev_plan.update_payment_method",
		resourceType: "dev_plan",
		resourceId: personalOrg.devPlanStripeSubscriptionId,
		metadata: {
			cardLast4:
				paymentMethod.type === "card" ? paymentMethod.card?.last4 : undefined,
		},
	});

	return c.json(
		{
			success: true,
		},
		200,
	);
});
