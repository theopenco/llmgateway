import { modelKey } from "@/components/analytics/chart-helpers";

import { splitCost } from "@llmgateway/shared/cost-breakdown";

import type { DailyActivity } from "@/types/activity";

/**
 * Tokens and spend per token type. `input` is fresh input only: the rollups'
 * `inputTokens` also counts cache reads and cache writes, which are billed at
 * their own rates. The costs always add up to the row's total spend; spend
 * that is not per token (request, image, audio, web search fees) is `otherCost`
 * and data retention is `storageCost`.
 */
export interface TokenUsage {
	input: number;
	cacheWrites: number;
	cache: number;
	output: number;
	inputCost: number;
	cacheWriteCost: number;
	cacheCost: number;
	outputCost: number;
	otherCost: number;
	storageCost: number;
}

type UsageRow = Pick<
	DailyActivity,
	| "inputTokens"
	| "cachedTokens"
	| "outputTokens"
	| "cacheWriteTokens"
	| "cost"
	| "inputCost"
	| "outputCost"
	| "cachedInputCost"
	| "cacheWriteInputCost"
> &
	Partial<Pick<DailyActivity, "dataStorageCost">>;

export const EMPTY_TOKEN_USAGE: TokenUsage = {
	input: 0,
	cacheWrites: 0,
	cache: 0,
	output: 0,
	inputCost: 0,
	cacheWriteCost: 0,
	cacheCost: 0,
	outputCost: 0,
	otherCost: 0,
	storageCost: 0,
};

export function tokenBreakdown(row: UsageRow): TokenUsage {
	const split = splitCost(row);
	return {
		input: Math.max(
			0,
			row.inputTokens - row.cachedTokens - row.cacheWriteTokens,
		),
		cacheWrites: row.cacheWriteTokens,
		cache: row.cachedTokens,
		output: row.outputTokens,
		inputCost: split.input,
		cacheWriteCost: split.cacheWrite,
		cacheCost: split.cachedInput,
		outputCost: split.output,
		otherCost: split.other,
		storageCost: split.storage,
	};
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
	const sum = { ...a };
	for (const key of Object.keys(sum) as (keyof TokenUsage)[]) {
		sum[key] += b[key];
	}
	return sum;
}

/**
 * Same breakdown narrowed to one model. Several rows can share a display key
 * (the same model served from two regions), so the matches are summed.
 */
export function modelTokenBreakdown(
	day: DailyActivity,
	model: string,
): TokenUsage {
	return day.modelBreakdown
		.filter((entry) => modelKey(entry, "mapping") === model)
		.reduce(
			(sum, entry) => addTokenUsage(sum, tokenBreakdown(entry)),
			EMPTY_TOKEN_USAGE,
		);
}
