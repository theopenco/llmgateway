import Redis from "ioredis";

const redisClient = new Redis({
	host: process.env.REDIS_HOST || "localhost",
	port: Number(process.env.REDIS_PORT) || 6379,
});

redisClient.on("error", (err) => console.error("Redis Client Error", err));

export const LOG_QUEUE = "log_queue_" + process.env.NODE_ENV;
export const LOG_PROCESSING_QUEUE =
	"log_processing_queue_" + process.env.NODE_ENV;

export async function publishToQueue(
	queue: string,
	message: unknown,
): Promise<void> {
	try {
		await redisClient.lpush(queue, JSON.stringify(message));
	} catch (error) {
		console.error("Error publishing to queue:", error);
		throw error;
	}
}

export async function consumeFromQueue(
	queue: string,
): Promise<string[] | null> {
	try {
		const result = await redisClient.lpop(queue, 10);

		if (!result) {
			return null;
		}

		return result;
	} catch (error) {
		console.error("Error consuming from queue:", error);
		throw error;
	}
}

export async function peekFromQueue(queue: string): Promise<string[] | null> {
	try {
		const result = await redisClient.lrange(queue, 0, 9);

		if (!result || result.length === 0) {
			return null;
		}

		return result;
	} catch (error) {
		console.error("Error peeking from queue:", error);
		throw error;
	}
}

export async function removeFromQueue(
	queue: string,
	count: number,
): Promise<void> {
	try {
		for (let i = 0; i < count; i++) {
			await redisClient.lpop(queue);
		}
	} catch (error) {
		console.error("Error removing from queue:", error);
		throw error;
	}
}

export async function moveToProcessingQueue(
	sourceQueue: string,
	processingQueue: string,
	count: number,
): Promise<string[] | null> {
	try {
		const messages: string[] = [];
		for (let i = 0; i < count; i++) {
			const message = await redisClient.rpoplpush(sourceQueue, processingQueue);
			if (!message) {
				break;
			}
			messages.push(message);
		}

		return messages.length > 0 ? messages : null;
	} catch (error) {
		console.error("Error moving to processing queue:", error);
		throw error;
	}
}

export async function removeFromProcessingQueue(
	processingQueue: string,
	count: number,
): Promise<void> {
	try {
		for (let i = 0; i < count; i++) {
			await redisClient.lpop(processingQueue);
		}
	} catch (error) {
		console.error("Error removing from processing queue:", error);
		throw error;
	}
}

export async function recoverProcessingQueue(
	processingQueue: string,
	targetQueue: string,
): Promise<void> {
	try {
		while (true) {
			const message = await redisClient.rpoplpush(processingQueue, targetQueue);
			if (!message) {
				break;
			}
		}
	} catch (error) {
		console.error("Error recovering processing queue:", error);
		throw error;
	}
}

export default redisClient;
