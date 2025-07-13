import { serve } from "@hono/node-server";
import { closeDatabase } from "@llmgateway/db";

import { app } from "./index";
import redisClient from "./lib/redis";
import { startWorker, stopWorker } from "./worker";

const port = Number(process.env.PORT) || 4001;

console.log("listening on port", port);

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
		console.log("Shutdown already in progress, ignoring signal:", signal);
		return;
	}

	isShuttingDown = true;
	console.log(`Received ${signal}, starting graceful shutdown...`);

	try {
		console.log("Stopping worker...");
		await stopWorker();
		console.log("Worker stopped successfully");

		console.log("Closing HTTP server...");
		await closeServer();
		console.log("HTTP server closed");

		console.log("Closing Redis connection...");
		await redisClient.quit();
		console.log("Redis connection closed");

		console.log("Closing database connection...");
		await closeDatabase();
		console.log("Database connection closed");

		console.log("Graceful shutdown completed");
		process.exit(0);
	} catch (error) {
		console.error("Error during graceful shutdown:", error);
		process.exit(1);
	}
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("uncaughtException", (error) => {
	console.error("Uncaught exception:", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled rejection at:", promise, "reason:", reason);
	process.exit(1);
});
