import {
	addDays,
	addMonths,
	differenceInCalendarDays,
	format,
	isValid,
	subDays,
	subMonths,
} from "date-fns";

export type UsageComparisonMode =
	"off" | "previous-period" | "previous-week" | "previous-month" | "custom";

export interface UsageDateRange {
	from: Date;
	to: Date;
}

interface SearchParamsReader {
	get: (name: string) => string | null;
}

export function parseUsageComparisonMode(
	value: string | null,
): UsageComparisonMode {
	switch (value) {
		case "previous-period":
		case "previous-week":
		case "previous-month":
		case "custom":
			return value;
		default:
			return "off";
	}
}

function parseDay(value: string | null): Date | null {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return null;
	}
	const date = new Date(`${value}T00:00:00`);
	return isValid(date) && format(date, "yyyy-MM-dd") === value ? date : null;
}

export function namedUsageComparisonRange(
	mode: "previous-week" | "previous-month",
	from: Date,
): UsageDateRange {
	return {
		from,
		to:
			mode === "previous-week"
				? addDays(from, 6)
				: subDays(addMonths(from, 1), 1),
	};
}

export function resolveUsageComparisonRange(
	mode: UsageComparisonMode,
	current: UsageDateRange,
	searchParams?: SearchParamsReader,
): UsageDateRange | null {
	const selectedStart = parseDay(searchParams?.get("compareFrom") ?? null);

	switch (mode) {
		case "previous-period": {
			const days = differenceInCalendarDays(current.to, current.from) + 1;
			return {
				from: subDays(current.from, days),
				to: subDays(current.from, 1),
			};
		}
		case "previous-week":
		case "previous-month": {
			const from =
				selectedStart ??
				(mode === "previous-week"
					? subDays(current.from, 7)
					: subMonths(current.from, 1));
			const range = namedUsageComparisonRange(mode, from);
			return range.to < current.from ? range : null;
		}
		case "custom": {
			const from = parseDay(searchParams?.get("compareFrom") ?? null);
			const to = parseDay(searchParams?.get("compareTo") ?? null);
			return from && to && from <= to ? { from, to } : null;
		}
		case "off":
		default:
			return null;
	}
}

export function formatUsageDateRange({ from, to }: UsageDateRange): string {
	if (from.getFullYear() === to.getFullYear()) {
		if (from.getMonth() === to.getMonth()) {
			return `${format(from, "MMM d")}–${format(to, "d, yyyy")}`;
		}
		return `${format(from, "MMM d")}–${format(to, "MMM d, yyyy")}`;
	}
	return `${format(from, "MMM d, yyyy")}–${format(to, "MMM d, yyyy")}`;
}
