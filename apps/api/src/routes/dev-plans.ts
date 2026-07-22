import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { voidPendingCycleRenewalInvoices } from "@/lib/pending-renewal.js";
import {
	computeSelfRefundEligibility,
	executeSelfRefund,
	isSelfRefundCandidateType,
} from "@/lib/self-refund.js";
import { posthog } from "@/posthog.js";
import {
	ensureStripeCustomer,
	finalizeDevPlanSetupSession,
	fulfillResetPassPurchase,
	isDevPlanCardDedupeEnforced,
} from "@/stripe.js";
import { findDefaultOrganization } from "@/utils/default-org.js";
import {
	buildInvoiceDataForTransaction,
	generateAndEmailInvoice,
	generateInvoicePDF,
	isInvoiceableTransaction,
	isRefundTransaction,
} from "@/utils/invoice.js";
import { getOrCreatePersonalOrg } from "@/utils/personal-org.js";
import { resolveDevPassBillingDetails } from "@/utils/plan-billing.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	cdb,
	db,
	tables,
	eq,
	and,
	or,
	lt,
	gte,
	isNull,
	shortid,
	sql,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	DEV_PLAN_INCLUDED_RESET_PASSES,
	DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
	DEV_PLAN_PRICES,
	DEV_PLAN_RESET_PASS_PRICES,
	DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE,
	DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE,
	getDevPlanCreditsLimit,
	getDevPlanCycleUsageFraction,
	getDevPlanPremiumWeeklyLimit,
	getDevPlanUpgradeCredits,
	getIncludedResetPassesRemaining,
	getRemainingPremiumWeeklyAllowance,
	isPremiumWeekExpired,
	type DevPlanCycle,
	type DevPlanTier,
} from "@llmgateway/shared";

import { getStripe } from "./payments.js";

import type { ServerTypes } from "@/vars.js";
import type Stripe from "stripe";

export const devPlans = new OpenAPIHono<ServerTypes>();

// How long an unreleased tier-change lease is honored before a retry may take
// it over. Well above the Stripe SDK's request timeout (80s per attempt), so a
// lease this old cannot still have an upgrade charge in flight.
const STALE_TIER_CHANGE_CLAIM_MS = 15 * 60 * 1000;

// A failed release is swallowed: the lease then simply expires via the
// staleness window instead of blocking upgrades until renewal.
async function releaseTierChangeLease(organizationId: string) {
	await db
		.update(tables.organization)
		.set({ devPlanTierChangeClaimedAt: null })
		.where(eq(tables.organization.id, organizationId))
		.catch((releaseError) => {
			logger.error(
				"Failed to release dev plan tier-change lease",
				releaseError instanceof Error
					? releaseError
					: new Error(String(releaseError)),
			);
		});
}

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

