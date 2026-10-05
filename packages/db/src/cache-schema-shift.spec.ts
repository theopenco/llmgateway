import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { redisClient } from "@llmgateway/cache";

import { db, pool } from "./db.js";
import { RedisCache } from "./redis-cache.js";

/**
 * End-to-end proof of the bug the schema cache version exists for, against a
 * real Postgres and a real Redis — no mocks, the same `drizzle()` client,
 * `RedisCache` and `$withCache({ tag })` call shape production uses.
 *
 * A real migration is simulated the only way it can be within one test run: a
 * scratch table gains a column, and the two `RedisCache` instances stand in for
 * the build that cached a row before that column existed and the build reading
 * it afterwards.
 */
const TABLE = "cache_layout_probe";
const ROW_ID = "probe-row";
const TAG = `cache-layout-probe:${ROW_ID}`;

// The build that cached the row, before the migration.
const probeBefore = pgTable(TABLE, {
	id: text("id").primaryKey(),
	status: text("status"),
	label: text("label"),
});

// The build reading it afterwards. `kind` lands ahead of the columns that
// follow it in the select list, which is what shifts their values.
const probeAfter = pgTable(TABLE, {
	id: text("id").primaryKey(),
	kind: text("kind"),
	status: text("status"),
	label: text("label"),
});

function clientForLayout(schemaVersion: string) {
	return drizzle({
		client: pool,
		casing: "snake_case",
		cache: new RedisCache(redisClient, schemaVersion),
	});
}

async function readBeforeMigration(schemaVersion: string) {
	const rows = await clientForLayout(schemaVersion)
		.select()
		.from(probeBefore)
		.where(eq(probeBefore.id, ROW_ID))
		.limit(1)
		.$withCache({ tag: TAG });
	return rows[0];
}

async function readAfterMigration(schemaVersion: string) {
	const rows = await clientForLayout(schemaVersion)
		.select()
		.from(probeAfter)
		.where(eq(probeAfter.id, ROW_ID))
		.limit(1)
		.$withCache({ tag: TAG });
	return rows[0];
}

async function createProbeTableWithoutKind(): Promise<void> {
	await db.execute(sql`drop table if exists ${sql.identifier(TABLE)}`);
	await db.execute(
		sql`create table ${sql.identifier(TABLE)} (id text primary key, status text, label text)`,
	);
	await db.execute(
		sql`insert into ${sql.identifier(TABLE)} (id, status, label) values (${ROW_ID}, 'active', 'the label')`,
	);
}

async function applyMigration(): Promise<void> {
	await db.execute(
		sql`alter table ${sql.identifier(TABLE)} add column kind text`,
	);
}

// The unit suite shares one Redis, so only this probe's own keys are cleared.
async function clearProbeCacheKeys(): Promise<void> {
	const keys = await redisClient.keys(`drizzle:cache:*:${TAG}`);
	await redisClient.del(
		...keys,
		`drizzle:tags:${TAG}`,
		`drizzle:table_keys:${TABLE}`,
		`drizzle:tables:${TABLE}`,
	);
}

describe("cached rows across a column layout change", () => {
	beforeEach(async () => {
		await clearProbeCacheKeys();
		await createProbeTableWithoutKind();
	});

	afterAll(async () => {
		await clearProbeCacheKeys();
		await db.execute(sql`drop table if exists ${sql.identifier(TABLE)}`);
	});

	it("shifts values into the wrong columns when both layouts share a cache namespace", async () => {
		// Pre-fix behaviour: the key prefix was a constant, so both builds read
		// and wrote the same entry.
		const sharedNamespace = "shared-layout";

		const cached = await readBeforeMigration(sharedNamespace);
		expect(cached).toMatchObject({ status: "active", label: "the label" });

		await applyMigration();
		const row = await readAfterMigration(sharedNamespace);

		// The cached row is three positional values mapped onto four columns:
		// every value lands one column to the left of where it belongs.
		expect(row).toEqual({
			id: ROW_ID,
			kind: "active",
			status: "the label",
			label: undefined,
		});
		// This is the reported symptom — an active row reads as not active.
		expect(row?.status).not.toBe("active");
	});

	it("reads the row correctly when the layout fingerprint namespaces the entry", async () => {
		await readBeforeMigration("layout-before-migration");

		await applyMigration();
		const row = await readAfterMigration("layout-after-migration");

		expect(row).toEqual({
			id: ROW_ID,
			kind: null,
			status: "active",
			label: "the label",
		});
	});

	it("keeps serving the entry within one layout, so the fix does not just disable the cache", async () => {
		const version = "layout-before-migration";
		await readBeforeMigration(version);

		// Change the row behind the cache: a second read still returns the
		// cached value, proving the entry was reused rather than refetched.
		await db.execute(
			sql`update ${sql.identifier(TABLE)} set status = 'inactive' where id = ${ROW_ID}`,
		);

		expect(await readBeforeMigration(version)).toMatchObject({
			status: "active",
		});
	});
});
