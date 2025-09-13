import { redisClient } from "@llmgateway/cache";
import { db } from "@llmgateway/db";

import { processLogQueue } from "../worker";

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
