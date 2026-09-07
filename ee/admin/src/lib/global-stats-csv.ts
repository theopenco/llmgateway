import {
	buildCsv,
	DEFAULT_CSV_FORMAT,
	formatCsvNumber,
} from "@llmgateway/shared";

import type { GlobalStatsChartMetric } from "@/lib/global-stats-chart";
import type { CsvFormat } from "@llmgateway/shared";

export interface GlobalStatsCsvMetrics {
	requestCount: number;
	errorCount: number;
	cacheCount: number;
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	totalTokens: number;
	cost: number;
	inputCost: number;
	cachedInputCost: number;
	outputCost: number;
}

export interface GlobalStatsCsvTimeseriesPoint extends GlobalStatsCsvMetrics {
	date: string;
}

export interface GlobalStatsCsvBreakdownItem extends GlobalStatsCsvMetrics {
	key: string;
	label: string;
}

export interface GlobalStatsCsvTimeseriesBreakdownPoint {
	date: string;
	key: string;
	requestCount: number;
	cost: number;
	totalTokens: number;
}

export interface GlobalStatsCsvCompositionItem {
	key: string;
	label: string;
	requestCount: number;
	cost: number;
	totalTokens: number;
}

/** Human-readable description of the filters an export was taken under. */
export interface GlobalStatsCsvScope {
	start: string;
	end: string;
	allTime: boolean;
	traffic: string;
	organization: string;
	groupBy: string;
	modelView: string | null;
	metric: GlobalStatsChartMetric;
}

export const GLOBAL_STATS_METRIC_COLUMNS = [
	"requestCount",
	"errorCount",
	"cacheCount",
	"inputTokens",
	"cachedTokens",
	"outputTokens",
	"totalTokens",
	"cost",
	"inputCost",
	"cachedInputCost",
	"outputCost",
] as const satisfies readonly (keyof GlobalStatsCsvMetrics)[];

export const GLOBAL_STATS_METRIC_LABELS: Record<
	GlobalStatsChartMetric,
	string
> = {
	requestCount: "Requests",
	cost: "Cost",
	totalTokens: "Total tokens",
};

function metricCells(row: GlobalStatsCsvMetrics, format: CsvFormat) {
	return GLOBAL_STATS_METRIC_COLUMNS.map((column) =>
		formatCsvNumber(row[column], format),
	);
}

export function buildGlobalStatsTimeseriesCsv(
	timeseries: readonly GlobalStatsCsvTimeseriesPoint[],
	format: CsvFormat = DEFAULT_CSV_FORMAT,
): string {
	return buildCsv(
		["date", ...GLOBAL_STATS_METRIC_COLUMNS],
		timeseries.map((point) => [point.date, ...metricCells(point, format)]),
		format,
	);
}

/**
 * One line per day and dimension, in rank order within each day, carrying
 * requests, tokens and cost — the stacked chart without the "Other" bucket.
 */
export function buildGlobalStatsTimeseriesBreakdownCsv(
	{
		dimension,
		rankedBreakdown,
		timeseries,
		timeseriesBreakdown,
	}: {
		dimension: string;
		rankedBreakdown: readonly { key: string; label: string }[];
		timeseries: readonly { date: string }[];
		timeseriesBreakdown: readonly GlobalStatsCsvTimeseriesBreakdownPoint[];
	},
	format: CsvFormat = DEFAULT_CSV_FORMAT,
): string {
	const rank = new Map(rankedBreakdown.map((item, i) => [item.key, i]));
	const label = new Map(rankedBreakdown.map((item) => [item.key, item.label]));
	const dateOrder = new Map(timeseries.map((point, i) => [point.date, i]));
	const rows = timeseriesBreakdown
		.filter((point) => dateOrder.has(point.date) && rank.has(point.key))
		.sort(
			(a, b) =>
				(dateOrder.get(a.date) ?? 0) - (dateOrder.get(b.date) ?? 0) ||
				(rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0),
		);
	return buildCsv(
		["date", dimension, "label", "requestCount", "totalTokens", "cost"],
		rows.map((point) => [
			point.date,
			point.key,
			label.get(point.key) ?? point.key,
			formatCsvNumber(point.requestCount, format),
			formatCsvNumber(point.totalTokens, format),
			formatCsvNumber(point.cost, format),
		]),
		format,
	);
}

/**
 * Every dimension with all metrics, in the order given (the caller sorts by
 * the selected metric) plus that metric's share of the range total.
 */
