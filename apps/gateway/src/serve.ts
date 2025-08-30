import { serve } from "@hono/node-server";
import { closeDatabase } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { app } from "./index";
import redisClient from "./lib/redis";
import { startWorker, stopWorker } from "./worker";

const port = Number(process.env.PORT) || 4001;

logger.info("Server starting", { port });

void startWorker();

const server = serve({
	port,
	fetch: app.fetch,
});

let isShuttingDown = false;

const closeServer = (): Promise<void> => {
	return new Promise((resolve, reject) => {
		server.close((error) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
};

const gracefulShutdown = async (signal: string) => {
	if (isShuttingDown) {
		logger.warn("Shutdown already in progress, ignoring signal", { signal });
		return;
	}

	isShuttingDown = true;
	logger.info("Received shutdown signal, starting graceful shutdown", {
		signal,
	});

	try {
		logger.info("Stopping worker");
		await stopWorker();
		logger.info("Worker stopped successfully");

		logger.info("Closing HTTP server");
		await closeServer();
		logger.info("HTTP server closed");

		logger.info("Closing Redis connection");
		await redisClient.quit();
		logger.info("Redis connection closed");

		logger.info("Closing database connection");
		await closeDatabase();
		logger.info("Database connection closed");

		logger.info("Graceful shutdown completed");
		process.exit(0);
	} catch (error) {
		logger.error(
			"Error during graceful shutdown",
			error instanceof Error ? error : new Error(String(error)),
		);
		process.exit(1);
	}
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
	logger.fatal("Uncaught exception", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	logger.fatal("Unhandled rejection", { promise, reason });
	process.exit(1);
});
