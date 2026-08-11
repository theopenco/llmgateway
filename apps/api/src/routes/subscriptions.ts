import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { ensureStripeCustomer } from "@/stripe.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	PRO_PLAN_MAX_EXTRA_API_KEYS,
	PRO_PLAN_MAX_SEATS,
} from "@llmgateway/shared";

import { getStripe } from "./payments.js";

import type { ServerTypes } from "@/vars.js";
import type Stripe from "stripe";

export const subscriptions = new OpenAPIHono<ServerTypes>();

// Self-serve Pro configuration: seats (each including one API key), extra API
// keys beyond the per-seat allowance, and the flat SSO & SCIM add-on.
const proSelectionSchema = z.object({
	seats: z.number().int().min(1).max(PRO_PLAN_MAX_SEATS),
	extraApiKeys: z
		.number()
		.int()
		.min(0)
		.max(PRO_PLAN_MAX_EXTRA_API_KEYS)
		.optional()
		.default(0),
	ssoAddon: z.boolean().optional().default(false),
});

export function getProPriceIds(): {
	seat: string;
	extraApiKey: string;
	sso: string;
} {
	const seat = process.env.STRIPE_PRO_SEAT_PRICE_ID;
	const extraApiKey = process.env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID;
	const sso = process.env.STRIPE_PRO_SSO_PRICE_ID;
	if (!seat || !extraApiKey || !sso) {
		throw new HTTPException(500, {
			message:
				"Pro plan price IDs are not configured (STRIPE_PRO_SEAT_PRICE_ID, STRIPE_PRO_EXTRA_API_KEY_PRICE_ID, STRIPE_PRO_SSO_PRICE_ID)",
		});
	}
	return { seat, extraApiKey, sso };
}

