import { createServer } from "node:http";

import { redisClient } from "@llmgateway/cache";
import { closeDatabase, setQueryTags } from "@llmgateway/db";
import { logger, toError } from "@llmgateway/logger";

import { attachRealtimeServer } from "./server.js";

const port = Number(process.env.REALTIME_PORT) || 4003;

// Existing sessions may run up to the session-duration limit; the shutdown
// grace defaults to that limit plus a minute so a rolling deploy drains
// cleanly. Must stay <= the pod's terminationGracePeriodSeconds.
const shutdownGracePeriodMs =
	Number(process.env.REALTIME_SHUTDOWN_GRACE_PERIOD_MS) ||
	((Number(process.env.REALTIME_MAX_SESSION_SECONDS) || 3600) + 60) * 1000;

setQueryTags({ application: "gateway-realtime" });

const httpServer = createServer((req, res) => {
	if (req.url === "/healthz" || req.url === "/") {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				status: "ok",
				sessions: realtime.sessionCount(),
			}),
		);
		return;
	}
	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(
		JSON.stringify({
			error: {
				message:
					"This is the LLMGateway realtime service. Connect via WebSocket at /v1/realtime.",
				type: "invalid_request_error",
				param: null,
				code: "not_found",
			},
		}),
	);
});

const realtime = attachRealtimeServer(httpServer);

httpServer.listen(port, () => {
	logger.info("Realtime server started", { port });
});

let isShuttingDown = false;

async function gracefulShutdown(signal: string, exitCode = 0): Promise<void> {
	if (isShuttingDown) {
		logger.warn("Shutdown already in progress, ignoring signal", { signal });
		return;
	}
	isShuttingDown = true;
	logger.info("Received shutdown signal, draining realtime sessions", {
		signal,
		activeSessions: realtime.sessionCount(),
	});

	// Stop accepting new sessions immediately; readiness fails via the closed
	// listener while existing sessions drain.
	realtime.stopAccepting();
	httpServer.close();

	const deadline = Date.now() + shutdownGracePeriodMs;
	while (realtime.sessionCount() > 0 && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	if (realtime.sessionCount() > 0) {
		logger.warn("Force-closing remaining realtime sessions", {
			remaining: realtime.sessionCount(),
		});
		realtime.closeAll(1001, "server_shutdown");
		// Give the close frames and final billing writes a moment to flush.
		await new Promise((resolve) => setTimeout(resolve, 2000));
	}

	try {
		await closeDatabase();
		await redisClient.quit();
	} catch (error) {
		logger.error("Error during realtime shutdown cleanup", toError(error));
	}
	logger.info("Realtime graceful shutdown completed");
	process.exit(exitCode);
}

process.on("SIGTERM", () => void gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => void gracefulShutdown("SIGINT"));
// Fatal paths must exit non-zero: a zero exit reads as an intentional stop to
// orchestrators and alerting.
process.on("uncaughtException", (error) => {
	logger.fatal("Uncaught exception in realtime server", error);
	void gracefulShutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (reason) => {
	logger.fatal("Unhandled rejection in realtime server", toError(reason));
	void gracefulShutdown("unhandledRejection", 1);
});
