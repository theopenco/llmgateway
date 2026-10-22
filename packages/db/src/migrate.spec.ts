import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { randomToken } from "@llmgateway/shared/random";

import {
	checkMigrations,
	runMigrations,
	type MigrationOptions,
} from "./migrate.js";

const BP = "--> statement-breakpoint";

let folder: string;
let schema: string;
let admin: Client;
let options: MigrationOptions;

function writeMigration(name: string, statements: string[]): void {
	mkdirSync(join(folder, name));
	writeFileSync(
		join(folder, name, "migration.sql"),
		statements.join(`\n${BP}\n`),
	);
}

async function appliedNames(): Promise<string[]> {
	const result = await admin.query<{ name: string }>(
		`select name from "${schema}_bk"."__drizzle_migrations" order by id`,
	);
	return result.rows.map((row) => row.name);
}

async function columnExists(table: string, column: string): Promise<boolean> {
	const result = await admin.query(
		"select 1 from information_schema.columns where table_schema = $1 and table_name = $2 and column_name = $3",
		[schema, table, column],
	);
	return result.rows.length > 0;
}

async function connectSession(): Promise<Client> {
	const client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	return client;
}

beforeEach(async () => {
	folder = mkdtempSync(join(tmpdir(), "llmgateway-migrate-spec-"));
	schema = `mig_spec_${randomToken(8)}`;
	admin = await connectSession();
	options = {
		migrationsFolder: folder,
		migrationsSchema: `${schema}_bk`,
		clearCaches: false,
		lockTimeoutMs: 200,
		maxAttempts: 2,
		retryBaseDelayMs: 50,
		requirePrebuiltIndexes: false,
	};
	writeMigration("20260101000000_init", [
		`CREATE SCHEMA "${schema}";`,
		`CREATE TABLE "${schema}"."a" ("id" integer PRIMARY KEY, "x" integer);`,
		`CREATE TABLE "${schema}"."b" ("id" integer PRIMARY KEY);`,
	]);
	expect(await runMigrations(options)).toEqual(["20260101000000_init"]);
});

afterEach(async () => {
	await admin.query(`drop schema if exists "${schema}" cascade`);
	await admin.query(`drop schema if exists "${schema}_bk" cascade`);
	await admin.end();
	rmSync(folder, { recursive: true, force: true });
});