// Purchased Reset Passes are tier-bound: only the inventory bought for the
// org's current tier is redeemable, so a cheap Lite pass can't reset the
// larger Pro/Max allowance.
function getPurchasedResetPasses(
	org: {
		devPlanResetPassesLite: number;
		devPlanResetPassesPro: number;
		devPlanResetPassesMax: number;
	},
	tier: DevPlanTier,
): number {
	switch (tier) {
		case "lite":
			return org.devPlanResetPassesLite;
		case "pro":
			return org.devPlanResetPassesPro;
		case "max":
			return org.devPlanResetPassesMax;
	}
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

// The full price of a tier charged on an upgrade. Reads the Stripe price's
// unit amount so it stays correct for both monthly and legacy annual cadences
// (DEV_PLAN_PRICES only tracks the monthly dollar figure).
async function getDevPlanFullPriceCents(priceId: string): Promise<number> {
	const price = await getStripe().prices.retrieve(priceId);
	return price.unit_amount ?? 0;
}

function getDevPlanChangeInvoiceId(subscription: Stripe.Subscription) {
	const latestInvoice = (
		subscription as Stripe.Subscription & {
			latest_invoice?: string | Stripe.Invoice | null;
		}
	).latest_invoice;
	if (!latestInvoice) {
		return { invoiceId: null, paymentIntentId: null, amountPaid: null };
	}
	if (typeof latestInvoice === "string") {
		return {
			invoiceId: latestInvoice,
			paymentIntentId: null,
			amountPaid: null,
		};
	}
	return {
		invoiceId: latestInvoice.id ?? null,
		paymentIntentId: getInvoicePaymentIntentId(latestInvoice),
		amountPaid:
			typeof latestInvoice.amount_paid === "number"
				? latestInvoice.amount_paid
				: null,
	};
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

// Reset a personal org's dev-plan fields after its Stripe subscription has
// fully ended (`canceled` / `incomplete_expired`). This mirrors the reset the
// `customer.subscription.deleted` webhook performs, so the dashboard falls back
// to the plan chooser and the user can subscribe again. It exists as a
// self-heal for the case where that webhook was delayed or missed: without it
// the org is stuck holding a reference to a dead subscription — resume is
// rejected by Stripe and a fresh subscribe is blocked as "already active".
async function resetEndedDevPlan(organizationId: string): Promise<void> {
	await db
		.update(tables.organization)
		.set({
			devPlan: "none",
			devPlanPendingTier: null,
			devPlanCreditsLimit: "0",
			devPlanCreditsUsed: "0",
			devPlanPremiumCreditsUsed: "0",
			devPlanPremiumWeekStart: null,
			// Included passes are a per-cycle grant, so their used-counter clears
			// with the plan; purchased passes were paid for and survive to a
			// future resubscribe.
			devPlanIncludedResetPassesUsed: 0,
			devPlanCreditsFrozen: false,
			devPlanCreditsLimitBeforeFreeze: null,
			devPlanStripeSubscriptionId: null,
			devPlanExpiresAt: null,
			devPlanCancelled: false,
			devPlanBillingCycleStart: null,
		})
		.where(eq(tables.organization.id, organizationId));
}

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

	// Check if already has an active dev plan subscription. A stale reference to
	// a subscription Stripe has already ended (deletion webhook delayed/missed)
	// would otherwise permanently block resubscribing, so verify the recorded
	// subscription is really live before rejecting — and self-heal if it isn't.
	if (
		personalOrg.devPlan !== "none" &&
		personalOrg.devPlanStripeSubscriptionId
	) {
		const existing = await getStripe().subscriptions.retrieve(
			personalOrg.devPlanStripeSubscriptionId,
		);
		if (
			existing.status === "canceled" ||
			existing.status === "incomplete_expired"
		) {
			await resetEndedDevPlan(personalOrg.id);
		} else {
			throw new HTTPException(400, {
				message:
					"Already have an active dev plan. Please upgrade or cancel first.",
			});
		}
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
						// True when the subscription had already fully ended and could
						// not be resumed — the org was reset to "none" and the user
						// should subscribe again via the plan chooser.
						ended: z.boolean().optional(),
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

		// A subscription Stripe has fully ended (`canceled`, or expired before its
		// first payment) can no longer be resumed by clearing `cancel_at_period_end`:
		// Stripe rejects the update with `invalid_canceled_subscription_fields`
		// ("A canceled subscription can only update its cancellation_details and
		// metadata"). This state is normally transient — the
		// `customer.subscription.deleted` webhook resets the org's dev plan to
		// "none" — but a resume reaching Stripe before that webhook lands, or if it
		// was missed, would hit the rejected update. Self-heal the stale row so the
		// dashboard falls back to the plan chooser, and tell the client the
		// subscription has ended so it can prompt a fresh subscribe.
		if (
			subscription.status === "canceled" ||
			subscription.status === "incomplete_expired"
		) {
			await resetEndedDevPlan(personalOrg.id);
			return c.json({ success: false, ended: true }, 200);
		}

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
		if (error instanceof HTTPException) {
			throw error;
		}
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
	// When an upgrade takes effect. "now" (default) charges the full new-tier
	// price immediately, restarts the cycle, and rolls unused credits over;
	// "next_cycle" schedules the new tier for the upcoming renewal like a
	// downgrade — no charge today, current allowance kept until then.
	// Downgrades always apply at renewal, so timing is ignored for them.
	timing: z.enum(["now", "next_cycle"]).optional(),
});

const tierChangePreviewResponseSchema = z.object({
	currentTier: z.enum(["lite", "pro", "max"]),
	newTier: z.enum(["lite", "pro", "max"]),
	isUpgrade: z.boolean(),
	amountDueCents: z.number().int().nonnegative(),
	currency: z.literal("USD"),
	currentCreditsLimit: z.number(),
	newCreditsLimit: z.number(),
	rolloverCredits: z.number(),
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
	const existingCycle: DevPlanCycle = personalOrg.devPlanCycle;
	const subscription = await getStripe().subscriptions.retrieve(
		personalOrg.devPlanStripeSubscriptionId,
	);
	const subscriptionItem = subscription.items.data[0];

	if (!subscriptionItem) {
		throw new HTTPException(500, {
			message: "Subscription item not found",
		});
	}

	// Upgrades charge the full new-tier price today and start a fresh billing
	// cycle (no proration); downgrades stay deferred to renewal, so nothing is
	// due today. On an upgrade the new allowance is the new tier's full
	// allotment plus the unused remainder of the current cycle rolled over.
	const currentCreditsLimit = parseFloat(personalOrg.devPlanCreditsLimit);
	let amountDueCents = 0;
	let newCreditsLimit = currentCreditsLimit;
	let rolloverCredits = 0;
	if (isUpgrade) {
		const newPriceId = getDevPlanPriceId(newTier, existingCycle);
		if (!newPriceId) {
			const envSuffix =
				existingCycle === "annual" ? "_ANNUAL_PRICE_ID" : "_PRICE_ID";
			throw new HTTPException(500, {
				message: `STRIPE_DEV_PLAN_${newTier.toUpperCase()}${envSuffix} environment variable is not set`,
			});
		}
		amountDueCents = await getDevPlanFullPriceCents(newPriceId);
		({ rolloverCredits, newCreditsLimit } = getDevPlanUpgradeCredits(
			newTier,
			personalOrg.devPlanCreditsUsed,
			personalOrg.devPlanCreditsLimit,
		));
	}

	return c.json({
		currentTier,
		newTier,
		isUpgrade,
		amountDueCents,
		currency: "USD" as const,
		currentCreditsLimit,
		newCreditsLimit,
		rolloverCredits,
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
	const { newTier, expectedAmountDueCents, timing } = c.req.valid("json");

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
	// An upgrade applies immediately unless the user opted to schedule it for
	// the next renewal; downgrades are always deferred to renewal.
	const applyNow = isUpgrade && timing !== "next_cycle";

	// Tracks whether this request won the upgrade lease, so only the winning
	// request releases it — a request that lost the claim race must not clear a
	// lease still held by the in-flight upgrade.
	let claimedLeaseThisCall = false;

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
			applyNow &&
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

		// A scheduled tier change (upgrade or downgrade) doesn't hard-lock the
		// plan: the user can still upgrade immediately, which supersedes and
		// clears the pending change (the immediate-upgrade branch below sets
		// devPlanPendingTier back to null). Only block scheduling *another*
		// change while one is already pending — to revert to the current tier
		// the user uses the dedicated cancel action.
		if (personalOrg.devPlanPendingTier && !applyNow) {
			throw new HTTPException(409, {
				message:
					"You've already scheduled a plan change for your next renewal. Upgrade immediately or cancel the scheduled change first.",
			});
		}

		// Guard UPGRADES against a double charge. An upgrade resets the billing
		// cycle and charges the full new-tier price, so two racing requests (e.g. a
		// double-clicked confirm) would each start a fresh cycle and charge again.
		// Take a lease atomically *before* any Stripe call: a single conditional
		// UPDATE stamps the claim time only if no lease is held, so of two racing
		// requests only one wins and the other gets 409. The lease is released when
		// the request completes (success or failure); if the request dies without
		// releasing (process crash or restart mid-flight), the lease expires after
		// the staleness window — far above the Stripe SDK's request timeout, so a
		// lease that old cannot still have a charge in flight — and a retry
		// re-claims it. A re-submit after a completed upgrade is not this guard's
		// job: it is rejected by the "Already on <tier> plan" check above.
		// Scheduled changes (downgrades and next-cycle upgrades) are exempt: they
		// only record the target tier for renewal (no charge), so an in-flight
		// upgrade must not block them.
		if (applyNow) {
			const staleClaimBefore = new Date(
				Date.now() - STALE_TIER_CHANGE_CLAIM_MS,
			);
			const claimed = await db
				.update(tables.organization)
				.set({ devPlanTierChangeClaimedAt: new Date() })
				.where(
					and(
						eq(tables.organization.id, personalOrg.id),
						or(
							isNull(tables.organization.devPlanTierChangeClaimedAt),
							lt(
								tables.organization.devPlanTierChangeClaimedAt,
								staleClaimBefore,
							),
						),
					),
				)
				.returning({ id: tables.organization.id });
			if (claimed.length === 0) {
				logger.warn("Dev plan upgrade denied: lease already held", {
					organizationId: personalOrg.id,
					claimedAt: personalOrg.devPlanTierChangeClaimedAt?.toISOString(),
				});
				throw new HTTPException(409, {
					message:
						"An upgrade is already being processed. Please try again in a few minutes.",
				});
			}
			claimedLeaseThisCall = true;
		}

		// Immediate upgrades charge the full new-tier price today; scheduled
		// changes are deferred to renewal and cost nothing now.
		const amountDueCents = applyNow
			? await getDevPlanFullPriceCents(newPriceId)
			: 0;

		// Guard against charging the user more than the preview they confirmed. The
		// full price is deterministic per tier, so this only trips if the Stripe
		// price changed between the preview and the confirmation.
		if (
			typeof expectedAmountDueCents === "number" &&
			amountDueCents > expectedAmountDueCents
		) {
			throw new HTTPException(409, {
				message:
					"The upgrade amount changed before payment. Refresh the preview and try again.",
			});
		}

		if (applyNow) {
			// If the previous cycle just ended, its renewal invoice may still be
			// pending (Stripe drafts it at the period boundary and charges ~an hour
			// later). Void it before re-anchoring — otherwise it would later charge
			// for a cycle this upgrade replaces and its webhook would clobber the
			// fresh allowance granted below.
			await voidPendingCycleRenewalInvoices(subscriptionId);

			// Swap to the new price, reset the billing cycle to now
			// (`billing_cycle_anchor: "now"`) so Stripe immediately invoices the full
			// new-tier price and starts a fresh period, and suppress proration
			// (`proration_behavior: "none"`) so no partial credit or debit is applied.
			// `error_if_incomplete` makes the update atomic: if the charge can't be
			// collected Stripe throws and leaves the subscription on the old tier, so
			// there's no half-applied upgrade to roll back.
			const updated = await getStripe().subscriptions.update(subscriptionId, {
				items: [
					{
						id: subscriptionItemId,
						price: newPriceId,
					},
				],
				proration_behavior: "none",
				billing_cycle_anchor: "now",
				payment_behavior: "error_if_incomplete",
				expand: ["latest_invoice.payment_intent"],
				metadata: {
					...subscription.metadata,
					devPlan: newTier,
					devPlanCycle: existingCycle,
				},
			});

			if (updated.status !== "active" && updated.status !== "trialing") {
				throw new HTTPException(402, {
					message:
						"Upgrade payment could not be collected. Update your payment method and try again.",
				});
			}

			const newExpiresAt = new Date(
				updated.items.data[0].current_period_end * 1000,
			);
			const { invoiceId, paymentIntentId, amountPaid } =
				getDevPlanChangeInvoiceId(updated);
			const chargedAmount =
				amountPaid !== null ? amountPaid / 100 : amountDueCents / 100;

			// Insert the unique-stripeInvoiceId marker and reset the org to the new
			// tier's full allowance in one transaction so they commit together.
			// onConflictDoNothing keeps this idempotent against the
			// `invoice.payment_succeeded` webhook fallback: only the path that wins
			// the insert resets org state and emails the invoice, so a concurrent
			// webhook can't double-apply the reset, produce a second transaction row,
			// or send a duplicate email.
			const upgradeResult = await db.transaction(async (tx) => {
				// The new allowance is the new tier's full allotment plus the unused
				// remainder of the cycle being replaced — the user already paid for
				// it, so it rolls over instead of being forfeited. The rollover lasts
				// until the next renewal, which resets the limit to the tier's base
				// allotment. Recompute from a fresh row read inside the transaction:
				// usage may have advanced during the Stripe round-trips above, and the
				// request-start snapshot would over-grant that spend as rollover.
				const freshOrg = await tx.query.organization.findFirst({
					where: { id: { eq: personalOrg.id } },
				});
				const { rolloverCredits, newCreditsLimit } = getDevPlanUpgradeCredits(
					newTier,
					freshOrg?.devPlanCreditsUsed ?? personalOrg.devPlanCreditsUsed,
					freshOrg?.devPlanCreditsLimit ?? personalOrg.devPlanCreditsLimit,
				);

				const [created] = await tx
					.insert(tables.transaction)
					.values({
						organizationId: personalOrg.id,
						type: "dev_plan_upgrade",
						amount: chargedAmount.toString(),
						creditAmount: newCreditsLimit.toString(),
						currency: "USD",
						status: "completed",
						stripePaymentIntentId: paymentIntentId,
						stripeInvoiceId: invoiceId,
						description: `Changed from ${currentTier} to ${newTier} plan`,
					})
					.onConflictDoNothing()
					.returning();

				if (created) {
					// Fresh billing cycle: set the limit to the new tier's full
					// allowance plus the rollover, zero out usage (including the
					// premium weekly window), advance the cycle start, clear any
					// pending change and dunning freeze state, and persist the new
					// period end as the renewal date.
					await tx
						.update(tables.organization)
						.set({
							devPlan: newTier,
							devPlanCreditsLimit: newCreditsLimit.toString(),
							devPlanCreditsUsed: "0",
							devPlanPremiumCreditsUsed: "0",
							devPlanPremiumWeekStart: new Date(),
							devPlanIncludedResetPassesUsed: 0,
							devPlanCreditsFrozen: false,
							devPlanCreditsLimitBeforeFreeze: null,
							devPlanBillingCycleStart: new Date(),
							devPlanExpiresAt: newExpiresAt,
							devPlanPendingTier: null,
						})
						.where(eq(tables.organization.id, personalOrg.id));
				}

				return created ? { created, rolloverCredits, newCreditsLimit } : null;
			});

			if (upgradeResult) {
				const { created, rolloverCredits, newCreditsLimit } = upgradeResult;
				try {
					const billingDetails =
						await resolveDevPassBillingDetails(personalOrg);
					await generateAndEmailInvoice({
						invoiceNumber: created.id,
						invoiceDate: new Date(),
						organizationName: personalOrg.name,
						organizationId: personalOrg.id,
						...billingDetails,
						lineItems: [
							{
								description:
									rolloverCredits > 0
										? `Dev Plan upgrade to ${newTier.toUpperCase()} ($${getDevPlanCreditsLimit(newTier)} credits included + $${rolloverCredits} unused credits rolled over)`
										: `Dev Plan upgrade to ${newTier.toUpperCase()} ($${newCreditsLimit} credits included)`,
								amount: chargedAmount,
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
		} else {
			// Scheduled change (a downgrade, or an upgrade the user chose to defer):
			// the new tier takes effect at the next renewal, so keep `devPlan` (and
			// the current cycle's credits) on the current tier and record the target
			// tier as pending. Swap the Stripe price with no proration and no cycle
			// reset, so the renewal invoice bills the new price; the renewal webhook
			// then flips `devPlan` to the pending tier and resets credits to its
			// allotment. No invoice is generated now, so record the tier-change
			// transaction here.
			await getStripe().subscriptions.update(subscriptionId, {
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

			await db
				.update(tables.organization)
				.set({
					devPlanPendingTier: newTier,
				})
				.where(eq(tables.organization.id, personalOrg.id));

			// Scheduled downgrades keep their historical no-amount transaction row.
			// A scheduled upgrade records no transaction: `dev_plan_upgrade` rows
			// are treated as payment rows by the invoice list and self-refund
			// eligibility, so a $0 marker would pollute both. The audit event below
			// captures the scheduling; the renewal itself is recorded by the
			// `dev_plan_renewal` transaction when it bills.
			if (!isUpgrade) {
				await db.insert(tables.transaction).values({
					organizationId: personalOrg.id,
					type: "dev_plan_downgrade",
					description: `Changed from ${currentTier} to ${newTier} plan`,
					status: "completed",
				});
			}
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
				timing: applyNow ? "now" : "next_cycle",
			},
		});

		if (claimedLeaseThisCall) {
			await releaseTierChangeLease(personalOrg.id);
		}

		return c.json({
			success: true,
		});
	} catch (error) {
		// Release the lease if we won it but the change didn't complete, so a
		// transient failure (e.g. a declined upgrade charge) doesn't block retries
		// for the full staleness window.
		if (claimedLeaseThisCall) {
			await releaseTierChangeLease(personalOrg.id);
		}
		if (error instanceof HTTPException) {
			throw error;
		}
		// Stripe returns StripeCardError / StripeInvalidRequestError when an
		// upgrade can't be collected (declined card, no payment method on file,
		// etc.). Surface this to the caller as a 402 instead of a generic 500
		// so the UI can prompt the user to update billing. This is an expected
		// user-facing outcome, not a server fault, so log it at warn — never
		// error — to avoid noisy alerts for declined cards.
		const errCode =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code?: unknown }).code)
				: undefined;
		if (errCode === "card_declined" || errCode === "invoice_payment_required") {
			logger.warn("Dev plan tier change payment declined", {
				code: errCode,
			});
			throw new HTTPException(402, {
				message:
					"Upgrade payment could not be collected. Update your payment method and try again.",
			});
		}
		logger.error(
			"Stripe dev plan tier change error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to change dev plan tier",
		});
	}
});

// Cancel a scheduled downgrade and stay on the current tier
const cancelDowngrade = createRoute({
	method: "post",
	path: "/cancel-downgrade",
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
			description:
				"Scheduled dev plan tier change (upgrade or downgrade) cancelled successfully",
		},
	},
});

devPlans.openapi(cancelDowngrade, async (c) => {
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
			message: "No active dev plan subscription found",
		});
	}

	if (!personalOrg.devPlanPendingTier || personalOrg.devPlan === "none") {
		throw new HTTPException(400, {
			message: "No scheduled plan change to cancel",
		});
	}

	const currentTier: DevPlanTier = personalOrg.devPlan;
	const existingCycle: DevPlanCycle = personalOrg.devPlanCycle;
	const currentTierPriceId = getDevPlanPriceId(currentTier, existingCycle);
	if (!currentTierPriceId) {
		const envSuffix =
			existingCycle === "annual" ? "_ANNUAL_PRICE_ID" : "_PRICE_ID";
		throw new HTTPException(500, {
			message: `STRIPE_DEV_PLAN_${currentTier.toUpperCase()}${envSuffix} environment variable is not set`,
		});
	}

	try {
		const subscription = await getStripe().subscriptions.retrieve(
			personalOrg.devPlanStripeSubscriptionId,
		);

		if (
			subscription.status === "canceled" ||
			subscription.status === "incomplete_expired"
		) {
			throw new HTTPException(409, {
				message:
					"Your dev plan subscription has ended. Subscribe again to choose a new plan.",
			});
		}

		const subscriptionItem = subscription.items.data[0];
		const subscriptionItemId = subscriptionItem?.id;
		if (!subscriptionItem || !subscriptionItemId) {
			throw new HTTPException(500, {
				message: "Subscription item not found",
			});
		}

		// Scheduling the change swapped the Stripe price to the target tier so the
		// renewal would bill it; reverting to the current tier's price keeps the
		// subscriber on their current plan going forward. Proration stays suppressed
		// (no charge or refund) — the current tier was never actually left.
		await getStripe().subscriptions.update(
			personalOrg.devPlanStripeSubscriptionId,
			{
				items: [{ id: subscriptionItemId, price: currentTierPriceId }],
				proration_behavior: "none",
				payment_behavior: "allow_incomplete",
				metadata: {
					...subscription.metadata,
					devPlan: currentTier,
					devPlanCycle: existingCycle,
				},
			},
		);

		await db
			.update(tables.organization)
			.set({ devPlanPendingTier: null })
			.where(eq(tables.organization.id, personalOrg.id));

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "dev_plan.cancel_downgrade",
			resourceType: "dev_plan",
			resourceId: personalOrg.devPlanStripeSubscriptionId,
			metadata: {
				cancelledPendingTier: personalOrg.devPlanPendingTier,
				tier: currentTier,
			},
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		if (error instanceof HTTPException) {
			throw error;
		}
		logger.error(
			"Stripe dev plan cancel-downgrade error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to cancel scheduled plan change",
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
						devPlanPendingTier: z.enum(["lite", "pro", "max"]).nullable(),
						devPlanCycle: z.enum(["monthly", "annual"]),
						devPlanCreditsUsed: z.string(),
						devPlanCreditsLimit: z.string(),
						devPlanCreditsRemaining: z.string(),
						devPlanPremiumWeeklyLimit: z.string(),
						devPlanPremiumCreditsUsed: z.string(),
						devPlanPremiumWeekResetsAt: z.string().nullable(),
						// Purchased Reset Passes redeemable on the current tier
						// (purchased inventory is tier-bound).
						devPlanResetPasses: z.number(),
						// Plan-included Reset Passes: per-cycle grant and how many
						// of those are still available this cycle.
						devPlanIncludedResetPasses: z.number(),
						devPlanIncludedResetPassesRemaining: z.number(),
						// One-time price of a Reset Pass for the current tier.
						devPlanResetPassPrice: z.number().nullable(),
						devPlanBillingCycleStart: z.string().nullable(),
						devPlanCancelled: z.boolean(),
						devPlanExpiresAt: z.string().nullable(),
						regularCredits: z.string(),
						organizationId: z.string().nullable(),
						projectId: z.string().nullable(),
						apiKey: z.string().nullable(),
						devPlanServiceTier: z.enum(["default", "flex"]),
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
			devPlanPendingTier: null,
			devPlanCycle: "monthly" as const,
			devPlanCreditsUsed: "0",
			devPlanCreditsLimit: "0",
			devPlanCreditsRemaining: "0",
			devPlanPremiumWeeklyLimit: "0",
			devPlanPremiumCreditsUsed: "0",
			devPlanPremiumWeekResetsAt: null,
			devPlanResetPasses: 0,
			devPlanIncludedResetPasses: 0,
			devPlanIncludedResetPassesRemaining: 0,
			devPlanResetPassPrice: null,
			devPlanBillingCycleStart: null,
			devPlanCancelled: false,
			devPlanExpiresAt: null,
			regularCredits: "0",
			organizationId: null,
			projectId: null,
			apiKey: null,
			devPlanServiceTier: "default" as const,
			retentionLevel: "none" as const,
			defaultRoutingStrategy: "auto" as const,
		});
	}

	const creditsUsed = parseFloat(personalOrg.devPlanCreditsUsed);
	const creditsLimit = parseFloat(personalOrg.devPlanCreditsLimit);
	const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);

	// Weekly premium fair-use allowance, computed with the same helpers the
	// gateway uses for enforcement. An expired window reports zero usage and no
	// reset date — the full allowance is already available again.
	const premiumWeeklyLimit =
		personalOrg.devPlan !== "none"
			? getDevPlanPremiumWeeklyLimit(personalOrg.devPlan)
			: 0;
	const premiumWeekExpired = isPremiumWeekExpired(
		personalOrg.devPlanPremiumWeekStart,
	);
	const premiumCreditsUsed = premiumWeekExpired
		? 0
		: parseFloat(personalOrg.devPlanPremiumCreditsUsed ?? "0");
	const premiumWeekResetsAt =
		!premiumWeekExpired && personalOrg.devPlanPremiumWeekStart
			? new Date(
					personalOrg.devPlanPremiumWeekStart.getTime() +
						DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
				).toISOString()
			: null;

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
		devPlanPendingTier: personalOrg.devPlanPendingTier,
		devPlanCycle: personalOrg.devPlanCycle,
		devPlanCreditsUsed: personalOrg.devPlanCreditsUsed,
		devPlanCreditsLimit: personalOrg.devPlanCreditsLimit,
		devPlanCreditsRemaining: creditsRemaining.toFixed(2),
		devPlanPremiumWeeklyLimit: premiumWeeklyLimit.toFixed(2),
		devPlanPremiumCreditsUsed: premiumCreditsUsed.toFixed(2),
		devPlanPremiumWeekResetsAt: premiumWeekResetsAt,
		devPlanResetPasses:
			personalOrg.devPlan !== "none"
				? getPurchasedResetPasses(personalOrg, personalOrg.devPlan)
				: 0,
		devPlanIncludedResetPasses:
			personalOrg.devPlan !== "none"
				? DEV_PLAN_INCLUDED_RESET_PASSES[personalOrg.devPlan]
				: 0,
		devPlanIncludedResetPassesRemaining:
			personalOrg.devPlan !== "none"
				? getIncludedResetPassesRemaining(
						personalOrg.devPlan,
						personalOrg.devPlanIncludedResetPassesUsed,
					)
				: 0,
		devPlanResetPassPrice:
			personalOrg.devPlan !== "none"
				? DEV_PLAN_RESET_PASS_PRICES[personalOrg.devPlan]
				: null,
		devPlanBillingCycleStart:
			personalOrg.devPlanBillingCycleStart?.toISOString() ?? null,
		devPlanCancelled: personalOrg.devPlanCancelled,
		devPlanExpiresAt: personalOrg.devPlanExpiresAt?.toISOString() ?? null,
		regularCredits: personalOrg.credits,
		organizationId: personalOrg.id,
		projectId,
		apiKey,
		devPlanServiceTier: personalOrg.devPlanServiceTier,
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
						// Default processing tier for DevPass routing. "flex" saves
						// plan credits by using cheaper flex processing where the
						// selected provider supports it.
						devPlanServiceTier: z.enum(["default", "flex"]).optional(),
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
						devPlanServiceTier: z.enum(["default", "flex"]),
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
	const { devPlanServiceTier, retentionLevel, defaultRoutingStrategy } =
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
		devPlanServiceTier?: "default" | "flex";
		retentionLevel?: "retain" | "none";
	} = {};

	if (devPlanServiceTier !== undefined) {
		updateData.devPlanServiceTier = devPlanServiceTier;
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
			devPlanServiceTier !== undefined &&
			devPlanServiceTier !== personalOrg.devPlanServiceTier
		) {
			changes.devPlanServiceTier = {
				old: personalOrg.devPlanServiceTier,
				new: devPlanServiceTier,
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
		devPlanServiceTier: devPlanServiceTier ?? personalOrg.devPlanServiceTier,
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
									"dev_plan_reset_pass",
								]),
								date: z.string(),
								amount: z.string().nullable(),
								creditAmount: z.string().nullable(),
								currency: z.string(),
								status: z.enum(["pending", "completed", "failed"]),
								description: z.string().nullable(),
								refund: z
									.object({
										eligible: z.boolean(),
										reason: z
											.enum([
												"unsupported_type",
												"not_completed",
												"already_refunded",
												"window_expired",
												"not_owner",
												"not_latest_purchase",
												"plan_inactive",
												"credits_frozen",
												"usage_exceeded",
												"pass_already_used",
											])
											.optional(),
									})
									.optional(),
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

	// Eligibility needs the full transaction list (refund rows, ordering across
	// types); the dev-plan billing events are filtered out of it for display.
	const transactions = await db.query.transaction.findMany({
		where: {
			organizationId: { eq: personalOrg.id },
		},
		orderBy: {
			createdAt: "desc",
		},
	});

	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: user.id },
			organizationId: { eq: personalOrg.id },
		},
	});

	const invoices = transactions
		.filter((t) =>
			[
				"dev_plan_start",
				"dev_plan_renewal",
				"dev_plan_upgrade",
				"dev_plan_reset_pass",
			].includes(t.type),
		)
		.map((t) => ({
			id: t.id,
			type: t.type as
				| "dev_plan_start"
				| "dev_plan_renewal"
				| "dev_plan_upgrade"
				| "dev_plan_reset_pass",
			date: t.createdAt.toISOString(),
			amount: t.amount,
			creditAmount: t.creditAmount,
			currency: t.currency,
			status: t.status,
			description: t.description,
			refund: isSelfRefundCandidateType(t.type)
				? computeSelfRefundEligibility({
						organization: personalOrg,
						role: membership?.role,
						transactions,
						transaction: t,
					})
				: undefined,
		}));

	return c.json({ invoices });
});

