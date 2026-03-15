import { defineConfig } from "drizzle-kit";

// noinspection JSUnusedGlobalSymbols
export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema.ts",
	out: "./migrations",
	casing: "snake_case",
	migrations: {
		prefix: "unix",
	},
	dbCredentials: {
		url: process.env.DATABASE_URL ?? "postgres://postgres:pw@localhost:5432/db",
	},
});
