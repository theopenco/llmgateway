import { addDays, differenceInCalendarDays, format } from "date-fns";

import type { UsageDateRange } from "./usage-comparison";
import type { DailyActivity } from "@/types/activity";

export interface ChartPoint {
	index: number;
	currentDate?: string;
	comparisonDate?: string;
	currentCost?: number;
	comparisonCost?: number;
	currentRequests?: number;
	comparisonRequests?: number;
	currentInputCost?: number;
	comparisonInputCost?: number;
	currentOutputCost?: number;
	comparisonOutputCost?: number;
	currentCachedInputCost?: number;
	comparisonCachedInputCost?: number;
}

function dateKeys(range: UsageDateRange): string[] {
	const days = differenceInCalendarDays(range.to, range.from) + 1;
	return Array.from({ length: days }, (_, index) =>
		format(addDays(range.from, index), "yyyy-MM-dd"),
	);
}

type ChartActivity = Pick<
	DailyActivity,
	| "date"
	| "cost"
	| "requestCount"
	| "inputCost"
	| "outputCost"
	| "cachedInputCost"
>;

export function buildUsageChartData(
	currentRange: UsageDateRange,
	data: ChartActivity[],
	comparisonRange?: UsageDateRange | null,
	comparisonData?: ChartActivity[],
): ChartPoint[] {
	const currentKeys = dateKeys(currentRange);
	const comparisonKeys = comparisonRange ? dateKeys(comparisonRange) : [];
	const currentByDate = new Map(data.map((day) => [day.date, day]));
	const comparisonByDate = new Map(
		(comparisonData ?? []).map((day) => [day.date, day]),
	);
	const pointCount = Math.max(currentKeys.length, comparisonKeys.length);
	return Array.from({ length: pointCount }, (_, index) => {
		const currentDate = currentKeys[index];
		const comparisonDate = comparisonKeys[index];
		const current = currentDate ? currentByDate.get(currentDate) : undefined;
		const comparison = comparisonDate
			? comparisonByDate.get(comparisonDate)
			: undefined;
		return {
			index,
			currentDate,
			comparisonDate,
			currentCost: currentDate ? (current?.cost ?? 0) : undefined,
			comparisonCost:
				comparisonData && comparisonDate ? (comparison?.cost ?? 0) : undefined,
			currentRequests: currentDate ? (current?.requestCount ?? 0) : undefined,
			comparisonRequests:
				comparisonData && comparisonDate
					? (comparison?.requestCount ?? 0)
					: undefined,
			currentInputCost: currentDate ? (current?.inputCost ?? 0) : undefined,
			comparisonInputCost:
				comparisonData && comparisonDate
					? (comparison?.inputCost ?? 0)
					: undefined,
			currentOutputCost: currentDate ? (current?.outputCost ?? 0) : undefined,
			comparisonOutputCost:
				comparisonData && comparisonDate
					? (comparison?.outputCost ?? 0)
					: undefined,
			currentCachedInputCost: currentDate
				? (current?.cachedInputCost ?? 0)
				: undefined,
			comparisonCachedInputCost:
				comparisonData && comparisonDate
					? (comparison?.cachedInputCost ?? 0)
					: undefined,
		};
	});
}
