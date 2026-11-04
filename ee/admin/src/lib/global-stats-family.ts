import { Decimal } from "decimal.js";

import {
	canonicalUsedModelId,
	modelFamilyLabel,
	resolveUsedModelFamily,
} from "@llmgateway/models";

import {
	GLOBAL_STATS_METRIC_COLUMNS,
	type GlobalStatsCsvBreakdownItem,
	type GlobalStatsCsvMetrics,
	type GlobalStatsCsvTimeseriesPoint,
} from "./global-stats-csv";

/** Bucket for models the catalogue no longer knows (removed ids). */
export const UNKNOWN_FAMILY = "unknown";

/** Which dimension mapping-keyed rows are re-summarized into. */
export type GlobalStatsFamilyView =
	"family" | "mapping" | "canonical" | "provider";

export interface GlobalStatsFamilyBucketPoint {
	date: string;
	key: string;
	label: string;
	requestCount: number;
	cost: number;
	totalTokens: number;
}

const BUCKET_METRIC_COLUMNS = [
	"requestCount",
	"cost",
	"totalTokens",
] as const satisfies readonly (keyof GlobalStatsCsvMetrics)[];

type MetricColumn = (typeof GLOBAL_STATS_METRIC_COLUMNS)[number];

/** Model family behind a `provider/model` mapping key, whoever served it. */
export function mappingFamily(mappingKey: string): string {
	return resolveUsedModelFamily(mappingKey) ?? UNKNOWN_FAMILY;
}

export function familyLabel(family: string): string {
	return family === UNKNOWN_FAMILY
		? "Unknown family"
		: modelFamilyLabel(family);
}

// The provider the mapping key was prefixed with. The API's provider view reads
// the `usedProvider` column instead; the two agree because the gateway writes
// `usedModel` as `${usedProvider}/${modelId}`.
function mappingProvider(mappingKey: string): string {
	const slash = mappingKey.indexOf("/");
	return (slash === -1 ? "" : mappingKey.slice(0, slash)) || "unknown";
}

function rekey(
	mappingKey: string,
	view: GlobalStatsFamilyView,
): { key: string; label: string } {
	switch (view) {
		case "family": {
			const family = mappingFamily(mappingKey);
			return { key: family, label: familyLabel(family) };
		}
		case "canonical": {
			const canonical = canonicalUsedModelId(mappingKey);
			return { key: canonical, label: canonical };
		}
		case "provider": {
			const provider = mappingProvider(mappingKey);
			return { key: provider, label: provider };
		}
		default:
			return { key: mappingKey, label: mappingKey };
	}
}

function emptyAccumulator<Column extends string>(
	columns: readonly Column[],
): Record<Column, Decimal> {
	return Object.fromEntries(
		columns.map((column) => [column, new Decimal(0)]),
	) as Record<Column, Decimal>;
}

function materialize<Column extends string>(
	columns: readonly Column[],
	accumulator: Record<Column, Decimal>,
): Record<Column, number> {
	return Object.fromEntries(
		columns.map((column) => [column, accumulator[column].toNumber()]),
	) as Record<Column, number>;
}

export interface GlobalStatsFamilySummary {
	totals: GlobalStatsCsvMetrics;
	timeseries: GlobalStatsCsvTimeseriesPoint[];
	timeseriesBreakdown: GlobalStatsFamilyBucketPoint[];
	breakdown: GlobalStatsCsvBreakdownItem[];
	/**
	 * True when the per-bucket rows had to be rebuilt from the three charted
	 * metrics, which leaves every other per-bucket column at zero. Only the
	 * range totals and the breakdown stay complete under a family filter.
	 */
	timeseriesPartial: boolean;
}

/**
 * Re-summarizes mapping-keyed global stats by model family, client-side.
 *
 * Families live in the model catalogue, not in the rollup tables: a mapping key
 * carries both the serving provider and the canonical model id, so one
 * mapping-keyed response is enough to derive every family view without new
 * aggregation. `family` narrows the whole page to one family; `view` picks the
 * dimension the rows are grouped into afterwards.
 */
