import { randomUUID } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgSchema, real } from "drizzle-orm/pg-core";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runMigrations, type MigrationOptions } from "./migrate.js";

const migrations = new URL("../migrations/", import.meta.url);
const name = readdirSync(migrations).find((entry) =>
	entry.endsWith("_rollup_cost_double_precision"),
);
if (!name) {
	throw new Error("Missing rollup cost migration");
}
const migration = readFileSync(
	new URL(`${name}/migration.sql`, migrations),
	"utf8",
);
const tables = new Map<string, string[]>();
for (const statement of migration.split("--> statement-breakpoint")) {
	const table = /ALTER TABLE "([a-z_]+)"/.exec(statement)?.[1];
	if (!table || tables.has(table)) {
		throw new Error("Each rollup table must be widened in one statement");
	}
	tables.set(
		table,
		[
			...statement.matchAll(
				/ALTER COLUMN "([a-z_]+)" SET DATA TYPE double precision/g,
			),
		].map((match) => match[1]!),
	);
}
const entries = [...tables];
const schema = `rollup_precision_${randomUUID().replaceAll("-", "")}`;
let folder: string;
let admin: Client;
let options: MigrationOptions;

async function columnTypes(): Promise<string[]> {
	const result = await admin.query<{ data_type: string }>(
		"SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND column_name NOT IN ('id', 'marker')",
		[schema],
	);
	return result.rows.map((row) => row.data_type);
}

async function fileNodes(): Promise<Record<string, number>> {
	const result = await admin.query<{ relname: string; relfilenode: number }>(
		"SELECT relname, relfilenode FROM pg_class WHERE relnamespace = $1::regnamespace AND relkind IN ('r', 'i')",
		[schema],
	);
	return Object.fromEntries(
		result.rows.map((row) => [row.relname, row.relfilenode]),
	);
}

beforeAll(async () => {
	mkdirSync(".context", { recursive: true });
	folder = mkdtempSync(join(".context", "rollup-migration-"));
	mkdirSync(join(folder, name));
	writeFileSync(
		join(folder, name, "migration.sql"),
		migration.replaceAll('ALTER TABLE "', `ALTER TABLE "${schema}"."`),
	);
	admin = new Client({ connectionString: process.env.DATABASE_URL });
	await admin.connect();
	await admin.query(`CREATE SCHEMA "${schema}"`);
	for (const [table, columns] of entries) {
		await admin.query(
			`CREATE TABLE "${schema}"."${table}" (id integer PRIMARY KEY, marker real, ${columns.map((column) => `"${column}" real NOT NULL DEFAULT 0`).join(", ")})`,
		);
		await admin.query(
			`CREATE INDEX "${table}_cost_idx" ON "${schema}"."${table}" ("${columns[0]}")`,
		);
		await admin.query(
			`INSERT INTO "${schema}"."${table}" (id, ${columns.map((column) => `"${column}"`).join(", ")}) SELECT n, ${columns.map(() => "4321.1234::real").join(", ")} FROM generate_series(1, 1000) n`,
		);
		await admin.query(`INSERT INTO "${schema}"."${table}" (id) VALUES (0)`);
	}
	options = {
		migrationsFolder: folder,
		migrationsSchema: `${schema}_bk`,
		clearCaches: false,
		lockTimeoutMs: 100,
		statementTimeoutMs: 10_000,
		maxAttempts: 1,
		requirePrebuiltIndexes: true,
	};
}, 30_000);

afterAll(async () => {
	if (admin) {
		await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		await admin.query(`DROP SCHEMA IF EXISTS "${schema}_bk" CASCADE`);
		await admin.end();
	}
	if (folder) {
		rmSync(folder, { recursive: true });
	}
});