describe("runMigrations", () => {
	it("is a no-op once everything is applied", async () => {
		expect(await runMigrations(options)).toEqual([]);
	});

	it("fails fast under lock contention and leaves the migration unapplied", async () => {
		writeMigration("20260102000000_add_columns", [
			`ALTER TABLE "${schema}"."a" ADD COLUMN "y" integer;`,
			`ALTER TABLE "${schema}"."b" ADD COLUMN "z" integer;`,
		]);

		// A long-running read on `b`, like the dashboard log searches in the
		// 2026-10-19 outage: ADD COLUMN needs ACCESS EXCLUSIVE and must not wait.
		const holder = await connectSession();
		await holder.query("BEGIN");
		await holder.query(`select * from "${schema}"."b"`);
		try {
			const startedAt = Date.now();
			await expect(runMigrations(options)).rejects.toMatchObject({
				code: "55P03",
			});
			expect(Date.now() - startedAt).toBeLessThan(5000);

			// Rolled back: neither the column on `a` nor the bookkeeping row survived.
			expect(await columnExists("a", "y")).toBe(false);
			expect(await appliedNames()).toEqual(["20260101000000_init"]);

			// App queries on `a` were never left queued behind the migration.
			const probe = await connectSession();
			await probe.query("SET lock_timeout = '1s'");
			await probe.query(`select * from "${schema}"."a"`);
			await probe.end();
		} finally {
			await holder.query("ROLLBACK");
			await holder.end();
		}

		expect(await runMigrations(options)).toEqual([
			"20260102000000_add_columns",
		]);
		expect(await columnExists("a", "y")).toBe(true);
		expect(await columnExists("b", "z")).toBe(true);
	});

	it("retries when the lock frees up between attempts", async () => {
		writeMigration("20260102000000_add_column", [
			`ALTER TABLE "${schema}"."a" ADD COLUMN "y" integer;`,
		]);
		const holder = await connectSession();
		await holder.query("BEGIN");
		await holder.query(`select * from "${schema}"."a"`);
		setTimeout(() => void holder.query("ROLLBACK"), 100);
		try {
			expect(
				await runMigrations({
					...options,
					maxAttempts: 5,
					retryBaseDelayMs: 200,
				}),
			).toEqual(["20260102000000_add_column"]);
		} finally {
			await holder.end();
		}
	});

	it("commits each migration in its own transaction", async () => {
		writeMigration("20260102000000_good", [
			`ALTER TABLE "${schema}"."a" ADD COLUMN "y" integer;`,
		]);
		writeMigration("20260103000000_bad", [
			`ALTER TABLE "${schema}"."b" ADD COLUMN "z" integer;`,
			`ALTER TABLE "${schema}"."missing" ADD COLUMN "q" integer;`,
		]);

		await expect(runMigrations(options)).rejects.toMatchObject({
			code: "42P01",
		});
		expect(await appliedNames()).toEqual([
			"20260101000000_init",
			"20260102000000_good",
		]);
		expect(await columnExists("a", "y")).toBe(true);
		expect(await columnExists("b", "z")).toBe(false);
	});

	describe("with MIGRATIONS_REQUIRE_PREBUILT_INDEXES", () => {
		beforeEach(() => {
			options = { ...options, requirePrebuiltIndexes: true };
		});

		it("refuses an index that was not prebuilt and prints the command", async () => {
			writeMigration("20260102000000_a_x_idx", [
				`CREATE INDEX IF NOT EXISTS "a_x_idx" ON "${schema}"."a" USING btree ("x");`,
			]);
			await expect(runMigrations(options)).rejects.toThrow(
				`CREATE INDEX CONCURRENTLY IF NOT EXISTS "a_x_idx" ON "${schema}"."a" USING btree ("x");`,
			);
			expect(await appliedNames()).toEqual(["20260101000000_init"]);

			await admin.query(
				`CREATE INDEX CONCURRENTLY IF NOT EXISTS "a_x_idx" ON "${schema}"."a" ("x")`,
			);
			expect(await runMigrations(options)).toEqual(["20260102000000_a_x_idx"]);
		});

		it("asks to rebuild an INVALID index", async () => {
			await admin.query(`CREATE INDEX "a_x_idx" ON "${schema}"."a" ("x")`);
			await admin.query(
				`update pg_index set indisvalid = false where indexrelid = '"${schema}"."a_x_idx"'::regclass`,
			);
			writeMigration("20260102000000_a_x_idx", [
				`CREATE INDEX IF NOT EXISTS "a_x_idx" ON "${schema}"."a" ("x");`,
			]);
			const error = await runMigrations(options).catch((e: unknown) => e);
			expect(String(error)).toContain(
				`DROP INDEX CONCURRENTLY IF EXISTS "${schema}"."a_x_idx";`,
			);
			expect(String(error)).toContain("INVALID");
		});

		it("refuses a DROP INDEX until it was dropped concurrently", async () => {
			await admin.query(`CREATE INDEX "a_x_idx" ON "${schema}"."a" ("x")`);
			writeMigration("20260102000000_drop_a_x_idx", [
				`DROP INDEX IF EXISTS "${schema}"."a_x_idx";`,
			]);
			await expect(runMigrations(options)).rejects.toThrow(
				`DROP INDEX CONCURRENTLY IF EXISTS "${schema}"."a_x_idx";`,
			);
			await admin.query(`DROP INDEX CONCURRENTLY "${schema}"."a_x_idx"`);
			expect(await runMigrations(options)).toEqual([
				"20260102000000_drop_a_x_idx",
			]);
		});

		it("exempts new tables and explicitly allowed indexes", async () => {
			writeMigration("20260102000000_c", [
				`CREATE TABLE "${schema}"."c" ("id" integer PRIMARY KEY, "x" integer);`,
				`CREATE INDEX "c_x_idx" ON "${schema}"."c" ("x");`,
				`-- migrate:allow-blocking-index\nCREATE INDEX IF NOT EXISTS "b_id_idx" ON "${schema}"."b" ("id");`,
			]);
			expect(await runMigrations(options)).toEqual(["20260102000000_c"]);
		});
	});
});

describe("checkMigrations", () => {
	it("reports pending index work and long-held locks without writing", async () => {
		writeMigration("20260102000000_a_x_idx", [
			`CREATE INDEX IF NOT EXISTS "a_x_idx" ON "${schema}"."a" ("x");`,
		]);
		const holder = await connectSession();
		await holder.query("SET application_name = 'spec-blocker'");
		await holder.query("BEGIN");
		await holder.query(`select * from "${schema}"."a"`);
		try {
			const result = await checkMigrations({
				...options,
				maxTransactionAgeS: 0,
			});
			expect(result.ok).toBe(false);
			expect(result.pending).toEqual(["20260102000000_a_x_idx"]);
			expect(result.indexProblems.map((p) => p.problem)).toEqual(["missing"]);
			expect(result.blockers).toEqual([
				expect.objectContaining({
					applicationName: "spec-blocker",
					table: "a",
					granted: true,
				}),
			]);
		} finally {
			await holder.query("ROLLBACK");
			await holder.end();
		}
		expect(await appliedNames()).toEqual(["20260101000000_init"]);
	});

	it("passes when nothing is pending", async () => {
		expect(await checkMigrations(options)).toEqual({
			ok: true,
			pending: [],
			indexProblems: [],
			blockers: [],
		});
	});
});
