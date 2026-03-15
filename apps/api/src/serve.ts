import { serve, type ServerType } from "@hono/node-server";

import { closeDatabase, runMigrations } from "@llmgateway/db";
import {
	initializeInstrumentation,
	shutdownInstrumentation,
} from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";

import { redisClient } from "./auth/config.js";
import { app } from "./index.js";
import {
	sendInstallationBeacon,
	startDailyBeacon,
	stopDailyBeacon,
} from "./lib/beacon.js";

import type { NodeSDK } from "@opentelemetry/sdk-node";
import type { Server } from "node:http";

// Increase keepAliveTimeout from Node.js default of 5s to reduce 502 errors
// from GCP Load Balancer reusing stale connections.
const keepAliveTimeoutS = Number(process.env.KEEP_ALIVE_TIMEOUT_S) || 60;

let sdk: NodeSDK | null = null;

async function startServer() {
	const port = Number(process.env.PORT) || 4002;

	// Initialize tracing for API service
	try {
		sdk = initializeInstrumentation({
			serviceName: process.env.OTEL_SERVICE_NAME ?? "llmgateway-api",
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

	// Start daily beacon schedule to track active installations
	startDailyBeacon();

	logger.info("Server listening", { port });

	return serve({
		port,
		fetch: app.fetch,
	});
}

let isShuttingDown = false;

// Grace period for in-flight requests to complete before force closing (default 120s)
const shutdownGracePeriodMs =
	Number(process.env.SHUTDOWN_GRACE_PERIOD_MS) || 120000;

const closeServer = (server: ServerType): Promise<void> => {
	return new Promise((resolve, reject) => {
		const httpServer = server as Server;

		// server.close() stops accepting new connections but waits for ALL connections
		// to close, including idle keep-alive connections (which could wait 60s!)
		httpServer.close((error) => {
			clearTimeout(timeout);
			clearInterval(drainInterval);
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});

		// Periodically close idle keep-alive connections so server.close() can complete
		// This is safe because it only closes connections without active requests
		const drainInterval = setInterval(() => {
			httpServer.closeIdleConnections();
		}, 100);

		// Force close all connections after grace period expires
		const timeout = setTimeout(() => {
			logger.warn(
				"Graceful shutdown timeout reached, forcing close of remaining connections",
				{ gracePeriodMs: shutdownGracePeriodMs },
			);
			clearInterval(drainInterval);
			httpServer.closeAllConnections();
		}, shutdownGracePeriodMs);
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

		logger.info("Stopping daily beacon schedule");
		stopDailyBeacon();

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
		(server as Server).keepAliveTimeout = keepAliveTimeoutS * 1000;
		(server as Server).headersTimeout = (keepAliveTimeoutS + 1) * 1000;

		process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
		process.on("SIGINT", () => gracefulShutdown("SIGINT", server));

		process.on("uncaughtException", (error) => {
			logger.error("Uncaught exception", error);
			process.exit(1);
		});

		process.on("unhandledRejection", (reason) => {
			logger.error("Unhandled rejection", reason);
			process.exit(1);
		});
	})
	.catch((error) => {
		logger.error("Failed to start server", error);
		process.exit(1);
	});
