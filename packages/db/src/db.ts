import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

import { logger } from "@llmgateway/logger";

import { relations } from "./relations";

const client = new Client({
	connectionString:
		process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5432/db",
});

void client.connect();

export const db = drizzle({
	client,
	casing: "snake_case",
	relations,
});

export async function closeDatabase(): Promise<void> {
	try {
		await client.end();
		logger.info("Database connection closed");
	} catch (error) {
		logger.error(
			"Error closing database connection",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
