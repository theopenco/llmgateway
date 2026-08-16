import { HTTPException } from "hono/http-exception";

import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";
import {
	isCappedOrg,
	spendDailyKey,
	spendMonthlyKey,
	type SpendCapOrg,
} from "@llmgateway/shared";

import {
	getOrganizationLifetimeSpend,
	getOrgSpendTier,
} from "./org-rate-limit.js";

import type { Context } from "hono";

/**
 * Per-organization daily and monthly USD spend caps for regular
 * (kind=default, non-enterprise) orgs.
 *
 * The cap for an org is chosen by its trust tier (see {@link getOrgSpendTier} in
 * org-rate-limit.ts) — a pure function of account age and cached lifetime usage
 * spend. Enforcement is post-paid, mirroring how the gateway already bills:
 * - before a request we reject if a counter is already at/over the cap (429);
 * - after a request {@link recordSpend} adds the actual cost to both counters.
 *
 * Counters are calendar-period buckets in Redis (UTC), so they never need the
 * `transaction` table on the hot path. Everything fails OPEN on Redis errors so
 * a limiter outage can never block traffic.
 */

const DAILY_TTL_SECONDS = 2 * 24 * 60 * 60; // ~2 days
const MONTHLY_TTL_SECONDS = 35 * 24 * 60 * 60; // ~35 days

/**
 * Whether spend caps are enforced. `GATEWAY_SPEND_CAPS_ENABLED` is the explicit
 * switch. When unset, enabled in prod but disabled under any test runner
 * (`NODE_ENV==='test'` or `E2E_TEST`), because the tight T0 cap ($5/day) would
 * otherwise trip unrelated tests that share the seeded org and Redis.
 */
export function isSpendCapEnabled(): boolean {
	const explicit = process.env.GATEWAY_SPEND_CAPS_ENABLED;
	if (explicit !== undefined) {
		return explicit === "true";
	}
	return process.env.NODE_ENV !== "test" && process.env.E2E_TEST !== "true";
}

function secondsToNextUtcMidnight(now: number): number {
	const d = new Date(now);
	const next = Date.UTC(
		d.getUTCFullYear(),
		d.getUTCMonth(),
		d.getUTCDate() + 1,
	);
	return Math.max(1, Math.ceil((next - now) / 1000));
}

function secondsToNextUtcMonth(now: number): number {
	const d = new Date(now);
	const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
	return Math.max(1, Math.ceil((next - now) / 1000));
}

export interface SpendLimitResult {
	allowed: boolean;
	period?: "daily" | "monthly";
	limit?: number;
	current?: number;
	retryAfter?: number;
}

/**
 * Check whether the org may make a spending request. Returns `{ allowed: true }`
 * for exempt orgs (non-default kind, enterprise, disabled) and on Redis error.
 * When a counter is already at/over its tier cap, returns the blocking period,
 * the cap, the current spend, and seconds until the counter resets.
 */
export async function checkSpendLimit(
	org: SpendCapOrg,
): Promise<SpendLimitResult> {
	if (!isSpendCapEnabled() || !isCappedOrg(org)) {
		return { allowed: true };
	}

	try {
		const now = Date.now();
		const lifetimeSpend = await getOrganizationLifetimeSpend(org.id);
		const tier = getOrgSpendTier(org, lifetimeSpend, now);

		const [dailyRaw, monthlyRaw] = await redisClient.mget(
			spendDailyKey(org.id, now),
			spendMonthlyKey(org.id, now),
		);
		const daily = Number(dailyRaw ?? 0) || 0;
		const monthly = Number(monthlyRaw ?? 0) || 0;

		if (daily >= tier.dailyCapUsd) {
			logger.info("Org daily spend cap reached", {
				organizationId: org.id,
				tier: tier.tier,
				current: daily,
				limit: tier.dailyCapUsd,
			});
			return {
				allowed: false,
				period: "daily",
				limit: tier.dailyCapUsd,
				current: daily,
				retryAfter: secondsToNextUtcMidnight(now),
			};
		}

		if (monthly >= tier.monthlyCapUsd) {
			logger.info("Org monthly spend cap reached", {
				organizationId: org.id,
				tier: tier.tier,
				current: monthly,
				limit: tier.monthlyCapUsd,
			});
			return {
				allowed: false,
				period: "monthly",
				limit: tier.monthlyCapUsd,
				current: monthly,
				retryAfter: secondsToNextUtcMonth(now),
			};
		}

		return { allowed: true };
	} catch (error) {
		logger.error("Error checking org spend limit:", error as Error);
		// Fail open so Redis issues never block users.
		return { allowed: true };
	}
}

/**
 * Enforce the org's spend cap for a request that will be billed to org credits,
 * and reject with `429` when a cap is already reached.
 *
 * This is the single enforcement chokepoint every credits-funded handler should
 * call, so a cap cannot be bypassed by reaching platform credentials through a
 * different path (hybrid fallback, non-chat endpoints, ...).
 *
 * Reset headers are set on the context before throwing, mirroring
 * `validateFreeModelUsage`: the global error handler rebuilds the body from the
 * `HTTPException` and would drop headers attached to the exception itself, but
 * headers set on `c` survive onto the error response.
 */
export async function assertSpendLimit(
	c: Pick<Context, "header">,
	org: SpendCapOrg,
	modelIsFree: boolean,
): Promise<void> {
	// Free models never consume credits, so they are exempt from spend caps.
	if (modelIsFree) {
		return;
	}

	const result = await checkSpendLimit(org);
	if (result.allowed) {
		return;
	}

	if (result.limit !== undefined) {
		c.header("X-RateLimit-Limit", String(result.limit));
		c.header("X-RateLimit-Remaining", "0");
	}
	if (result.retryAfter) {
		c.header("Retry-After", String(result.retryAfter));
		c.header(
			"X-RateLimit-Reset",
			String(Math.floor(Date.now() / 1000) + result.retryAfter),
		);
	}

	throw new HTTPException(429, {
		message: `Organization ${org.id} has reached its ${result.period} spend limit of $${result.limit}. Try again later or contact support to raise your limit.`,
	});
}

/**
 * Add the actual cost of a completed request to the org's daily and monthly
 * spend counters. Called from the single `insertLog` chokepoint, so it is DRY
 * across every request path. Recording for non-capped orgs is harmless — those
 * counters are never read.
 */
export async function recordSpend(
	organizationId: string,
	cost: number,
): Promise<void> {
	if (!isSpendCapEnabled() || !(cost > 0)) {
		return;
	}

	try {
		const now = Date.now();
		const dKey = spendDailyKey(organizationId, now);
		const mKey = spendMonthlyKey(organizationId, now);

		const pipeline = redisClient.pipeline();
		pipeline.incrbyfloat(dKey, cost);
		pipeline.expire(dKey, DAILY_TTL_SECONDS);
		pipeline.incrbyfloat(mKey, cost);
		pipeline.expire(mKey, MONTHLY_TTL_SECONDS);
		await pipeline.exec();
	} catch (error) {
		logger.error("Error recording org spend:", error as Error);
	}
}
