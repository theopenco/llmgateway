import { createAdaptorServer, serve } from "@hono/node-server";

import { startProviderEnvInventoryPublisher } from "@llmgateway/actions";
import { redisClient, storageRedisClient } from "@llmgateway/cache";
import { closeDatabase, setQueryTags } from "@llmgateway/db";
import {
	initializeInstrumentation,
	shutdownInstrumentation,
} from "@llmgateway/instrumentation";
import { logger, toError } from "@llmgateway/logger";
import { getEnterpriseLicenseStatus } from "@llmgateway/shared/enterprise-license";

import { app } from "./app.js";
import { drainPendingWork, pendingWorkCount } from "./lib/pending-work.js";
import {
	closeUpstreamDispatcher,
	installUpstreamDispatcher,
} from "./lib/upstream-dispatcher.js";
import { metricsApp } from "./metrics-app.js";
import { posthog } from "./posthog.js";
import { attachRealtimeServer } from "./realtime/server.js";

import type { RealtimeServer } from "./realtime/server.js";
import type { ServerType } from "@hono/node-server";
import type { NodeSDK } from "@opentelemetry/sdk-node";
import type { Server } from "node:http";

// GATEWAY_PORT wins over PORT so a local worktree can pin gateway and api to
// different ports from one shared shell env (both services read PORT).
// Deployments only ever set PORT, so they are unaffected.
const port = Number(process.env.GATEWAY_PORT || process.env.PORT) || 4001;

// The Prometheus metrics endpoint is served on a separate port so it can be
// exposed only internally (via the cluster network / Service) and never through
// the public gateway ingress.
const metricsPort = Number(process.env.METRICS_PORT) || 9090;

// GCP Load Balancer has a fixed 600s keepalive timeout. Node.js default is 5s.
// If Node closes the connection first, the LB sends requests on stale connections → 502.
// Default to 620s (above GCP's 600s) to ensure the LB closes first.
const keepAliveTimeoutS = Number(process.env.KEEP_ALIVE_TIMEOUT_S) || 620;

// Host the /v1/realtime WebSocket proxy inside this process, so realtime
// sessions are served on the gateway port with no extra deployment to operate.
// Opt-in because a process that mints client secrets without an attached
// listener would hand out credentials for a path nothing serves.
const realtimeInline = process.env.REALTIME_INLINE === "true";

let sdk: NodeSDK | null = null;
let metricsServer: ServerType | null = null;
let realtime: RealtimeServer | null = null;
let stopEnvInventoryPublisher: (() => void) | null = null;

async function startServer() {
	// Tag every DB query with the originating service for Cloud SQL Query Insights
	setQueryTags({ application: "gateway" });

	installUpstreamDispatcher();

	// Initialize tracing for gateway service
	try {
		sdk = initializeInstrumentation({
			serviceName: process.env.OTEL_SERVICE_NAME ?? "llmgateway-gateway",
			projectId: process.env.GOOGLE_CLOUD_PROJECT,
		});
	} catch (error) {
		logger.error("Failed to initialize instrumentation", error as Error);
		// Continue without tracing
	}

	// Serve Prometheus metrics on a separate, internal-only port.
	logger.info("Metrics server starting", { port: metricsPort });
	metricsServer = serve({
		port: metricsPort,
		fetch: metricsApp.fetch,
	});

	const enterpriseLicense = getEnterpriseLicenseStatus();
	// kind + organizationId matter as much as status: an org-bound "enterprise"
	// license reads "active" yet denies enterprise access to every other org.
	logger.info("Enterprise license status", {
		status: enterpriseLicense.status,
		kind: enterpriseLicense.kind,
		organizationId: enterpriseLicense.organizationId,
		licenseId: enterpriseLicense.licenseId,
		keyId: enterpriseLicense.keyId,
		expiresAt: enterpriseLicense.expiresAt,
		maxSeats: enterpriseLicense.maxSeats,
	});

	// Node's default accept backlog (511) overflows under connection bursts, which
	// the GKE L7 LB surfaces as "connection timeout". Raise it so bursts queue
	// instead of being dropped. The kernel caps the effective value at
	// net.core.somaxconn (4096 on modern COS nodes), so 1024 is honored.
	const listenBacklog = Number(process.env.LISTEN_BACKLOG) || 1024;

	logger.info("Server starting", { port, backlog: listenBacklog });

	const server = createAdaptorServer({ fetch: app.fetch });

	// Wait for the bind to succeed (or fail) before resolving, so a bind error
	// (e.g. EADDRINUSE) rejects startup → process.exit(1) instead of being
	// swallowed by the log-and-continue uncaughtException handler, which would
	// otherwise leave the process alive without accepting traffic.
	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			server.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			server.off("error", onError);
			resolve();
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen({ port, backlog: listenBacklog });
	});

	logger.info("Server listening", { port, backlog: listenBacklog });

	if (realtimeInline) {
		realtime = attachRealtimeServer(server as Server);
		logger.info("Realtime WebSocket proxy attached inline", { port });
	}

	// Publish which LLM_* API keys this process holds (masked and fingerprinted,
	// never the tokens) so the admin dashboard lists the keys actually serving
	// traffic. The API is a separate deployment and generally has no provider
	// keys of its own to report.
	stopEnvInventoryPublisher = startProviderEnvInventoryPublisher();

	return server;
}

let isShuttingDown = false;

