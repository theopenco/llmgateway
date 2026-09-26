export type LoadMetric = "rps" | "duration" | "ttft";

export interface LoadChartPointEntry {
	key: string;
	requestCount: number;
	rps: number;
	avgDurationMs: number | null;
	avgTimeToFirstTokenMs: number | null;
}

export interface LoadChartPoint {
	timestamp: string;
	partial: boolean;
	bucketSeconds: number;
	requestCount: number;
	rps: number;
	avgDurationMs: number | null;
	avgTimeToFirstTokenMs: number | null;
	entries: LoadChartPointEntry[];
}

export interface LoadChartSeries {
	chartKey: string;
	label: string;
	sourceKey: string | null;
}

export interface LoadChartRow extends Record<
	string,
	number | string | boolean | null | undefined
> {
	timestamp: string;
	partial: boolean;
	total: number | null;
}

export interface LoadChart {
	rows: LoadChartRow[];
	series: LoadChartSeries[];
	restCount: number;
}

function metricValue(
	source: {
		rps: number;
		avgDurationMs: number | null;
		avgTimeToFirstTokenMs: number | null;
	},
	metric: LoadMetric,
): number | null {
	switch (metric) {
		case "duration":
			return source.avgDurationMs;
		case "ttft":
			return source.avgTimeToFirstTokenMs;
		default:
			return source.rps;
	}
}

/**
 * Pivots the overview payload into Recharts rows of the requested metric.
 *
 * Series get positional `series_N` keys: model ids contain dots and slashes,
 * which are unsafe both as Recharts data paths and as CSS custom property
 * suffixes. The API only returns per-bucket entries for the ranked keys, so
 * for `rps` the remainder of each bucket's total becomes a single "Other"
 * series rather than silently shrinking the stack.
 *
 * The latency metrics get no "Other" band and no zero-fill: an average has no
 * residual to derive one from, and a bucket with no sample is a gap in the
 * line, not a drop to zero.
 */
export function buildLoadChart({
	series,
	data,
	totalKeys,
	metric = "rps",
}: {
	series: { key: string; label: string }[];
	data: LoadChartPoint[];
	totalKeys: number;
	metric?: LoadMetric;
}): LoadChart {
	const additive = metric === "rps";
	const restCount = additive ? Math.max(0, totalKeys - series.length) : 0;
	const chartSeries: LoadChartSeries[] = series.map((item, index) => ({
		chartKey: `series_${index}`,
		label: item.label,
		sourceKey: item.key,
	}));
	if (restCount > 0) {
		chartSeries.push({
			chartKey: "series_other",
			label: `Other (${restCount})`,
			sourceKey: null,
		});
	}

	const chartKeyBySource = new Map(
		series.map((item, index) => [item.key, `series_${index}`]),
	);

	const rows = data.map((point) => {
		const row: LoadChartRow = {
			timestamp: point.timestamp,
			partial: point.partial,
			total: metricValue(point, metric),
		};
		for (const entry of chartSeries) {
			row[entry.chartKey] = additive ? 0 : null;
		}
		let accounted = 0;
		for (const entry of point.entries) {
			const chartKey = chartKeyBySource.get(entry.key);
			if (!chartKey) {
				continue;
			}
			const value = metricValue(entry, metric);
			if (!additive) {
				row[chartKey] = value;
				continue;
			}
			row[chartKey] = Number(row[chartKey]) + (value ?? 0);
			accounted += value ?? 0;
		}
		if (restCount > 0) {
			row.series_other = Math.max(0, point.rps - accounted);
		}
		return row;
	});

	return { rows, series: chartSeries, restCount };
}
