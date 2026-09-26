import { readFileSync } from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, pool, tables } from "@llmgateway/db";

import type { InferInsertModel } from "@llmgateway/db";

const installSql = readFileSync(
	new URL("../../../scripts/cleanup-log-routing-metadata.sql", import.meta.url),
	"utf8",
);

function logRow(
	id: string,
	overrides: Partial<InferInsertModel<typeof tables.log>> = {},
): InferInsertModel<typeof tables.log> {
	return {
		id,
		requestId: id,
		organizationId: "cleanup-org",
		projectId: "cleanup-project",
		apiKeyId: "cleanup-key",
		duration: 100,
		requestedModel: "gpt-4o-mini",
		usedModel: "gpt-4o-mini",
		usedProvider: "openai",
		responseSize: 10,
		mode: "credits",
		usedMode: "credits",
		createdAt: new Date("2020-01-01T00:00:00Z"),
		dataRetentionCleanedUp: true,
		routingMetadata: { selectedProvider: "openai" },
		content: "unchanged",
		...overrides,
	};
}

async function progress() {
	const result = await pool.query<{
		last_id: string;
		scanned_rows: string;
		cleared_rows: string;
		completed: boolean;
	}>("SELECT * FROM maintenance.log_routing_metadata_cleanup");
	return result.rows[0];
}

describe("routing metadata backfill", () => {
	beforeAll(async () => {
		await pool.query(installSql);
	});

	beforeEach(async () => {
		await db.delete(tables.log);
		await pool.query("TRUNCATE maintenance.log_routing_metadata_cleanup");
	});

	afterAll(async () => {
		await db.delete(tables.log);
		await pool.query(`
			DROP PROCEDURE maintenance.cleanup_log_routing_metadata(integer, double precision, integer);
			DROP TABLE maintenance.log_routing_metadata_cleanup;
		`);
	});

	it("bounds scans, resumes empty batches, and preserves the cutoff", async () => {
		await db
			.insert(tables.log)
			.values([
				logRow("a", { routingMetadata: null }),
				logRow("b", { createdAt: new Date() }),
				logRow("c"),
				logRow("d", { dataRetentionCleanedUp: false }),
				logRow("e"),
			]);

		await pool.query("CALL maintenance.cleanup_log_routing_metadata(2, 0, 1)");
		expect(await progress()).toMatchObject({
			last_id: "b",
			scanned_rows: "2",
			cleared_rows: "0",
			completed: false,
		});

		await pool.query(`
			UPDATE public.log SET created_at = (
				SELECT cutoff FROM maintenance.log_routing_metadata_cleanup
			) WHERE id = 'e'
		`);
		await pool.query(installSql);
		await pool.query("CALL maintenance.cleanup_log_routing_metadata(2, 0, 1)");
		expect(await progress()).toMatchObject({
			last_id: "d",
			scanned_rows: "4",
			cleared_rows: "2",
			completed: false,
		});

		await pool.query("CALL maintenance.cleanup_log_routing_metadata(2, 0, 10)");
		expect(await progress()).toMatchObject({
			last_id: "e",
			scanned_rows: "5",
			cleared_rows: "2",
			completed: true,
		});

		const logs = await db.query.log.findMany({ orderBy: { id: "asc" } });
		expect(logs.map((log) => log.routingMetadata)).toEqual([
			null,
			{ selectedProvider: "openai" },
			null,
			null,
			{ selectedProvider: "openai" },
		]);
		expect(logs.map((log) => log.dataRetentionCleanedUp)).toEqual([
			true,
			true,
			true,
			false,
			true,
		]);
		expect(logs.every((log) => log.content === "unchanged")).toBe(true);

		await pool.query("CALL maintenance.cleanup_log_routing_metadata(2, 0, 1)");
		expect((await progress()).scanned_rows).toBe("5");
	});

	it("commits earlier batches and retries locked rows without skipping", async () => {
		await db.insert(tables.log).values([logRow("a"), logRow("b")]);
		const blocker = await pool.connect();
		try {
			await blocker.query("BEGIN");
			await blocker.query(
				"SELECT id FROM public.log WHERE id = 'b' FOR UPDATE",
			);
			await expect(
				pool.query("CALL maintenance.cleanup_log_routing_metadata(1, 0, 2)"),
			).rejects.toThrow(/lock timeout/);
			expect(await progress()).toMatchObject({
				last_id: "a",
				scanned_rows: "1",
				cleared_rows: "1",
			});
		} finally {
			await blocker.query("ROLLBACK");
			blocker.release();
		}

		await pool.query("CALL maintenance.cleanup_log_routing_metadata(1, 0, 10)");
		expect(await progress()).toMatchObject({
			last_id: "b",
			scanned_rows: "2",
			cleared_rows: "2",
			completed: true,
		});
		const logs = await db.query.log.findMany();
		expect(logs.every((log) => log.routingMetadata === null)).toBe(true);
	});

	it.each([
		[0, 0, 1],
		[10001, 0, 1],
		[1, -1, 1],
		[1, 0, 0],
	])("rejects invalid limits (%i, %i, %i)", async (...limits) => {
		await expect(
			pool.query(
				"CALL maintenance.cleanup_log_routing_metadata($1, $2, $3)",
				limits,
			),
		).rejects.toThrow(/Use batch_size/);
	});
});