// Grace period for in-flight requests to complete before force closing.
// Defaults to 20 minutes to match AI_STREAMING_TIMEOUT_MS so long-running streams
// aren't force-killed mid-flight during rollouts. Should remain <= k8s
// terminationGracePeriodSeconds (minus any preStop sleep).
const shutdownGracePeriodMs =
	Number(process.env.SHUTDOWN_GRACE_PERIOD_MS) || 1200000;

// Realtime sessions are long-lived WebSockets rather than request/response, so
// closeServer()'s idle-connection draining never retires them: a live call is
// "idle" between audio frames. They get their own explicit drain, bounded by
// the session-duration cap plus a minute so a rolling deploy converges even if
// a session runs to its limit. Must stay <= the pod's
// terminationGracePeriodSeconds, or the orchestrator SIGKILLs mid-call and the
// wait accomplishes nothing.
const realtimeShutdownGracePeriodMs =
	Number(process.env.REALTIME_SHUTDOWN_GRACE_PERIOD_MS) ||
	((Number(process.env.REALTIME_MAX_SESSION_SECONDS) || 3600) + 60) * 1000;

// Warn when handler tails (billing, log insertion) outlive their HTTP
// connection longer than expected. Shutdown continues waiting after this
// threshold because closing shared dependencies underneath live handlers is
// guaranteed to make them fail; the orchestrator owns the hard deadline.
const pendingWorkTimeoutMs =
	Number(process.env.SHUTDOWN_PENDING_WORK_TIMEOUT_MS) || 20000;

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

	// Stop refreshing before the Redis connection closes below; the snapshot
	// expires on its own once no gateway is publishing.
	stopEnvInventoryPublisher?.();
	stopEnvInventoryPublisher = null;

	try {
		// Stop accepting new realtime sessions, then let the live calls hang up
		// on their own rather than cutting them off mid-conversation. This runs
		// before closeServer() because the WebSockets would otherwise keep the
		// HTTP server open past its own grace period anyway.
		if (realtime) {
			logger.info("Draining realtime sessions", {
				activeSessions: realtime.sessionCount(),
				gracePeriodMs: realtimeShutdownGracePeriodMs,
			});
			realtime.stopAccepting();

			const deadline = Date.now() + realtimeShutdownGracePeriodMs;
			while (realtime.sessionCount() > 0 && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			if (realtime.sessionCount() > 0) {
				logger.warn("Force-closing remaining realtime sessions", {
					remaining: realtime.sessionCount(),
				});
				realtime.closeAll(1001, "server_shutdown");
				// Session finalization and its final billing writes are
				// fire-and-forget; let them flush before closeDatabase() below.
				await new Promise((resolve) => setTimeout(resolve, 2000));
			}
			logger.info("Realtime sessions drained");
		}

		logger.info("Closing HTTP server");
		await closeServer(server);
		logger.info("HTTP server closed");

		if (metricsServer) {
			logger.info("Closing metrics server");
			await closeServer(metricsServer);
			logger.info("Metrics server closed");
		}

		// Handlers whose client disconnected (or hung up right after [DONE])
		// outlive their connection, so the server is closed while their billing
		// and logging tail still runs. Wait for that work — before the upstream
		// dispatcher, database pool, and Redis close underneath it.
		const pendingAtClose = pendingWorkCount();
		if (pendingAtClose > 0) {
			logger.info("Waiting for pending request work", {
				pending: pendingAtClose,
			});
			await drainPendingWork(pendingWorkTimeoutMs, (remaining) => {
				logger.warn("Pending request work is still draining", {
					remaining,
					warningThresholdMs: pendingWorkTimeoutMs,
				});
			});
		}

		logger.info("Closing upstream dispatcher");
		await closeUpstreamDispatcher();

		// Flush batched analytics before the process winds down — posthog-node
		// buffers events (~10s), and a redeploy would otherwise drop the tail.
		// Guarded: a telemetry flush failure must not abort the shutdown.
		try {
			await posthog.shutdown();
		} catch (error) {
			logger.warn("PostHog flush failed during shutdown", {
				error: String(error),
			});
		}

		logger.info("Closing database connection");
		await closeDatabase();
		logger.info("Database connection closed");

		logger.info("Closing Redis connections");
		await Promise.all([redisClient.quit(), storageRedisClient.quit()]);
		logger.info("Redis connections closed");

		// Shutdown instrumentation last to ensure all spans are flushed
		if (sdk) {
			await shutdownInstrumentation(sdk);
		}

		logger.info("Graceful shutdown completed");
		process.exit(0);
	} catch (error) {
		logger.error("Error during graceful shutdown", toError(error));
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

		// Log and continue on process-level errors instead of shutting down. In an
		// async proxy these are common and usually benign (aborted streams, stray
		// upstream socket errors); self-terminating on them causes restart-cycling
		// under load, which surfaces as more 503s. We accept that an
		// uncaughtException leaves Node in an officially-undefined state in
		// exchange for not restart-cycling a proxy under load. SIGTERM/SIGINT still
		// trigger graceful shutdown so k8s rollouts/draining work normally.
		process.on("uncaughtException", (error) => {
			logger.error("Uncaught exception (continuing)", toError(error));
		});

		process.on("unhandledRejection", (reason) => {
			logger.error("Unhandled rejection (continuing)", toError(reason));
		});
	})
	.catch((error) => {
		logger.error("Failed to start server", error);
		process.exit(1);
	});
