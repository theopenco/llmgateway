import { discountFraction } from "@/lib/discount";

import type { ApiModelProviderMapping } from "./api-types";

type PeakPricing = NonNullable<ApiModelProviderMapping["peakPricing"]>;

export function effectiveTokenPrice(
	price: string | null | undefined,
	discount?: string | null,
): number | null {
	if (price === null || price === undefined || price === "") {
		return null;
	}
	const raw = parseFloat(price);
	if (!Number.isFinite(raw) || raw <= 0) {
		return null;
	}
	const d = discountFraction(discount);
	const eff = d > 0 ? raw * (1 - d) : raw;
	if (!Number.isFinite(eff) || eff <= 0) {
		return null;
	}
	return eff * 1e6;
}

export function compareNullBottom(
	a: number | null,
	b: number | null,
	dir: "asc" | "desc",
): number {
	if (a === null && b === null) {
		return 0;
	}
	if (a === null) {
		return 1;
	}
	if (b === null) {
		return -1;
	}
	return dir === "asc" ? a - b : b - a;
}

const orderedDays = [1, 2, 3, 4, 5, 6, 0] as const;
const dayNames = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
] as const;

function formatDays(days: number[]): string {
	const uniqueDays = orderedDays.filter((day) => days.includes(day));
	if (uniqueDays.length === 7) {
		return "Every day";
	}
	if (
		uniqueDays.length === 5 &&
		uniqueDays.every((day, index) => day === orderedDays[index])
	) {
		return "Monday–Friday";
	}

	const names = uniqueDays.map((day) => dayNames[day]);
	if (names.length <= 1) {
		return names[0] ?? "";
	}
	if (names.length === 2) {
		return `${names[0]} and ${names[1]}`;
	}
	return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function formatTime(hourUtc: number, utcOffsetMinutes: number): string {
	const minutesPerDay = 24 * 60;
	const utcMinutes = hourUtc * 60;
	const localMinutes =
		(((utcMinutes + utcOffsetMinutes) % minutesPerDay) + minutesPerDay) %
		minutesPerDay;
	const hours = Math.floor(localMinutes / 60);
	const minutes = localMinutes % 60;
	return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatPeakPricingSchedule(peakPricing: PeakPricing): {
	peakDays: string;
	offPeakDays: string | null;
	peakHours: string;
	timeZoneLabel: string;
} {
	const offPeakDays = peakPricing.offPeakDays;
	const utcOffsetMinutes = offPeakDays?.utcOffsetMinutes ?? 0;
	const allDayOffPeakDays = offPeakDays?.daysOfWeek ?? [];
	const peakDays = orderedDays.filter(
		(day) => !allDayOffPeakDays.includes(day),
	);
	const peakHours = peakPricing.hoursUtc
		.map(
			([start, end]) =>
				`${formatTime(start, utcOffsetMinutes)}–${formatTime(end, utcOffsetMinutes)}`,
		)
		.join(" and ");

	return {
		peakDays: formatDays(peakDays),
		offPeakDays:
			allDayOffPeakDays.length > 0 ? formatDays(allDayOffPeakDays) : null,
		peakHours,
		timeZoneLabel: offPeakDays?.timeZoneLabel ?? "UTC",
	};
}

export function getMinPerImagePrice(
	mapping: ApiModelProviderMapping,
): number | null {
	if (
		!mapping.perImagePrice ||
		Object.keys(mapping.perImagePrice).length === 0
	) {
		return null;
	}
	const d = discountFraction(mapping.discount);
	const values = Object.values(mapping.perImagePrice)
		.map(Number)
		.filter((v) => Number.isFinite(v) && v > 0)
		.map((v) => (d > 0 ? v * (1 - d) : v))
		.filter((v) => v > 0);
	return values.length > 0 ? Math.min(...values) : null;
}

export function getMinPerSecondPrice(
	mapping: ApiModelProviderMapping,
): number | null {
	if (
		!mapping.perSecondPrice ||
		Object.keys(mapping.perSecondPrice).length === 0
	) {
		return null;
	}
	const d = discountFraction(mapping.discount);
	const values = Object.values(mapping.perSecondPrice)
		.map(Number)
		.filter((v) => Number.isFinite(v) && v > 0)
		.map((v) => (d > 0 ? v * (1 - d) : v))
		.filter((v) => v > 0);
	return values.length > 0 ? Math.min(...values) : null;
}

export function getMinInputCharacterPrice(
	mapping: ApiModelProviderMapping,
): number | null {
	if (!mapping.inputCharacterPrice) {
		return null;
	}
	const price = parseFloat(mapping.inputCharacterPrice);
	if (!Number.isFinite(price) || price <= 0) {
		return null;
	}
	const d = discountFraction(mapping.discount);
	const eff = d > 0 ? price * (1 - d) : price;
	return eff > 0 && Number.isFinite(eff) ? eff : null;
}
