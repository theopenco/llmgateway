import { addDays, differenceInCalendarDays, format } from "date-fns";

import { splitCost, COST_SEGMENTS } from "@llmgateway/shared/cost-breakdown";

import type { UsageDateRange } from "./usage-comparison";
import type { DailyActivity } from "@/types/activity";
import type { CostSegmentKey } from "@llmgateway/shared/cost-breakdown";

export type Period = "current" | "comparison";

/** Per-period cost of one stacked segment, e.g. `currentCacheWriteCost`. */
export type SegmentField = `${Period}${Capitalize<CostSegmentKey>}Cost`;

export type ChartPoint = {
	index: number;
	currentDate?: string;
	comparisonDate?: string;
	/** Total spend: inference cost plus data storage. */
	currentCost?: number;
	comparisonCost?: number;
	currentRequests?: number;
	comparisonRequests?: number;
} & Partial<Record<SegmentField, number>>;

export function segmentField(
	period: Period,
	key: CostSegmentKey,
): SegmentField {
	return `${period}${key.charAt(0).toUpperCase()}${key.slice(1)}Cost` as SegmentField;
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
	| "cacheWriteInputCost"
	| "dataStorageCost"
>;

const SEGMENT_KEYS: CostSegmentKey[] = [
	"input",
	"output",
	"cachedInput",
	"cacheWrite",
	"other",
	"storage",
];

function periodFields(
	period: Period,
	day: ChartActivity | undefined,
): Partial<ChartPoint> {
	const split = splitCost(
		day ?? {
			cost: 0,
			inputCost: 0,
			outputCost: 0,
			cachedInputCost: 0,
			cacheWriteInputCost: 0,
		},
	);
	const requests = day?.requestCount ?? 0;
	const fields: Partial<ChartPoint> =
		period === "current"
			? { currentCost: split.total, currentRequests: requests }
			: { comparisonCost: split.total, comparisonRequests: requests };
	for (const key of SEGMENT_KEYS) {
		fields[segmentField(period, key)] = split[key];
	}
	return fields;
}

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
		return {
			index,
			currentDate,
			comparisonDate,
			...(currentDate
				? periodFields("current", currentByDate.get(currentDate))
				: {}),
			...(comparisonData && comparisonDate
				? periodFields("comparison", comparisonByDate.get(comparisonDate))
				: {}),
		};
	});
}
// Shown even when zero so the breakdown always reads the same; the rest only
// appear once they carry spend.
const ALWAYS_SHOWN = new Set<CostSegmentKey>([
	"input",
	"output",
	"cachedInput",
]);

export function isSegmentShown(key: CostSegmentKey, value: number): boolean {
	return ALWAYS_SHOWN.has(key) || value > 0;
}

/** Segments that carry spend anywhere in the chart, in stacking order. */
export function visibleSegments(points: ChartPoint[]) {
	return COST_SEGMENTS.filter((segment) =>
		points.some(
			(point) =>
				isSegmentShown(
					segment.key,
					point[segmentField("current", segment.key)] ?? 0,
				) || (point[segmentField("comparison", segment.key)] ?? 0) > 0,
		),
	);
}
