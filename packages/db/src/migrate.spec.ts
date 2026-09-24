import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, pool } from "./db.js";
import { countAppliedMigrations } from "./migrate.js";

// `runMigrations` clears the cached rows only when this count grew, so the
// count has to survive both states of a real database: before Drizzle's
// bookkeeping table exists (naming a missing table is a parse error, not a
// runtime one) and after.
const migrationDb = drizzle({ client: pool });
const SENTINEL_HASH = "migrate-spec-sentinel";

async function bookkeepingTableExists(): Promise<boolean> {
	const result = await db.execute(
		sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`,
	);
	return result.rows[0]?.present === true;
}

describe("countAppliedMigrations", () => {
	let tableCreatedHere = false;

	beforeAll(async () => {
		tableCreatedHere = !(await bookkeepingTableExists());
	});

	afterAll(async () => {
		if (tableCreatedHere) {
			await db.execute(sql`drop table if exists drizzle.__drizzle_migrations`);
			return;
		}
		await db.execute(
			sql`delete from drizzle.__drizzle_migrations where hash = ${SENTINEL_HASH}`,
		);
	});

	it("counts rows once the bookkeeping table exists", async () => {
		if (tableCreatedHere) {
			// The pre-migration state of a fresh database.
			expect(await countAppliedMigrations(migrationDb)).toBe(0);

			await db.execute(sql`create schema if not exists drizzle`);
			await db.execute(
				sql`create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)`,
			);
			expect(await countAppliedMigrations(migrationDb)).toBe(0);
		}

		const before = await countAppliedMigrations(migrationDb);
		await db.execute(
			sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${SENTINEL_HASH}, ${Date.now()})`,
		);

		expect(await countAppliedMigrations(migrationDb)).toBe(before + 1);
	});
});
