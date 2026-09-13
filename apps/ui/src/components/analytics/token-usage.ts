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
