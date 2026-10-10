import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

/**
 * Estimates of credits-billed video submissions that have passed the credit
 * gate but whose job row does not exist yet. The job row is the durable
 * reservation (see getPendingVideoReservationUsd in videos.ts); this counter
 * covers the window between the gate and the insert, so two submissions
 * racing for the same balance cannot both pass. A submission adds itself
 * here before reading the pending sum and removes itself after inserting
 * its row (or on any failure), so a concurrent submission sees it in one of
 * the two. Fail-open on Redis errors, like every other limiter counter, and
 * short-lived so a crashed request cannot hold the org's balance.
 */
const IN_FLIGHT_TTL_SECONDS = 5 * 60;

function inFlightKey(organizationId: string): string {
	return `video:submitting:${organizationId}`;
}

// Only decrement live keys, clamped at zero, so a release after expiry does
// not materialize a negative counter.
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
 * Add a submission's estimate to the org's in-flight total and return that
 * total, including the amount just added. When Redis cannot answer, the
 * submission is treated as the only one in flight: the job-row sum still
 * gates it, and only the race window between two simultaneous submissions
 * goes unprotected, which is preferable to a Redis outage blocking every
 * credits-billed video.
 */
export async function reserveVideoSubmission(
	organizationId: string,
	estimatedUsd: number,
): Promise<number> {
	if (!(estimatedUsd > 0)) {
		return 0;
	}
	try {
		const key = inFlightKey(organizationId);
		const results = await redisClient
			.multi()
			.incrbyfloat(key, estimatedUsd)
			.expire(key, IN_FLIGHT_TTL_SECONDS)
			.exec();
		const total = Number(results?.[0]?.[1]);
		if (!Number.isFinite(total)) {
			logger.warn("In-flight video reservation returned no total", {
				organizationId,
				result: results?.[0],
			});
			return estimatedUsd;
		}
		return total;
	} catch (error) {
		logger.error("Error reserving in-flight video submission:", error as Error);
		return estimatedUsd;
	}
}

export async function releaseVideoSubmission(
	organizationId: string,
	estimatedUsd: number,
): Promise<void> {
	if (!(estimatedUsd > 0)) {
		return;
	}
	try {
		await redisClient.eval(
			CLAMPED_DECREMENT_SCRIPT,
			1,
			inFlightKey(organizationId),
			String(-estimatedUsd),
		);
	} catch (error) {
		logger.error("Error releasing in-flight video submission:", error as Error);
	}
}
