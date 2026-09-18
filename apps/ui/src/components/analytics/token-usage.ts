import { modelKey } from "@/components/analytics/chart-helpers";

import type { DailyActivity } from "@/types/activity";

export function tokenBreakdown(
	day: Pick<
		DailyActivity,
		"inputTokens" | "cachedTokens" | "outputTokens" | "cacheWriteTokens"
	>,
) {
	return {
		input: Math.max(0, day.inputTokens - day.cachedTokens),
		cache: day.cachedTokens,
		output: day.outputTokens,
		cacheWrites: day.cacheWriteTokens,
	};
}

/**
 * Same breakdown narrowed to one model. Several rows can share a display key
 * (the same model served from two regions), so the matches are summed.
 */
export function modelTokenBreakdown(day: DailyActivity, model: string) {
	return day.modelBreakdown
		.filter((entry) => modelKey(entry, "mapping") === model)
		.reduce(
			(sum, entry) => {
				const entryTokens = tokenBreakdown(entry);
				return {
					input: sum.input + entryTokens.input,
					cache: sum.cache + entryTokens.cache,
					output: sum.output + entryTokens.output,
					cacheWrites: sum.cacheWrites + entryTokens.cacheWrites,
				};
			},
			{ input: 0, cache: 0, output: 0, cacheWrites: 0 },
		);
}
