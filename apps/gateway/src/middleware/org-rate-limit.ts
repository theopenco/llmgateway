import { isInternalApiOrigin } from "@/lib/api-origin.js";
import { findOrganizationCachedById } from "@/lib/cached-queries.js";
import {
	buildAnthropicErrorBody,
	buildOpenAIErrorBody,
} from "@/lib/error-response.js";
import { parseApiToken } from "@/lib/extract-api-token.js";
import {
	acquireOrgInflightSlot,
	checkOrgRateLimit,
	getOrganizationLifetimeSpend,
	getOrgInflightLimit,
	getOrgSpendTier,
	getPlanClass,
	INFLIGHT_LIMITED_KEYS,
	isOrgRateLimitEnabled,
	resolveOrganizationIdForToken,
	resolvePathRateLimit,
} from "@/lib/org-rate-limit.js";
import { runWithResponseCleanup } from "@/lib/response-cleanup.js";

import { gatewayRequestsShedTotal } from "@llmgateway/instrumentation";

import type { ServerTypes } from "@/vars.js";
import type { Context, Next } from "hono";

/**
 * Per-organization rate and concurrency limiting middleware for the gateway.
 *
 * Two limit families are enforced from one token → org resolution:
 *
 * Per-path RPM (sliding window):
 * - Only `/v1/*` endpoints with a configured limit are throttled; other paths
 *   (health, metrics, docs, mcp/oauth) pass through.
 * - Enterprise organizations are exempt.
 * - Dev ("devpass") and chat plan orgs get their own, much tighter per-path
 *   limits and are not eligible for the spend-tier multiplier.
 * - Regular (pay-as-you-go) org limits scale with their lifetime spend tier.
 *
 * In-flight concurrency (fleet-wide, inference endpoints only):
 * - One budget per org across all inference POSTs; a slot is held for the
 *   response's full lifetime (including streaming) and released on close.
 * - Regular (pay-as-you-go) org ceilings scale with the trust tier; dev and
 *   chat plans stay on a flat, tight limit.
 * - Enterprise organizations are NOT exempt — they get an elevated ceiling.
 * - Over-limit requests get a retryable 429 with `Retry-After: 1`.
 *
 * Requests without a resolvable API token are passed through so the
 * downstream handler can return the appropriate auth error.
 */
export async function orgRateLimitMiddleware(
	c: Context<ServerTypes>,
	next: Next,
) {
	if (!isOrgRateLimitEnabled()) {
		return await next();
	}

	// Trusted internal forwards (e.g. images/responses/messages handlers calling
	// `/v1/chat/completions`) already counted against their own endpoint budget;
	// don't double-count them against the forwarded endpoint's bucket. Detected
	// via the internal api-origin token those handlers stamp on the hop.
	if (isInternalApiOrigin(c)) {
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

	// Use the cached-only lookup: the enterprise check needs `plan`, not fresh
	// credits, so this stays a Redis cache hit even for zero-credit orgs (which
	// findOrganizationById would otherwise refetch from Postgres every request).
	const organization = await findOrganizationCachedById(organizationId);
	if (!organization) {
		return await next();
	}

	const isEnterprise = organization.plan === "enterprise";
	const planClass = getPlanClass(organization);

	// Enterprise organizations are excluded from the per-path RPM limits, but
	// still get the (elevated) in-flight concurrency check below — unbounded
	// concurrency from a single tenant can exhaust shared gateway capacity
	// regardless of plan.
	if (!isEnterprise) {
		// Only regular (pay-as-you-go) orgs get a spend-tier boost; dev/chat plans
		// stay on their flat, tight limit. The multiplier is resolved lazily inside
		// checkOrgRateLimit and only once the org has reached its base limit, so the
		// common under-limit path skips the spend lookup entirely.
		const result = await checkOrgRateLimit(
			organizationId,
			config,
			planClass,
			async () => {
				if (planClass !== "regular") {
					return 1;
				}
				const lifetimeSpend =
					await getOrganizationLifetimeSpend(organizationId);
				return getOrgSpendTier(organization, lifetimeSpend).rpmMultiplier;
			},
		);

		if (!result.allowed) {
			const retryAfter = result.retryAfter ?? 60;
			const message = `Rate limit exceeded for ${c.req.path}. Please retry after ${retryAfter} seconds.`;
			const headers: Record<string, string> = {
				"Retry-After": String(retryAfter),
				// Standard draft-ietf-httpapi-ratelimit-headers fields (RateLimit-Reset
				// is delta-seconds) alongside the legacy X- variants (epoch reset).
				"RateLimit-Limit": String(result.limit),
				"RateLimit-Remaining": "0",
				"RateLimit-Reset": String(retryAfter),
				"X-RateLimit-Limit": String(result.limit),
				"X-RateLimit-Remaining": "0",
				"X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + retryAfter),
			};

			if (c.req.path.startsWith("/v1/messages")) {
				return c.json(
					buildAnthropicErrorBody({ message, status: 429 }),
					429,
					headers,
				);
			}
			return c.json(
				buildOpenAIErrorBody({ message, status: 429 }),
				429,
				headers,
			);
		}
	}

	// Per-org fleet-wide in-flight concurrency limit: one budget across all
	// inference endpoints, since those are the requests that hold connections
	// open for the duration of a model call. Unlike the RPM window, a slot is
	// released when the response settles, so the count tracks live concurrency
	// (Little's law: it binds throughput × duration, which RPM alone cannot).
	// Regular (PAYG) orgs get a trust-tier-elevated ceiling, resolved lazily
	// only once the org reaches the base; dev/chat/enterprise stay flat.
	if (c.req.method === "POST" && INFLIGHT_LIMITED_KEYS.has(config.key)) {
		const baseLimit = getOrgInflightLimit(planClass, isEnterprise);
		const acquisition = await acquireOrgInflightSlot(
			organizationId,
			baseLimit,
			async () => {
				if (isEnterprise || planClass !== "regular") {
					return baseLimit;
				}
				const lifetimeSpend =
					await getOrganizationLifetimeSpend(organizationId);
				return getOrgSpendTier(organization, lifetimeSpend).inflightLimit;
			},
			config.key,
		);

		if (!acquisition.allowed) {
			gatewayRequestsShedTotal.inc({ scope: "org" });
			const message = `Too many concurrent requests for this organization (limit: ${acquisition.limit}). Retry shortly, or reduce request concurrency.`;
			const headers: Record<string, string> = {
				"Retry-After": "1",
				"RateLimit-Limit": String(acquisition.limit),
				"RateLimit-Remaining": "0",
				"RateLimit-Reset": "1",
				"X-RateLimit-Limit": String(acquisition.limit),
				"X-RateLimit-Remaining": "0",
				"X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 1),
			};

			if (c.req.path.startsWith("/v1/messages")) {
				return c.json(
					buildAnthropicErrorBody({ message, status: 429 }),
					429,
					headers,
				);
			}
			return c.json(
				buildOpenAIErrorBody({ message, status: 429 }),
				429,
				headers,
			);
		}

		if (acquisition.release) {
			return await runWithResponseCleanup(c, next, acquisition.release);
		}
	}

	return await next();
}
