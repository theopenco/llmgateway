import { beforeEach } from "vitest";

/**
 * Exponential backoff before test retries.
 * Delays: retry 1 = 1s, retry 2 = 2s, retry 3 = 4s, retry 4 = 8s, retry 5 = 16s
 */
beforeEach(async (context) => {
	const retryCount = context.task.result?.retryCount;
	if (retryCount && retryCount > 0) {
		const delayMs = 1000 * Math.pow(2, retryCount - 1);
		console.log(
			`Retry attempt ${retryCount} - waiting ${delayMs}ms before retrying`,
		);
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
});
