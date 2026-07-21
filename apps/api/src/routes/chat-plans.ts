import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { ensureStripeCustomer } from "@/stripe.js";
import { getOrCreateChatOrg } from "@/utils/personal-org.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, tables, eq } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	CHAT_PLAN_PRICES,
	getChatPlanCreditsLimit,
	type ChatPlanTier,
} from "@llmgateway/shared";

import { getStripe } from "./payments.js";

import type { ServerTypes } from "@/vars.js";

export const chatPlans = new OpenAPIHono<ServerTypes>();

function getChatPlanPriceId(tier: ChatPlanTier): string | undefined {
	const monthlyKeys: Record<ChatPlanTier, string> = {
		starter: "STRIPE_CHAT_PLAN_STARTER_PRICE_ID",
		plus: "STRIPE_CHAT_PLAN_PLUS_PRICE_ID",
		pro: "STRIPE_CHAT_PLAN_PRO_PRICE_ID",
	};
	return process.env[monthlyKeys[tier]];
}

const subscribe = createRoute({
	method: "post",
	path: "/subscribe",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						tier: z.enum(["starter", "plus", "pro"]),
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

chatPlans.openapi(subscribe, async (c) => {
	const user = c.get("user");
	const { tier } = c.req.valid("json");

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

	const personalOrg = await getOrCreateChatOrg(user);

	if (
		personalOrg.chatPlan !== "none" &&
		personalOrg.chatPlanStripeSubscriptionId
	) {
		throw new HTTPException(400, {
			message:
				"Already have an active chat plan. Please upgrade or cancel first.",
		});
	}

	const priceId = getChatPlanPriceId(tier);
	if (!priceId) {
		throw new HTTPException(500, {
			message: `STRIPE_CHAT_PLAN_${tier.toUpperCase()}_PRICE_ID environment variable is not set`,
		});
	}

	const stripeCustomerId = await ensureStripeCustomer(personalOrg.id);

	let session;
	try {
		session = await getStripe().checkout.sessions.create({
			customer: stripeCustomerId,
			mode: "subscription",
			line_items: [
				{
					price: priceId,
					quantity: 1,
				},
			],
			allow_promotion_codes: true,
			success_url: `${process.env.PLAYGROUND_URL ?? "http://localhost:3003"}/?chat_plan_success=true`,
			cancel_url: `${process.env.PLAYGROUND_URL ?? "http://localhost:3003"}/pricing?canceled=true`,
			metadata: {
				organizationId: personalOrg.id,
				subscriptionType: "chat_plan",
				chatPlan: tier,
				chatPlanCycle: "monthly",
				userEmail: user.email,
			},
			subscription_data: {
				metadata: {
					organizationId: personalOrg.id,
					subscriptionType: "chat_plan",
					chatPlan: tier,
					chatPlanCycle: "monthly",
					userEmail: user.email,
				},
			},
		});
	} catch (error) {
		// Only Stripe's checkout call is wrapped: log the upstream failure and
		// surface a generic message rather than echoing the raw error to the
		// client. HTTPExceptions raised below propagate to the global handler.
		logger.error(
			"Stripe checkout session error for chat plan",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to create checkout session",
		});
	}

	if (!session.url) {
		throw new HTTPException(500, {
			message: "Failed to generate checkout URL",
		});
	}

	await logAuditEvent({
		organizationId: personalOrg.id,
		userId: user.id,
		action: "chat_plan.subscribe",
		resourceType: "chat_plan",
		metadata: {
			tier,
		},
	});

	return c.json({
		checkoutUrl: session.url,
	});
});

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
			description: "Chat plan subscription cancelled successfully",
		},
	},
});

chatPlans.openapi(cancel, async (c) => {
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
		(uo) => uo.organization?.kind === "chat",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (!personalOrg.chatPlanStripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active chat plan subscription found",
		});
	}

	try {
		await getStripe().subscriptions.update(
			personalOrg.chatPlanStripeSubscriptionId,
			{
				cancel_at_period_end: true,
			},
		);

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "chat_plan.cancel",
			resourceType: "chat_plan",
			resourceId: personalOrg.chatPlanStripeSubscriptionId,
			metadata: {
				tier: personalOrg.chatPlan,
			},
		});

		await new Promise((resolve) => {
			setTimeout(resolve, 3000);
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		logger.error(
			"Stripe chat plan cancellation error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to cancel chat plan subscription",
		});
	}
});

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
			description: "Chat plan subscription resumed successfully",
		},
	},
});

