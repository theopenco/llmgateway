import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { ensureStripeCustomer } from "@/stripe.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, tables, eq, shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	DEV_PLAN_PRICES,
	getDevPlanCreditsLimit,
	type DevPlanTier,
} from "@llmgateway/shared";

import { getStripe } from "./payments.js";

import type { ServerTypes } from "@/vars.js";

export const devPlans = new OpenAPIHono<ServerTypes>();

interface User {
	id: string;
	email: string;
	emailVerified?: boolean;
}

// Helper to get or create personal organization for a user
// Uses a transaction to ensure atomicity when creating org, membership, and project
async function getOrCreatePersonalOrg(user: User) {
	// Find existing personal org for user
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	const existingPersonalOrg = userOrgs.find(
		(uo) => uo.organization?.isPersonal === true,
	);

	if (existingPersonalOrg?.organization) {
		return existingPersonalOrg.organization;
	}

	// Create new personal org with transaction for atomicity
	return await db.transaction(async (tx) => {
		const [newOrg] = await tx
			.insert(tables.organization)
			.values({
				name: "Personal",
				isPersonal: true,
				billingEmail: user.email,
			})
			.returning();

		await tx.insert(tables.userOrganization).values({
			userId: user.id,
			organizationId: newOrg.id,
			role: "owner",
		});

		await tx.insert(tables.project).values({
			name: "Default Project",
			organizationId: newOrg.id,
			mode: "credits",
		});

		return newOrg;
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

function getDevPlanPriceId(tier: DevPlanTier): string | undefined {
	const envKeys: Record<DevPlanTier, string> = {
		lite: "STRIPE_DEV_PLAN_LITE_PRICE_ID",
		pro: "STRIPE_DEV_PLAN_PRO_PRICE_ID",
		max: "STRIPE_DEV_PLAN_MAX_PRICE_ID",
	};
	return process.env[envKeys[tier]];
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
						isPersonal: z.boolean(),
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
		isPersonal: org.isPersonal,
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

	const priceId = getDevPlanPriceId(tier);
	if (!priceId) {
		throw new HTTPException(500, {
			message: `STRIPE_DEV_PLAN_${tier.toUpperCase()}_PRICE_ID environment variable is not set`,
		});
	}

	try {
		const stripeCustomerId = await ensureStripeCustomer(personalOrg.id);

		const session = await getStripe().checkout.sessions.create({
			customer: stripeCustomerId,
			mode: "subscription",
			line_items: [
				{
					price: priceId,
					quantity: 1,
				},
			],
			allow_promotion_codes: true,
			success_url: `${process.env.CODE_URL ?? "http://localhost:3004"}/dashboard?success=true`,
			cancel_url: `${process.env.CODE_URL ?? "http://localhost:3004"}/dashboard/plans?canceled=true`,
			metadata: {
				organizationId: personalOrg.id,
				subscriptionType: "dev_plan",
				devPlan: tier,
				userEmail: user.email,
			},
			subscription_data: {
				metadata: {
					organizationId: personalOrg.id,
					subscriptionType: "dev_plan",
					devPlan: tier,
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
		(uo) => uo.organization?.isPersonal === true,
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
		(uo) => uo.organization?.isPersonal === true,
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

// Upgrade or downgrade dev plan tier
const changeTier = createRoute({
	method: "post",
	path: "/change-tier",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						newTier: z.enum(["lite", "pro", "max"]),
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
			description: "Dev plan tier changed successfully",
		},
	},
});

devPlans.openapi(changeTier, async (c) => {
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
		(uo) => uo.organization?.isPersonal === true,
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

	const newPriceId = getDevPlanPriceId(newTier);
	if (!newPriceId) {
		throw new HTTPException(500, {
			message: `STRIPE_DEV_PLAN_${newTier.toUpperCase()}_PRICE_ID environment variable is not set`,
		});
	}

	try {
		const subscription = await getStripe().subscriptions.retrieve(
			personalOrg.devPlanStripeSubscriptionId,
		);

		// Update subscription with new tier
		await getStripe().subscriptions.update(
			personalOrg.devPlanStripeSubscriptionId,
			{
				items: [
					{
						id: subscription.items.data[0].id,
						price: newPriceId,
					},
				],
				proration_behavior: "create_prorations",
				metadata: {
					...subscription.metadata,
					devPlan: newTier,
				},
			},
		);

		// Update local database immediately
		const newCreditsLimit = getDevPlanCreditsLimit(newTier);
		const isUpgrade =
			DEV_PLAN_PRICES[newTier] >
			DEV_PLAN_PRICES[personalOrg.devPlan as DevPlanTier];

		await db
			.update(tables.organization)
			.set({
				devPlan: newTier,
				devPlanCreditsLimit: newCreditsLimit.toString(),
			})
			.where(eq(tables.organization.id, personalOrg.id));

		// Record transaction
		await db.insert(tables.transaction).values({
			organizationId: personalOrg.id,
			type: isUpgrade ? "dev_plan_upgrade" : "dev_plan_downgrade",
			description: `Changed from ${personalOrg.devPlan} to ${newTier} plan`,
			status: "completed",
		});

		await logAuditEvent({
			organizationId: personalOrg.id,
			userId: user.id,
			action: "dev_plan.change_tier",
			resourceType: "dev_plan",
			resourceId: personalOrg.devPlanStripeSubscriptionId,
			metadata: {
				changes: {
					tier: { old: personalOrg.devPlan, new: newTier },
				},
			},
		});

		return c.json({
			success: true,
		});
	} catch (error) {
		logger.error(
			"Stripe dev plan tier change error",
			error instanceof Error ? error : new Error(String(error)),
		);
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
						devPlanCreditsUsed: z.string(),
						devPlanCreditsLimit: z.string(),
						devPlanCreditsRemaining: z.string(),
						devPlanBillingCycleStart: z.string().nullable(),
						devPlanCancelled: z.boolean(),
						devPlanExpiresAt: z.string().nullable(),
						regularCredits: z.string(),
						organizationId: z.string().nullable(),
						apiKey: z.string().nullable(),
						devPlanAllowAllModels: z.boolean(),
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
		(uo) => uo.organization?.isPersonal === true,
	)?.organization;

	if (!personalOrg) {
		return c.json({
			hasPersonalOrg: false,
			devPlan: "none" as const,
			devPlanCreditsUsed: "0",
			devPlanCreditsLimit: "0",
			devPlanCreditsRemaining: "0",
			devPlanBillingCycleStart: null,
			devPlanCancelled: false,
			devPlanExpiresAt: null,
			regularCredits: "0",
			organizationId: null,
			apiKey: null,
			devPlanAllowAllModels: false,
		});
	}

	const creditsUsed = parseFloat(personalOrg.devPlanCreditsUsed);
	const creditsLimit = parseFloat(personalOrg.devPlanCreditsLimit);
	const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);

	// Get API key if user has an active dev plan
	let apiKey: string | null = null;
	if (personalOrg.devPlan !== "none") {
		// Find the default project for this org
		const project = await db.query.project.findFirst({
			where: {
				organizationId: {
					eq: personalOrg.id,
				},
			},
		});

		if (project) {
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
		devPlanCreditsUsed: personalOrg.devPlanCreditsUsed,
		devPlanCreditsLimit: personalOrg.devPlanCreditsLimit,
		devPlanCreditsRemaining: creditsRemaining.toFixed(2),
		devPlanBillingCycleStart:
			personalOrg.devPlanBillingCycleStart?.toISOString() ?? null,
		devPlanCancelled: personalOrg.devPlanCancelled,
		devPlanExpiresAt: personalOrg.devPlanExpiresAt?.toISOString() ?? null,
		regularCredits: personalOrg.credits,
		organizationId: personalOrg.id,
		apiKey,
		devPlanAllowAllModels: personalOrg.devPlanAllowAllModels,
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
					}),
				},
			},
			description: "Dev plan settings updated successfully",
		},
	},
});

devPlans.openapi(updateSettings, async (c) => {
	const user = c.get("user");
	const { devPlanAllowAllModels } = c.req.valid("json");

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
		(uo) => uo.organization?.isPersonal === true,
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

	const updateData: { devPlanAllowAllModels?: boolean } = {};

	if (devPlanAllowAllModels !== undefined) {
		updateData.devPlanAllowAllModels = devPlanAllowAllModels;
	}

	if (Object.keys(updateData).length > 0) {
		await db
			.update(tables.organization)
			.set(updateData)
			.where(eq(tables.organization.id, personalOrg.id));

		const changes: Record<string, { old: unknown; new: unknown }> = {};
		if (
			devPlanAllowAllModels !== undefined &&
			devPlanAllowAllModels !== personalOrg.devPlanAllowAllModels
		) {
			changes.devPlanAllowAllModels = {
				old: personalOrg.devPlanAllowAllModels,
				new: devPlanAllowAllModels,
			};
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
	}

	return c.json({
		success: true,
		devPlanAllowAllModels:
			devPlanAllowAllModels ?? personalOrg.devPlanAllowAllModels,
	});
});
