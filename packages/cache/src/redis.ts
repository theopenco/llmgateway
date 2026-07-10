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

// In-memory retry buffer for queue messages that could not be published while
// Redis was unreachable. Messages are re-published when the connection comes
// back (see the "ready" listener / retry interval below) instead of dropped.
const MAX_PENDING_QUEUE_MESSAGES = 10_000;
const PENDING_FLUSH_INTERVAL_MS = 5_000;
const pendingQueueMessages: { queue: string; payload: string }[] = [];
let flushingPendingQueueMessages = false;

export function pendingQueueMessageCount(): number {
	return pendingQueueMessages.length;
}

export async function flushPendingQueueMessages(): Promise<number> {
	if (flushingPendingQueueMessages) {
		return 0;
	}
	flushingPendingQueueMessages = true;
	let flushed = 0;
	try {
		while (pendingQueueMessages.length > 0) {
			const next = pendingQueueMessages[0];
			await redisClient.lpush(next.queue, next.payload);
			pendingQueueMessages.shift();
			flushed++;
		}
	} catch (error) {
		logger.warn("Failed to flush pending queue messages, will retry", error, {
			flushed,
			pending: pendingQueueMessages.length,
		});
	} finally {
		flushingPendingQueueMessages = false;
	}
	if (flushed > 0) {
		logger.info("Flushed pending queue messages to Redis", {
			flushed,
			pending: pendingQueueMessages.length,
		});
	}
	return flushed;
}

function bufferPendingQueueMessage(queue: string, payload: string): void {
	if (pendingQueueMessages.length >= MAX_PENDING_QUEUE_MESSAGES) {
		pendingQueueMessages.shift();
		logger.error("Pending queue buffer full, dropping oldest message", {
			maxPending: MAX_PENDING_QUEUE_MESSAGES,
		});
	}
	pendingQueueMessages.push({ queue, payload });
}

redisClient.on("ready", () => {
	if (pendingQueueMessages.length > 0) {
		void flushPendingQueueMessages();
	}
});

setInterval(() => {
	if (pendingQueueMessages.length > 0 && redisClient.status === "ready") {
		void flushPendingQueueMessages();
	}
}, PENDING_FLUSH_INTERVAL_MS).unref();

export async function publishToQueue(
	queue: string,
	message: unknown,
): Promise<void> {
	const payload = JSON.stringify(message);
	try {
		await redisClient.lpush(queue, payload);
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
		// When Redis is briefly unreachable (deploy/failover), buffer the message
		// in memory and re-publish once the connection recovers, instead of
		// throwing — a transient blip must not turn an already-served request
		// into an unhandled 500 or raise error alerts.
		if (isConnectionUnavailableError(error)) {
			bufferPendingQueueMessage(queue, payload);
			logger.warn(
				"Redis unavailable, buffered queue message for retry",
				error,
				{ queue, item, pending: pendingQueueMessages.length },
			);
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
		// Drain any buffered queue messages before tearing down the connection so
		// logs published during a Redis blip are not lost on shutdown.
		await flushPendingQueueMessages();
		await redisClient.quit();
		logger.info("Redis client disconnected");
	} catch (error) {
		if (isConnectionUnavailableError(error)) {
			logger.warn("Redis already disconnected during close", error);
			redisClient.disconnect();
			return;
		}
		logger.error("Error disconnecting Redis client", error);
		throw error;
	}
}
