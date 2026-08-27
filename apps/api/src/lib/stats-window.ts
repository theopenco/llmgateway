import { z } from "zod";

/**
 * Rolling lookback windows shared by the admin analytics endpoints.
 */
export const tokenWindowSchema = z.enum([
	"1h",
	"4h",
	"12h",
	"1d",
	"7d",
	"30d",
	"90d",
	"365d",
]);

export type TokenWindow = z.infer<typeof tokenWindowSchema>;

export function getTokenWindowStartDate(
	window: string,
	now: Date = new Date(),
): Date {
	const windowMs: Record<string, number> = {
		"1h": 60 * 60 * 1000,
		"4h": 4 * 60 * 60 * 1000,
		"12h": 12 * 60 * 60 * 1000,
		"1d": 24 * 60 * 60 * 1000,
		"7d": 7 * 24 * 60 * 60 * 1000,
		"30d": 30 * 24 * 60 * 60 * 1000,
		"90d": 90 * 24 * 60 * 60 * 1000,
		"365d": 365 * 24 * 60 * 60 * 1000,
	};
	const ms = windowMs[window] ?? 7 * 24 * 60 * 60 * 1000;
	return new Date(now.getTime() - ms);
}

/**
 * Bucket granularity for a window. Short windows keep the hourly grain the
 * stats tables are stored at; longer ones roll up to days so a 365d chart does
 * not return 8760 points.
 */
export function getBucketUnitForWindow(window: string): "hour" | "day" {
	if (
		window === "1h" ||
		window === "4h" ||
		window === "12h" ||
		window === "1d"
	) {
		return "hour";
	}
	return "day";
}

/**
 * Every bucket boundary the window covers, oldest first, as UTC ISO strings.
 *
 * Rollup queries only return buckets that actually hold rows, so a chart drawn
 * straight from them silently shrinks to the busy days. Callers hand this grid
 * to the client so quiet buckets can be zero-filled and the axis always spans
 * the whole window. The hourly stats tables store UTC in a zone-less
 * `timestamp`, so `date_trunc` cuts on UTC boundaries — hence UTC arithmetic
 * here, matching the ISO strings the endpoints emit.
 */
export function getWindowBucketTimestamps(
	window: string,
	now: Date = new Date(),
): string[] {
	const bucketUnit = getBucketUnitForWindow(window);
	const stepMs = bucketUnit === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
	const truncate = (date: Date) =>
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth(),
			date.getUTCDate(),
			bucketUnit === "hour" ? date.getUTCHours() : 0,
		);

	const end = truncate(now);
	const buckets: string[] = [];
	for (
		let ms = truncate(getTokenWindowStartDate(window, now));
		ms <= end;
		ms += stepMs
	) {
		buckets.push(new Date(ms).toISOString());
	}
	return buckets;
}
