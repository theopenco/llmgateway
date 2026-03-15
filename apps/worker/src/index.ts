import { logger } from "@llmgateway/logger";

import { startWorker, stopWorker } from "./worker.js";

export { processLogQueue } from "./worker.js";

let isShuttingDown = false;

async function gracefulShutdown(): Promise<void> {
	if (isShuttingDown) {
		return;
	}

	isShuttingDown = true;
	logger.info("Received shutdown signal, stopping worker...");

	try {
		await stopWorker();
		logger.info("Worker stopped gracefully");
		process.exit(0);
	} catch (error) {
		logger.error(
			"Error during graceful shutdown",
			error instanceof Error ? error : new Error(String(error)),
		);
		process.exit(1);
	}
}

// Handle graceful shutdown
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
	logger.error("Uncaught exception", error);
	void gracefulShutdown();
});

process.on("unhandledRejection", (reason) => {
	logger.error(
		"Unhandled promise rejection",
		reason instanceof Error ? reason : new Error(String(reason)),
	);
	void gracefulShutdown();
});

// Start the worker
logger.info("Starting worker application...");
startWorker().catch((error) => {
	logger.error(
		"Failed to start worker",
		error instanceof Error ? error : new Error(String(error)),
	);
	process.exit(1);
});
