export type ChartMetric = "cost" | "requestCount" | "totalTokens";
export type ModelView = "mapping" | "canonical";

export interface ModelBreakdownEntry {
	id: string;
	provider: string;
	requestCount: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	cost: number;
}

export interface ActivityRow {
	date: string;
	modelBreakdown: ModelBreakdownEntry[];
}

export const seriesColors = [
	"hsl(221 83% 53%)",
	"hsl(142 71% 45%)",
	"hsl(262 83% 58%)",
	"hsl(32 95% 44%)",
	"hsl(0 84% 60%)",
	"hsl(199 89% 48%)",
	"hsl(291 64% 42%)",
	"hsl(48 96% 53%)",
	"hsl(160 84% 39%)",
	"hsl(340 82% 52%)",
];

export const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

/**
 * Mirrors the gateway's canonical model id extraction: drop the provider prefix
 * (everything before the first "/") and any version/tag suffix (after ":").
 */
export function extractCanonicalModelId(usedModel: string): string {
	const slashIdx = usedModel.indexOf("/");
	const withoutProvider =
		slashIdx === -1 ? usedModel : usedModel.slice(slashIdx + 1);
	const colonIdx = withoutProvider.indexOf(":");
	return colonIdx === -1 ? withoutProvider : withoutProvider.slice(0, colonIdx);
}

/**
 * Builds the display key for a model breakdown entry. The "mapping" view shows
 * the provider-specific model (e.g. "azure/gpt-image-2"); the "canonical" view
 * collapses providers/tags into the base model id.
 */
export function modelKey(entry: ModelBreakdownEntry, view: ModelView): string {
	if (view === "canonical") {
		return extractCanonicalModelId(entry.id);
	}
	if (entry.id.includes("/") || !entry.provider) {
		return entry.id;
	}
	return `${entry.provider}/${entry.id}`;
}

export interface ModelAggregate {
	model: string;
	cost: number;
	requestCount: number;
	totalTokens: number;
}

export interface CostByModelResult {
	models: ModelAggregate[];
	totalCost: number;
	totalRequests: number;
	totalTokens: number;
}

/**
 * Aggregates the per-bucket model breakdowns from /activity into per-model
 * totals for the horizontal bar chart.
 */
export function aggregateCostByModel(
	activity: ActivityRow[],
	view: ModelView,
	limit = 20,
): CostByModelResult {
	const byModel = new Map<string, ModelAggregate>();
	let totalCost = 0;
	let totalRequests = 0;
	let totalTokens = 0;

	for (const row of activity) {
		for (const entry of row.modelBreakdown) {
			const key = modelKey(entry, view);
			const agg = byModel.get(key) ?? {
				model: key,
				cost: 0,
				requestCount: 0,
				totalTokens: 0,
			};
			agg.cost += entry.cost;
			agg.requestCount += entry.requestCount;
			agg.totalTokens += entry.totalTokens;
			byModel.set(key, agg);
			totalCost += entry.cost;
			totalRequests += entry.requestCount;
			totalTokens += entry.totalTokens;
		}
	}

	const models = Array.from(byModel.values())
		.sort((a, b) => b.cost - a.cost)
		.slice(0, limit);

	return { models, totalCost, totalRequests, totalTokens };
}

export interface ModelTimePoint {
	timestamp: string;
	entries: Record<
		string,
		{ cost: number; requestCount: number; totalTokens: number }
	>;
}

export interface ModelTimeseriesResult {
	models: string[];
	data: ModelTimePoint[];
}

/**
 * Pivots the per-bucket model breakdowns from /activity into a stacked-area
 * time series of the top-N models (ranked by total cost over the window).
 */
export function buildModelTimeseries(
	activity: ActivityRow[],
	view: ModelView,
	topN = 10,
): ModelTimeseriesResult {
	const totalsByModel = new Map<string, number>();
	for (const row of activity) {
		for (const entry of row.modelBreakdown) {
			const key = modelKey(entry, view);
			totalsByModel.set(key, (totalsByModel.get(key) ?? 0) + entry.cost);
		}
	}

	const topModels = Array.from(totalsByModel.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([k]) => k);
	const topSet = new Set(topModels);

	const data: ModelTimePoint[] = activity.map((row) => {
		const entries: ModelTimePoint["entries"] = {};
		for (const entry of row.modelBreakdown) {
			const key = modelKey(entry, view);
			if (!topSet.has(key)) {
				continue;
			}
			const existing = entries[key] ?? {
				cost: 0,
				requestCount: 0,
				totalTokens: 0,
			};
			existing.cost += entry.cost;
			existing.requestCount += entry.requestCount;
			existing.totalTokens += entry.totalTokens;
			entries[key] = existing;
		}
		return { timestamp: row.date, entries };
	});

	return { models: topModels, data };
}

export function sanitizeKey(model: string): string {
	// Encode each non-alphanumeric char as its code point so distinct model ids
	// (e.g. "claude-3.5" vs "claude-3-5") can't collapse into the same key and
	// overwrite each other in the chart. Output stays CSS-var safe.
	return model.replace(/[^a-zA-Z0-9]/g, (c) => `_${c.charCodeAt(0)}_`);
}
