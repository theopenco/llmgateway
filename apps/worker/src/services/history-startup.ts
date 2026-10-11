import { interruptibleSleep, isStopRequested } from "@/shutdown.js";

import { logger } from "@llmgateway/logger";

import { initializeMinuteRecovery } from "./stats-calculator.js";

/** Keep history writers behind the recovery boundary without blocking other jobs. */
export async function startHistoryAfterRecovery(
	start: () => void,
): Promise<void> {
	while (!isStopRequested()) {
		try {
			await initializeMinuteRecovery();
		} catch (error) {
			logger.error(
				"Error initializing minute history recovery",
				error instanceof Error ? error : new Error(String(error)),
			);
			await interruptibleSleep(5000);
			continue;
		}
		if (!isStopRequested()) {
			start();
		}
		return;
	}
}