export function summarizeGlobalStatsByFamily({
	breakdown,
	timeseries,
	timeseriesBreakdown,
	totals,
	family,
	view,
}: {
	breakdown: readonly GlobalStatsCsvBreakdownItem[];
	timeseries: readonly GlobalStatsCsvTimeseriesPoint[];
	timeseriesBreakdown: readonly GlobalStatsFamilyBucketPoint[];
	totals: GlobalStatsCsvMetrics;
	family: string | null;
	view: GlobalStatsFamilyView;
}): GlobalStatsFamilySummary {
	const keep = (mappingKey: string) =>
		family === null || mappingFamily(mappingKey) === family;

	const breakdownBuckets = new Map<
		string,
		{ label: string; metrics: Record<MetricColumn, Decimal> }
	>();
	for (const row of breakdown) {
		if (!keep(row.key)) {
			continue;
		}
		const { key, label } = rekey(row.key, view);
		let bucket = breakdownBuckets.get(key);
		if (!bucket) {
			bucket = {
				label,
				metrics: emptyAccumulator(GLOBAL_STATS_METRIC_COLUMNS),
			};
			breakdownBuckets.set(key, bucket);
		}
		for (const column of GLOBAL_STATS_METRIC_COLUMNS) {
			bucket.metrics[column] = bucket.metrics[column].plus(row[column]);
		}
	}

	const bucketPoints = new Map<
		string,
		{
			date: string;
			key: string;
			label: string;
			metrics: Record<(typeof BUCKET_METRIC_COLUMNS)[number], Decimal>;
		}
	>();
	for (const point of timeseriesBreakdown) {
		if (!keep(point.key)) {
			continue;
		}
		const { key, label } = rekey(point.key, view);
		const id = `${point.date}\u0000${key}`;
		let bucket = bucketPoints.get(id);
		if (!bucket) {
			bucket = {
				date: point.date,
				key,
				label,
				metrics: emptyAccumulator(BUCKET_METRIC_COLUMNS),
			};
			bucketPoints.set(id, bucket);
		}
		for (const column of BUCKET_METRIC_COLUMNS) {
			bucket.metrics[column] = bucket.metrics[column].plus(point[column]);
		}
	}

	// Without a family filter the response already covers exactly the rows on
	// screen, so the server's totals and per-bucket metrics are kept verbatim
	// and stay complete. A filter drops rows, so both are recomputed — and the
	// per-bucket payload only carries the three charted metrics.
	const filtered = family !== null;
	const perBucket = new Map<string, Record<string, Decimal>>();
	if (filtered) {
		bucketPoints.forEach((bucket) => {
			let row = perBucket.get(bucket.date);
			if (!row) {
				row = emptyAccumulator(BUCKET_METRIC_COLUMNS);
				perBucket.set(bucket.date, row);
			}
			for (const column of BUCKET_METRIC_COLUMNS) {
				row[column] = row[column].plus(bucket.metrics[column]);
			}
		});
	}

	const filteredTotals = emptyAccumulator(GLOBAL_STATS_METRIC_COLUMNS);
	if (filtered) {
		breakdownBuckets.forEach((bucket) => {
			for (const column of GLOBAL_STATS_METRIC_COLUMNS) {
				filteredTotals[column] = filteredTotals[column].plus(
					bucket.metrics[column],
				);
			}
		});
	}

	return {
		totals: filtered
			? materialize(GLOBAL_STATS_METRIC_COLUMNS, filteredTotals)
			: totals,
		timeseries: filtered
			? timeseries.map((point) => {
					const row = perBucket.get(point.date);
					return {
						...ZERO_METRICS,
						...(row ? materialize(BUCKET_METRIC_COLUMNS, row) : {}),
						date: point.date,
					};
				})
			: [...timeseries],
		timeseriesBreakdown: Array.from(bucketPoints, ([, bucket]) => ({
			date: bucket.date,
			key: bucket.key,
			label: bucket.label,
			...materialize(BUCKET_METRIC_COLUMNS, bucket.metrics),
		})),
		breakdown: Array.from(breakdownBuckets, ([key, bucket]) => ({
			key,
			label: bucket.label,
			...materialize(GLOBAL_STATS_METRIC_COLUMNS, bucket.metrics),
		})),
		timeseriesPartial: filtered,
	};
}

const ZERO_METRICS: GlobalStatsCsvMetrics = materialize(
	GLOBAL_STATS_METRIC_COLUMNS,
	emptyAccumulator(GLOBAL_STATS_METRIC_COLUMNS),
);
