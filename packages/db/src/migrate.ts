import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { logger } from "@llmgateway/logger";

import { clearRowCaches } from "./cache-reset.js";
import { SCHEMA_CACHE_VERSION } from "./schema-cache-version.js";

type MigrationDb = ReturnType<typeof drizzle>;

/**
 * How many migrations the database has applied so far. Returns 0 before the
 * first migration has ever run, when Drizzle's bookkeeping table is absent.
 */
async function countAppliedMigrations(db: MigrationDb): Promise<number> {
	// Probe first: naming a missing table fails at parse time, so this cannot be
	// folded into the count query itself.
	const present = await db.execute(
		sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
	);
	if (present.rows[0]?.present !== true) {
		return 0;
	}

	const result = await db.execute(
		sql`select count(*)::int as count from drizzle.__drizzle_migrations`,
	);
	return Number(result.rows[0]?.count ?? 0);
}

/**
 * Run database migrations using drizzle-orm
 * This function connects to the database and applies all pending migrations
 */
export async function runMigrations(): Promise<void> {
	const databaseUrl =
		process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db";

	logger.info("Starting database migrations", {
		schemaCacheVersion: SCHEMA_CACHE_VERSION,
	});

	// Create a drizzle instance for migrations
	const migrationDb = drizzle({
		connection: databaseUrl,
	});

	try {
		const appliedBefore = await countAppliedMigrations(migrationDb);

		// Run migrations from the migrations folder
		await migrate(migrationDb, {
			migrationsFolder: "./migrations", // we copy this in the dockerfile
		});
		logger.info("Database migrations completed successfully");

		// A migration changes the shape of the rows already sitting in Redis, so
		// drop them rather than let them be served against the new schema.
		if ((await countAppliedMigrations(migrationDb)) > appliedBefore) {
			await clearRowCaches();
		}
	} catch (error) {
		logger.error(
			"Database migration failed",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
