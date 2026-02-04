import { serve } from "@hono/node-server";

import { redisClient } from "@llmgateway/cache";
import { closeDatabase } from "@llmgateway/db";
import {
	initializeInstrumentation,
	shutdownInstrumentation,
} from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";

import { app } from "./app.js";

import type { ServerType } from "@hono/node-server";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import type { Server } from "node:http";

const port = Number(process.env.PORT) || 4001;

// GCP Load Balancer has a fixed 600s keepalive timeout. Node.js default is 5s.
// If Node closes the connection first, the LB sends requests on stale connections → 502.
// Default to 620s (above GCP's 600s) to ensure the LB closes first.
const keepAliveTimeoutS = Number(process.env.KEEP_ALIVE_TIMEOUT_S) || 620;

let sdk: NodeSDK | null = null;

async function startServer() {
	// Initialize tracing for gateway service
	try {
		sdk = initializeInstrumentation({
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

// Grace period for in-flight requests to complete before force closing (default 120s)
const shutdownGracePeriodMs =
	Number(process.env.SHUTDOWN_GRACE_PERIOD_MS) || 120000;

const closeServer = (server: ServerType): Promise<void> => {
	return new Promise((resolve, reject) => {
		const httpServer = server as Server;

		// server.close() stops accepting new connections but waits for ALL connections
		// to close, including idle keep-alive connections (which could wait 620s!)
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
		// headersTimeout must be greater than keepAliveTimeout
		// Using +5s margin to account for processing time and avoid race conditions
		(server as Server).headersTimeout = (keepAliveTimeoutS + 5) * 1000;

		process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
		process.on("SIGINT", () => gracefulShutdown("SIGINT", server));

		// Handle uncaught errors gracefully - allow in-flight requests to complete
		// before exiting. This prevents 502s for all concurrent requests when
		// a single request causes an unhandled error.
		process.on("uncaughtException", (error) => {
			logger.fatal("Uncaught exception, initiating graceful shutdown", error);
			gracefulShutdown("uncaughtException", server);
		});

		process.on("unhandledRejection", (reason, promise) => {
			logger.fatal("Unhandled rejection, initiating graceful shutdown", {
				promise,
				reason,
			});
			gracefulShutdown("unhandledRejection", server);
		});
	})
	.catch((error) => {
		logger.error(
			"Failed to start server",
			error instanceof Error ? error : new Error(String(error)),
		);
		process.exit(1);
	});
