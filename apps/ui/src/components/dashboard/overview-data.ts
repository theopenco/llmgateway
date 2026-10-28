import {
	addDays,
	differenceInCalendarDays,
	format,
	startOfMonth,
	startOfWeek,
} from "date-fns";

import { splitCost, COST_SEGMENTS } from "@llmgateway/shared/cost-breakdown";

import type { UsageDateRange } from "./usage-comparison";
import type { DailyActivity } from "@/types/activity";
import type { CostSegmentKey } from "@llmgateway/shared/cost-breakdown";

export type Period = "current" | "comparison";

/** Time span each chart bar aggregates. Weeks start on Monday. */
export type UsageGrain = "day" | "week" | "month";

export const USAGE_GRAINS: UsageGrain[] = ["day", "week", "month"];

export function parseUsageGrain(value: string | null): UsageGrain {
	return value === "week" || value === "month" ? value : "day";
}

export function usageGrainAdjective(grain: UsageGrain): string {
	switch (grain) {
		case "week":
			return "Weekly";
		case "month":
			return "Monthly";
		default:
			return "Daily";
	}
}

/** Per-period cost of one stacked segment, e.g. `currentCacheWriteCost`. */
export type SegmentField = `${Period}${Capitalize<CostSegmentKey>}Cost`;

export type ChartPoint = {
	index: number;
	/** First day of the bucket, clipped to the selected range. */
	currentDate?: string;
	comparisonDate?: string;
	/** Last day of the bucket, clipped to the selected range. */
	currentEndDate?: string;
	comparisonEndDate?: string;
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

interface Bucket {
	id: string;
	start: string;
	end: string;
	days: string[];
}

function bucketStart(date: Date, grain: UsageGrain): Date {
	switch (grain) {
		case "week":
			return startOfWeek(date, { weekStartsOn: 1 });
		case "month":
			return startOfMonth(date);
		default:
			return date;
	}
}

function dateBuckets(range: UsageDateRange, grain: UsageGrain): Bucket[] {
	const dayCount = differenceInCalendarDays(range.to, range.from) + 1;
	const buckets: Bucket[] = [];
	for (let index = 0; index < dayCount; index++) {
		const date = addDays(range.from, index);
		const day = format(date, "yyyy-MM-dd");
		const id = format(bucketStart(date, grain), "yyyy-MM-dd");
		const last = buckets[buckets.length - 1];
		if (last?.id === id) {
			last.end = day;
			last.days.push(day);
		} else {
			buckets.push({ id, start: day, end: day, days: [day] });
		}
	}
	return buckets;
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
	bucket: Bucket,
	byDate: Map<string, ChartActivity>,
): Partial<ChartPoint> {
	let total = 0;
	let requests = 0;
	const segments = Object.fromEntries(
		SEGMENT_KEYS.map((key) => [key, 0]),
	) as Record<CostSegmentKey, number>;
	// Split each day before summing so a bucket stacks exactly like its days.
	for (const date of bucket.days) {
		const day = byDate.get(date);
		if (!day) {
			continue;
		}
		const split = splitCost(day);
		total += split.total;
		requests += day.requestCount;
		for (const key of SEGMENT_KEYS) {
			segments[key] += split[key];
		}
	}
	const fields: Partial<ChartPoint> =
		period === "current"
			? {
					currentDate: bucket.start,
					currentEndDate: bucket.end,
					currentCost: total,
					currentRequests: requests,
				}
			: {
					comparisonDate: bucket.start,
					comparisonEndDate: bucket.end,
					comparisonCost: total,
					comparisonRequests: requests,
				};
	for (const key of SEGMENT_KEYS) {
		fields[segmentField(period, key)] = segments[key];
	}
	return fields;
}

export function buildUsageChartData(
	currentRange: UsageDateRange,
	data: ChartActivity[],
	comparisonRange?: UsageDateRange | null,
	comparisonData?: ChartActivity[],
	grain: UsageGrain = "day",
): ChartPoint[] {
	const currentBuckets = dateBuckets(currentRange, grain);
	const comparisonBuckets = comparisonRange
		? dateBuckets(comparisonRange, grain)
		: [];
	const currentByDate = new Map(data.map((day) => [day.date, day]));
	const comparisonByDate = new Map(
		(comparisonData ?? []).map((day) => [day.date, day]),
	);
	const pointCount = Math.max(currentBuckets.length, comparisonBuckets.length);
	return Array.from({ length: pointCount }, (_, index) => {
		const currentBucket = currentBuckets[index];
		const comparisonBucket = comparisonBuckets[index];
		return {
			index,
			...(currentBucket
				? periodFields("current", currentBucket, currentByDate)
				: {}),
			...(comparisonBucket
				? comparisonData
					? periodFields("comparison", comparisonBucket, comparisonByDate)
					: {
							comparisonDate: comparisonBucket.start,
							comparisonEndDate: comparisonBucket.end,
						}
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