chatPlans.openapi(resume, async (c) => {
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
		(uo) => uo.organization?.kind === "chat",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (!personalOrg.chatPlanStripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No chat plan subscription found",
		});
	}

	try {
		const subscription = await getStripe().subscriptions.retrieve(
			personalOrg.chatPlanStripeSubscriptionId,
		);

		if (!subscription.cancel_at_period_end) {
			throw new HTTPException(400, {
				message: "Subscription is not cancelled",
			});
		}

		await getStripe().subscriptions.update(
			personalOrg.chatPlanStripeSubscriptionId,
			{
				cancel_at_period_end: false,
			},
		);

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "chat_plan.resume",
			resourceType: "chat_plan",
			resourceId: personalOrg.chatPlanStripeSubscriptionId,
			metadata: {
				tier: personalOrg.chatPlan,
			},
		});

		await new Promise((resolve) => {
			setTimeout(resolve, 3000);
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		logger.error(
			"Stripe chat plan resume error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to resume chat plan subscription",
		});
	}
});

const changeTier = createRoute({
	method: "post",
	path: "/change-tier",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						newTier: z.enum(["starter", "plus", "pro"]),
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
			description: "Chat plan tier changed successfully",
		},
	},
});

chatPlans.openapi(changeTier, async (c) => {
	const user = c.get("user");
	const { newTier } = c.req.valid("json");

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
		(uo) => uo.organization?.kind === "chat",
	)?.organization;

	if (!personalOrg) {
		throw new HTTPException(404, {
			message: "Personal organization not found",
		});
	}

	if (!personalOrg.chatPlanStripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active chat plan subscription found",
		});
	}

	if (personalOrg.chatPlan === newTier) {
		throw new HTTPException(400, {
			message: `Already on ${newTier} plan`,
		});
	}

	const newPriceId = getChatPlanPriceId(newTier);
	if (!newPriceId) {
		throw new HTTPException(500, {
			message: `STRIPE_CHAT_PLAN_${newTier.toUpperCase()}_PRICE_ID environment variable is not set`,
		});
	}

	const isUpgrade =
		CHAT_PLAN_PRICES[newTier] >
		CHAT_PLAN_PRICES[personalOrg.chatPlan as ChatPlanTier];

	try {
		const subscription = await getStripe().subscriptions.retrieve(
			personalOrg.chatPlanStripeSubscriptionId,
		);
		const subscriptionItemId = subscription.items.data[0].id;
		const newCreditsLimit = getChatPlanCreditsLimit(newTier);

		if (isUpgrade) {
			// Charge the full new-tier price today and start a fresh billing cycle
			// (`billing_cycle_anchor: "now"`) with no proration
			// (`proration_behavior: "none"`). `error_if_incomplete` makes the update
			// atomic, so a declined card leaves the subscription on the old tier.
			const updated = await getStripe().subscriptions.update(
				personalOrg.chatPlanStripeSubscriptionId,
				{
					items: [{ id: subscriptionItemId, price: newPriceId }],
					proration_behavior: "none",
					billing_cycle_anchor: "now",
					payment_behavior: "error_if_incomplete",
					metadata: {
						...subscription.metadata,
						chatPlan: newTier,
						chatPlanCycle: "monthly",
					},
				},
			);

			if (updated.status !== "active" && updated.status !== "trialing") {
				throw new HTTPException(402, {
					message:
						"Upgrade payment could not be collected. Update your payment method and try again.",
				});
			}

			// Fresh billing cycle: reset credits to the new tier's full allowance,
			// zero out usage, and advance the cycle start. The resulting
			// `subscription_update` invoice is recorded and emailed by the webhook
			// (handleInvoicePaymentSucceeded), keyed on its unique stripeInvoiceId, so
			// we don't insert an upgrade transaction here.
			await db
				.update(tables.organization)
				.set({
					chatPlan: newTier,
					chatPlanCreditsLimit: newCreditsLimit.toString(),
					chatPlanCreditsUsed: "0",
					chatPlanBillingCycleStart: new Date(),
				})
				.where(eq(tables.organization.id, personalOrg.id));
		} else {
			// Downgrade: unchanged behavior. Take effect immediately with Stripe
			// proration crediting the unused higher-tier time on the next invoice.
			await getStripe().subscriptions.update(
				personalOrg.chatPlanStripeSubscriptionId,
				{
					items: [{ id: subscriptionItemId, price: newPriceId }],
					proration_behavior: "create_prorations",
					payment_behavior: "allow_incomplete",
					metadata: {
						...subscription.metadata,
						chatPlan: newTier,
						chatPlanCycle: "monthly",
					},
				},
			);

			await db
				.update(tables.organization)
				.set({
					chatPlan: newTier,
					chatPlanCreditsLimit: newCreditsLimit.toString(),
				})
				.where(eq(tables.organization.id, personalOrg.id));

			await db.insert(tables.transaction).values({
				organizationId: personalOrg.id,
				type: "chat_plan_downgrade",
				description: `Changed from ${personalOrg.chatPlan} to ${newTier} plan`,
				status: "completed",
			});
		}

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "chat_plan.change_tier",
			resourceType: "chat_plan",
			resourceId: personalOrg.chatPlanStripeSubscriptionId,
			metadata: {
				changes: {
					tier: { old: personalOrg.chatPlan, new: newTier },
				},
			},
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		if (error instanceof HTTPException) {
			throw error;
		}
		// A declined card / required invoice payment is an expected user-facing
		// outcome, not a server fault: surface it as a 402 and log at warn — never
		// error — to avoid noisy alerts for declined cards.
		const errCode =
			typeof error === "object" && error !== null && "code" in error
				? String((error as { code?: unknown }).code)
				: undefined;
		if (errCode === "card_declined" || errCode === "invoice_payment_required") {
			logger.warn("Chat plan tier change payment declined", {
				code: errCode,
			});
			throw new HTTPException(402, {
				message:
					"Upgrade payment could not be collected. Update your payment method and try again.",
			});
		}
		logger.error(
			"Stripe chat plan tier change error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to change chat plan tier",
		});
	}
});

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
						chatPlan: z.enum(["none", "starter", "plus", "pro"]),
						chatPlanCycle: z.enum(["monthly"]),
						chatPlanCreditsUsed: z.string(),
						chatPlanCreditsLimit: z.string(),
						chatPlanCreditsRemaining: z.string(),
						chatPlanBillingCycleStart: z.string().nullable(),
						chatPlanCancelled: z.boolean(),
						chatPlanExpiresAt: z.string().nullable(),
						regularCredits: z.string(),
						organizationId: z.string().nullable(),
					}),
				},
			},
			description: "Chat plan status retrieved successfully",
		},
	},
});

