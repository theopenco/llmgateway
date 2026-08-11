import { HTTPException } from "hono/http-exception";

import { formatInTimeZone, zonedTimeToUtc } from "@/utils/timezone.js";

// Daily buckets are padded one calendar day at a time, so cap the window to a
// year to keep the response bounded and — crucially — to keep the returned
// buckets covering exactly the same range the SQL totals do (no silent
// truncation of an over-large span).
export const MAX_ORG_ACTIVITY_RANGE_DAYS = 366;

export function rangeDaysInclusive(fromStr: string, toStr: string): number {
	const from = Date.parse(`${fromStr}T00:00:00Z`);
	const to = Date.parse(`${toStr}T00:00:00Z`);
	return Math.round((to - from) / 86_400_000) + 1;
}

// Resolve the query window and the local calendar day-labels used to pad the
// series. from/to are interpreted as wall-clock days in the caller's timezone
// (defaulting to UTC), so the returned fromStr/toStr always line up with the
// day buckets the SQL produces.
export function resolveDateRange(
	from: string | undefined,
	to: string | undefined,
	timeZone: string,
): {
	startDate: Date;
	endDate: Date;
	fromStr: string;
	toStr: string;
} {
	if (from && to) {
		if (
			Number.isNaN(Date.parse(from + "T00:00:00Z")) ||
			Number.isNaN(Date.parse(to + "T00:00:00Z"))
		) {
			throw new HTTPException(400, {
				message: "Invalid from/to date (expected YYYY-MM-DD)",
			});
		}
		const startDate = zonedTimeToUtc(from + "T00:00:00.000", timeZone);
		const endDate = zonedTimeToUtc(to + "T23:59:59.999", timeZone);
		return { startDate, endDate, fromStr: from, toStr: to };
	}
	const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
	const endDate = new Date();
	const startDate = new Date(endDate.getTime() - sevenDaysMs);
	return {
		startDate,
		endDate,
		fromStr: formatInTimeZone(startDate, timeZone, false),
		toStr: formatInTimeZone(endDate, timeZone, false),
	};
}
