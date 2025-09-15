import { redisClient } from "@llmgateway/cache";
import { db, tables, eq } from "@llmgateway/db";

import { processLogQueue } from "../../../worker/src/worker";

export { getProviderEnvVar } from "../lib/provider";

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
	maxWaitMs = 10000,
	intervalMs = 100,
) {
	const startTime = Date.now();
	console.log(
		`Waiting for log with request ID ${requestId} (timeout: ${maxWaitMs}ms)...`,
	);

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
			console.log(
				`Found log with request ID ${requestId} after ${Date.now() - startTime}ms`,
			);
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
