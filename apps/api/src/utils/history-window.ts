import {
	modelHistory,
	modelHistoryHourly,
	modelProviderMappingHistory,
	modelProviderMappingHistoryHourly,
} from "@llmgateway/db";

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
export function pickMappingHistoryTable(hourly: boolean): {
	table: typeof modelProviderMappingHistory;
	bucket:
		| typeof modelProviderMappingHistory.minuteTimestamp
		| typeof modelProviderMappingHistoryHourly.hourTimestamp;
} {
	if (hourly) {
		return {
			table:
				modelProviderMappingHistoryHourly as unknown as typeof modelProviderMappingHistory,
			bucket: modelProviderMappingHistoryHourly.hourTimestamp,
		};
	}
	return {
		table: modelProviderMappingHistory,
		bucket: modelProviderMappingHistory.minuteTimestamp,
	};
}

export function pickModelHistoryTable(hourly: boolean): {
	table: typeof modelHistory;
	bucket:
		| typeof modelHistory.minuteTimestamp
		| typeof modelHistoryHourly.hourTimestamp;
} {
	if (hourly) {
		return {
			table: modelHistoryHourly as unknown as typeof modelHistory,
			bucket: modelHistoryHourly.hourTimestamp,
		};
	}
	return {
		table: modelHistory,
		bucket: modelHistory.minuteTimestamp,
	};
}
