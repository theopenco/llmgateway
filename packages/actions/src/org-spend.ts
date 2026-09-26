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
	now = Date.now(),
): Promise<void> {
	if (!isSpendCapEnabled() || !(cost > 0)) {
		return;
	}

	try {
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

export async function adjustOrgSpend(
	organizationId: string,
	deltaUsd: number,
	reservation?: { amount: number; createdAt: Date },
): Promise<void> {
	if (!isSpendCapEnabled() || !Number.isFinite(deltaUsd)) {
		return;
	}
	const now = Date.now();
	const reservedAt = reservation?.createdAt.getTime() ?? now;
	try {
		const pipeline = redisClient.pipeline();
		for (const [keyFor, ttl] of [
			[spendDailyKey, DAILY_TTL_SECONDS],
			[spendMonthlyKey, MONTHLY_TTL_SECONDS],
		] as const) {
			const previousKey = keyFor(organizationId, reservedAt);
			const currentKey = keyFor(organizationId, now);
			const moved = previousKey !== currentKey && reservation;
			if (moved && reservation.amount > 0) {
				pipeline.eval(
					CLAMPED_DECREMENT_SCRIPT,
					1,
					previousKey,
					String(-reservation.amount),
				);
			}
			const amount = moved ? deltaUsd + reservation.amount : deltaUsd;
			if (amount > 0) {
				pipeline.incrbyfloat(currentKey, amount);
				pipeline.expire(currentKey, ttl);
			} else if (amount < 0) {
				pipeline.eval(CLAMPED_DECREMENT_SCRIPT, 1, currentKey, String(amount));
			}
		}
		await pipeline.exec();
	} catch (error) {
		logger.error("Error adjusting org spend:", error as Error);
	}
}
