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
