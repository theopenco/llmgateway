import { logger } from "@llmgateway/logger";
import Redis from "ioredis";

const redisClient = new Redis({
	host: process.env.REDIS_HOST || "localhost",
	port: Number(process.env.REDIS_PORT) || 6379,
	password: process.env.REDIS_PASSWORD,
});

redisClient.on("error", (err: unknown) =>
	logger.error(
		"Redis Client Error for rate limiting",
		err instanceof Error ? err : new Error(String(err)),
	),
);

export interface RateLimitConfig {
	keyPrefix: string;
	windowSizeMs: number;
	maxRequests: number;
}

export interface RateLimitResult {
	allowed: boolean;
	resetTime: number;
	remaining: number;
}

/**
 * Check if an IP address is rate limited for signup attempts
 * Uses a sliding window approach with Redis
 */
export async function checkSignupRateLimit(
	ipAddress: string,
): Promise<RateLimitResult> {
	const config: RateLimitConfig = {
		keyPrefix: "signup_rate_limit",
		windowSizeMs: 10 * 60 * 1000, // 10 minutes
		maxRequests: 2,
	};

	return await checkRateLimit(ipAddress, config);
}

/**
 * Generic rate limiting function using sliding window with Redis
 */
export async function checkRateLimit(
	identifier: string,
	config: RateLimitConfig,
): Promise<RateLimitResult> {
	const key = `${config.keyPrefix}:${identifier}`;
	const now = Date.now();
	const windowStart = now - config.windowSizeMs;

	try {
		// First, clean up expired entries and count current requests
		const cleanupPipeline = redisClient.pipeline();
		cleanupPipeline.zremrangebyscore(key, 0, windowStart);
		cleanupPipeline.zcard(key);

		const cleanupResults = await cleanupPipeline.exec();

		if (!cleanupResults) {
			throw new Error("Redis pipeline execution failed");
		}

		// Get the count after removing expired entries
		const currentCount = (cleanupResults[1][1] as number) || 0;
		const allowed = currentCount < config.maxRequests;
		const remaining = Math.max(
			0,
			config.maxRequests - currentCount - (allowed ? 1 : 0),
		);
		const resetTime = now + config.windowSizeMs;

		// Only add the request if it's allowed
		if (allowed) {
			const addPipeline = redisClient.pipeline();
			addPipeline.zadd(key, now, now);
			addPipeline.expire(key, Math.ceil(config.windowSizeMs / 1000));
			await addPipeline.exec();
		}

		logger.debug("Rate limit check", {
			identifier,
			currentCount,
			maxRequests: config.maxRequests,
			allowed,
			remaining,
			resetTime,
		});

		return {
			allowed,
			resetTime,
			remaining,
		};
	} catch (error) {
		logger.error(
			"Rate limit check failed",
			error instanceof Error ? error : new Error(String(error)),
		);

		// Fail open - allow the request if Redis is down
		return {
			allowed: true,
			resetTime: now + config.windowSizeMs,
			remaining: config.maxRequests - 1,
		};
	}
}
