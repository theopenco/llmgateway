import { findOrganizationById } from "@/lib/cached-queries.js";
import {
	buildAnthropicErrorBody,
	buildOpenAIErrorBody,
} from "@/lib/error-response.js";
import { parseApiToken } from "@/lib/extract-api-token.js";
import {
	checkOrgRateLimit,
	getOrganizationLifetimeSpend,
	getSpendTierMultiplier,
	isOrgRateLimitEnabled,
	resolveOrganizationIdForToken,
	resolvePathRateLimit,
} from "@/lib/org-rate-limit.js";

import type { ServerTypes } from "@/vars.js";
import type { Context, Next } from "hono";

/**
 * Per-organization, per-path rate limiting middleware for the gateway.
 *
 * - Only `/v1/*` endpoints with a configured limit are throttled; other paths
 *   (health, metrics, docs, mcp/oauth) pass through.
 * - Enterprise organizations are exempt.
 * - Limits scale with the organization's lifetime spend tier.
 * - Requests without a resolvable API token are passed through so the
 *   downstream handler can return the appropriate auth error.
 */
export async function orgRateLimitMiddleware(
	c: Context<ServerTypes>,
	next: Next,
) {
	if (!isOrgRateLimitEnabled()) {
		return await next();
	}

	const config = resolvePathRateLimit(c.req.path);
	if (!config) {
		return await next();
	}

	const token = parseApiToken(c);
	if (!token) {
		return await next();
	}

	const organizationId = await resolveOrganizationIdForToken(token);
	if (!organizationId) {
		return await next();
	}

	const organization = await findOrganizationById(organizationId);
	if (!organization) {
		return await next();
	}

	// Enterprise organizations are excluded from gateway rate limits.
	if (organization.plan === "enterprise") {
		return await next();
	}

	const lifetimeSpend = await getOrganizationLifetimeSpend(organizationId);
	const { multiplier } = getSpendTierMultiplier(lifetimeSpend);

	const result = await checkOrgRateLimit(organizationId, config, multiplier);

	if (!result.allowed) {
		const retryAfter = result.retryAfter ?? 60;
		const message = `Rate limit exceeded for ${c.req.path}. Please retry after ${retryAfter} seconds.`;
		const headers: Record<string, string> = {
			"Retry-After": String(retryAfter),
			"X-RateLimit-Limit": String(result.limit),
			"X-RateLimit-Remaining": "0",
		};

		if (c.req.path.startsWith("/v1/messages")) {
			return c.json(
				buildAnthropicErrorBody({ message, status: 429 }),
				429,
				headers,
			);
		}
		return c.json(buildOpenAIErrorBody({ message, status: 429 }), 429, headers);
	}

	return await next();
}
