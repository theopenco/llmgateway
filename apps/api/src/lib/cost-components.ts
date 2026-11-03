import { z } from "zod";

import { sql } from "@llmgateway/db";

import type { AnyColumn } from "@llmgateway/db";

/**
 * Per-token-type spend for any rollup table carrying the cost columns, so a
 * breakdown row can be split the same way as the totals it rolls up into.
 */
export function costComponentFields(table: {
	inputCost: AnyColumn;
	outputCost: AnyColumn;
	cachedInputCost: AnyColumn;
	cacheWriteInputCost: AnyColumn;
}) {
	return {
		inputCost:
			sql<number>`COALESCE(SUM(cast(${table.inputCost} as double precision)), 0)`.as(
				"inputCost",
			),
		outputCost:
			sql<number>`COALESCE(SUM(cast(${table.outputCost} as double precision)), 0)`.as(
				"outputCost",
			),
		cachedInputCost:
			sql<number>`COALESCE(SUM(cast(${table.cachedInputCost} as double precision)), 0)`.as(
				"cachedInputCost",
			),
		cacheWriteInputCost:
			sql<number>`COALESCE(SUM(cast(${table.cacheWriteInputCost} as double precision)), 0)`.as(
				"cacheWriteInputCost",
			),
	};
}

export const costComponentSchema = {
	inputCost: z.number(),
	outputCost: z.number(),
	cachedInputCost: z.number(),
	cacheWriteInputCost: z.number(),
};

export interface CostComponentRow {
	inputCost: number | string | null;
	outputCost: number | string | null;
	cachedInputCost: number | string | null;
	cacheWriteInputCost: number | string | null;
}

export function mapCostComponents(row: CostComponentRow) {
	return {
		inputCost: Number(row.inputCost),
		outputCost: Number(row.outputCost),
		cachedInputCost: Number(row.cachedInputCost),
		cacheWriteInputCost: Number(row.cacheWriteInputCost),
	};
}
