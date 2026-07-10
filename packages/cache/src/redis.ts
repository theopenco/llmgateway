import { Redis } from "ioredis";

import { logger } from "@llmgateway/logger";

export const redisClient = new Redis({
	host: process.env.REDIS_HOST ?? "localhost",
	port: Number(process.env.REDIS_PORT) || 6379,
	password: process.env.REDIS_PASSWORD,
});

/**
 * Detects transient "Redis is not currently reachable" errors — e.g. a socket
 * closed during a rolling deploy/failover or an in-flight command racing with
 * graceful shutdown. ioredis auto-reconnects from these, so they are expected
 * operational noise rather than application bugs.
 */
function isConnectionUnavailableError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const code = (error as NodeJS.ErrnoException).code;
	if (
		code === "ECONNREFUSED" ||
		code === "ECONNRESET" ||
		code === "ETIMEDOUT" ||
		code === "EPIPE" ||
		code === "ENOTFOUND"
	) {
		return true;
	}
	return (
		error.message.includes("Connection is closed") ||
		error.message.includes("Stream isn't writeable") ||
		error.message.includes("max retries per request")
	);
}

redisClient.on("error", (err) => {
	if (isConnectionUnavailableError(err)) {
		logger.warn("Redis connection unavailable", err);
		return;
	}
	logger.error("Redis Client Error", err);
});

export const LOG_QUEUE = "log_queue_" + process.env.NODE_ENV;

export async function publishToQueue(
	queue: string,
	message: unknown,
): Promise<void> {
	try {
		await redisClient.lpush(queue, JSON.stringify(message));
	} catch (error) {
		const msg = message as Record<string, unknown> | undefined;
		const item = msg
			? {
					requestId: msg.requestId,
					organizationId: msg.organizationId,
					projectId: msg.projectId,
					usedModel: msg.usedModel,
					usedProvider: msg.usedProvider,
				}
			: undefined;
		// Publishing request logs is best-effort telemetry. When Redis is briefly
		// unreachable (deploy/failover) the command can't be queued; swallow it at
		// warn level instead of throwing, so a transient blip doesn't turn an
		// already-served request into an unhandled 500 or raise error alerts.
		if (isConnectionUnavailableError(error)) {
			logger.warn("Skipped publishing to queue (Redis unavailable)", error, {
				queue,
				item,
			});
			return;
		}
		logger.error("Error publishing to queue", error, { queue, item });
		throw error;
	}
}

export async function consumeFromQueue(
	queue: string,
	count = 100,
): Promise<string[] | null> {
	try {
		const result = await redisClient.lpop(queue, count);

		if (!result) {
			return null;
		}

		return result;
	} catch (error) {
		logger.error("Error consuming from queue", error);
		throw error;
	}
}

export async function closeRedisClient(): Promise<void> {
	try {
		await redisClient.disconnect();
		logger.info("Redis client disconnected");
	} catch (error) {
		logger.error("Error disconnecting Redis client", error);
		throw error;
	}
}
