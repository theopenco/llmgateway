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

export const key = new OpenAPIHono<ServerTypes>();

const keyResponseSchema = z.object({
	data: z.object({
		label: z.string().openapi({
			description: "Description of the API key used for the request.",
		}),
		usage: z.string().openapi({
			description: "Total usage in USD accrued by this API key.",
		}),
		limit: z.string().nullable().openapi({
			description: "Usage limit in USD set on this API key, if any.",
		}),
		devPlan: z.enum(["none", "lite", "pro", "max"]).openapi({
			description:
				"Dev plan tier of the organization this key belongs to. 'none' for pay-as-you-go organizations.",
		}),
		devPlanCreditsUsed: z.string().openapi({
			description: "Plan credits used in the current billing cycle, in USD.",
		}),
		devPlanCreditsLimit: z.string().openapi({
			description: "Plan credit allowance per billing cycle, in USD.",
		}),
		devPlanCreditsRemaining: z.string().openapi({
			description: "Plan credits remaining in the current billing cycle.",
		}),
		devPlanPremiumWeeklyLimit: z.string().openapi({
			description:
				"Weekly fair-use allowance for premium models, in USD of plan credits.",
		}),
		devPlanPremiumCreditsUsed: z.string().openapi({
			description:
				"Premium-model plan credits used in the current weekly window.",
		}),
		devPlanPremiumWeekResetsAt: z.string().nullable().openapi({
			description:
				"When the current premium weekly window resets (ISO 8601), or null when no window is active.",
		}),
	}),
});

const getKey = createRoute({
	operationId: "v1_key_retrieve",
	summary: "Retrieve key status",
	description:
		"Returns usage information for the API key used to authenticate the request, including the organization's dev plan allowance and weekly premium-model usage. Lets clients that only hold an API key surface remaining quota without a dashboard session. Deliberately excludes billing details and the key token itself.",
	method: "get",
	path: "/",
	security: [{ bearerAuth: [] }],
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: keyResponseSchema,
				},
			},
			description: "Status of the API key and its organization's dev plan.",
		},
	},
});

key.openapi(getKey, async (c) => {
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

	// Plan status is developer-key territory: embeddable-SDK principals
	// (publishable keys, end-user sessions) must not read org-level plan state
	// or the aggregate key's metadata.
	if (apiKey.keyType !== "user" || apiKey.endUserSession) {
		throw new HTTPException(403, {
			message: "This endpoint is only available for regular API keys.",
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

	// Per-key and per-member usage limits are deliberately NOT enforced here:
	// a client most needs to read remaining quota exactly when the key is
	// over its cap.

	const devPlan =
		organization.kind === "devpass" ? organization.devPlan : "none";

	if (devPlan === "none") {
		return c.json({
			data: {
				label: apiKey.description,
				usage: apiKey.usage,
				limit: apiKey.usageLimit,
				devPlan: "none" as const,
				devPlanCreditsUsed: "0",
				devPlanCreditsLimit: "0",
				devPlanCreditsRemaining: "0",
				devPlanPremiumWeeklyLimit: "0",
				devPlanPremiumCreditsUsed: "0",
				devPlanPremiumWeekResetsAt: null,
			},
		});
	}

	const creditsUsed = parseFloat(organization.devPlanCreditsUsed);
	const creditsLimit = parseFloat(organization.devPlanCreditsLimit);
	const creditsRemaining = Math.max(0, creditsLimit - creditsUsed);

	// Same semantics as GET /dev-plans/status on the API: an expired window
	// reports zero usage and no reset date — the full allowance is already
	// available again. The cached organization may round-trip timestamps as
	// strings, so re-wrap before doing date math.
	const premiumWeekStart = organization.devPlanPremiumWeekStart
		? new Date(organization.devPlanPremiumWeekStart)
		: null;
	const premiumWeeklyLimit = getDevPlanPremiumWeeklyLimit(devPlan);
	const premiumWeekExpired = isPremiumWeekExpired(premiumWeekStart);
	const premiumCreditsUsed = premiumWeekExpired
		? 0
		: parseFloat(organization.devPlanPremiumCreditsUsed ?? "0");
	const premiumWeekResetsAt =
		!premiumWeekExpired && premiumWeekStart
			? new Date(
					premiumWeekStart.getTime() + DEV_PLAN_PREMIUM_WEEK_LENGTH_MS,
				).toISOString()
			: null;

	return c.json({
		data: {
			label: apiKey.description,
			usage: apiKey.usage,
			limit: apiKey.usageLimit,
			devPlan,
			devPlanCreditsUsed: organization.devPlanCreditsUsed,
			devPlanCreditsLimit: organization.devPlanCreditsLimit,
			devPlanCreditsRemaining: creditsRemaining.toFixed(2),
			devPlanPremiumWeeklyLimit: premiumWeeklyLimit.toFixed(2),
			devPlanPremiumCreditsUsed: premiumCreditsUsed.toFixed(2),
			devPlanPremiumWeekResetsAt: premiumWeekResetsAt,
		},
	});
});
