import { readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { lintMigrationsFolder } from "./migration-lint.js";
import {
	createdTables,
	lintMigrationSql,
	parseIndexOperations,
	toConcurrentCreateIndex,
	touchedTables,
} from "./migration-sql.js";

const BP = "--> statement-breakpoint";

// Shaped like the migration that queued behind long reads on 2026-10-19: three
// ADD COLUMNs across two live tables, all locks held until commit.
const MULTI_TABLE = [
	`ALTER TABLE "organization" ADD COLUMN "provider_key_alerts_enabled" boolean DEFAULT true NOT NULL;`,
	`ALTER TABLE "provider_key_hourly_stats" ADD COLUMN "error_count" integer DEFAULT 0 NOT NULL;`,
	`ALTER TABLE "provider_key_hourly_stats" ADD COLUMN "alerted_at" timestamp;`,
].join(`\n${BP}\n`);

describe("lintMigrationSql", () => {
	it("flags a migration that locks several existing tables", () => {
		expect(lintMigrationSql(MULTI_TABLE).map((f) => f.rule)).toEqual([
			"multi-table-lock",
		]);
	});

	it("accepts the same migration with a reviewed reason", () => {
		const reviewed = `-- migrate:reviewed both tables are tiny on every deployment\n${MULTI_TABLE}`;
		expect(lintMigrationSql(reviewed)).toEqual([]);
	});

	it("does not accept a reviewed marker without a reason", () => {
		expect(
			lintMigrationSql(`-- migrate:reviewed\n${MULTI_TABLE}`).map(
				(f) => f.rule,
			),
		).toEqual(["multi-table-lock"]);
	});

	// The previous release keeps running against the migrated schema during the
	// rollout and after a rollback; #4552 dropped user.time_zone while the
	// deployed schema.ts still had it, and old pods failed user reads until the
	// rollout finished.
	it("flags changes the previous release cannot run against", () => {
		const sql = [
			`ALTER TABLE "user" DROP COLUMN "time_zone";`,
			`ALTER TABLE "project" RENAME COLUMN "name" TO "title";`,
			`ALTER TABLE "stats" DROP CONSTRAINT "stats_bucket_unique";`,
			`ALTER TABLE "project" ADD COLUMN "region" text NOT NULL;`,
			`ALTER TABLE "project" ALTER COLUMN "mode" DROP DEFAULT;`,
			`DROP TABLE "old_feature";`,
		].join(`\n${BP}\n`);
		expect(lintMigrationSql(sql).map((f) => f.rule)).toEqual([
			"drop-column",
			"rename",
			"drop-constraint",
			"add-not-null-without-default",
			"drop-default",
			"drop-table",
			"multi-table-lock",
		]);
	});

	it("accepts contract changes acknowledged on the statement", () => {
		const sql = `-- migrate:contract #4551 removed it from schema.ts and is deployed\nALTER TABLE "user" DROP COLUMN "time_zone";`;
		expect(lintMigrationSql(sql)).toEqual([]);
		expect(
			lintMigrationSql(
				`-- migrate:reviewed tiny table\nALTER TABLE "user" DROP COLUMN "time_zone";`,
			).map((f) => f.rule),
		).toEqual(["drop-column"]);
		expect(
			lintMigrationSql(
				`-- migrate:contract\nALTER TABLE "user" DROP COLUMN "time_zone";`,
			).map((f) => f.rule),
		).toEqual(["drop-column"]);
	});

	it("ignores keywords inside names, foreign key drops, and generated columns", () => {
		const sql = [
			`ALTER TABLE "project" ADD COLUMN "rename_mode" text DEFAULT 'drop column';`,
			`ALTER TABLE "project" DROP CONSTRAINT "project_org_id_organization_id_fk";`,
			`ALTER TABLE "project" ADD COLUMN "total" integer GENERATED ALWAYS AS (1) STORED NOT NULL;`,
		].join(`\n${BP}\n`);
		expect(lintMigrationSql(sql)).toEqual([]);
	});

	it("flags dropping an index the previous release may target", () => {
		const sql = `DROP INDEX IF EXISTS "rate_limit_org_provider_model_unique";`;
		expect(lintMigrationSql(sql).map((f) => f.rule)).toEqual(["drop-index"]);
		expect(lintMigrationSql(`-- migrate:contract not unique\n${sql}`)).toEqual(
			[],
		);
	});

	it("checks each ADD COLUMN action and every dropped table", () => {
		const sql = [
			`ALTER TABLE "project" ADD COLUMN "a" text DEFAULT 'x' NOT NULL, ADD COLUMN "b" text NOT NULL;`,
			`CREATE TABLE "scratch" ("id" text);`,
			`DROP TABLE "scratch", "old_feature";`,
		].join(`\n${BP}\n`);
		expect(lintMigrationSql(sql).map((f) => f.rule)).toEqual([
			"add-not-null-without-default",
			"drop-table",
		]);
	});

	it("flags a table dropped before it is recreated", () => {
		const sql = [
			`DROP TABLE "project";`,
			`CREATE TABLE "project" ("id" text PRIMARY KEY NOT NULL);`,
		].join(`\n${BP}\n`);
		expect(lintMigrationSql(sql).map((f) => f.rule)).toEqual(["drop-table"]);
	});

	it("requires a separator between a marker and its reason", () => {
		expect(
			lintMigrationSql(
				`-- migrate:contractual note\nALTER TABLE "user" DROP COLUMN "time_zone";`,
			).map((f) => f.rule),
		).toEqual(["drop-column"]);
		expect(
			lintMigrationSql(
				`-- migrate:contract: #4551 is deployed\nALTER TABLE "user" DROP COLUMN "time_zone";`,
			),
		).toEqual([]);
	});

	it("allows additive changes and contract changes on new tables", () => {
		const sql = [
			`CREATE TABLE "feature" ("id" text PRIMARY KEY NOT NULL, "x" text);`,
			`ALTER TABLE "feature" DROP COLUMN "x";`,
			`ALTER TABLE "project" ADD COLUMN "mode" text DEFAULT 'strict' NOT NULL;`,
		].join(`\n${BP}\n`);
		expect(lintMigrationSql(sql)).toEqual([]);
	});

	it("requires IF NOT EXISTS / IF EXISTS on index changes to existing tables", () => {
		const sql = [
			`CREATE INDEX "log_x_idx" ON "log" USING btree ("x");`,
			`DROP INDEX "log_y_idx";`,
		].join(`\n${BP}\n`);
		expect(lintMigrationSql(sql).map((f) => f.rule)).toEqual([
			"create-index-if-not-exists",
			"drop-index-if-exists",
			"drop-index",
		]);
		expect(
			lintMigrationSql(
				`CREATE INDEX IF NOT EXISTS "log_x_idx" ON "log" ("x");\n${BP}\n-- migrate:contract not unique\nDROP INDEX IF EXISTS "log_y_idx";`,
			),
		).toEqual([]);
	});

	it("exempts tables created in the same migration", () => {
		const sql = [
			`CREATE TABLE "widget" ("id" text PRIMARY KEY NOT NULL, "org_id" text NOT NULL);`,
			`CREATE INDEX "widget_org_idx" ON "widget" ("org_id");`,
			`ALTER TABLE "widget" ADD CONSTRAINT "widget_org_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organization"("id");`,
			`ALTER TABLE "widget" ALTER COLUMN "org_id" SET NOT NULL;`,
		].join(`\n${BP}\n`);
		expect(lintMigrationSql(sql)).toEqual([]);
	});

	it("flags blocking ALTERs on existing tables", () => {
		const cases: Array<[string, string]> = [
			[
				`ALTER TABLE "log" ALTER COLUMN "cost" SET DATA TYPE numeric;`,
				"alter-column-type",
			],
			[
				`ALTER TABLE "log" ALTER COLUMN "cost" TYPE numeric;`,
				"alter-column-type",
			],
			[`ALTER TABLE "log" ALTER COLUMN "cost" SET NOT NULL;`, "set-not-null"],
			[
				`ALTER TABLE "log" ADD CONSTRAINT "log_p_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id");`,
				"foreign-key-not-valid",
			],
			[
				`ALTER TABLE "log" ADD COLUMN "uid" text DEFAULT gen_random_uuid();`,
				"volatile-default",
			],
		];
		for (const [sql, rule] of cases) {
			expect(lintMigrationSql(sql).map((f) => f.rule)).toEqual([rule]);
		}
		expect(
			lintMigrationSql(
				`ALTER TABLE "log" ADD CONSTRAINT "log_p_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project"("id") NOT VALID;`,
			),
		).toEqual([]);
		expect(
			lintMigrationSql(
				`ALTER TABLE "log" ADD COLUMN "seen_at" timestamp DEFAULT now();`,
			),
		).toEqual([]);
	});

	it("passes every migration created since the lint was introduced", () => {
		expect(
			lintMigrationsFolder(new URL("../migrations", import.meta.url).pathname),
		).toEqual([]);
		expect(
			readdirSync(new URL("../migrations", import.meta.url)).length,
		).toBeGreaterThan(0);
	});
});

describe("migration SQL parsing", () => {
	it("parses index operations", () => {
		const ops = parseIndexOperations(
			[
				`-- migrate:allow-blocking-index\nCREATE UNIQUE INDEX IF NOT EXISTS "a_idx" ON ONLY "public"."a" ("x");`,
				`DROP INDEX CONCURRENTLY IF EXISTS "b_idx", "c_idx";`,
			].join(`\n${BP}\n`),
		);
		expect(
			ops.map(({ kind, name, table, ifExists, concurrently }) => ({
				kind,
				name,
				table,
				ifExists,
				concurrently,
			})),
		).toEqual([
			{
				kind: "create",
				name: `"a_idx"`,
				table: `"public"."a"`,
				ifExists: true,
				concurrently: false,
			},
			{
				kind: "drop",
				name: `"b_idx"`,
				table: undefined,
				ifExists: true,
				concurrently: true,
			},
			{
				kind: "drop",
				name: `"c_idx"`,
				table: undefined,
				ifExists: true,
				concurrently: true,
			},
		]);
	});

	it("rewrites CREATE INDEX into its concurrent form", () => {
		expect(
			toConcurrentCreateIndex(`CREATE UNIQUE INDEX "a_idx" ON "a" ("x");`),
		).toBe(
			`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "a_idx" ON "a" ("x");`,
		);
		expect(
			toConcurrentCreateIndex(`create index if not exists a_idx on a (x)`),
		).toBe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS a_idx on a (x);`);
	});

	it("lists created and touched tables", () => {
		const sql = [
			`CREATE TABLE "w" ("id" text, "org" text REFERENCES "organization"("id"));`,
			`ALTER TABLE "Mixed"."Case" ADD COLUMN "x" text;`,
			`UPDATE "project" SET "x" = 1;`,
			`CREATE INDEX IF NOT EXISTS "i" ON "log" ("x");`,
		].join(`\n${BP}\n`);
		expect([...createdTables(sql)]).toEqual(["w"]);
		expect([...touchedTables(sql)].sort()).toEqual([
			"Case",
			"log",
			"organization",
			"project",
		]);
	});
});