// Resolve the organization the request acts on. `organizationId` scopes the
// lookup for users in multiple organizations; without it the user's first
// membership is used (the historical behavior of these endpoints).
async function resolveUserOrganization(
	userId: string,
	organizationId: string | undefined,
) {
	const userOrganization = await db.query.userOrganization.findFirst({
		where: organizationId
			? { userId: { eq: userId }, organizationId: { eq: organizationId } }
			: { userId: { eq: userId } },
		with: {
			organization: true,
		},
	});

	const organization = userOrganization?.organization;
	if (!userOrganization || !organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	return { role: userOrganization.role, organization };
}

function assertOwner(role: string) {
	if (role !== "owner") {
		throw new HTTPException(403, {
			message: "Only owners can manage subscriptions",
		});
	}
}

// A Pro configuration must cover what the organization already uses: every
// member (and pending invite) needs a seat, and every active developer API key
// must be covered by a seat's included key or a purchased extra key.
async function assertSelectionCoversUsage(
	organizationId: string,
	seats: number,
	extraApiKeys: number,
) {
	const [members, invites, orgProjects] = await Promise.all([
		db.query.userOrganization.findMany({
			where: { organizationId: { eq: organizationId } },
			columns: { id: true },
		}),
		db.query.organizationInvite.findMany({
			where: {
				organizationId: { eq: organizationId },
				status: { eq: "pending" },
			},
			columns: { expiresAt: true },
		}),
		db.query.project.findMany({
			where: { organizationId: { eq: organizationId } },
			columns: { id: true },
		}),
	]);

	const now = new Date();
	const seatsUsed =
		members.length + invites.filter((i) => i.expiresAt > now).length;

	if (seats < seatsUsed) {
		throw new HTTPException(400, {
			message: `Your organization currently uses ${seatsUsed} seats (members plus pending invites). Select at least ${seatsUsed} seats or remove members first.`,
		});
	}

	const activeKeys = orgProjects.length
		? await db.query.apiKey.findMany({
				where: {
					projectId: { in: orgProjects.map((p) => p.id) },
					status: { eq: "active" },
					keyType: { eq: "user" },
				},
				columns: { id: true },
			})
		: [];

	if (seats + extraApiKeys < activeKeys.length) {
		throw new HTTPException(400, {
			message: `Your organization has ${activeKeys.length} active API keys, but the selected plan only covers ${seats + extraApiKeys} (one per seat plus extra keys). Add extra API keys or delete unused keys first.`,
		});
	}
}

function buildProLineItems(selection: {
	seats: number;
	extraApiKeys: number;
	ssoAddon: boolean;
}): { price: string; quantity: number }[] {
	const priceIds = getProPriceIds();
	const lineItems = [{ price: priceIds.seat, quantity: selection.seats }];
	if (selection.extraApiKeys > 0) {
		lineItems.push({
			price: priceIds.extraApiKey,
			quantity: selection.extraApiKeys,
		});
	}
	if (selection.ssoAddon) {
		lineItems.push({ price: priceIds.sso, quantity: 1 });
	}
	return lineItems;
}

const createProSubscription = createRoute({
	method: "post",
	path: "/create-pro-subscription",
	request: {
		body: {
			content: {
				"application/json": {
					schema: proSelectionSchema.extend({
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

subscriptions.openapi(createProSubscription, async (c) => {
	const user = c.get("user");
	const { seats, extraApiKeys, ssoAddon, organizationId } = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Require email verification before subscribing to pro
	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message: "Email verification required",
		});
	}

	const userOrganization = await resolveUserOrganization(
		user.id,
		organizationId,
	);
	assertOwner(userOrganization.role);

	const organization = userOrganization.organization;

	// Block paid subscriptions for personal/chat orgs (dev/chat plans only)
	if (organization.kind !== "default") {
		throw new HTTPException(403, {
			message:
				"Paid subscriptions are not available for personal organizations. Please use Dev Plans at devpass.llmgateway.io or create a regular organization.",
		});
	}

	if (organization.plan === "enterprise") {
		throw new HTTPException(400, {
			message:
				"Your organization is on an enterprise plan. Contact us to change your agreement.",
		});
	}

	// Check if organization already has a pro subscription
	if (organization.plan === "pro" && organization.stripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "Organization already has an active pro subscription",
		});
	}

	await assertSelectionCoversUsage(organization.id, seats, extraApiKeys);

	try {
		const stripeCustomerId = await ensureStripeCustomer(organization.id);

		// Create Stripe Checkout session
		const session = await getStripe().checkout.sessions.create({
			customer: stripeCustomerId,
			mode: "subscription",
			line_items: buildProLineItems({ seats, extraApiKeys, ssoAddon }),
			allow_promotion_codes: true,
			success_url: `${process.env.UI_URL ?? "http://localhost:3002"}/dashboard/${organization.id}/org/billing?success=true`,
			cancel_url: `${process.env.UI_URL ?? "http://localhost:3002"}/dashboard/${organization.id}/org/billing?canceled=true`,
			metadata: {
				organizationId: organization.id,
				plan: "pro",
				userEmail: user.email,
			},
			subscription_data: {
				metadata: {
					organizationId: organization.id,
					plan: "pro",
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
			organizationId: organization.id,
			userId: user.id,
			action: "subscription.create",
			resourceType: "subscription",
			metadata: {
				seats,
				extraApiKeys,
				ssoAddon,
			},
		});

		return c.json({
			checkoutUrl: session.url,
		});
	} catch (error) {
		logger.error(
			"Stripe checkout session error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: `Failed to create checkout session: ${error}`,
		});
	}
});

const updateProSubscription = createRoute({
	method: "post",
	path: "/update-pro-subscription",
	request: {
		body: {
			content: {
				"application/json": {
					schema: proSelectionSchema.extend({
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
			description: "Pro subscription updated successfully",
		},
	},
});

subscriptions.openapi(updateProSubscription, async (c) => {
	const user = c.get("user");
	const { seats, extraApiKeys, ssoAddon, organizationId } = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrganization = await resolveUserOrganization(
		user.id,
		organizationId,
	);
	assertOwner(userOrganization.role);

	const organization = userOrganization.organization;

	if (organization.plan !== "pro" || !organization.stripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active pro subscription found",
		});
	}

	// Legacy flat-fee Pro subscriptions have no seat line item to adjust.
	if (organization.proSeats === null) {
		throw new HTTPException(400, {
			message:
				"Your legacy Pro subscription cannot be changed here. Cancel it first, then subscribe to the new per-seat Pro plan.",
		});
	}

	await assertSelectionCoversUsage(organization.id, seats, extraApiKeys);

	const priceIds = getProPriceIds();

	try {
		const stripe = getStripe();
		const subscription = await stripe.subscriptions.retrieve(
			organization.stripeSubscriptionId,
		);

		// Map the desired quantities onto the existing subscription items:
		// update quantities in place, add missing items, delete dropped ones.
		const desired: { price: string; quantity: number }[] = [
			{ price: priceIds.seat, quantity: seats },
			{ price: priceIds.extraApiKey, quantity: extraApiKeys },
			{ price: priceIds.sso, quantity: ssoAddon ? 1 : 0 },
		];

		const items: Stripe.SubscriptionUpdateParams.Item[] = [];
		for (const { price, quantity } of desired) {
			const existing = subscription.items.data.find(
				(item) => item.price.id === price,
			);
			if (existing && quantity > 0) {
				items.push({ id: existing.id, quantity });
			} else if (existing && quantity === 0) {
				items.push({ id: existing.id, deleted: true });
			} else if (!existing && quantity > 0) {
				items.push({ price, quantity });
			}
		}

		await stripe.subscriptions.update(organization.stripeSubscriptionId, {
			items,
			proration_behavior: "create_prorations",
		});

		// The subscription.updated webhook re-syncs these from Stripe as well;
		// writing them here makes the dashboard reflect the change immediately.
		await db
			.update(tables.organization)
			.set({
				proSeats: seats,
				proExtraApiKeys: extraApiKeys,
				proSsoEnabled: ssoAddon,
			})
			.where(eq(tables.organization.id, organization.id));

		await logAuditEvent({
			organizationId: organization.id,
			userId: user.id,
			action: "subscription.update",
			resourceType: "subscription",
			resourceId: organization.stripeSubscriptionId,
			metadata: {
				seats,
				extraApiKeys,
				ssoAddon,
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
			"Stripe subscription update error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to update subscription",
		});
	}
});

const cancelProSubscription = createRoute({
	method: "post",
	path: "/cancel-pro-subscription",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().optional(),
					}),
				},
			},
			required: false,
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
			description: "Pro subscription canceled successfully",
		},
	},
});

subscriptions.openapi(cancelProSubscription, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrganization = await resolveUserOrganization(
		user.id,
		body?.organizationId,
	);
	assertOwner(userOrganization.role);

	const organization = userOrganization.organization;

	if (!organization.stripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active subscription found",
		});
	}

	try {
		// Cancel the subscription at the end of the current period
		await getStripe().subscriptions.update(organization.stripeSubscriptionId, {
			cancel_at_period_end: true,
		});

		await logAuditEvent({
			organizationId: organization.id,
			userId: user.id,
			action: "subscription.cancel",
			resourceType: "subscription",
			resourceId: organization.stripeSubscriptionId,
		});

		// let the webhook handler the rest to unify the logic
		await new Promise((resolve) => {
			setTimeout(resolve, 5000);
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		logger.error(
			"Stripe subscription cancellation error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to cancel subscription",
		});
	}
});

