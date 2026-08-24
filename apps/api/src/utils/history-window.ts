import {
	modelHistory,
	modelHistoryHourly,
	modelProviderMappingHistory,
	modelProviderMappingHistoryHourly,
	modelProviderMappingUsageHistory,
	modelProviderMappingUsageHistoryHourly,
	modelUsageHistory,
	modelUsageHistoryHourly,
} from "@llmgateway/db";

type CatalogUsageMode = "total" | "credits" | "api-keys";

// Windows longer than 24h read the hourly rollup tables instead of the minute
// tables, so a 7d/30d/90d range scans hours rather than millions of minute rows.
export const HOURLY_BUCKET_THRESHOLD_MINUTES = 1440;

// Floor a date to the start of its hour so the hourly-table range filter aligns
// to bucket boundaries.
export function floorToHourStart(date: Date): Date {
	const d = new Date(date);
	d.setMinutes(0, 0, 0);
	return d;
}

// Whether a [from, to) range is long enough to be served from the hourly rollup.
export function isHourlyRange(from: Date, to: Date): boolean {
	return (
		to.getTime() - from.getTime() > HOURLY_BUCKET_THRESHOLD_MINUTES * 60 * 1000
	);
}

// The minute and hourly history tables share identical metric column names and
// differ only in their timestamp column. These pickers return the right source
// for a window plus its bucket column, so aggregate/timeseries queries can serve
// both without duplicating every SUM(). The hourly table is cast to the minute
// table's type because the metric columns line up exactly at runtime; callers
// must use the returned `bucket` for any timestamp predicate (never
// `table.minuteTimestamp`, which does not exist on the hourly table).
export function pickMappingHistoryTable(
	hourly: boolean,
	mode: CatalogUsageMode = "total",
): {
	table: typeof modelProviderMappingUsageHistory;
	bucket:
		| typeof modelProviderMappingHistory.minuteTimestamp
		| typeof modelProviderMappingHistoryHourly.hourTimestamp
		| typeof modelProviderMappingUsageHistory.minuteTimestamp
		| typeof modelProviderMappingUsageHistoryHourly.hourTimestamp;
} {
	if (hourly) {
		const table =
			mode === "total"
				? modelProviderMappingHistoryHourly
				: modelProviderMappingUsageHistoryHourly;
		return {
			table: table as unknown as typeof modelProviderMappingUsageHistory,
			bucket: table.hourTimestamp,
		};
	}
	const table =
		mode === "total"
			? modelProviderMappingHistory
			: modelProviderMappingUsageHistory;
	return {
		table: table as unknown as typeof modelProviderMappingUsageHistory,
		bucket: table.minuteTimestamp,
	};
}

export function pickModelHistoryTable(
	hourly: boolean,
	mode: CatalogUsageMode = "total",
): {
	table: typeof modelUsageHistory;
	bucket:
		| typeof modelHistory.minuteTimestamp
		| typeof modelHistoryHourly.hourTimestamp
		| typeof modelUsageHistory.minuteTimestamp
		| typeof modelUsageHistoryHourly.hourTimestamp;
} {
	if (hourly) {
		const table =
			mode === "total" ? modelHistoryHourly : modelUsageHistoryHourly;
		return {
			table: table as unknown as typeof modelUsageHistory,
			bucket: table.hourTimestamp,
		};
	}
	const table = mode === "total" ? modelHistory : modelUsageHistory;
	return {
		table: table as unknown as typeof modelUsageHistory,
		bucket: table.minuteTimestamp,
	};
}
