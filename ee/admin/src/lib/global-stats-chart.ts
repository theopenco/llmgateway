export type GlobalStatsChartMetric = "requestCount" | "cost" | "totalTokens";

export interface GlobalStatsBreakdownItem {
	key: string;
	label: string;
	requestCount: number;
	cost: number;
	totalTokens: number;
}

export interface GlobalStatsTimeseriesPoint {
	date: string;
}

export interface GlobalStatsTimeseriesBreakdownPoint extends GlobalStatsTimeseriesPoint {
	key: string;
	requestCount: number;
	cost: number;
	totalTokens: number;
}

export interface GlobalStatsChartSeries {
	chartKey: string;
	label: string;
	sourceKey: string | null;
}

export interface GlobalStatsStackedChart {
	data: Record<string, number | string>[];
	series: GlobalStatsChartSeries[];
	restCount: number;
}

/**
 * Pivots API dimension keys into chart-safe rank keys. Model identifiers can
 * contain dots and slashes, which are unsafe as Recharts paths and CSS custom
 * property suffixes. Positional keys are both collision-proof and stable for
 * the ranked series shown in this render.
 */
export function buildGlobalStatsStackedChart({
	rankedBreakdown,
	timeseries,
	timeseriesBreakdown,
	metric,
	limit,
}: {
	rankedBreakdown: GlobalStatsBreakdownItem[];
	timeseries: GlobalStatsTimeseriesPoint[];
	timeseriesBreakdown: GlobalStatsTimeseriesBreakdownPoint[];
	metric: GlobalStatsChartMetric;
	limit: number;
}): GlobalStatsStackedChart {
	const top = rankedBreakdown.slice(0, limit);
	const restCount = Math.max(0, rankedBreakdown.length - top.length);
	const series: GlobalStatsChartSeries[] = top.map((item, index) => ({
		chartKey: `series_${index}`,
		label: item.label,
		sourceKey: item.key,
	}));
	if (restCount > 0) {
		series.push({
			chartKey: "series_other",
			label: `Other (${restCount})`,
			sourceKey: null,
		});
	}

	const chartKeyBySource = new Map(
		series
			.filter(
				(entry): entry is GlobalStatsChartSeries & { sourceKey: string } =>
					entry.sourceKey !== null,
			)
			.map((entry) => [entry.sourceKey, entry.chartKey]),
	);
	const rows = new Map<string, Record<string, number | string>>();
	for (const point of timeseries) {
		const row: Record<string, number | string> = { date: point.date };
		for (const entry of series) {
			row[entry.chartKey] = 0;
		}
		rows.set(point.date, row);
	}

	for (const point of timeseriesBreakdown) {
		const row = rows.get(point.date);
		if (!row) {
			continue;
		}
		const chartKey = chartKeyBySource.get(point.key) ?? "series_other";
		if (!(chartKey in row)) {
			continue;
		}
		row[chartKey] = Number(row[chartKey]) + point[metric];
	}

	return { data: Array.from(rows.values()), series, restCount };
}
