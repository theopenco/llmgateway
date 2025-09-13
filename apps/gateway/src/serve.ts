import { serve } from "@hono/node-server";

import { redisClient } from "@llmgateway/cache";
import { closeDatabase } from "@llmgateway/db";
import {
	initializeInstrumentation,
	shutdownInstrumentation,
} from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";

import { app } from ".";

import type { ServerType } from "@hono/node-server";
import type { NodeSDK } from "@opentelemetry/sdk-node";

const port = Number(process.env.PORT) || 4001;

let sdk: NodeSDK | null = null;

async function startServer() {
	// Initialize tracing for gateway service
	try {
		sdk = await initializeInstrumentation({
			serviceName: process.env.OTEL_SERVICE_NAME || "llmgateway-gateway",
			projectId: process.env.GOOGLE_CLOUD_PROJECT,
		});
	} catch (error) {
		logger.error("Failed to initialize instrumentation", error as Error);
		// Continue without tracing
	}

	logger.info("Server starting", { port });

	return serve({
		port,
		fetch: app.fetch,
	});
}

let isShuttingDown = false;

const closeServer = (server: ServerType): Promise<void> => {
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

const gracefulShutdown = async (signal: string, server: ServerType) => {
	if (isShuttingDown) {
		logger.warn("Shutdown already in progress, ignoring signal", { signal });
		return;
	}

	isShuttingDown = true;
	logger.info("Received shutdown signal, starting graceful shutdown", {
		signal,
	});

	try {
		logger.info("Closing HTTP server");
		await closeServer(server);
		logger.info("HTTP server closed");

		logger.info("Closing Redis connection");
		await redisClient.quit();
		logger.info("Redis connection closed");

		logger.info("Closing database connection");
		await closeDatabase();
		logger.info("Database connection closed");

		// Shutdown instrumentation last to ensure all spans are flushed
		if (sdk) {
			await shutdownInstrumentation(sdk);
		}

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

// Start the server
startServer()
	.then((server) => {
		process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
		process.on("SIGINT", () => gracefulShutdown("SIGINT", server));

		process.on("uncaughtException", (error) => {
			logger.fatal("Uncaught exception", error);
			process.exit(1);
		});

		process.on("unhandledRejection", (reason, promise) => {
			logger.fatal("Unhandled rejection", { promise, reason });
			process.exit(1);
		});
	})
	.catch((error) => {
		logger.error(
			"Failed to start server",
			error instanceof Error ? error : new Error(String(error)),
		);
		process.exit(1);
	});
