import { z } from "zod";

/**
 * Bucket grains the gateway-load endpoints can report at. `minute` is only
 * reachable from the minute-grain mapping-history tables; the tenant rollups
 * (project/api-key hourly stats) never go finer than `hour`.
 */
export const loadBucketSchema = z.enum(["minute", "hour", "day"]);

export type LoadBucket = z.infer<typeof loadBucketSchema>;

export const BUCKET_SECONDS: Record<LoadBucket, number> = {
	minute: 60,
	hour: 60 * 60,
	day: 24 * 60 * 60,
};

/**
 * Default grain for a window. Short windows keep the minute grain so a live
 * request rate is actually visible; anything longer would return thousands of
 * points, so it rolls up.
 */
export function getLoadBucketForWindow(window: string): LoadBucket {
	if (window === "1h" || window === "4h") {
		return "minute";
	}
	if (window === "12h" || window === "1d" || window === "7d") {
		return "hour";
	}
	return "day";
}

export function truncateToLoadBucket(date: Date, unit: LoadBucket): Date {
	return new Date(
		Date.UTC(
			date.getUTCFullYear(),
			date.getUTCMonth(),
			date.getUTCDate(),
			unit === "day" ? 0 : date.getUTCHours(),
			unit === "minute" ? date.getUTCMinutes() : 0,
		),
	);
}

export function formatLoadBucket(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:00Z`;
}

/**
 * Every bucket boundary the range covers, oldest first.
 *
 * Rollup queries only return buckets that hold rows, so the caller zero-fills
 * against this grid and the axis always spans the whole window.
 */
export function generateLoadBuckets(
	start: Date,
	end: Date,
	unit: LoadBucket,
): string[] {
	const stepMs = BUCKET_SECONDS[unit] * 1000;
	const startMs = truncateToLoadBucket(start, unit).getTime();
	const endMs = truncateToLoadBucket(end, unit).getTime();
	const buckets: string[] = [];
	for (let t = startMs; t <= endMs; t += stepMs) {
		buckets.push(formatLoadBucket(new Date(t)));
	}
	return buckets;
}

/**
 * How many seconds of the bucket have actually elapsed.
 *
 * The trailing bucket of a live chart is still filling, so dividing its request
 * count by the full bucket length always renders a rate dipping towards zero.
 * Dividing by the elapsed seconds instead keeps the last point comparable to
 * the ones before it. Floored at 1 second so a bucket that just opened cannot
 * divide by zero.
 */
export function bucketSecondsFor(
	bucketIso: string,
	unit: LoadBucket,
	now: Date = new Date(),
): number {
	const full = BUCKET_SECONDS[unit];
	const startMs = Date.parse(bucketIso);
	if (Number.isNaN(startMs)) {
		return full;
	}
	const elapsed = Math.floor((now.getTime() - startMs) / 1000);
	if (elapsed >= full) {
		return full;
	}
	return Math.max(1, elapsed);
}

export function isPartialBucket(
	bucketIso: string,
	unit: LoadBucket,
	now: Date = new Date(),
): boolean {
	const startMs = Date.parse(bucketIso);
	if (Number.isNaN(startMs)) {
		return false;
	}
	const lengthMs = BUCKET_SECONDS[unit] * 1000;
	return startMs + lengthMs > now.getTime();
}

export function toRps(requestCount: number, seconds: number): number {
	if (seconds <= 0) {
		return 0;
	}
	return requestCount / seconds;
}