// Self-service refund for a DevPass billing event. Only the first (or latest)
// barely-used payment qualifies; refunding a plan payment also cancels the
// DevPass immediately, while refunding an unused Reset Pass just returns the
// pass and leaves the plan running. See lib/self-refund.ts for the
// eligibility rules.
const selfRefundInvoice = createRoute({
	method: "post",
	path: "/invoices/{invoiceId}/refund",
	request: {
		params: z.object({
			invoiceId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						status: z.literal("refund_processing"),
						stripeRefundId: z.string(),
					}),
				},
			},
			description:
				"Refund created; bookkeeping is applied when Stripe confirms via webhook. A plan-payment refund cancels the DevPass immediately, a Reset Pass refund removes the unused pass and leaves the plan running",
		},
	},
});

devPlans.openapi(selfRefundInvoice, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { invoiceId } = c.req.param();

	const personalOrg = await findPersonalOrg(user.id);
	if (!personalOrg) {
		throw new HTTPException(404, { message: "No DevPass organization found" });
	}

	const transactions = await db.query.transaction.findMany({
		where: {
			organizationId: { eq: personalOrg.id },
		},
	});
	const transaction = transactions.find((t) => t.id === invoiceId);
	if (!transaction) {
		throw new HTTPException(404, { message: "Invoice not found" });
	}

	const membership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: user.id },
			organizationId: { eq: personalOrg.id },
		},
	});

	const eligibility = computeSelfRefundEligibility({
		organization: personalOrg,
		role: membership?.role,
		transactions,
		transaction,
	});
	if (!eligibility.eligible) {
		throw new HTTPException(400, {
			message: `This payment is not eligible for a self-service refund: ${eligibility.reason}`,
		});
	}

	const { stripeRefundId } = await executeSelfRefund({
		organization: personalOrg,
		transaction,
		userId: user.id,
	});

	return c.json({
		status: "refund_processing" as const,
		stripeRefundId,
	});
});

