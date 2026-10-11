import { sql } from "@llmgateway/db";

import type { SQL } from "@llmgateway/db";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Hour starts for a sparkline, oldest first, ending with the hour in progress.
 * Epoch-aligned, which matches the UTC `hourTimestamp` buckets.
 */
export function hourBucketStarts(
	count: number,
	now: Date = new Date(),
): Date[] {
	const end = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
	return Array.from({ length: count }, (_, index) => {
		const offsetMs = (count - 1 - index) * HOUR_MS;
		return new Date(end - offsetMs);
	});
}

/**
 * Start of each UTC day in a sparkline, oldest first, ending with today. Whole
 * UTC days rather than a rolling count×24h window: `date_trunc('day')` cuts on
 * UTC boundaries, so a rolling start would leave the oldest bucket holding only
 * part of its day and draw a dip that never happened.
 */
export function utcDayBucketStarts(
	count: number,
	now: Date = new Date(),
): Date[] {
	const today = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate(),
	);
	return Array.from({ length: count }, (_, index) => {
		const offsetMs = (count - 1 - index) * DAY_MS;
		return new Date(today - offsetMs);
	});
}

/**
 * ISO-8601 UTC label for a truncated bucket, formatted the same way
 * `Date#toISOString` would, so it can be compared to a generated bucket grid.
 */
export function bucketLabel(bucketExpr: SQL<Date>) {
	return sql<string>`to_char(${bucketExpr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}
