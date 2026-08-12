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
	creditsRequestCount: number;
	apiKeysRequestCount: number;
	creditsCost: number;
	apiKeysCost: number;
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

// --- Generic dimension breakdown (org-level analytics) ---------------------
// The org activity endpoint returns one breakdown per day keyed by the chosen
// dimension (model, project, or API key). These helpers mirror the model ones
// but stay dimension-agnostic, keyed by a stable id with a display label.

export interface DimensionEntry {
	key: string;
	label: string;
	cost: number;
	requestCount: number;
	totalTokens: number;
	creditsRequestCount: number;
	apiKeysRequestCount: number;
	creditsCost: number;
	apiKeysCost: number;
}

export interface DimensionRow {
	date: string;
	breakdown: DimensionEntry[];
}

export interface DimensionAggregate {
	key: string;
	label: string;
	cost: number;
	requestCount: number;
	totalTokens: number;
}

export interface DimensionAggregateResult {
	items: DimensionAggregate[];
	totalCost: number;
	totalRequests: number;
	totalTokens: number;
}

export function aggregateByDimension(
	rows: DimensionRow[],
	metric: ChartMetric = "cost",
	limit = 20,
): DimensionAggregateResult {
	const byKey = new Map<string, DimensionAggregate>();
	let totalCost = 0;
	let totalRequests = 0;
	let totalTokens = 0;

	for (const row of rows) {
		for (const entry of row.breakdown) {
			const agg = byKey.get(entry.key) ?? {
				key: entry.key,
				label: entry.label,
				cost: 0,
				requestCount: 0,
				totalTokens: 0,
			};
			agg.cost += entry.cost;
			agg.requestCount += entry.requestCount;
			agg.totalTokens += entry.totalTokens;
			byKey.set(entry.key, agg);
			totalCost += entry.cost;
			totalRequests += entry.requestCount;
			totalTokens += entry.totalTokens;
		}
	}

	// Rank by the metric being viewed so Requests/Tokens views surface the right
	// top-N, not the top spenders.
	const items = Array.from(byKey.values())
		.sort((a, b) => b[metric] - a[metric])
		.slice(0, limit);

	return { items, totalCost, totalRequests, totalTokens };
}

export interface DimensionTimePoint {
	timestamp: string;
	entries: Record<
		string,
		{ cost: number; requestCount: number; totalTokens: number }
	>;
}

export interface DimensionTimeseriesResult {
	series: { key: string; label: string }[];
	data: DimensionTimePoint[];
}

export function buildDimensionTimeseries(
	rows: DimensionRow[],
	metric: ChartMetric = "cost",
	topN = 10,
): DimensionTimeseriesResult {
	const totalsByKey = new Map<string, number>();
	const labelByKey = new Map<string, string>();
	for (const row of rows) {
		for (const entry of row.breakdown) {
			totalsByKey.set(
				entry.key,
				(totalsByKey.get(entry.key) ?? 0) + entry[metric],
			);
			labelByKey.set(entry.key, entry.label);
		}
	}

	const topKeys = Array.from(totalsByKey.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, topN)
		.map(([k]) => k);
	const topSet = new Set(topKeys);

	const data: DimensionTimePoint[] = rows.map((row) => {
		const entries: DimensionTimePoint["entries"] = {};
		for (const entry of row.breakdown) {
			if (!topSet.has(entry.key)) {
				continue;
			}
			const existing = entries[entry.key] ?? {
				cost: 0,
				requestCount: 0,
				totalTokens: 0,
			};
			existing.cost += entry.cost;
			existing.requestCount += entry.requestCount;
			existing.totalTokens += entry.totalTokens;
			entries[entry.key] = existing;
		}
		return { timestamp: row.date, entries };
	});

	return {
		series: topKeys.map((key) => ({ key, label: labelByKey.get(key) ?? key })),
		data,
	};
}

