import { parseISO, startOfHour, subDays } from "date-fns";

import {
	buildHourlyActivity,
	sliceHistory,
	type DemoProject,
} from "@/components/home/dashboard-demo-data";

import type { TimeRangeValue } from "./controls";
import type { DailyActivity } from "@/types/activity";

export const RANGE_HOURS: Record<TimeRangeValue, number> = {
	"1h": 1,
	"4h": 4,
	"24h": 24,
	"7d": 7 * 24,
	"30d": 30 * 24,
};

export function isHourlyRange(timeRange: TimeRangeValue) {
	return RANGE_HOURS[timeRange] <= 24;
}

export function activityForRange(
	timeRange: TimeRangeValue,
	{
		anchorDay,
		history,
		openedAt,
		project,
	}: {
		anchorDay: string;
		history: DailyActivity[];
		openedAt: number;
		project: DemoProject;
	},
): DailyActivity[] {
	const hours = RANGE_HOURS[timeRange];
	if (isHourlyRange(timeRange)) {
		return buildHourlyActivity(startOfHour(openedAt), hours, project);
	}
	const anchor = parseISO(anchorDay);
	const days = hours / 24;
	return sliceHistory(history, subDays(anchor, days - 1), anchor);
}

export function periodLabel(timeRange: TimeRangeValue) {
	const hours = RANGE_HOURS[timeRange];
	if (hours < 24) {
		return `last ${hours} hour${hours > 1 ? "s" : ""}`;
	}
	if (hours === 24) {
		return "last 24 hours";
	}
	return `last ${hours / 24} days`;
}

export function scaleDayToKey(
	day: DailyActivity,
	share: number,
): DailyActivity {
	const scale = <
		T extends {
			requestCount: number;
			creditsRequestCount: number;
			apiKeysRequestCount: number;
			totalTokens: number;
			cost: number;
			creditsCost: number;
			apiKeysCost: number;
		},
	>(
		row: T,
	): T => ({
		...row,
		requestCount: Math.round(row.requestCount * share),
		creditsRequestCount: Math.round(row.creditsRequestCount * share),
		apiKeysRequestCount: Math.round(row.apiKeysRequestCount * share),
		totalTokens: Math.round(row.totalTokens * share),
		cost: row.cost * share,
		creditsCost: row.creditsCost * share,
		apiKeysCost: row.apiKeysCost * share,
	});
	return {
		...scale(day),
		dataStorageCost: day.dataStorageCost * share,
		creditsDataStorageCost: day.creditsDataStorageCost * share,
		apiKeysDataStorageCost: day.apiKeysDataStorageCost * share,
		modelBreakdown: day.modelBreakdown.map(scale),
		apiKeyBreakdown: [],
		userBreakdown: [],
	};
}
