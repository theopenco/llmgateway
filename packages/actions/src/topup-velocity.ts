import { redisClient } from "@llmgateway/cache";
import {
	and,
	db,
	eq,
	gte,
	inArray,
	sql,
	tables,
	projectHourlyStats,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getOrgSpendTier,
	isTopUpVelocityEnabled,
	isTopUpVelocityGatedOrg,
	TOPUP_VELOCITY_RESERVATION_TTL_SECONDS,
	TOPUP_VELOCITY_WINDOW_MS,
	topUpVelocityKey,
} from "@llmgateway/shared";

import { recordLimitHit } from "./limit-hits.js";

/**
 * Per-organization top-up velocity limits: caps the gross USD an org can top up
 * within a rolling 24h window, scaled by its trust tier. Anti-abuse control for
 * stolen-card testing, which shows up as rapid successive top-ups.
 *
 * Accounting is two-layered because the manual top-up routes create the Stripe
 * charge before any `transaction` row exists (the row is written by the webhook
 * seconds later), so a sum over the table alone is bypassable with parallel
 * initiations:
 * - a windowed SUM over `transaction` (type=credit_topup, pending+completed)
 *   is the durable source of truth, and
 * - a short-TTL Redis reservation counter covers the initiation→webhook gap;
 *   it is incremented BEFORE the check so concurrent initiations see each other.
 *
 * On Redis failure the check degrades to DB-only enforcement (the cap still
 * holds, only the parallel-initiation race reopens); on DB failure it throws —
 * this gates payments, so unlike the gateway rate limiter it must not silently
 * allow.
 */

export interface TopUpVelocityOrg {
	id: string;
	kind?: string | null;
	plan?: string | null;
	createdAt: Date;
	trustTierOverride?: number | null;
}

export interface TopUpVelocityResult {
	allowed: boolean;
	/** Effective cap for the org's tier (Infinity when exempt/unlimited). */
	capUsd: number;
	/** Gross USD already counted in the window, excluding this request. */
	usedUsd: number;
	remainingUsd: number;
	windowHours: 24;
}

// Decrement a reservation without ever recreating an expired key: a plain
// INCRBYFLOAT by a negative amount on a missing key would materialize a
// negative counter with no TTL and permanently loosen the cap.
const RELEASE_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  local r = tonumber(redis.call('INCRBYFLOAT', KEYS[1], ARGV[1]))
  if r < 0 then
    redis.call('SET', KEYS[1], '0', 'KEEPTTL')
  end
end
return 1
`;

/**
 * Gross top-up USD in the rolling window. Deliberately NOT net of refunds:
 * the original `credit_topup` row keeps `status: "completed"` when refunded
 * (the webhook only inserts a separate `credit_refund` row), and it must keep
 * consuming headroom — otherwise top-up → refund → top-up again would cycle
 * money through the window faster than the cap allows. Do not subtract
 * `credit_refund` rows here.
 */
async function windowDbSumUsd(organizationId: string, now: number) {
	const windowStart = new Date(now - TOPUP_VELOCITY_WINDOW_MS);
	const rows = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, organizationId),
				eq(tables.transaction.type, "credit_topup"),
				inArray(tables.transaction.status, ["pending", "completed"]),
				gte(tables.transaction.createdAt, windowStart),
			),
		);
	return Number(rows[0]?.total ?? 0) || 0;
}

/**
 * Gross USD ever refunded back to the org (completed `credit_refund` rows;
 * `amount` on those is the positive refunded dollar figure). Deducted from the
 * tier-qualifying spend so money that came back — fraud clawbacks included —
 * cannot buy higher limits.
 */
async function lifetimeRefundedUsd(organizationId: string) {
	const rows = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, organizationId),
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
			),
		);
	return Number(rows[0]?.total ?? 0) || 0;
}

async function lifetimeUsageSpendUsd(organizationId: string) {
	// creditsCost, NOT cost: only usage billed to the org's credit balance may
	// qualify for a tier. Total `cost` includes BYOK (own-provider-key) usage,
	// which the spend caps deliberately don't bound and which costs the org
	// nothing here — counting it would let an attacker pump a stolen provider
	// key on day one and unlock top-tier top-up allowances for free.
	const rows = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`,
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(tables.project.id, projectHourlyStats.projectId),
		)
		.where(eq(tables.project.organizationId, organizationId));
	return Number(rows[0]?.total ?? 0) || 0;
}

/**
 * The spend figure trust tiers qualify on: lifetime usage spend minus every
 * completed refund, floored at 0. A fraudster who tops up, burns credits on
 * inference and then gets the payment refunded must not keep the tier (and
 * with it the higher RPM/spend/top-up allowances) that usage bought.
 */
export async function getOrgTierQualifyingSpendUsd(
	organizationId: string,
): Promise<number> {
	const [usage, refunded] = await Promise.all([
		lifetimeUsageSpendUsd(organizationId),
		lifetimeRefundedUsd(organizationId),
	]);
	return Math.max(0, usage - refunded);
}

/**
 * Check the org's top-up velocity cap and, by default, reserve the attempted
 * amount so concurrent initiations count against each other before any
 * `transaction` row exists.
 *
 * The worker's auto top-up passes `reserve: false`: it inserts a `pending`
 * transaction row before charging, which already counts via the DB sum, and its
 * loop is serialized — reserving too would double-count.
 *
 * Call {@link releaseTopUpReservation} if the subsequent Stripe call fails, so
 * the aborted attempt does not consume headroom for its TTL.
 */
