import type { TokenWindow } from "./types";

interface GlobalStatsByModel {
	totals: { cost: number; requestCount: number };
	breakdown: {
		label: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
	}[];
}

/** Top 20 models by cost from a `/admin/global-stats?groupBy=model` response. */
export function mapGlobalStatsToCostByModel(
	data: GlobalStatsByModel | undefined,
	window: TokenWindow,
) {
	if (!data) {
		return null;
	}
	const models = data.breakdown
		.map((entry) => ({
			model: entry.label,
			cost: entry.cost,
			requestCount: entry.requestCount,
			totalTokens: entry.totalTokens,
		}))
		.sort((a, b) => b.cost - a.cost)
		.slice(0, 20);
	return {
		window,
		models,
		totalCost: data.totals.cost,
		totalRequests: data.totals.requestCount,
	};
}
