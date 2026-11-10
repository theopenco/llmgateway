import { redisClient } from "@/auth/config.js";

import { logger, toError } from "@llmgateway/logger";

// Increment and expiry must land together. A plain INCR followed by a separate
// EXPIRE can leave the counter with no TTL if the connection drops between the
// two — and every later call skips EXPIRE because the count is no longer 1, so
// the window never resets and the identifier stays blocked forever once it
// passes `max`. The TTL check also repairs any such key left behind by an
// earlier failure, since a counter with no expiry can only be that.
const CONSUME_RATE_LIMIT = `
local count = redis.call('incr', KEYS[1])
if count == 1 or redis.call('ttl', KEYS[1]) < 0 then
	redis.call('expire', KEYS[1], ARGV[1])
end
return count
`;

const RELEASE_RATE_LIMIT = `
if tonumber(redis.call('get', KEYS[1]) or '0') > 0 then
	redis.call('decr', KEYS[1])
end
return 1
`;

export type RateLimitState = "allowed" | "limited" | "unavailable";

/**
 * Consumes one slot of a fixed Redis window and tells a Redis failure apart
 * from a decision, for callers that must refuse rather than fail open.
 */
export async function tryConsumeRateLimit(
	key: string,
	max: number,
	windowSeconds: number,
): Promise<RateLimitState> {
	try {
		const count = await redisClient.eval(
			CONSUME_RATE_LIMIT,
			1,
			key,
			String(windowSeconds),
		);
		return Number(count) <= max ? "allowed" : "limited";
	} catch (error) {
		logger.error("Public rate limit check failed", toError(error));
		return "unavailable";
	}
}

/**
 * Consumes one slot of a fixed Redis window, returning false once `max` is
 * exceeded. Fails open: a Redis outage must not take the public endpoints
 * down with it.
 *
 * Key the window on `getClientIpFromContext` (`@llmgateway/shared/client-ip`)
 * for per-IP limits — never on a hand-rolled header lookup.
 */
export async function consumeRateLimit(
	key: string,
	max: number,
	windowSeconds: number,
): Promise<boolean> {
	return (await tryConsumeRateLimit(key, max, windowSeconds)) !== "limited";
}

/** Gives back a slot taken for work that then failed. */
export async function releaseRateLimit(key: string): Promise<void> {
	try {
		await redisClient.eval(RELEASE_RATE_LIMIT, 1, key);
	} catch (error) {
		logger.error("Public rate limit release failed", toError(error));
	}
}
