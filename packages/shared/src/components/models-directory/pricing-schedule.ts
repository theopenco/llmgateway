import { discountFraction } from "@/lib/discount";

import type { ApiModelProviderMapping } from "./api-types";

type PeakPricing = NonNullable<ApiModelProviderMapping["peakPricing"]>;

type PriceRecord = Record<string, string | number>;

/** Per-unit pricing fields shared by API mappings and catalogue definitions. */
export interface PerUnitPricing {
	perImagePrice?: PriceRecord | null;
	perSecondPrice?: PriceRecord | null;
	inputCharacterPrice?: string | number | null;
	discount?: string | null;
}

export const PRICE_UNIT_FIELDS = [
	"perImagePrice",
	"perSecondPrice",
	"inputCharacterPrice",
] as const;
export type PriceUnitField = (typeof PRICE_UNIT_FIELDS)[number];

export function isPriceUnitField(
	value: string | null | undefined,
): value is PriceUnitField {
	return (
		value !== null &&
		value !== undefined &&
		(PRICE_UNIT_FIELDS as readonly string[]).includes(value)
	);
}

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

/** Discounted price in the field's own unit; null when missing or invalid. */
export function effectiveUnitPrice(
	price: string | number | null | undefined,
	discount?: string | null,
): number | null {
	const raw = parseStrictPrice(price);
	if (raw === null) {
		return null;
	}
	const d = discountFraction(discount);
	return d > 0 ? raw * (1 - d) : raw;
}

/** Discounted token price in $/M tokens. */
export function effectiveTokenPrice(
	price: string | null | undefined,
	discount?: string | null,
): number | null {
	const eff = effectiveUnitPrice(price, discount);
	return eff === null ? null : eff * 1e6;
}

/** Per-unit prices render with 5 decimals; round once so filter, sort and display agree. */
export function roundPerUnit(value: number): number {
	return Number(value.toFixed(5));
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

export function discountedPriceValues(
	record: PriceRecord,
	discount?: string | null,
): number[] {
	return Object.values(record)
		.map((v) => effectiveUnitPrice(v, discount))
		.filter((v): v is number => v !== null)
		.map(roundPerUnit);
}

function minOf(values: number[]): number | null {
	return values.length > 0 ? Math.min(...values) : null;
}

function maxOf(values: number[]): number | null {
	return values.length > 0 ? Math.max(...values) : null;
}

/** True when any tier of the record is priced above zero before discounts. */
export function hasPaidTier(record: PriceRecord | null | undefined): boolean {
	return (
		!!record &&
		Object.values(record).some((v) => (parseStrictPrice(v) ?? 0) > 0)
	);
}

export function getMinPerImagePrice(mapping: PerUnitPricing): number | null {
	return mapping.perImagePrice
		? minOf(discountedPriceValues(mapping.perImagePrice, mapping.discount))
		: null;
}

export function getMaxPerImagePrice(mapping: PerUnitPricing): number | null {
	return mapping.perImagePrice
		? maxOf(discountedPriceValues(mapping.perImagePrice, mapping.discount))
		: null;
}

export function getMinPerSecondPrice(mapping: PerUnitPricing): number | null {
	return mapping.perSecondPrice
		? minOf(discountedPriceValues(mapping.perSecondPrice, mapping.discount))
		: null;
}

export function getMaxPerSecondPrice(mapping: PerUnitPricing): number | null {
	return mapping.perSecondPrice
		? maxOf(discountedPriceValues(mapping.perSecondPrice, mapping.discount))
		: null;
}

/** Discounted speech price in $/1K characters. */
export function getInputCharacterPricePer1K(
	mapping: PerUnitPricing,
): number | null {
	const eff = effectiveUnitPrice(mapping.inputCharacterPrice, mapping.discount);
	return eff === null ? null : roundPerUnit(eff * 1000);
}

/** Cheapest price of a mapping in the given unit; null when it has none. */
export function minUnitPrice(
	mapping: PerUnitPricing,
	unit: PriceUnitField,
): number | null {
	switch (unit) {
		case "perImagePrice":
			return getMinPerImagePrice(mapping);
		case "perSecondPrice":
			return getMinPerSecondPrice(mapping);
		case "inputCharacterPrice":
			return getInputCharacterPricePer1K(mapping);
	}
}

/** Most expensive price of a mapping in the given unit; null when it has none. */
export function maxUnitPrice(
	mapping: PerUnitPricing,
	unit: PriceUnitField,
): number | null {
	switch (unit) {
		case "perImagePrice":
			return getMaxPerImagePrice(mapping);
		case "perSecondPrice":
			return getMaxPerSecondPrice(mapping);
		case "inputCharacterPrice":
			return getInputCharacterPricePer1K(mapping);
	}
}

/** Input price used for the Input column: cheapest tier in `unit`, else $/M tokens. */
export function inputPriceInUnit(
	mapping: ApiModelProviderMapping,
	unit: PriceUnitField | null,
): number | null {
	return unit
		? minUnitPrice(mapping, unit)
		: effectiveTokenPrice(mapping.inputPrice, mapping.discount);
}

/** Output price used for the Output column: priciest tier in `unit`, else $/M tokens. */
export function outputPriceInUnit(
	mapping: ApiModelProviderMapping,
	unit: PriceUnitField | null,
): number | null {
	return unit
		? maxUnitPrice(mapping, unit)
		: effectiveTokenPrice(mapping.outputPrice, mapping.discount);
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
