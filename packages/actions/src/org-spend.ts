import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";
import {
	isSpendCapEnabled,
	spendDailyKey,
	spendMonthlyKey,
} from "@llmgateway/shared";

// Comfortably outlive their UTC buckets so a counter never vanishes mid-period.
const DAILY_TTL_SECONDS = 2 * 24 * 60 * 60;
const MONTHLY_TTL_SECONDS = 35 * 24 * 60 * 60;

/**
 * Add billed cost to an organization's daily/monthly spend-cap counters.
 * Shared by every biller of org credits: the gateway's `insertLog` chokepoint,
 * realtime billing, and the worker's video-job finalization (which inserts log
 * rows directly and never passes through the gateway). Fail-open — a Redis
 * error must never break billing paths.
 */
export async function recordOrgSpend(
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

// Only decrement live keys, clamped at zero: INCRBYFLOAT by a negative amount
// on a missing key would materialize a negative counter with no TTL.
const CLAMPED_DECREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  local r = tonumber(redis.call('INCRBYFLOAT', KEYS[1], ARGV[1]))
  if r < 0 then
    redis.call('SET', KEYS[1], '0', 'KEEPTTL')
  end
end
return 1
`;

/**
 * Reconcile a previously recorded spend estimate against the actual billed
 * cost (video jobs reserve an estimate at submission and settle at
 * finalization). Positive deltas record normally; negative deltas decrement
 * the live counters, clamped at zero — a bucket rollover between estimate and
 * reconciliation can leave less than the delta in the current bucket.
 */
export async function adjustOrgSpend(
	organizationId: string,
	deltaUsd: number,
): Promise<void> {
	if (!isSpendCapEnabled() || !deltaUsd || !Number.isFinite(deltaUsd)) {
		return;
	}
	if (deltaUsd > 0) {
		await recordOrgSpend(organizationId, deltaUsd);
		return;
	}

	try {
		const now = Date.now();
		for (const key of [
			spendDailyKey(organizationId, now),
			spendMonthlyKey(organizationId, now),
		]) {
			await redisClient.eval(
				CLAMPED_DECREMENT_SCRIPT,
				1,
				key,
				String(deltaUsd),
			);
		}
	} catch (error) {
		logger.error("Error adjusting org spend:", error as Error);
	}
}
