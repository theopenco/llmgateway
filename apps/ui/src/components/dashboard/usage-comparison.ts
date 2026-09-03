import { differenceInCalendarDays, format, subDays, subMonths } from "date-fns";

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
	return format(date, "yyyy-MM-dd") === value ? date : null;
}

export function resolveUsageComparisonRange(
	mode: UsageComparisonMode,
	current: UsageDateRange,
	searchParams?: SearchParamsReader,
): UsageDateRange | null {
	switch (mode) {
		case "previous-period": {
			const days = differenceInCalendarDays(current.to, current.from) + 1;
			return {
				from: subDays(current.from, days),
				to: subDays(current.from, 1),
			};
		}
		case "previous-week":
			return {
				from: subDays(current.from, 7),
				to: subDays(current.to, 7),
			};
		case "previous-month":
			return {
				from: subMonths(current.from, 1),
				to: subMonths(current.to, 1),
			};
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
