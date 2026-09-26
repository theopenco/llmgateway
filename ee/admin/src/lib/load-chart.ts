export interface LoadChartPointEntry {
	key: string;
	requestCount: number;
	rps: number;
}

export interface LoadChartPoint {
	timestamp: string;
	partial: boolean;
	bucketSeconds: number;
	requestCount: number;
	rps: number;
	entries: LoadChartPointEntry[];
}

export interface LoadChartSeries {
	chartKey: string;
	label: string;
	sourceKey: string | null;
}

export interface LoadChartRow extends Record<
	string,
	number | string | boolean
> {
	timestamp: string;
	partial: boolean;
	total: number;
}

export interface LoadChart {
	rows: LoadChartRow[];
	series: LoadChartSeries[];
	restCount: number;
}

/**
 * Pivots the overview payload into Recharts rows of requests per second.
 *
 * Series get positional `series_N` keys: model ids contain dots and slashes,
 * which are unsafe both as Recharts data paths and as CSS custom property
 * suffixes. The API only returns per-bucket entries for the ranked keys, so
 * the remainder of each bucket's total becomes a single "Other" series rather
 * than silently shrinking the stack.
 */
export function buildLoadChart({
	series,
	data,
	totalKeys,
}: {
	series: { key: string; label: string }[];
	data: LoadChartPoint[];
	totalKeys: number;
}): LoadChart {
	const restCount = Math.max(0, totalKeys - series.length);
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
			total: point.rps,
		};
		for (const entry of chartSeries) {
			row[entry.chartKey] = 0;
		}
		let accounted = 0;
		for (const entry of point.entries) {
			const chartKey = chartKeyBySource.get(entry.key);
			if (!chartKey) {
				continue;
			}
			row[chartKey] = Number(row[chartKey]) + entry.rps;
			accounted += entry.rps;
		}
		if (restCount > 0) {
			row.series_other = Math.max(0, point.rps - accounted);
		}
		return row;
	});

	return { rows, series: chartSeries, restCount };
}