export async function checkAndReserveTopUp(options: {
	org: TopUpVelocityOrg;
	/** Gross USD of this attempt (base + fees — what the card is charged). */
	amountUsd: number;
	reserve?: boolean;
	reservationTtlSeconds?: number;
	now?: number;
}): Promise<TopUpVelocityResult> {
	const {
		org,
		amountUsd,
		reserve = true,
		reservationTtlSeconds = TOPUP_VELOCITY_RESERVATION_TTL_SECONDS,
		now = Date.now(),
	} = options;

	if (!isTopUpVelocityEnabled() || !isTopUpVelocityGatedOrg(org)) {
		return {
			allowed: true,
			capUsd: Number.POSITIVE_INFINITY,
			usedUsd: 0,
			remainingUsd: Number.POSITIVE_INFINITY,
			windowHours: 24,
		};
	}

	const lifetimeSpend = await getOrgTierQualifyingSpendUsd(org.id);
	const tier = getOrgSpendTier(org, lifetimeSpend, now);
	const capUsd = tier.topUpDailyCapUsd;

	// An operator override of 0 means "no top-up cap for this tier", matching
	// the 0-disables convention of the per-path RPM overrides.
	if (capUsd <= 0) {
		return {
			allowed: true,
			capUsd: Number.POSITIVE_INFINITY,
			usedUsd: 0,
			remainingUsd: Number.POSITIVE_INFINITY,
			windowHours: 24,
		};
	}

	// Redis first, DB second — deliberately. Settlement inserts the durable
	// transaction row BEFORE releasing its Redis reservation, so reading the
	// reservation before the DB sum guarantees every settling amount is seen
	// by at least one of the two sources; the reverse order could miss an
	// amount that settled between the two reads.
	// reservedIncl = in-flight reservations INCLUDING this attempt.
	let reservedIncl = amountUsd;
	let reservedInRedis = false;
	const key = topUpVelocityKey(org.id);
	try {
		if (reserve) {
			// All in-flight reservations share one key, so the TTL may only ever
			// be extended: NX stamps a fresh key, GT lengthens it for a
			// longer-lived attempt. A plain EXPIRE would let a later short-TTL
			// top-up shorten a hosted checkout's 35-minute reservation.
			const [incrResult] = await redisClient
				.multi()
				.incrbyfloat(key, amountUsd)
				.expire(key, reservationTtlSeconds, "NX")
				.expire(key, reservationTtlSeconds, "GT")
				.exec()
				.then((results) => results ?? []);
			reservedInRedis = true;
			const raw = incrResult?.[1];
			const value = Number(raw);
			if (Number.isFinite(value)) {
				reservedIncl = value;
			}
		} else {
			const raw = await redisClient.get(key);
			const value = Number(raw ?? 0);
			reservedIncl = (Number.isFinite(value) ? value : 0) + amountUsd;
		}
	} catch (error) {
		// Degrade to DB-only enforcement: the cap still applies via dbSum, only
		// the concurrent-initiation protection is lost while Redis is down.
		logger.error("Top-up velocity Redis error (DB-only mode):", error as Error);
		reservedIncl = amountUsd;
		reservedInRedis = false;
	}

	let dbSum: number;
	try {
		dbSum = await windowDbSumUsd(org.id, now);
	} catch (error) {
		// No charge will happen (the caller propagates this as a 5xx), so the
		// just-created reservation must not consume allowance for its TTL and
		// 429 legitimate retries.
		if (reservedInRedis) {
			await releaseTopUpReservation(org.id, amountUsd);
		}
		throw error;
	}

	const totalUsd = dbSum + reservedIncl;
	const usedUsd = totalUsd - amountUsd;

	if (totalUsd > capUsd) {
		if (reservedInRedis) {
			await releaseTopUpReservation(org.id, amountUsd);
		}
		logger.info("Top-up velocity cap reached", {
			organizationId: org.id,
			tier: tier.tier,
			capUsd,
			usedUsd,
			attemptedUsd: amountUsd,
		});
		// amountUsd === 0 is the post-settlement observability probe, not a
		// blocked attempt — don't count it.
		if (amountUsd > 0) {
			await recordLimitHit({
				organizationId: org.id,
				limitType: "topup_velocity",
				blockedUsd: amountUsd,
				now,
			});
		}
		return {
			allowed: false,
			capUsd,
			usedUsd,
			remainingUsd: Math.max(0, capUsd - usedUsd),
			windowHours: 24,
		};
	}

	return {
		allowed: true,
		capUsd,
		usedUsd,
		remainingUsd: Math.max(0, capUsd - totalUsd),
		windowHours: 24,
	};
}

/**
 * Release a previously made reservation (blocked attempt, or Stripe call
 * failure after a successful check). Never recreates an expired key.
 */
export async function releaseTopUpReservation(
	organizationId: string,
	amountUsd: number,
): Promise<void> {
	try {
		await redisClient.eval(
			RELEASE_SCRIPT,
			1,
			topUpVelocityKey(organizationId),
			String(-amountUsd),
		);
	} catch (error) {
		// Best-effort: an unreleased reservation self-expires with its TTL.
		logger.error("Top-up velocity release failed:", error as Error);
	}
}

/** Window usage for display (the org limits endpoint). */
export async function getTopUpVelocityUsage(
	organizationId: string,
	now: number = Date.now(),
): Promise<{ dbSumUsd: number; reservedUsd: number }> {
	const dbSumUsd = await windowDbSumUsd(organizationId, now);
	let reservedUsd = 0;
	try {
		const raw = await redisClient.get(topUpVelocityKey(organizationId));
		const value = Number(raw ?? 0);
		reservedUsd = Number.isFinite(value) && value > 0 ? value : 0;
	} catch {
		// Display-only; ignore Redis errors.
	}
	return { dbSumUsd, reservedUsd };
}