export function buildGlobalStatsBreakdownCsv(
	{
		dimension,
		breakdown,
		metric,
	}: {
		dimension: string;
		breakdown: readonly GlobalStatsCsvBreakdownItem[];
		metric: GlobalStatsChartMetric;
	},
	format: CsvFormat = DEFAULT_CSV_FORMAT,
): string {
	const total = breakdown.reduce((sum, item) => sum + item[metric], 0);
	return buildCsv(
		[
			dimension,
			"label",
			...GLOBAL_STATS_METRIC_COLUMNS,
			`${metric}SharePercent`,
		],
		breakdown.map((item) => [
			item.key,
			item.label,
			...metricCells(item, format),
			formatCsvNumber(total > 0 ? (item[metric] / total) * 100 : 0, format),
		]),
		format,
	);
}

function compositionCsv(
	dimension: string,
	items: readonly GlobalStatsCsvCompositionItem[],
	format: CsvFormat,
): string {
	return buildCsv(
		[dimension, "label", "requestCount", "cost", "totalTokens"],
		items.map((item) => [
			item.key,
			item.label,
			formatCsvNumber(item.requestCount, format),
			formatCsvNumber(item.cost, format),
			formatCsvNumber(item.totalTokens, format),
		]),
		format,
	);
}

/**
 * Whole-page report: scope header, totals, compositions, the daily
 * timeseries and the per-dimension tables, as blank-line separated CSV
 * sections in a single file.
 */
export function buildGlobalStatsReportCsv(
	{
		scope,
		generatedAt,
		totals,
		composition,
		timeseries,
		timeseriesBreakdown,
		breakdown,
		dimension,
	}: {
		scope: GlobalStatsCsvScope;
		generatedAt: Date;
		totals: GlobalStatsCsvMetrics;
		composition: {
			byMode: readonly GlobalStatsCsvCompositionItem[] | null;
			byKind: readonly GlobalStatsCsvCompositionItem[] | null;
		};
		timeseries: readonly GlobalStatsCsvTimeseriesPoint[];
		timeseriesBreakdown: readonly GlobalStatsCsvTimeseriesBreakdownPoint[];
		breakdown: readonly GlobalStatsCsvBreakdownItem[];
		dimension: string;
	},
	format: CsvFormat = DEFAULT_CSV_FORMAT,
): string {
	const sections: { title: string; csv: string }[] = [
		{
			title: "Global stats report",
			csv: buildCsv(
				["field", "value"],
				[
					["generated", generatedAt.toISOString()],
					["range", scope.allTime ? "All time" : "Custom"],
					["start", scope.start],
					["end", scope.end],
					["traffic", scope.traffic],
					["organization", scope.organization],
					["breakDownBy", scope.groupBy],
					...(scope.modelView ? [["modelView", scope.modelView]] : []),
					["measure", GLOBAL_STATS_METRIC_LABELS[scope.metric]],
				],
				format,
			),
		},
		{
			title: "Totals",
			csv: buildCsv(
				["metric", "value"],
				GLOBAL_STATS_METRIC_COLUMNS.map((column) => [
					column,
					formatCsvNumber(totals[column], format),
				]),
				format,
			),
		},
	];
	if (composition.byMode) {
		sections.push({
			title: "Composition by billing mode",
			csv: compositionCsv("mode", composition.byMode, format),
		});
	}
	if (composition.byKind) {
		sections.push({
			title: "Composition by organization kind",
			csv: compositionCsv("kind", composition.byKind, format),
		});
	}
	sections.push(
		{
			title: "Daily timeseries",
			csv: buildGlobalStatsTimeseriesCsv(timeseries, format),
		},
		{
			title: `Daily timeseries by ${dimension}`,
			csv: buildGlobalStatsTimeseriesBreakdownCsv(
				{
					dimension,
					rankedBreakdown: breakdown,
					timeseries,
					timeseriesBreakdown,
				},
				format,
			),
		},
		{
			title: `Breakdown by ${dimension}`,
			csv: buildGlobalStatsBreakdownCsv(
				{ dimension, breakdown, metric: scope.metric },
				format,
			),
		},
	);

	return sections
		.map(
			(section) => `${buildCsv([section.title], [], format)}\n${section.csv}`,
		)
		.join("\n\n");
}

export function globalStatsExportFilename(
	section: string,
	scope: Pick<GlobalStatsCsvScope, "start" | "end" | "allTime">,
): string {
	const range = scope.allTime ? "all-time" : `${scope.start}_${scope.end}`;
	return `global-stats-${section}-${range}.csv`;
}