const resumeProSubscription = createRoute({
	method: "post",
	path: "/resume-pro-subscription",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						organizationId: z.string().optional(),
					}),
				},
			},
			required: false,
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
			description: "Pro subscription resumed successfully",
		},
	},
});

subscriptions.openapi(resumeProSubscription, async (c) => {
	const user = c.get("user");
	const body = c.req.valid("json");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrganization = await resolveUserOrganization(
		user.id,
		body?.organizationId,
	);
	assertOwner(userOrganization.role);

	const organization = userOrganization.organization;

	if (!organization.stripeSubscriptionId) {
		throw new HTTPException(400, {
			message: "No active subscription found",
		});
	}

	try {
		// Check if subscription is actually cancelled
		const subscription = await getStripe().subscriptions.retrieve(
			organization.stripeSubscriptionId,
		);

		if (!subscription.cancel_at_period_end) {
			throw new HTTPException(400, {
				message: "Subscription is not cancelled",
			});
		}

		// Resume the subscription by setting cancel_at_period_end to false
		await getStripe().subscriptions.update(organization.stripeSubscriptionId, {
			cancel_at_period_end: false,
		});

		await logAuditEvent({
			organizationId: organization.id,
			userId: user.id,
			action: "subscription.resume",
			resourceType: "subscription",
			resourceId: organization.stripeSubscriptionId,
		});

		// let the webhook handler the rest to unify the logic
		await new Promise((resolve) => {
			setTimeout(resolve, 5000);
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		if (error instanceof HTTPException) {
			throw error;
		}
		logger.error(
			"Stripe subscription resume error",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw new HTTPException(500, {
			message: "Failed to resume subscription",
		});
	}
});

const getSubscriptionStatus = createRoute({
	method: "get",
	path: "/status",
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
						plan: z.enum(["free", "pro", "enterprise"]),
						subscriptionId: z.string().nullable(),
						planExpiresAt: z.string().nullable(),
						subscriptionCancelled: z.boolean(),
						billingCycle: z.enum(["monthly", "yearly"]).nullable(),
						// Seat-based Pro configuration; `seats` is null for free,
						// enterprise, and legacy flat-fee Pro organizations.
						seats: z.number().nullable(),
						extraApiKeys: z.number(),
						ssoAddon: z.boolean(),
					}),
				},
			},
			description: "Subscription status retrieved successfully",
		},
	},
});

subscriptions.openapi(getSubscriptionStatus, async (c) => {
	const user = c.get("user");
	const { organizationId } = c.req.valid("query");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const userOrganization = await resolveUserOrganization(
		user.id,
		organizationId,
	);

	const organization = userOrganization.organization;

	// Get billing cycle from Stripe subscription if available
	let billingCycle: "monthly" | "yearly" | null = null;
	if (organization.stripeSubscriptionId) {
		try {
			const subscription = await getStripe().subscriptions.retrieve(
				organization.stripeSubscriptionId,
			);
			const currentPriceId = subscription.items.data[0]?.price.id;
			const yearlyPriceId = process.env.STRIPE_PRO_YEARLY_PRICE_ID;
			if (!yearlyPriceId) {
				throw new HTTPException(500, {
					message: "STRIPE_PRO_YEARLY_PRICE_ID environment variable is not set",
				});
			}
			billingCycle = currentPriceId === yearlyPriceId ? "yearly" : "monthly";
		} catch (error) {
			logger.error(
				"Error fetching subscription details",
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}

	return c.json({
		plan: organization.plan || "free",
		subscriptionId: organization.stripeSubscriptionId,
		planExpiresAt: organization.planExpiresAt?.toISOString() ?? null,
		subscriptionCancelled: organization.subscriptionCancelled || false,
		billingCycle,
		seats: organization.proSeats,
		extraApiKeys: organization.proExtraApiKeys,
		ssoAddon: organization.proSsoEnabled,
	});
});
