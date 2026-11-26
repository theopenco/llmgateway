import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const migration = readFileSync(
	new URL(
		"../migrations/20261110163311_transaction_credit_topup_payment_intent_unique/migration.sql",
		import.meta.url,
	),
	"utf8",
);
const indexName = "transaction_credit_topup_payment_intent_unique";
let client: Client;
let schema: string;

beforeEach(async () => {
	client = new Client({ connectionString: process.env.DATABASE_URL });
	await client.connect();
	schema = `topup_${randomUUID().replaceAll("-", "")}`;
	await client.query(`CREATE SCHEMA ${schema}`);
	await client.query(`SET search_path TO ${schema}`);
	await client.query(`CREATE TABLE "transaction" (
		organization_id text NOT NULL,
		type text NOT NULL,
		status text NOT NULL,
		stripe_payment_intent_id text
	)`);
});

afterEach(async () => {
	await client.query(`DROP SCHEMA ${schema} CASCADE`);
	await client.end();
});

async function insert(
	type: string,
	status: string,
	intent: string | null,
	org = "org-a",
) {
	await client.query('INSERT INTO "transaction" VALUES ($1, $2, $3, $4)', [
		org,
		type,
		status,
		intent,
	]);
}

describe("credit top-up payment intent unique index", () => {
	test("allows one completed top-up per payment intent", async () => {
		await client.query(migration);
		// Failed and pending attempts, other types and missing intents don't count.
		await insert("credit_topup", "failed", "pi-shared");
		await insert("credit_topup", "failed", "pi-shared");
		await insert("credit_topup", "pending", "pi-shared");
		await insert("credit_refund", "completed", "pi-shared");
		await insert("credit_refund", "completed", "pi-shared");
		await insert("credit_topup", "completed", null);
		await insert("credit_topup", "completed", null);

		await insert("credit_topup", "completed", "pi-shared");
		await expect(
			insert("credit_topup", "completed", "pi-shared"),
		).rejects.toMatchObject({ code: "23505", constraint: indexName });
		await expect(
			insert("credit_topup", "completed", "pi-shared", "org-b"),
		).rejects.toMatchObject({ code: "23505", constraint: indexName });
		await insert("credit_topup", "completed", "pi-other");
	});

	test("fails on existing duplicates without touching ledger rows", async () => {
		await insert("credit_topup", "completed", "pi-duplicate");
		await insert("credit_topup", "completed", "pi-duplicate");
		await expect(client.query(migration)).rejects.toMatchObject({
			code: "23505",
		});
		const result = await client.query<{ count: string }>(
			'SELECT count(*) FROM "transaction"',
		);
		expect(result.rows[0].count).toBe("2");
	});
});
