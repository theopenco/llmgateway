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

export interface RelativeRangePreset {
	value: string;
	getLabel: (today: Date) => string;
	getRange: (today: Date) => { from: Date; to: Date };
}

function getQuarterLabel(date: Date): string {
	return `Q${getQuarter(date)} ${format(date, "yyyy")}`;
}

// Relative date-range presets. Selecting one stores its value in the `range`
// query param so the URL stays relative ("this week" is resolved against
// today on every request); concrete `from`/`to` params are only used for
// custom spans.
export const RELATIVE_RANGE_PRESETS: RelativeRangePreset[] = [
	{
		value: "today",
		getLabel: () => "Today",
		getRange: (today) => ({ from: today, to: today }),
	},
	{
		value: "this_week",
		getLabel: () => "This week",
		getRange: (today) => ({
			from: startOfWeek(today, { weekStartsOn: 1 }),
			to: today,
		}),
	},
	{
		value: "this_month",
		getLabel: () => "This month",
		getRange: (today) => ({ from: startOfMonth(today), to: today }),
	},
	{
		value: "this_year",
		getLabel: () => "This year",
		getRange: (today) => ({ from: startOfYear(today), to: today }),
	},
	{
		value: "last_week",
		getLabel: () => "Last week",
		getRange: (today) => {
			const lw = subWeeks(today, 1);
			return {
				from: startOfWeek(lw, { weekStartsOn: 1 }),
				to: endOfWeek(lw, { weekStartsOn: 1 }),
			};
		},
	},
	{
		value: "last_month",
		getLabel: () => "Last month",
		getRange: (today) => {
			const lm = subMonths(today, 1);
			return { from: startOfMonth(lm), to: endOfMonth(lm) };
		},
	},
	{
		value: "last_year",
		getLabel: () => "Last year",
		getRange: (today) => {
			const ly = subYears(today, 1);
			return { from: startOfYear(ly), to: endOfYear(ly) };
		},
	},
	{
		value: "last_30_days",
		getLabel: () => "Last 30 days",
		getRange: (today) => ({ from: subDays(today, 29), to: today }),
	},
	{
		value: "last_90_days",
		getLabel: () => "Last 90 days",
		getRange: (today) => ({ from: subDays(today, 89), to: today }),
	},
	{
		value: "last_6_months",
		getLabel: () => "Last 6 months",
		getRange: (today) => ({ from: subMonths(today, 6), to: today }),
	},
	{
		value: "this_quarter",
		getLabel: (today) => `This quarter (${getQuarterLabel(today)})`,
		getRange: (today) => ({ from: startOfQuarter(today), to: today }),
	},
	{
		value: "last_quarter",
		getLabel: (today) =>
			`Last quarter (${getQuarterLabel(subQuarters(today, 1))})`,
		getRange: (today) => {
			const lq = subQuarters(today, 1);
			return { from: startOfQuarter(lq), to: endOfQuarter(lq) };
		},
	},
	{
		value: "2_quarters_ago",
		getLabel: (today) =>
			`2 quarters ago (${getQuarterLabel(subQuarters(today, 2))})`,
		getRange: (today) => {
			const q = subQuarters(today, 2);
			return { from: startOfQuarter(q), to: endOfQuarter(q) };
		},
	},
	{
		value: "3_quarters_ago",
		getLabel: (today) =>
			`3 quarters ago (${getQuarterLabel(subQuarters(today, 3))})`,
		getRange: (today) => {
			const q = subQuarters(today, 3);
			return { from: startOfQuarter(q), to: endOfQuarter(q) };
		},
	},
];

export function findRelativeRangePreset(
	value: string | undefined,
): RelativeRangePreset | undefined {
	return value
		? RELATIVE_RANGE_PRESETS.find((p) => p.value === value)
		: undefined;
}

export interface DateRangeSearchParams {
	range?: string;
	from?: string;
	to?: string;
}

// Resolves the URL query state into concrete `from`/`to` date strings for API
// calls. A valid `range` preset wins and is resolved against today; `from`/`to`
// are honored only as a custom span; neither means "all time" (both undefined
// so the API uses its native all-time path).
export function resolveDateRange(params: DateRangeSearchParams): {
	from?: string;
	to?: string;
} {
	const preset = findRelativeRangePreset(params.range);
	if (preset) {
		const { from, to } = preset.getRange(new Date());
		return {
			from: format(from, "yyyy-MM-dd"),
			to: format(to, "yyyy-MM-dd"),
		};
	}
	if (params.from && params.to) {
		return { from: params.from, to: params.to };
	}
	return {};
}

export function resolveDateRangeFromSearchParams(
	params: Record<string, string | string[] | undefined>,
): { from?: string; to?: string } {
	return resolveDateRange({
		range: typeof params.range === "string" ? params.range : undefined,
		from: typeof params.from === "string" ? params.from : undefined,
		to: typeof params.to === "string" ? params.to : undefined,
	});
}
