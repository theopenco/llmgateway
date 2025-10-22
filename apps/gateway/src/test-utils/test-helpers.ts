import { processLogQueue } from "worker";

import { redisClient } from "@llmgateway/cache";
import { db, tables, eq } from "@llmgateway/db";

export async function clearCache() {
	await redisClient.flushdb();
}

/**
 * Helper function to wait for logs to be processed by the worker
 * @param expectedCount The expected number of logs
 * @param maxWaitMs Maximum time to wait in milliseconds
 * @param intervalMs Interval between checks in milliseconds
 * @returns Promise that resolves with true if logs are found, false if timed out
 */
export async function waitForLogs(
	expectedCount = 1,
	maxWaitMs = 10000,
	intervalMs = 100,
) {
	const startTime = Date.now();
	console.log(`Waiting for ${expectedCount} logs (timeout: ${maxWaitMs}ms)...`);

	while (Date.now() - startTime < maxWaitMs) {
		await processLogQueue();

		const logs = await db.query.log.findMany({});

		if (logs.length >= expectedCount) {
			console.log(
				`Found ${logs.length} logs after ${Date.now() - startTime}ms`,
			);
			return logs;
		}

		// Wait for the next interval
		await new Promise((resolve) => {
			setTimeout(resolve, intervalMs);
		});
	}

	const message = `Timed out waiting for ${expectedCount} logs after ${maxWaitMs}ms`;
	console.warn(message);

	throw new Error(message);
}

/**
 * Helper function to wait for a log entry with a specific request ID
 * @param requestId The request ID to wait for
 * @param maxWaitMs Maximum time to wait in milliseconds
 * @param intervalMs Interval between checks in milliseconds
 * @returns Promise that resolves with the log entry if found
 */
export async function waitForLogByRequestId(
	requestId: string,
	maxWaitMs = 20000,
	intervalMs = 100,
) {
	const startTime = Date.now();

	while (Date.now() - startTime < maxWaitMs) {
		// Process the log queue to ensure any pending logs are written to the database
		await processLogQueue();

		// Query for the specific log entry by request ID
		const logs = await db
			.select()
			.from(tables.log)
			.where(eq(tables.log.requestId, requestId))
			.limit(1);

		const log = logs[0] || null;

		if (log) {
			return log;
		}

		// Wait for the next interval
		await new Promise((resolve) => {
			setTimeout(resolve, intervalMs);
		});
	}

	const message = `Timed out waiting for log with request ID ${requestId} after ${maxWaitMs}ms`;
	console.warn(message);

	throw new Error(message);
}

/**
 * Helper function to read all chunks from a streaming response
 * @param stream The ReadableStream to read from
 * @returns Promise that resolves with parsed stream data including SSE validation
 */
export async function readAll(
	stream: ReadableStream<Uint8Array> | null,
): Promise<{
	fullContent?: string;
	hasContent: boolean;
	eventCount: number;
	hasValidSSE: boolean;
	hasOpenAIFormat: boolean;
	chunks: any[];
	hasUsage: boolean;
	errorEvents: any[];
	hasError: boolean;
}> {
	if (!stream) {
		return {
			hasContent: false,
			eventCount: 0,
			hasValidSSE: false,
			hasOpenAIFormat: false,
			chunks: [],
			hasUsage: false,
			errorEvents: [],
			hasError: false,
		};
	}
	const reader = stream.getReader();
	let fullContent = "";
	let eventCount = 0;
	let hasValidSSE = false;
	let hasContent = false;
	let hasOpenAIFormat = true; // Assume true until proven otherwise
	let hasUsage = false;
	const chunks: any[] = [];
	const errorEvents: any[] = [];
	let hasError = false;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			const chunk = new TextDecoder().decode(value);
			fullContent += chunk;
			const lines = chunk.split("\n");
			let currentEvent = "";
			for (const line of lines) {
				if (line.startsWith("event: ")) {
					currentEvent = line.substring(7).trim();
				} else if (line.startsWith("data: ")) {
					eventCount++;
					hasValidSSE = true;
					if (line === "data: [DONE]") {
						// Reset currentEvent to avoid stale carry-over
						currentEvent = "";
						continue;
					}
					try {
						const data = JSON.parse(line.substring(6));
						// Handle error events
						if (currentEvent === "error" || data.error) {
							errorEvents.push(data);
							hasError = true;
							currentEvent = "";
							continue;
						}
						chunks.push(data);
						// Check if this chunk has OpenAI format
						if (
							!data.id ||
							!data.object ||
							data.object !== "chat.completion.chunk"
						) {
							hasOpenAIFormat = false;
						}
						// Check for content in OpenAI format (should be the primary format after transformation)
						if (
							data.choices?.[0]?.delta?.content ||
							data.choices?.[0]?.finish_reason
						) {
							hasContent = true;
						}
						// Check for usage information
						if (
							data.usage &&
							(data.usage.prompt_tokens !== null ||
								data.usage.completion_tokens !== null ||
								data.usage.total_tokens !== null)
						) {
							hasUsage = true;
						}
					} catch {}
					currentEvent = "";
				}
			}
		}
	} finally {
		reader.releaseLock();
	}
	return {
		fullContent,
		hasContent,
		eventCount,
		hasValidSSE,
		hasOpenAIFormat,
		chunks,
		hasUsage,
		errorEvents,
		hasError,
	};
}
