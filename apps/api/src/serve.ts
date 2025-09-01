import { serve } from "@hono/node-server";
import { closeDatabase, runMigrations } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { app } from "./index";
import { sendInstallationBeacon } from "./lib/beacon";

async function startServer() {
	const port = Number(process.env.PORT) || 4002;

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

const closeServer = (server: any): Promise<void> => {
	return new Promise((resolve, reject) => {
		server.close((error: any) => {
			if (error) {
				reject(error);
			} else {
				resolve();
			}
		});
	});
};

const gracefulShutdown = async (signal: string, server: any) => {
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
