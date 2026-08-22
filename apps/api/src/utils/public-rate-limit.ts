import { redisClient } from "@/auth/config.js";

import { logger, toError } from "@llmgateway/logger";

/**
 * Consumes one slot of a fixed Redis window, returning false once `max` is
 * exceeded. Fails open: a Redis outage must not take the public endpoints
 * down with it.
 *
 * Key the window on `getClientIpFromContext` (`@/lib/client-ip.js`) for
 * per-IP limits — never on a hand-rolled header lookup.
 */
export async function consumeRateLimit(
	key: string,
	max: number,
	windowSeconds: number,
): Promise<boolean> {
	try {
		const count = await redisClient.incr(key);
		if (count === 1) {
			await redisClient.expire(key, windowSeconds);
		}
		return count <= max;
	} catch (error) {
		logger.error("Public rate limit check failed", toError(error));
		return true;
	}
}