// --- Project activity → generic dimension rows ----------------------------
// The org endpoint (/analytics/activity) already returns a generic `breakdown`,
// but the project endpoint (/activity) returns one field per dimension. This
// maps the latter onto DimensionRow so both feed the same cards.

export const UNATTRIBUTED_KEY = "__unattributed__";
export const UNATTRIBUTED_LABEL = "Unattributed";

// Sub-cent rounding noise between the project rollup and the per-key rollup
// should not render as a series.
const RESIDUAL_EPSILON = 1e-9;

export const UNATTRIBUTED_NOTE =
	"Spend is attributed to the member who created the API key that made each request. Traffic from platform keys cannot be attributed to a member and is shown as Unattributed.";

interface ProjectActivityRow {
	date: string;
	cost: number;
	requestCount: number;
	totalTokens: number;
	modelBreakdown: ModelBreakdownEntry[];
	apiKeyBreakdown: {
		id: string;
		description: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
		creditsRequestCount: number;
		apiKeysRequestCount: number;
		creditsCost: number;
		apiKeysCost: number;
	}[];
	userBreakdown: {
		id: string;
		name: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
		creditsRequestCount: number;
		apiKeysRequestCount: number;
		creditsCost: number;
		apiKeysCost: number;
	}[];
}

/**
 * Pass the rows through `applyUsageModeToDaily` first: the residual below is
 * computed against the day's own `cost`, so both sides must already be
 * normalized to the same billing mode.
 */
export function toDimensionRows(
	activity: ProjectActivityRow[],
	groupBy: "model" | "apiKey" | "user",
	view: ModelView = "mapping",
): DimensionRow[] {
	return activity.map((row) => {
		if (groupBy === "model") {
			return {
				date: row.date,
				breakdown: row.modelBreakdown.map((entry) => ({
					...entry,
					key: modelKey(entry, view),
					label: modelKey(entry, view),
				})),
			};
		}

		if (groupBy === "apiKey") {
			return {
				date: row.date,
				breakdown: row.apiKeyBreakdown.map((entry) => ({
					...entry,
					key: entry.id,
					label: entry.description,
				})),
			};
		}

		const breakdown: DimensionEntry[] = row.userBreakdown.map((entry) => ({
			...entry,
			key: entry.id,
			label: entry.name,
		}));

		// Per-key rollups only cover "user" and "end_user_customer" keys, so a
		// project driven by platform keys sums to less than its own total. Surface
		// the difference instead of letting the breakdown quietly under-report.
		//
		// Each metric is tested independently: free-model platform traffic adds
		// requests and tokens at zero cost, and gating on cost alone would drop it
		// from the Requests and Tokens views.
		const residualCost = row.cost - sum(breakdown, "cost");
		const residualRequests = row.requestCount - sum(breakdown, "requestCount");
		const residualTokens = row.totalTokens - sum(breakdown, "totalTokens");
		if (
			residualCost > RESIDUAL_EPSILON ||
			residualRequests > 0 ||
			residualTokens > 0
		) {
			breakdown.push({
				key: UNATTRIBUTED_KEY,
				label: UNATTRIBUTED_LABEL,
				cost: Math.max(0, residualCost),
				requestCount: Math.max(0, residualRequests),
				totalTokens: Math.max(0, residualTokens),
				creditsRequestCount: 0,
				apiKeysRequestCount: 0,
				creditsCost: 0,
				apiKeysCost: 0,
			});
		}

		return { date: row.date, breakdown };
	});
}

function sum(entries: DimensionEntry[], metric: ChartMetric): number {
	return entries.reduce((total, entry) => total + entry[metric], 0);
}

export function sanitizeKey(model: string): string {
	// Encode each non-alphanumeric char as its code point so distinct model ids
	// (e.g. "claude-3.5" vs "claude-3-5") can't collapse into the same key and
	// overwrite each other in the chart. Output stays CSS-var safe.
	return model.replace(/[^a-zA-Z0-9]/g, (c) => `_${c.charCodeAt(0)}_`);
}
