import { serve } from "@hono/node-server";
import { closeDatabase, runMigrations } from "@llmgateway/db";

import { app } from "./index";
import { sendInstallationBeacon } from "./lib/beacon";

async function startServer() {
	const port = Number(process.env.PORT) || 4002;

	// Run migrations if the environment variable is set
	if (process.env.RUN_MIGRATIONS === "true") {
		try {
			await runMigrations();
		} catch (error) {
			console.error("Failed to run migrations, exiting...", error);
			process.exit(1);
		}
	}

	// Send installation beacon for self-hosted tracking
	// This runs in the background and won't block startup
	void sendInstallationBeacon();

	console.log("listening on port", port);

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
		console.log("Shutdown already in progress, ignoring signal:", signal);
		return;
	}

	isShuttingDown = true;
	console.log(`Received ${signal}, starting graceful shutdown...`);

	try {
		console.log("Closing HTTP server...");
		await closeServer(server);
		console.log("HTTP server closed");

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

// Start the server
startServer()
	.then((server) => {
		process.on("SIGTERM", () => gracefulShutdown("SIGTERM", server));
		process.on("SIGINT", () => gracefulShutdown("SIGINT", server));

		process.on("uncaughtException", (error) => {
			console.error("Uncaught exception:", error);
			process.exit(1);
		});

		process.on("unhandledRejection", (reason, promise) => {
			console.error("Unhandled rejection at:", promise, "reason:", reason);
			process.exit(1);
		});
	})
	.catch((error) => {
		console.error("Failed to start server:", error);
		process.exit(1);
	});
