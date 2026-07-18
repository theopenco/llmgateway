import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";

import {
	findApiKeyByToken,
	findOrganizationById,
	findProjectById,
} from "@/lib/cached-queries.js";
import { extractApiToken } from "@/lib/extract-api-token.js";

import {
	DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
	getDevPlanPremiumWeeklyLimit,
	isPremiumWeekExpired,
} from "@llmgateway/shared";

import type { ServerTypes } from "@/vars.js";
import type { DevPlanTier } from "@llmgateway/shared";

const keyErrorSchema = z.object({
	error: z.object({
		message: z.string(),
		type: z.string(),
		param: z.string().nullable(),
		code: z.string(),
	}),
});

const keyStatusSchema = z
	.object({
		devPlan: z.enum(["none", "lite", "pro", "max"]).openapi({
			description:
				"DevPass plan tier of the organization behind the API key, or 'none' when the organization has no active dev plan.",
			example: "pro",
		}),
		devPlanCreditsUsed: z.string().openapi({
			description: "Plan credits used in the current billing cycle (USD).",
			example: "42.13",
		}),
		devPlanCreditsLimit: z.string().openapi({
			description: "Total plan credit allowance per billing cycle (USD).",
			example: "237.00",
		}),
		devPlanCreditsRemaining: z.string().openapi({
			description: "Plan credits remaining in the current billing cycle (USD).",
			example: "194.87",
		}),
		devPlanPremiumWeeklyLimit: z.string().openapi({
			description:
				"Weekly fair-use allowance for premium-tier models (USD). '0.00' when there is no active dev plan.",
			example: "35.55",
		}),
		devPlanPremiumCreditsUsed: z.string().openapi({
			description:
				"Premium-tier model usage in the current weekly window (USD). Reports '0.00' when the window has expired and the full allowance is available again.",
			example: "12.50",
		}),
		devPlanPremiumWeekResetsAt: z.string().nullable().openapi({
			description:
				"ISO timestamp when the current weekly premium window resets, or null when no window is active.",
			example: "2026-07-21T09:00:00.000Z",
		}),
	})
	.openapi({
		description:
			"DevPass plan status for the organization behind the bearer API key.",
	});

export const key = new OpenAPIHono<ServerTypes>();

// API-key-authenticated read-only plan status, following OpenRouter's
// GET /v1/key precedent. Deliberately returns a reduced subset of the
// session-authenticated GET /dev-plans/status response: an API key is a
// lower-privilege credential than a dashboard session, so billing details,
// invoices, payment info, and the key echo are all excluded.
const getKeyStatus = createRoute({
	operationId: "v1_key",
	summary: "Key plan status",
	description:
		"Returns the DevPass plan status (remaining plan credits and weekly premium usage) for the organization behind the bearer API key. Read-only and safe to expose to third-party client integrations: it excludes billing details, invoices, payment information, and the API key itself.",
	method: "get",
	path: "/",
	security: [
		{
			bearerAuth: [],
		},
	],
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: keyStatusSchema,
				},
			},
			description: "Plan status for the API key's organization.",
		},
		401: {
			content: {
				"application/json": {
					schema: keyErrorSchema,
				},
			},
			description: "Missing, invalid, or inactive API key.",
		},
		410: {
			content: {
				"application/json": {
					schema: keyErrorSchema,
				},
			},
			description: "Archived project or disabled organization.",
		},
		500: {
			content: {
				"application/json": {
					schema: keyErrorSchema,
				},
			},
			description: "Internal server error.",
		},
	},
});

key.openapi(getKeyStatus, async (c) => {
	const token = extractApiToken(c);
	const apiKey = await findApiKeyByToken(token);

	if (!apiKey) {
		throw new HTTPException(401, {
			message:
				"Unauthorized: Invalid LLMGateway API token. The token could not be found. Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	if (apiKey.status !== "active") {
		throw new HTTPException(401, {
			message:
				"Unauthorized: This LLMGateway API token is not active (it may be disabled or deleted). Go to the LLMGateway 'API Keys' page to generate a new token.",
		});
	}

	const project = await findProjectById(apiKey.projectId);
	if (!project) {
		throw new HTTPException(500, {
			message: "Could not find project",
		});
	}

	if (project.status === "deleted") {
		throw new HTTPException(410, {
			message: "Project has been archived and is no longer accessible",
		});
	}

	const organization = await findOrganizationById(project.organizationId);
	if (!organization) {
		throw new HTTPException(500, {
			message: "Could not find organization",
		});
	}

	if (organization.status === "deleted") {
		throw new HTTPException(410, {
			message: "Organization has been disabled and is no longer accessible",
		});
	}

	const creditsUsed = parseFloat(organization.devPlanCreditsUsed ?? "0");
	const creditsLimit = parseFloat(organization.devPlanCreditsLimit ?? "0");
	const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);

	// Weekly premium fair-use allowance, computed with the same helpers the
	// session status endpoint and gateway enforcement use. An expired window
	// reports zero usage and no reset date — the full allowance is already
	// available again.
	const premiumWeeklyLimit =
		organization.devPlan !== "none"
			? getDevPlanPremiumWeeklyLimit(organization.devPlan as DevPlanTier)
			: 0;
	const premiumWeekExpired = isPremiumWeekExpired(
		organization.devPlanPremiumWeekStart,
	);
	const premiumCreditsUsed = premiumWeekExpired
		? 0
		: parseFloat(organization.devPlanPremiumCreditsUsed ?? "0");
	const premiumWeekResetsAt =
		!premiumWeekExpired && organization.devPlanPremiumWeekStart
			? new Date(
					new Date(organization.devPlanPremiumWeekStart).getTime() +
						DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
				).toISOString()
			: null;

	return c.json(
		{
			devPlan: organization.devPlan,
			devPlanCreditsUsed: organization.devPlanCreditsUsed,
			devPlanCreditsLimit: organization.devPlanCreditsLimit,
			devPlanCreditsRemaining: creditsRemaining.toFixed(2),
			devPlanPremiumWeeklyLimit: premiumWeeklyLimit.toFixed(2),
			devPlanPremiumCreditsUsed: premiumCreditsUsed.toFixed(2),
			devPlanPremiumWeekResetsAt: premiumWeekResetsAt,
		},
		200,
	);
});
