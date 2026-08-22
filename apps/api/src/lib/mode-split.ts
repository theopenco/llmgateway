import { z } from "zod";

import { sql } from "@llmgateway/db";

import type { AnyColumn } from "@llmgateway/db";

/**
 * Aggregated credits-vs-BYOK ("api-keys") split for any rollup table carrying
 * the per-mode measure columns. The blended `cost`/`requestCount` columns on
 * those tables include both modes; these fields let clients present a
 * Total / Credits / BYOK view without extra queries.
 */
export function modeSplitFields(table: {
	creditsRequestCount: AnyColumn;
	apiKeysRequestCount: AnyColumn;
	creditsCost: AnyColumn;
	apiKeysCost: AnyColumn;
}) {
	return {
		creditsRequestCount:
			sql<number>`COALESCE(SUM(${table.creditsRequestCount}), 0)`.as(
				"creditsRequestCount",
			),
		apiKeysRequestCount:
			sql<number>`COALESCE(SUM(${table.apiKeysRequestCount}), 0)`.as(
				"apiKeysRequestCount",
			),
		creditsCost:
			sql<number>`COALESCE(SUM(cast(${table.creditsCost} as double precision)), 0)`.as(
				"creditsCost",
			),
		apiKeysCost:
			sql<number>`COALESCE(SUM(cast(${table.apiKeysCost} as double precision)), 0)`.as(
				"apiKeysCost",
			),
	};
}

export const modeSplitSchema = {
	creditsRequestCount: z.number(),
	apiKeysRequestCount: z.number(),
	creditsCost: z.number(),
	apiKeysCost: z.number(),
};

export interface ModeSplitRow {
	creditsRequestCount: number | string | null;
	apiKeysRequestCount: number | string | null;
	creditsCost: number | string | null;
	apiKeysCost: number | string | null;
}

export function mapModeSplit(row: ModeSplitRow) {
	return {
		creditsRequestCount: Number(row.creditsRequestCount),
		apiKeysRequestCount: Number(row.apiKeysRequestCount),
		creditsCost: Number(row.creditsCost),
		apiKeysCost: Number(row.apiKeysCost),
	};
}
