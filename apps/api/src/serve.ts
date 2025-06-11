import { serve } from "@hono/node-server";
import { runMigrations } from "@llmgateway/db";

import { app } from "./index";

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

	console.log("listening on port", port);

	serve({
		port,
		fetch: app.fetch,
	});
}

// Start the server
startServer().catch((error) => {
	console.error("Failed to start server:", error);
	process.exit(1);
});
