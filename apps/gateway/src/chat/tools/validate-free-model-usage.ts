// Helper function to validate free model usage
import { HTTPException } from "hono/http-exception";

import { checkFreeModelRateLimit } from "@/lib/rate-limit.js";

import { logger } from "@llmgateway/logger";

import { getUserFromOrganization } from "./get-user-from-organization.js";

import type { ServerTypes } from "@/vars.js";
import type { ModelDefinition } from "@llmgateway/models";
import type { Context } from "hono";

export async function validateFreeModelUsage(
	c: Context<ServerTypes>,
	organizationId: string,
	requestedModel: string,
	modelInfo: ModelDefinition,
) {
	const user = await getUserFromOrganization(organizationId);
	if (!user) {
		logger.error("User not found", { organizationId });
		throw new HTTPException(500, {
			message: "User not found",
		});
	}
	if (!user.emailVerified) {
		throw new HTTPException(403, {
			message:
				"Email verification required to use free models. Please verify your email address.",
		});
	}

	// Check rate limits for free models
	const rateLimitResult = await checkFreeModelRateLimit(
		organizationId,
		requestedModel,
		modelInfo,
	);

	// Always set limit and remaining headers
	c.header("X-RateLimit-Limit", rateLimitResult.limit.toString());
	c.header("X-RateLimit-Remaining", rateLimitResult.remaining.toString());

	if (!rateLimitResult.allowed) {
		// Only set retry and reset headers when rate limited
		const retryAfter = rateLimitResult.retryAfter;
		if (retryAfter) {
			c.header("Retry-After", retryAfter.toString());
			const resetTime = Math.floor(Date.now() / 1000) + retryAfter;
			c.header("X-RateLimit-Reset", resetTime.toString());
		}

		throw new HTTPException(429, {
			message: "Rate limit exceeded for free models. Please try again later.",
		});
	}
}