// Download a PDF invoice for a single DevPass billing event. Billing details
// mirror the invoice originally emailed at purchase time (see stripe.ts).
const downloadInvoice = createRoute({
	method: "get",
	path: "/invoices/{invoiceId}/pdf",
	request: {
		params: z.object({
			invoiceId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/pdf": {
					schema: z.any().openapi({ type: "string", format: "binary" }),
				},
			},
			description: "PDF invoice for the specified DevPass billing event",
		},
	},
});

devPlans.openapi(downloadInvoice, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { invoiceId } = c.req.param();

	const personalOrg = await findPersonalOrg(user.id);
	if (!personalOrg) {
		throw new HTTPException(404, { message: "Invoice not found" });
	}

	const transaction = await db.query.transaction.findFirst({
		where: {
			id: { eq: invoiceId },
			organizationId: { eq: personalOrg.id },
		},
	});
	if (!transaction || !isInvoiceableTransaction(transaction)) {
		throw new HTTPException(404, { message: "Invoice not found" });
	}

	const billingDetails = await resolveDevPassBillingDetails(personalOrg);

	const originalTransaction =
		isRefundTransaction(transaction.type) && transaction.relatedTransactionId
			? await db.query.transaction.findFirst({
					where: {
						id: { eq: transaction.relatedTransactionId },
						organizationId: { eq: personalOrg.id },
					},
				})
			: null;

	const pdf = generateInvoicePDF(
		buildInvoiceDataForTransaction(
			transaction,
			{
				id: personalOrg.id,
				name: personalOrg.name,
				...billingDetails,
			},
			originalTransaction,
		),
	);

	const prefix = isRefundTransaction(transaction.type)
		? "credit-note"
		: "invoice";
	c.header("Content-Type", "application/pdf");
	c.header(
		"Content-Disposition",
		`attachment; filename="${prefix}-${transaction.id}.pdf"`,
	);
	return c.body(new Uint8Array(pdf));
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
	// Skipped in local development so the same Stripe test card can be reused.
	if (isDevPlanCardDedupeEnforced()) {
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

// Buy a Reset Pass — charges the saved payment method directly (the dashboard
// shows a confirmation dialog first), so there is no Stripe Checkout redirect.
// The charge and the fulfilment are synchronous: on success one pass is added
// to the tier-bound inventory for the org's current tier.
const purchaseResetPass = createRoute({
	method: "post",
	path: "/reset-pass/purchase",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						// Purchased passes now redeemable on the current tier.
						devPlanResetPasses: z.number(),
						amount: z.number(),
					}),
				},
			},
			description: "Reset Pass purchased successfully",
		},
	},
});

