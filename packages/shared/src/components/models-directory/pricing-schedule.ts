import { discountFraction } from "@/lib/discount";

import type { ApiModelProviderMapping } from "./api-types";

type PeakPricing = NonNullable<ApiModelProviderMapping["peakPricing"]>;

export function parseStrictPrice(
	value: string | number | null | undefined,
): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	const str = String(value).trim();
	if (str === "") {
		return null;
	}
	if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(str)) {
		return null;
	}
	const n = Number(str);
	if (!Number.isFinite(n) || n < 0) {
		return null;
	}
	return n;
}

export function effectiveTokenPrice(
	price: string | null | undefined,
	discount?: string | null,
): number | null {
	const raw = parseStrictPrice(price);
	if (raw === null) {
		return null;
	}
	if (raw === 0) {
		return 0;
	}
	const d = discountFraction(discount);
	const eff = d > 0 ? raw * (1 - d) : raw;
	if (!Number.isFinite(eff) || eff < 0) {
		return null;
	}
	if (eff === 0) {
		return 0;
	}
	const scaled = eff * 1e6;
	return Number.isFinite(scaled) ? scaled : null;
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

export function compareSortValues(
	a: string | number | null,
	b: string | number | null,
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
	if (typeof a === "string" && typeof b === "string") {
		return dir === "asc" ? a.localeCompare(b) : b.localeCompare(a);
	}
	if (typeof a === "number" && typeof b === "number") {
		return dir === "asc" ? a - b : b - a;
	}
	return 0;
}

function discountedRecordValues(
	record: Record<string, string | number>,
	discount?: string | null,
): number[] {
	const d = discountFraction(discount);
	return Object.values(record)
		.map((v) => parseStrictPrice(v))
		.filter((v): v is number => v !== null)
		.map((v) => (d > 0 ? v * (1 - d) : v))
		.filter((v): v is number => Number.isFinite(v) && v >= 0);
}

export function getMinPerImagePrice(
	mapping: ApiModelProviderMapping,
): number | null {
	if (mapping.perImagePrice) {
		const values = discountedRecordValues(
			mapping.perImagePrice,
			mapping.discount,
		);
		if (values.length > 0) {
			return Math.min(...values);
		}
	}
	if (mapping.imageOutputPrice && mapping.imageOutputTokensByResolution) {
		const price = parseStrictPrice(mapping.imageOutputPrice);
		if (price !== null) {
			const tokens = Object.values(mapping.imageOutputTokensByResolution)
				.map((v) => Number(v))
				.filter((v) => Number.isFinite(v) && v > 0);
			if (tokens.length > 0) {
				const d = discountFraction(mapping.discount);
				const perImage = tokens
					.map((t) => t * price * (d > 0 ? 1 - d : 1))
					.filter((v) => Number.isFinite(v));
				if (perImage.length === 0) {
					return null;
				}
				return Math.min(...perImage);
			}
		}
	}
	return null;
}

export function getMaxPerImagePrice(
	mapping: ApiModelProviderMapping,
): number | null {
	if (!mapping.perImagePrice) {
		return null;
	}
	const values = discountedRecordValues(
		mapping.perImagePrice,
		mapping.discount,
	);
	return values.length > 0 ? Math.max(...values) : null;
}

export function getMinPerSecondPrice(
	mapping: ApiModelProviderMapping,
): number | null {
	if (!mapping.perSecondPrice) {
		return null;
	}
	const values = discountedRecordValues(
		mapping.perSecondPrice,
		mapping.discount,
	);
	return values.length > 0 ? Math.min(...values) : null;
}

export function getMaxPerSecondPrice(
	mapping: ApiModelProviderMapping,
): number | null {
	if (!mapping.perSecondPrice) {
		return null;
	}
	const values = discountedRecordValues(
		mapping.perSecondPrice,
		mapping.discount,
	);
	return values.length > 0 ? Math.max(...values) : null;
}

export function getMinInputCharacterPrice(
	mapping: ApiModelProviderMapping,
): number | null {
	const raw = parseStrictPrice(mapping.inputCharacterPrice);
	if (raw === null) {
		return null;
	}
	if (raw === 0) {
		return 0;
	}
	const d = discountFraction(mapping.discount);
	const eff = d > 0 ? raw * (1 - d) : raw;
	if (!Number.isFinite(eff) || eff < 0) {
		return null;
	}
	return eff;
}

/**
 * perImagePriceValues is used by formatPerImagePriceRange and table badges;
 * keep it exported for shared discounted value logic.
 */
export function perImagePriceValues(
	perImagePrice: Record<string, string | number>,
	discount?: string | null,
): number[] {
	return discountedRecordValues(perImagePrice, discount);
}

/**
 * effectiveTokenPrice returns $/M (scaled 1e6), getMin* return raw per-unit
 * (per image / per second / per 1K chars) — not comparable across families;
 * callers select via filters.priceUnit and must not compare $/M vs per-unit.
 */
export const _unitNote = undefined;

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
