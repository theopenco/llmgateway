import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { relations } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { RedisCache } from "./redis-cache.js";

// Import relations from the db package

const pool = new Pool({
	connectionString:
		process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/db",
});

export const cachedDb = drizzle({
	client: pool,
	casing: "snake_case",
	relations,
	cache: new RedisCache(),
});

export async function closeCachedDatabase(): Promise<void> {
	try {
		await pool.end();
		logger.info("Cached database connection pool closed");
	} catch (error) {
		logger.error(
			"Error closing cached database connection pool",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
