import { drizzle } from "drizzle-orm/node-postgres";
import { Client } from "pg";

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
		console.log("Database connection closed");
	} catch (error) {
		console.error("Error closing database connection:", error);
		throw error;
	}
}