devPlans.openapi(purchaseResetPass, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message: "Email verification required",
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
			message: "An active dev plan is required to buy a Reset Pass.",
		});
	}

	// A pass lifts the weekly premium cap, but the unlocked spend still draws
	// from the monthly credit pool — selling one against a nearly exhausted
	// pool would only confuse buyers, so the purchase waits for the renewal.
	// (At 100% the dashboard replaces the pass card with an upgrade/PAYG
	// promo; this gate is the server-side backstop for that state too.)
	if (
		getDevPlanCycleUsageFraction(
			personalOrg.devPlanCreditsUsed,
			personalOrg.devPlanCreditsLimit,
		) > DEV_PLAN_RESET_PASS_PURCHASE_MAX_CYCLE_USAGE
	) {
		throw new HTTPException(400, {
			message:
				"You've used more than 95% of this cycle's credit allowance, so a Reset Pass would give you almost nothing to use right now. You can buy one again when your credits renew.",
		});
	}

	const tier = personalOrg.devPlan;
	const price = DEV_PLAN_RESET_PASS_PRICES[tier];
	const stripeCustomerId = await ensureStripeCustomer(personalOrg.id);

	// Charge the payment method on file: the subscription's default first,
	// falling back to the customer's default. DevPass subscriptions are
	// card-only, so this is always a card.
	let paymentMethodId: string | null = null;
	if (personalOrg.devPlanStripeSubscriptionId) {
		try {
			const subscription = await getStripe().subscriptions.retrieve(
				personalOrg.devPlanStripeSubscriptionId,
			);
			paymentMethodId = getStripeId(subscription.default_payment_method);
		} catch (err) {
			logger.warn("Could not read subscription payment method", {
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}
	if (!paymentMethodId) {
		const customer = await getStripe().customers.retrieve(stripeCustomerId);
		if (!customer.deleted) {
			paymentMethodId = getStripeId(
				customer.invoice_settings?.default_payment_method,
			);
		}
	}
	if (!paymentMethodId) {
		throw new HTTPException(400, {
			message:
				"No saved payment method found. Update your payment method on the billing page and try again.",
		});
	}

	// `kind` (not `baseAmount`) in the metadata keeps this PaymentIntent out
	// of handlePaymentIntentSucceeded's credit top-up path and routes it to
	// the Reset Pass fulfilment recovery branch instead.
	let paymentIntent: Stripe.PaymentIntent;
	try {
		paymentIntent = await getStripe().paymentIntents.create({
			amount: Math.round(price * 100),
			currency: "usd",
			customer: stripeCustomerId,
			payment_method: paymentMethodId,
			off_session: true,
			confirm: true,
			description: `DevPass Reset Pass (${tier.toUpperCase()})`,
			metadata: {
				organizationId: personalOrg.id,
				kind: "dev_plan_reset_pass",
				devPlan: tier,
				userEmail: user.email,
				userId: user.id,
			},
		});
	} catch (err) {
		// Stripe raises StripeCardError when the saved card can't be charged
		// (declined, expired, insufficient funds, 3DS required off-session) —
		// an expected user-facing outcome surfaced as 402, mirroring the
		// tier-change handler. Anything else (configuration, outage,
		// programming errors) is rethrown to the global error handler.
		const stripeErr = err as { type?: string; code?: string };
		if (
			stripeErr?.type === "StripeCardError" ||
			stripeErr?.code === "card_declined"
		) {
			logger.warn("Reset Pass charge declined", { code: stripeErr.code });
			throw new HTTPException(402, {
				message:
					"Your card was declined. Update your payment method on the billing page and try again.",
			});
		}
		throw err;
	}

	if (paymentIntent.status !== "succeeded") {
		throw new HTTPException(402, {
			message:
				"The payment could not be completed. Update your payment method on the billing page and try again.",
		});
	}

	// Fulfilment is shared with the `payment_intent.succeeded` webhook, which
	// re-runs it as the recovery path if this request dies right here — the
	// charge can never be lost, and the dedup inside makes reruns no-ops.
	await fulfillResetPassPurchase(paymentIntent);

	const updatedOrg = await db.query.organization.findFirst({
		where: { id: { eq: personalOrg.id } },
	});

	await logAuditEvent({
		organizationId: personalOrg.id,
		userId: user.id,
		action: "dev_plan.reset_pass_purchase",
		resourceType: "dev_plan",
		resourceId: paymentIntent.id,
		metadata: {
			tier,
			price,
		},
	});

	return c.json({
		success: true,
		devPlanResetPasses: updatedOrg
			? getPurchasedResetPasses(updatedOrg, tier)
			: 0,
		amount: (paymentIntent.amount_received || paymentIntent.amount) / 100,
	});
});

// Redeem a Reset Pass: zero the weekly premium usage and clear the window so
// a fresh 7-day window starts with the next premium request (the same state a
// naturally expired week resolves to). Included (plan-granted) passes are
// consumed before purchased ones since they expire with the billing cycle.
const redeemResetPass = createRoute({
	method: "post",
	path: "/reset-pass/redeem",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						source: z.enum(["included", "purchased"]),
						devPlanResetPasses: z.number(),
						devPlanIncludedResetPassesRemaining: z.number(),
					}),
				},
			},
			description: "Reset Pass redeemed successfully",
		},
	},
});