chatPlans.openapi(getStatus, async (c) => {
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
		(uo) => uo.organization?.kind === "chat",
	)?.organization;

	if (!personalOrg) {
		return c.json({
			hasPersonalOrg: false,
			chatPlan: "none" as const,
			chatPlanCycle: "monthly" as const,
			chatPlanCreditsUsed: "0",
			chatPlanCreditsLimit: "0",
			chatPlanCreditsRemaining: "0",
			chatPlanBillingCycleStart: null,
			chatPlanCancelled: false,
			chatPlanExpiresAt: null,
			regularCredits: "0",
			organizationId: null,
		});
	}

	const creditsUsed = parseFloat(personalOrg.chatPlanCreditsUsed);
	const creditsLimit = parseFloat(personalOrg.chatPlanCreditsLimit);
	const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);

	return c.json({
		hasPersonalOrg: true,
		chatPlan: personalOrg.chatPlan,
		chatPlanCycle: personalOrg.chatPlanCycle,
		chatPlanCreditsUsed: personalOrg.chatPlanCreditsUsed,
		chatPlanCreditsLimit: personalOrg.chatPlanCreditsLimit,
		chatPlanCreditsRemaining: creditsRemaining.toFixed(2),
		chatPlanBillingCycleStart:
			personalOrg.chatPlanBillingCycleStart?.toISOString() ?? null,
		chatPlanCancelled: personalOrg.chatPlanCancelled,
		chatPlanExpiresAt: personalOrg.chatPlanExpiresAt?.toISOString() ?? null,
		regularCredits: personalOrg.credits,
		organizationId: personalOrg.id,
	});
});
