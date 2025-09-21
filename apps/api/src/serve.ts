import { serve, type ServerType } from "@hono/node-server";

import { closeDatabase, runMigrations } from "@llmgateway/db";
import {
	initializeInstrumentation,
	shutdownInstrumentation,
} from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";

import { redisClient } from "./auth/config.js";
import { app } from "./index.js";
import { sendInstallationBeacon } from "./lib/beacon.js";

import type { NodeSDK } from "@opentelemetry/sdk-node";

let sdk: NodeSDK | null = null;

async function startServer() {
	const port = Number(process.env.PORT) || 4002;

	// Initialize tracing for API service
	try {
		sdk = await initializeInstrumentation({
			serviceName: process.env.OTEL_SERVICE_NAME || "llmgateway-api",
			projectId: process.env.GOOGLE_CLOUD_PROJECT,
		});
	} catch (error) {
		logger.error("Failed to initialize instrumentation", error as Error);
		// Continue without tracing
	}

	// Run migrations if the environment variable is set
	if (process.env.RUN_MIGRATIONS === "true") {
		try {
			await runMigrations();
		} catch (error) {
			logger.error(
				"Failed to run migrations, exiting",
				error instanceof Error ? error : new Error(String(error)),
			);
			process.exit(1);
		}
	}

	// Send installation beacon for self-hosted tracking
	// This runs in the background and won't block startup
	void sendInstallationBeacon();

	logger.info("Server listening", { port });

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
		logger.info("Shutdown already in progress, ignoring signal", { signal });
		return;
	}

	isShuttingDown = true;
	logger.info("Starting graceful shutdown", { signal });

	try {
		logger.info("Closing HTTP server");
		await closeServer(server);
		logger.info("HTTP server closed");

		logger.info("Closing database connection");
		await closeDatabase();
		logger.info("Database connection closed");

		logger.info("Closing Redis connection");
		await redisClient.quit();
		logger.info("Redis connection closed");

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
			logger.error("Uncaught exception", error);
			process.exit(1);
		});

		process.on("unhandledRejection", (reason, promise) => {
			logger.error("Unhandled rejection", { promise, reason });
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
