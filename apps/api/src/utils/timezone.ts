import { z } from "zod";

import { sql } from "@llmgateway/db";

import type { SQLWrapper } from "@llmgateway/db";

export function isValidTimeZone(timeZone: string): boolean {
	try {
		Intl.DateTimeFormat("en-US", { timeZone });
		return true;
	} catch {
		return false;
	}
}

// Reusable optional query param for analytics/activity endpoints so every chart
// can bucket by the caller's local day instead of UTC. Defaults to "UTC" at the
// handler when omitted.
export const timezoneQueryField = z
	.string()
	.max(64)
	.refine(isValidTimeZone, { message: "Invalid IANA timezone" })
	.optional();

// Intl.DateTimeFormat construction is expensive and generateTimeSlots calls it
// in a loop (up to ~8800 iterations for 365d), so reuse one formatter per zone.
const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>();

function getTimeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
	let formatter = timeZoneFormatters.get(timeZone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23",
		});
		timeZoneFormatters.set(timeZone, formatter);
	}
	return formatter;
}

function getTimeZoneParts(date: Date, timeZone: string) {
	const parts = getTimeZoneFormatter(timeZone).formatToParts(date);
	const result: Record<string, string> = {};
	for (const part of parts) {
		result[part.type] = part.value;
	}
	return result;
}

export function formatInTimeZone(
	date: Date,
	timeZone: string,
	isHourly: boolean,
): string {
	const p = getTimeZoneParts(date, timeZone);
	const day = `${p.year}-${p.month}-${p.day}`;
	return isHourly ? `${day}T${p.hour}:${p.minute}:${p.second}` : day;
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
	const p = getTimeZoneParts(date, timeZone);
	const asUtc = Date.UTC(
		Number(p.year),
		Number(p.month) - 1,
		Number(p.day),
		Number(p.hour),
		Number(p.minute),
		Number(p.second),
	);
	const wholeSecondsMs = Math.trunc(date.getTime() / 1000) * 1000;
	return asUtc - wholeSecondsMs;
}

// Interpret a local wall-clock ISO string (no offset) in the given timezone
// and return the corresponding UTC instant. Two passes to converge across DST
// boundaries.
export function zonedTimeToUtc(localIso: string, timeZone: string): Date {
	const wallClock = new Date(localIso + "Z");
	const guess = new Date(
		wallClock.getTime() - timeZoneOffsetMs(wallClock, timeZone),
	);
	return new Date(wallClock.getTime() - timeZoneOffsetMs(guess, timeZone));
}

// Walk UTC hour boundaries (matching the hourly rollup buckets) and label each
// in the requested timezone, deduping consecutive labels for daily granularity
// and DST fall-back overlaps.
export function generateTimeSlots(
	startDate: Date,
	endDate: Date,
	isHourly: boolean,
	timeZone: string,
): string[] {
	const slots: string[] = [];
	const cur = new Date(startDate);
	cur.setUTCMinutes(0, 0, 0);
	while (cur.getTime() <= endDate.getTime()) {
		const slot = formatInTimeZone(cur, timeZone, isHourly);
		if (slots[slots.length - 1] !== slot) {
			slots.push(slot);
		}
		cur.setUTCHours(cur.getUTCHours() + 1);
	}
	return slots;
}

// Bucket UTC-stored hour timestamps as wall-clock strings in the caller's
// timezone, so daily grouping happens at local midnight rather than UTC.
// Callers must GROUP BY / ORDER BY the positional reference (e.g. `1`) rather
// than repeating this expression, because the repeated `timeZone` bind
// parameter would make the GROUP BY expression differ from the SELECT one.
export function bucketDate(
	column: SQLWrapper,
	timeZone: string,
	isHourly: boolean,
) {
	return isHourly
		? sql<string>`to_char(${column} AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD"T"HH24:MI:SS')`
		: sql<string>`to_char(${column} AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD')`;
}
