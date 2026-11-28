import {
	endOfMonth,
	endOfQuarter,
	endOfWeek,
	endOfYear,
	format,
	getQuarter,
	startOfMonth,
	startOfQuarter,
	startOfWeek,
	startOfYear,
	subDays,
	subMonths,
	subQuarters,
	subWeeks,
	subYears,
} from "date-fns";

export interface DatePresetRange {
	from: Date;
	to: Date;
}

export interface DatePreset {
	label: string;
	value: string;
	getRange: () => DatePresetRange;
}

function quarterLabel(date: Date): string {
	return `Q${getQuarter(date)} ${format(date, "yyyy")}`;
}

/** `today` is a local-midnight Date whose calendar fields are the day every
 *  preset is anchored on. `customRange` is the "Custom" entry's range. */
export function buildDatePresets(
	today: Date,
	customRange: () => DatePresetRange,
): DatePreset[] {
	return [
		{
			label: "Custom",
			value: "custom",
			getRange: customRange,
		},
		{
			label: "Today",
			value: "today",
			getRange: () => ({ from: today, to: today }),
		},
		{
			label: "This week",
			value: "this_week",
			getRange: () => ({
				from: startOfWeek(today, { weekStartsOn: 1 }),
				to: today,
			}),
		},
		{
			label: "This month",
			value: "this_month",
			getRange: () => ({ from: startOfMonth(today), to: today }),
		},
		{
			label: "This year",
			value: "this_year",
			getRange: () => ({ from: startOfYear(today), to: today }),
		},
		{
			label: "Last week",
			value: "last_week",
			getRange: () => {
				const lastWeek = subWeeks(today, 1);
				return {
					from: startOfWeek(lastWeek, { weekStartsOn: 1 }),
					to: endOfWeek(lastWeek, { weekStartsOn: 1 }),
				};
			},
		},
		{
			label: "Last month",
			value: "last_month",
			getRange: () => {
				const lastMonth = subMonths(today, 1);
				return { from: startOfMonth(lastMonth), to: endOfMonth(lastMonth) };
			},
		},
		{
			label: "Last year",
			value: "last_year",
			getRange: () => {
				const lastYear = subYears(today, 1);
				return { from: startOfYear(lastYear), to: endOfYear(lastYear) };
			},
		},
		{
			label: "Last 30 days",
			value: "last_30_days",
			getRange: () => ({ from: subDays(today, 29), to: today }),
		},
		{
			label: "Last 90 days",
			value: "last_90_days",
			getRange: () => ({ from: subDays(today, 89), to: today }),
		},
		{
			label: "Last 6 months",
			value: "last_6_months",
			getRange: () => ({ from: subMonths(today, 6), to: today }),
		},
		{
			label: `This quarter (${quarterLabel(today)})`,
			value: "this_quarter",
			getRange: () => ({ from: startOfQuarter(today), to: today }),
		},
		{
			label: `Last quarter (${quarterLabel(subQuarters(today, 1))})`,
			value: "last_quarter",
			getRange: () => {
				const quarter = subQuarters(today, 1);
				return { from: startOfQuarter(quarter), to: endOfQuarter(quarter) };
			},
		},
		{
			label: `2 quarters ago (${quarterLabel(subQuarters(today, 2))})`,
			value: "2_quarters_ago",
			getRange: () => {
				const quarter = subQuarters(today, 2);
				return { from: startOfQuarter(quarter), to: endOfQuarter(quarter) };
			},
		},
		{
			label: `3 quarters ago (${quarterLabel(subQuarters(today, 3))})`,
			value: "3_quarters_ago",
			getRange: () => {
				const quarter = subQuarters(today, 3);
				return { from: startOfQuarter(quarter), to: endOfQuarter(quarter) };
			},
		},
		{
			label: "All time",
			value: "all_time",
			getRange: () => ({ from: new Date(2020, 0, 1), to: today }),
		},
	];
}

/** `preferred` is checked first, so a default window that covers the same
 *  days as another preset (e.g. "This week" and "Today" on a Monday) keeps
 *  its own name. */
export function findMatchingPreset(
	from: Date,
	to: Date,
	presets: DatePreset[],
	preferred?: string,
): string {
	const ordered = preferred
		? [...presets].sort(
				(a, b) => Number(b.value === preferred) - Number(a.value === preferred),
			)
		: presets;
	for (const preset of ordered) {
		if (preset.value === "custom") {
			continue;
		}
		const range = preset.getRange();
		if (
			format(from, "yyyy-MM-dd") === format(range.from, "yyyy-MM-dd") &&
			format(to, "yyyy-MM-dd") === format(range.to, "yyyy-MM-dd")
		) {
			return preset.value;
		}
	}
	return "custom";
}
