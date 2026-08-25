import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { logger } from "@llmgateway/logger";

const catalogUsageModePreMigrationStatements = [
	`ALTER TABLE "model_history" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL`,
	`ALTER TABLE "model_history_hourly" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL`,
	`ALTER TABLE "model_provider_mapping_history" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL`,
	`ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL`,
	`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "model_history_model_minute_mode_unique" ON "model_history" ("model_id","minute_timestamp","used_mode")`,
	`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "model_history_model_hour_mode_unique" ON "model_history_hourly" ("model_id","hour_timestamp","used_mode")`,
	`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_mapping_minute_mode_unique" ON "model_provider_mapping_history" ("model_provider_mapping_id","minute_timestamp","used_mode")`,
	`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_mapping_hour_mode_unique" ON "model_provider_mapping_history_hourly" ("model_provider_mapping_id","hour_timestamp","used_mode")`,
	`CREATE INDEX CONCURRENTLY IF NOT EXISTS "model_provider_mapping_history_provider_stats_v4_idx" ON "model_provider_mapping_history" ("minute_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration")`,
	`CREATE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_hourly_provider_stats_v4_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration")`,
] as const;

async function prepareCatalogUsageModeMigration(
	databaseUrl: string,
): Promise<void> {
	const client = new Client({ connectionString: databaseUrl });
	await client.connect();

	try {
		const { rows } = await client.query<{
			tablesExist: boolean;
			migrationApplied: boolean;
		}>(`
			SELECT
				to_regclass('model_history') IS NOT NULL
					AND to_regclass('model_history_hourly') IS NOT NULL
					AND to_regclass('model_provider_mapping_history') IS NOT NULL
					AND to_regclass('model_provider_mapping_history_hourly') IS NOT NULL
					AS "tablesExist",
				EXISTS (
					SELECT 1
					FROM pg_constraint
					WHERE conname = 'model_history_model_minute_mode_unique'
						AND conrelid = to_regclass('model_history')
				) AS "migrationApplied"
		`);
		const state = rows[0];
		if (!state?.tablesExist || state.migrationApplied) {
			return;
		}

		logger.info("Preparing catalog usage mode migration");
		for (const statement of catalogUsageModePreMigrationStatements) {
			await client.query(statement);
		}
	} finally {
		await client.end();
	}
}

/**
 * Run database migrations using drizzle-orm
 * This function connects to the database and applies all pending migrations
 */
export async function runMigrations(): Promise<void> {
	const databaseUrl =
		process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db";

	logger.info("Starting database migrations");

	// Create a drizzle instance for migrations
	const migrationDb = drizzle({
		connection: databaseUrl,
	});

	try {
		await prepareCatalogUsageModeMigration(databaseUrl);

		// Run migrations from the migrations folder
		await migrate(migrationDb, {
			migrationsFolder: "./migrations", // we copy this in the dockerfile
		});
		logger.info("Database migrations completed successfully");
	} catch (error) {
		logger.error(
			"Database migration failed",
			error instanceof Error ? error : new Error(String(error)),
		);
		throw error;
	}
}
