import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	apiKeyHourlyModelStats,
	apiKeyHourlyStats,
	globalModelStats,
	globalSourceStats,
	log,
	modelHistory,
	modelHistoryHourly,
	modelProviderMappingHistory,
	modelProviderMappingHistoryHourly,
	projectHourlyModelStats,
	projectHourlySourceStats,
	projectHourlyStats,
	providerKeyHourlyStats,
} from "./schema.js";

import type { PgTable } from "drizzle-orm/pg-core";

// Acceptance guard for theopenco/llmgateway#3630.
//
// The derived analytical rollup tables persist money as their storage type, so
// every hourly/daily/history bucket is rounded when written and a bare SUM()
// over the column accumulates in that type. Storing them as real (float4) is
// what let rounding drift between independently grouped rollups; double
// precision (float8) removes it. This test fails if any rollup cost column
// regresses back to real, or if the raw log table is widened (explicitly out of
// scope: high-volume, disruptive rewrite).

// Columns whose name matches this are monetary and must be double precision in
// the rollup tables. "savings" covers discountSavings, which is a cost delta.
const COST_COLUMN = /cost|savings/i;

// The 12 derived rollup tables named in the issue's "Proposed scope".
const rollupTables: Record<string, PgTable> = {
	project_hourly_stats: projectHourlyStats,
	project_hourly_model_stats: projectHourlyModelStats,
	project_hourly_source_stats: projectHourlySourceStats,
	api_key_hourly_stats: apiKeyHourlyStats,
	api_key_hourly_model_stats: apiKeyHourlyModelStats,
	provider_key_hourly_stats: providerKeyHourlyStats,
	global_model_stats: globalModelStats,
	global_source_stats: globalSourceStats,
	model_history: modelHistory,
	model_history_hourly: modelHistoryHourly,
	model_provider_mapping_history: modelProviderMappingHistory,
	model_provider_mapping_history_hourly: modelProviderMappingHistoryHourly,
};

function costColumns(table: PgTable): [string, string][] {
	return Object.entries(getTableColumns(table))
		.filter(([name]) => COST_COLUMN.test(name))
		.map(([name, column]) => [name, column.getSQLType()]);
}

describe("rollup cost columns (#3630)", () => {
	for (const [tableName, table] of Object.entries(rollupTables)) {
		it(`${tableName}: every cost column is double precision`, () => {
			const columns = costColumns(table);
			// Guards against a future rename that silently drops the whole set:
			// an empty match would make the assertion vacuously pass.
			expect(columns.length).toBeGreaterThan(0);
			const notDouble = columns.filter(
				([, sqlType]) => sqlType !== "double precision",
			);
			expect(notDouble).toEqual([]);
		});
	}

	it("covers all 12 rollup tables from the issue's proposed scope", () => {
		expect(Object.keys(rollupTables)).toHaveLength(12);
	});

	it("migrates exactly 128 rollup cost columns to double precision", () => {
		const total = Object.values(rollupTables).reduce(
			(sum, table) => sum + costColumns(table).length,
			0,
		);
		expect(total).toBe(128);
	});

	it("leaves the raw log cost columns as real (out of scope)", () => {
		// The high-volume log table is deliberately not widened; query sites keep
		// casting log sums to double precision instead.
		expect(log.cost.getSQLType()).toBe("real");
		expect(log.inputCost.getSQLType()).toBe("real");
		expect(log.outputCost.getSQLType()).toBe("real");
	});
});