describe("rollup cost migration on PostgreSQL", () => {
	it("covers the pushed schema's 157 columns without widening log", async () => {
		expect(entries).toHaveLength(14);
		expect(entries.flatMap(([, columns]) => columns)).toHaveLength(157);
		for (const [table, columns] of entries) {
			const result = await admin.query<{
				column_name: string;
				data_type: string;
			}>(
				"SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2)",
				[table, columns],
			);
			expect(result.rows).toHaveLength(columns.length);
			expect(
				result.rows.every((row) => row.data_type === "double precision"),
			).toBe(true);
		}
		expect(
			(
				await admin.query(
					"SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'log' AND column_name = 'cost'",
				)
			).rows,
		).toEqual([{ data_type: "real" }]);
	});

	it("rolls every earlier rewrite back when the last table is locked", async () => {
		const holder = new Client({ connectionString: process.env.DATABASE_URL });
		await holder.connect();
		await holder.query("BEGIN");
		await holder.query(
			`SELECT * FROM "${schema}"."${entries.at(-1)![0]}" LIMIT 1`,
		);
		const before = await fileNodes();
		try {
			await expect(runMigrations(options)).rejects.toMatchObject({
				code: "55P03",
			});
			expect(await columnTypes()).toEqual(Array<string>(157).fill("real"));
			expect(await fileNodes()).toEqual(before);
			expect(
				(
					await admin.query(
						`SELECT count(*)::int AS count FROM "${schema}_bk".__drizzle_migrations`,
					)
				).rows[0]?.count,
			).toBe(0);
		} finally {
			await holder.query("ROLLBACK");
			await holder.end();
		}
	});

	it("holds all 14 exclusive locks until transaction end, blocking readers", async () => {
		const reader = new Client({
			connectionString: process.env.DATABASE_URL,
			lock_timeout: 100,
		});
		await reader.connect();
		await admin.query("BEGIN");
		try {
			for (const statement of migration.split("--> statement-breakpoint")) {
				await admin.query(
					statement.replaceAll('ALTER TABLE "', `ALTER TABLE "${schema}"."`),
				);
			}
			const locks = await admin.query(
				"SELECT count(*)::int AS count FROM pg_locks l JOIN pg_class c ON c.oid = l.relation WHERE l.pid = pg_backend_pid() AND l.mode = 'AccessExclusiveLock' AND l.granted AND c.relnamespace = $1::regnamespace AND c.relkind = 'r'",
				[schema],
			);
			expect(locks.rows[0]?.count).toBe(14);
			await expect(
				reader.query(`SELECT * FROM "${schema}"."${entries[0]![0]}" LIMIT 1`),
			).rejects.toMatchObject({ code: "55P03" });
		} finally {
			await admin.query("ROLLBACK");
			await reader.end();
		}
		expect(await columnTypes()).toEqual(Array<string>(157).fill("real"));
	});

	it("applies the generated migration once, preserving old data and rebuilding indexes", async () => {
		const before = await fileNodes();
		expect(await runMigrations(options)).toEqual([name]);
		expect(await runMigrations(options)).toEqual([]);
		expect(await columnTypes()).toEqual(
			Array<string>(157).fill("double precision"),
		);
		const after = await fileNodes();
		expect(Object.keys(after)).toHaveLength(42);
		for (const key of Object.keys(before)) {
			expect(after[key]).not.toBe(before[key]);
		}
		for (const [table, columns] of entries) {
			const rows = (
				await admin.query(
					`SELECT * FROM "${schema}"."${table}" WHERE id IN (0, 1) ORDER BY id`,
				)
			).rows;
			for (const column of columns) {
				expect(rows[0]?.[column]).toBe(0);
				expect(rows[1]?.[column]).toBe(Math.fround(4321.1234));
			}
			expect(rows[0]?.marker).toBeNull();
			await admin.query(
				`INSERT INTO "${schema}"."${table}" (id) VALUES (2000)`,
			);
			await expect(
				admin.query(
					`INSERT INTO "${schema}"."${table}" (id, "${columns[0]}") VALUES (2001, NULL)`,
				),
			).rejects.toMatchObject({ code: "23502" });
		}
	});

	it("accepts the previous release's real-column Drizzle reader and writer", async () => {
		const legacy = pgSchema(schema).table("global_model_stats", {
			id: integer().primaryKey(),
			cost: real().notNull().default(0),
		});
		const oldClient = drizzle({ client: admin });
		const rows = await oldClient
			.insert(legacy)
			.values({ id: 3000, cost: 123456.789 })
			.returning();
		expect(rows).toEqual([{ id: 3000, cost: 123456.789 }]);
	});

	it("keeps new aggregate precision, tiny/negative costs and nullable source semantics", async () => {
		await admin.query("CREATE TEMP TABLE rollup_cost_source (cost real)");
		await admin.query(
			"INSERT INTO rollup_cost_source SELECT 4321.1234::real FROM generate_series(1, 7000)",
		);
		await admin.query("INSERT INTO rollup_cost_source VALUES (NULL)");
		const expected = Math.fround(4321.1234) * 7000;
		const [table, columns] = entries[0]!;
		const target = `"${schema}"."${table}"`;
		await admin.query(
			`INSERT INTO ${target} (id, "${columns[0]}") SELECT 4000, sum(cost::double precision) FROM rollup_cost_source`,
		);
		const aggregate = (
			await admin.query(
				`SELECT "${columns[0]}" AS cost FROM ${target} WHERE id = 4000`,
			)
		).rows[0]?.cost;
		expect(aggregate).toBe(expected);
		expect(aggregate).not.toBe(Math.fround(expected));
		await admin.query(
			`INSERT INTO ${target} (id, "${columns[0]}") SELECT 4001, coalesce(sum(cost::double precision), 0) FROM rollup_cost_source WHERE cost IS NULL`,
		);
		await admin.query(
			`INSERT INTO ${target} (id, "${columns[0]}") VALUES (4002, 1e-20), (4003, -0.1234567890123)`,
		);
		expect(
			(
				await admin.query(
					`SELECT "${columns[0]}" AS cost FROM ${target} WHERE id >= 4001 ORDER BY id`,
				)
			).rows.map((row) => row.cost),
		).toEqual([0, 1e-20, -0.1234567890123]);
	});
});
