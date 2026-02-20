import { instrumentDrizzle } from "@kubiks/otel-drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { logger } from "@llmgateway/logger";

import { relations } from "./relations.js";

// Single shared pool for all database connections
// This prevents connection exhaustion from having multiple pools
export const pool = new Pool({
	connectionString:
		process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
	// Explicit pool configuration for production reliability
	max: Number(process.env.DATABASE_POOL_MAX) || 20, // Maximum connections in pool
	min: Number(process.env.DATABASE_POOL_MIN) || 2, // Minimum connections to maintain
	idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000, // Close idle connections after 30s
	connectionTimeoutMillis:
		Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS) || 10000, // Fail fast if can't connect in 10s
	allowExitOnIdle: false,
	keepAlive: true,
	keepAliveInitialDelayMillis: 10000, // Start sending keepalive probes after 10s of idle
});

// Log pool errors to help diagnose connection issues
pool.on("error", (err) => {
	logger.error("Unexpected database pool error", err);
});

// Log when pool connects (trace level to avoid noise in production)
pool.on("connect", () => {
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
	casing: "snake_case",
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
