import { expect, test } from "vitest";

import { db, sql } from "@llmgateway/db";

import { providerKeyBackfillStartQuery } from "./global-stats-aggregator.js";

interface PlanNode {
	"Node Type": string;
	"Index Name"?: string;
	"Actual Rows": number;
	"Actual Loops": number;
	Plans?: PlanNode[];
}

function flattenPlan(node: PlanNode): PlanNode[] {
	return [node, ...(node.Plans ?? []).flatMap(flattenPlan)];
}

test("backfill discovery seeks once per key without scanning unattributed history", async () => {
	await db.transaction(async (tx) => {
		await tx.execute(sql`SET LOCAL TIME ZONE 'Asia/Tokyo'`);
		// Shadow log only on this connection, with the production index layout.
		await tx.execute(sql`
			CREATE TEMP TABLE log (
				created_at timestamp NOT NULL,
				provider_key_id text,
				used_model text,
				used_provider text
			) ON COMMIT DROP
		`);
		await tx.execute(sql`
			CREATE INDEX log_created_at_used_model_used_provider_idx
			ON log (created_at, used_model, used_provider)
		`);
		await tx.execute(sql`
			CREATE INDEX log_provider_key_id_created_at_idx
			ON log (provider_key_id, created_at)
			WHERE provider_key_id IS NOT NULL
		`);
		await tx.execute(sql`
			INSERT INTO log (created_at)
			SELECT timestamp '2000-01-01' + n * interval '1 second'
			FROM generate_series(1, 100000) n
		`);
		await tx.execute(sql`
			INSERT INTO log (created_at, provider_key_id)
			SELECT timestamp '2026-01-01' + n * interval '1 second',
				CASE n % 3 WHEN 0 THEN 'z-key' WHEN 1 THEN 'm-key' ELSE 'a-key' END
			FROM generate_series(0, 9999) n
		`);
		await tx.execute(sql`ANALYZE log`);

		const result = await tx.execute<{ earliest_day_ms: string }>(
			providerKeyBackfillStartQuery,
		);
		expect(Number(result.rows[0].earliest_day_ms)).toBe(
			Date.parse("2026-01-01T00:00:00Z"),
		);

		const explained = await tx.execute<{
			"QUERY PLAN": Array<{ Plan: PlanNode }>;
		}>(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${providerKeyBackfillStartQuery}`);
		const nodes = flattenPlan(explained.rows[0]["QUERY PLAN"][0].Plan);
		expect(nodes.some((node) => node["Node Type"] === "Seq Scan")).toBe(false);
		expect(nodes.some((node) => node["Node Type"] === "Sort")).toBe(false);
		const scans = nodes.filter((node) => node["Index Name"] !== undefined);
		expect(scans).toHaveLength(2);
		expect(
			scans.every(
				(node) => node["Index Name"] === "log_provider_key_id_created_at_idx",
			),
		).toBe(true);
		expect(scans[0]["Actual Rows"]).toBe(1);
		expect(scans[0]["Actual Loops"]).toBe(1);
		expect(scans[1]["Actual Rows"]).toBeLessThanOrEqual(1);
		expect(scans[1]["Actual Loops"]).toBe(3);
	});
});
