import { fileURLToPath } from "node:url";

import { setQueryTags } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";

import { posthog } from "./posthog.js";
import { startWorker, stopWorker } from "./worker.js";

export { processLogQueue } from "./worker.js";
export {
	processPendingVideoJobs,
	processPendingWebhookDeliveries,
} from "./services/video-jobs.js";

const POSTHOG_SHUTDOWN_TIMEOUT_MS = 5000;

let isShuttingDown = false;

export async function stopWorkerAndFlush(): Promise<void> {
	try {
		await stopWorker();
	} finally {
		try {
			await posthog.shutdown(POSTHOG_SHUTDOWN_TIMEOUT_MS);
		} catch (error) {
			logger.warn("PostHog flush failed during shutdown", {
				error: toError(error),
			});
		}
	}
}

async function gracefulShutdown(): Promise<void> {
	if (isShuttingDown) {
		return;
	}

	isShuttingDown = true;
	logger.info("Received shutdown signal, stopping worker...");

	try {
		await stopWorkerAndFlush();
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

function isDirectExecution() {
	const entrypoint = process.argv[1];
	if (!entrypoint) {
		return false;
	}

	return fileURLToPath(import.meta.url) === entrypoint;
}

if (isDirectExecution()) {
	// Tag every DB query with the originating service for Cloud SQL Query Insights
	setQueryTags({ application: "worker" });

	logger.info("Starting worker application...");
	startWorker().catch((error) => {
		logger.error(
			"Failed to start worker",
			error instanceof Error ? error : new Error(String(error)),
		);
		process.exit(1);
	});
}
