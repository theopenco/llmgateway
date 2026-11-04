import { hostname } from "node:os";

import { instrumentDrizzle } from "@kubiks/otel-drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, Pool, type ClientConfig } from "pg";

import { logger } from "@llmgateway/logger";

import { getQueryTag, patchClientQuery } from "./query-tags.js";
import { relations } from "./relations.js";

function envMs(name: string, fallback: number | undefined): number | undefined {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		return fallback;
	}
	const value = Number(raw);
	return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/**
 * `<service>/<pod>` in pg_stat_activity, so a blocking or leaked session can be
 * traced to the process that opened it. Resolved per connection because the
 * service sets its query tags after this module loads.
 */
export function databaseApplicationName(): string {
	return (
		process.env.DATABASE_APPLICATION_NAME ??
		`${getQueryTag("application") ?? "llmgateway"}/${hostname()}`
	).slice(0, 63);
}

/**
 * Session limits sent as startup parameters on every pool connection. A query
 * waiting on a lock fails after lock_timeout instead of holding a pool slot
 * (and a server connection) until the blocker finishes, and a transaction left
 * idle is aborted instead of pinning its locks.
 */
export const databaseSessionSettings = {
	lock_timeout: envMs("DATABASE_LOCK_TIMEOUT_MS", 10_000),
	idle_in_transaction_session_timeout: envMs(
		"DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS",
		60_000,
	),
	// Unset by default so long worker queries keep the server/role default.
	statement_timeout: envMs("DATABASE_STATEMENT_TIMEOUT_MS", undefined),
} satisfies Pick<
	ClientConfig,
	"lock_timeout" | "idle_in_transaction_session_timeout" | "statement_timeout"
>;

class SessionClient extends Client {
	public constructor(config?: string | ClientConfig) {
		super({
			...(typeof config === "string" ? { connectionString: config } : config),
			application_name: databaseApplicationName(),
		});
	}
}

// Single shared pool for all database connections
// This prevents connection exhaustion from having multiple pools
export const pool = new Pool({
	connectionString:
		process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
	// Explicit pool configuration for production reliability
	max: Number(process.env.DATABASE_POOL_MAX) || 8, // Per-process cap; multiply by replicas (incl. deploy surge) and keep under the server max_connections
	min: Number(process.env.DATABASE_POOL_MIN) || 2, // Minimum connections to maintain
	idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 10000, // Release idle connections after 10s so bursts do not pin server slots
	connectionTimeoutMillis:
		Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS) || 10000, // Fail fast if can't connect in 10s
	allowExitOnIdle: false,
	keepAlive: true,
	keepAliveInitialDelayMillis: 10000, // Start sending keepalive probes after 10s of idle
	...databaseSessionSettings,
	Client: SessionClient,
});

const poolMax = pool.options.max;

/** Pool occupancy for metrics: see `registerDbPoolMetrics`. */
export function getPoolStats(): {
	total: number;
	idle: number;
	waiting: number;
	max: number;
} {
	return {
		total: pool.totalCount,
		idle: pool.idleCount,
		waiting: pool.waitingCount,
		max: poolMax,
	};
}

// Log pool errors to help diagnose connection issues
pool.on("error", (err) => {
	logger.error("Unexpected database pool error", err);
});

// Log when pool connects (trace level to avoid noise in production) and patch
// the new client so every statement it runs carries the sqlcommenter tag.
pool.on("connect", (client) => {
	patchClientQuery(client);
	logger.trace("New database connection established");
});

// Log when connections are removed from pool
pool.on("remove", () => {
	logger.trace("Database connection removed from pool");
});

const instrumentedPool = instrumentDrizzle(pool, {
	dbSystem: "postgresql",
	dbName: "llmgateway",
	captureQueryText: true,
	maxQueryTextLength: 5000,
});

export const db = drizzle({
	client: instrumentedPool,
	relations,
});

export async function closeDatabase(): Promise<void> {
	try {
		await pool.end();
		logger.info("Database connection pool closed");
	} catch (error) {
		logger.error(
			"Error closing database connection pool",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
