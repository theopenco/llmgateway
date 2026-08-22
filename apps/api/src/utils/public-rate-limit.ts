import { redisClient } from "@/auth/config.js";

import { logger, toError } from "@llmgateway/logger";

/**
 * Originating IP of a request to a public, unauthenticated endpoint, used as
 * the rate-limit key. CF-Connecting-IP comes first: Cloudflare overwrites any
 * client-supplied value, so it is the one IP header a visitor cannot forge.
 * X-Forwarded-For and X-Real-IP are fallbacks for deployments without it.
 */
export function extractClientIP(c: {
	req: { header: (name: string) => string | undefined };
}): string | null {
	const cfConnectingIP = c.req.header("CF-Connecting-IP");
	if (cfConnectingIP) {
		return cfConnectingIP;
	}
	const xForwardedFor = c.req.header("X-Forwarded-For");
	if (xForwardedFor) {
		return xForwardedFor.split(",")[0]?.trim() ?? null;
	}
	return c.req.header("X-Real-IP") ?? null;
}

/**
 * Consumes one slot of a fixed Redis window, returning false once `max` is
 * exceeded. Fails open: a Redis outage must not take the public endpoints
 * down with it.
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