devPlans.openapi(redeemResetPass, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message: "Email verification required",
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
			message: "An active dev plan is required to redeem a Reset Pass.",
		});
	}

	// With the monthly credit pool nearly exhausted, a reset would restore a
	// weekly cap the user can't actually spend against — burning the pass for
	// almost nothing. The pass keeps until the cycle renews, so hold it.
	if (
		getDevPlanCycleUsageFraction(
			personalOrg.devPlanCreditsUsed,
			personalOrg.devPlanCreditsLimit,
		) > DEV_PLAN_RESET_PASS_REDEEM_MAX_CYCLE_USAGE
	) {
		throw new HTTPException(400, {
			message:
				"You've used more than 90% of this cycle's credit allowance — redeeming now would waste the pass on usage you can't spend. Your pass stays available for when your credits renew.",
		});
	}

	const tier = personalOrg.devPlan;
	const weeklyLimit = getDevPlanPremiumWeeklyLimit(tier);
	const remaining = getRemainingPremiumWeeklyAllowance(
		tier,
		personalOrg.devPlanPremiumCreditsUsed,
		personalOrg.devPlanPremiumWeekStart,
	);

	// Redeeming with an untouched allowance would burn the pass for nothing.
	// A partially-used allowance implies an active (unexpired) window, so the
	// stored week start is necessarily set — the null check narrows the type
	// for the compare-and-swap below.
	const observedPremiumWeekStart = personalOrg.devPlanPremiumWeekStart;
	if (remaining >= weeklyLimit || !observedPremiumWeekStart) {
		throw new HTTPException(400, {
			message:
				"Your weekly premium allowance is already at its full limit — nothing to reset.",
		});
	}

	const includedRemaining = getIncludedResetPassesRemaining(
		tier,
		personalOrg.devPlanIncludedResetPassesUsed,
	);
	const source: "included" | "purchased" | null =
		includedRemaining > 0
			? "included"
			: getPurchasedResetPasses(personalOrg, tier) > 0
				? "purchased"
				: null;

	if (!source) {
		throw new HTTPException(400, {
			message:
				"No Reset Passes available. Buy one to reset your premium allowance now.",
		});
	}

	// Purchased inventory is tier-bound, so the decrement targets the column
	// for the org's current tier.
	const purchasedColumn =
		tier === "lite"
			? tables.organization.devPlanResetPassesLite
			: tier === "pro"
				? tables.organization.devPlanResetPassesPro
				: tables.organization.devPlanResetPassesMax;
	const purchasedDecrement =
		tier === "lite"
			? {
					devPlanResetPassesLite: sql`${tables.organization.devPlanResetPassesLite} - 1`,
				}
			: tier === "pro"
				? {
						devPlanResetPassesPro: sql`${tables.organization.devPlanResetPassesPro} - 1`,
					}
				: {
						devPlanResetPassesMax: sql`${tables.organization.devPlanResetPassesMax} - 1`,
					};

	// The WHERE clause makes the redeem atomic in two ways. The counter guard
	// stops a concurrent redeem that already consumed the last pass from
	// driving the inventory negative. The compare-and-swap on the observed
	// premium usage and week start stops two concurrent redeems (with enough
	// inventory for both) from each burning a pass to reset the same
	// allowance: the first reset rewrites both fields, so the loser's
	// predicates match zero rows.
	const updated = await db
		.update(tables.organization)
		.set({
			devPlanPremiumCreditsUsed: "0",
			devPlanPremiumWeekStart: null,
			...(source === "included"
				? {
						devPlanIncludedResetPassesUsed: sql`${tables.organization.devPlanIncludedResetPassesUsed} + 1`,
					}
				: purchasedDecrement),
		})
		.where(
			and(
				eq(tables.organization.id, personalOrg.id),
				eq(
					tables.organization.devPlanPremiumCreditsUsed,
					personalOrg.devPlanPremiumCreditsUsed,
				),
				eq(
					tables.organization.devPlanPremiumWeekStart,
					observedPremiumWeekStart,
				),
				source === "included"
					? lt(
							tables.organization.devPlanIncludedResetPassesUsed,
							DEV_PLAN_INCLUDED_RESET_PASSES[tier],
						)
					: gte(purchasedColumn, 1),
			),
		)
		.returning({
			devPlanResetPassesLite: tables.organization.devPlanResetPassesLite,
			devPlanResetPassesPro: tables.organization.devPlanResetPassesPro,
			devPlanResetPassesMax: tables.organization.devPlanResetPassesMax,
			devPlanIncludedResetPassesUsed:
				tables.organization.devPlanIncludedResetPassesUsed,
		});

	if (updated.length === 0) {
		throw new HTTPException(409, {
			message:
				"The pass was redeemed by another request. Refresh to see your current allowance.",
		});
	}

	await logAuditEvent({
		organizationId: personalOrg.id,
		userId: user.id,
		action: "dev_plan.reset_pass_redeem",
		resourceType: "dev_plan",
		metadata: {
			tier,
			source,
			premiumCreditsUsedBeforeReset: personalOrg.devPlanPremiumCreditsUsed,
		},
	});

	posthog.capture({
		distinctId: user.id,
		event: "reset_pass_redeemed",
		groups: { organization: personalOrg.id },
		properties: {
			devPlan: tier,
			source,
			organization: personalOrg.id,
		},
	});

	return c.json({
		success: true,
		source,
		devPlanResetPasses: getPurchasedResetPasses(updated[0], tier),
		devPlanIncludedResetPassesRemaining: getIncludedResetPassesRemaining(
			tier,
			updated[0].devPlanIncludedResetPassesUsed,
		),
	});
});
