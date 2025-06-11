import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Run database migrations using drizzle-orm
 * This function connects to the database and applies all pending migrations
 */
export async function runMigrations(): Promise<void> {
	const databaseUrl =
		process.env.DATABASE_URL || "postgres://postgres:pw@localhost:5389/db";

	console.log("🔄 Starting database migrations...");

	// Create a drizzle instance for migrations
	const migrationDb = drizzle({
		connection: databaseUrl,
	});

	try {
		// Run migrations from the migrations folder
		await migrate(migrationDb, {
			migrationsFolder: "./migrations", // we copy this in the dockerfile
		});
		console.log("✅ Database migrations completed successfully");
	} catch (error) {
		console.error("❌ Database migration failed:", error);
		throw error;
	}
}
