import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const devPlanCancellationFeedback = new OpenAPIHono<ServerTypes>();

const reasonEnum = z.enum([
	"too_expensive",
	"missing_features",
	"not_using_enough",
	"switched_alternative",
	"other",
]);

async function findUserPersonalOrg(userId: string) {
	const userOrgs = await db.query.userOrganization.findMany({
		where: { userId: { eq: userId } },
		with: { organization: true },
	});
	return userOrgs.find((uo) => uo.organization?.isPersonal === true)
		?.organization;
}

const eligibilitySchema = z.object({
	eligible: z.boolean(),
	subscriptionId: z.string().nullable(),
	previousDevPlan: z.enum(["lite", "pro", "max"]).nullable(),
	existingFeedback: z
		.object({
			reason: reasonEnum,
			comments: z.string().nullable(),
			submittedAt: z.string(),
		})
		.nullable(),
});

const getEligibility = createRoute({
	method: "get",
	path: "/eligibility",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": { schema: eligibilitySchema },
			},
			description: "Whether the user can submit cancellation feedback",
		},
	},
});

devPlanCancellationFeedback.openapi(getEligibility, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const personalOrg = await findUserPersonalOrg(user.id);

	if (!personalOrg || !personalOrg.devPlanCancelled) {
		return c.json({
			eligible: false,
			subscriptionId: null,
			previousDevPlan: null,
			existingFeedback: null,
		});
	}

	const subscriptionId = personalOrg.devPlanStripeSubscriptionId;
	if (!subscriptionId) {
		return c.json({
			eligible: false,
			subscriptionId: null,
			previousDevPlan: null,
			existingFeedback: null,
		});
	}

	const previousDevPlan =
		personalOrg.devPlan === "lite" ||
		personalOrg.devPlan === "pro" ||
		personalOrg.devPlan === "max"
			? personalOrg.devPlan
			: null;

	const existing = await db.query.devPlanCancellationFeedback.findFirst({
		where: {
			organizationId: { eq: personalOrg.id },
			devPlanStripeSubscriptionId: { eq: subscriptionId },
		},
	});

	return c.json({
		eligible: true,
		subscriptionId,
		previousDevPlan,
		existingFeedback: existing
			? {
					reason: existing.reason,
					comments: existing.comments,
					submittedAt: existing.updatedAt.toISOString(),
				}
			: null,
	});
});

const submit = createRoute({
	method: "post",
	path: "/submit",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						reason: reasonEnum,
						comments: z.string().max(2000).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Feedback recorded",
		},
	},
});

devPlanCancellationFeedback.openapi(submit, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { reason, comments } = c.req.valid("json");

	const personalOrg = await findUserPersonalOrg(user.id);
	if (!personalOrg || !personalOrg.devPlanCancelled) {
		throw new HTTPException(400, {
			message: "No cancelled dev plan found for this user",
		});
	}

	const subscriptionId = personalOrg.devPlanStripeSubscriptionId;
	if (!subscriptionId) {
		throw new HTTPException(400, {
			message: "No dev plan subscription on record",
		});
	}

	const previousDevPlan =
		personalOrg.devPlan === "lite" ||
		personalOrg.devPlan === "pro" ||
		personalOrg.devPlan === "max"
			? personalOrg.devPlan
			: null;

	await db
		.insert(tables.devPlanCancellationFeedback)
		.values({
			organizationId: personalOrg.id,
			userId: user.id,
			devPlanStripeSubscriptionId: subscriptionId,
			previousDevPlan,
			reason,
			comments: comments ?? null,
		})
		.onConflictDoUpdate({
			target: [
				tables.devPlanCancellationFeedback.organizationId,
				tables.devPlanCancellationFeedback.devPlanStripeSubscriptionId,
			],
			set: {
				reason,
				comments: comments ?? null,
				userId: user.id,
				updatedAt: new Date(),
			},
		});

	return c.json({ success: true });
});
