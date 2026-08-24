"use client";

import {
	endOfMonth,
	endOfYear,
	format,
	startOfMonth,
	startOfYear,
	subDays,
	subMonths,
	subYears,
} from "date-fns";
import { CalendarIcon, ChevronDownIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { DateRange } from "react-day-picker";

interface DatePreset {
	label: string;
	value: string;
	getRange: () => { from: Date; to: Date };
}

export const DEFAULT_GLOBAL_STATS_PRESET = "last_7_days";

// All time has no client-side date range: the API derives the span from the
// first/last recorded day, so it travels as `range=all` instead of from/to.
export const ALL_TIME_PRESET = "all_time";

function buildPresets(today: Date): DatePreset[] {
	return [
		{
			label: "Last 7 days",
			value: "last_7_days",
			getRange: () => ({ from: subDays(today, 6), to: today }),
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
			label: "This month",
			value: "this_month",
			getRange: () => ({ from: startOfMonth(today), to: today }),
		},
		{
			label: "Last month",
			value: "last_month",
			getRange: () => {
				const lm = subMonths(today, 1);
				return { from: startOfMonth(lm), to: endOfMonth(lm) };
			},
		},
		{
			label: "Last 3 months",
			value: "last_3_months",
			getRange: () => ({ from: subMonths(today, 3), to: today }),
		},
		{
			label: "Last 12 months",
			value: "last_12_months",
			getRange: () => ({ from: subMonths(today, 12), to: today }),
		},
		{
			label: "This year",
			value: "this_year",
			getRange: () => ({ from: startOfYear(today), to: today }),
		},
		{
			label: "Last year",
			value: "last_year",
			getRange: () => {
				const ly = subYears(today, 1);
				return { from: startOfYear(ly), to: endOfYear(ly) };
			},
		},
	];
}

export type ResolvedGlobalStatsRange =
	| { allTime: true; from: undefined; to: undefined }
	| { allTime: false; from: string; to: string };

export function resolveGlobalStatsRange(
	searchParams: URLSearchParams,
): ResolvedGlobalStatsRange {
	if (searchParams.get("range") === "all") {
		return { allTime: true, from: undefined, to: undefined };
	}
	const fromParam = searchParams.get("from");
	const toParam = searchParams.get("to");
	if (fromParam && toParam) {
		return { allTime: false, from: fromParam, to: toParam };
	}
	const today = new Date();
	const presets = buildPresets(today);
	const preset =
		presets.find((p) => p.value === DEFAULT_GLOBAL_STATS_PRESET) ?? presets[0];
	const range = preset.getRange();
	return {
		allTime: false,
		from: format(range.from, "yyyy-MM-dd"),
		to: format(range.to, "yyyy-MM-dd"),
	};
}

export function GlobalStatsRangePicker() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);
	const [showCalendar, setShowCalendar] = useState(false);
	const [calendarRange, setCalendarRange] = useState<DateRange | undefined>();

	const today = useMemo(() => new Date(), []);
	const presets = useMemo(() => buildPresets(today), [today]);

	const { allTime, from, to } = resolveGlobalStatsRange(searchParams);
	// All time has no explicit bounds, so the calendar still opens on the
	// default preset's window rather than an empty selection.
	const fallbackRange = useMemo(
		() =>
			(
				presets.find((p) => p.value === DEFAULT_GLOBAL_STATS_PRESET) ??
				presets[0]
			).getRange(),
		[presets],
	);
	const fromDate = useMemo(
		() => (from ? new Date(`${from}T00:00:00`) : fallbackRange.from),
		[from, fallbackRange],
	);
	const toDate = useMemo(
		() => (to ? new Date(`${to}T00:00:00`) : fallbackRange.to),
		[to, fallbackRange],
	);

	const activePreset = useMemo(() => {
		if (allTime) {
			return ALL_TIME_PRESET;
		}
		for (const preset of presets) {
			const r = preset.getRange();
			if (
				format(r.from, "yyyy-MM-dd") === from &&
				format(r.to, "yyyy-MM-dd") === to
			) {
				return preset.value;
			}
		}
		return "custom";
	}, [allTime, presets, from, to]);

	const updateRange = (newFrom: Date, newTo: Date) => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("range");
		params.set("from", format(newFrom, "yyyy-MM-dd"));
		params.set("to", format(newTo, "yyyy-MM-dd"));
		router.replace(`${pathname}?${params.toString()}`, { scroll: false });
	};

	const handlePresetSelect = (preset: DatePreset) => {
		const r = preset.getRange();
		updateRange(r.from, r.to);
		setOpen(false);
	};

	const handleAllTimeSelect = () => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("from");
		params.delete("to");
		params.set("range", "all");
		router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		setOpen(false);
	};

	const openCalendar = () => {
		setCalendarRange({ from: fromDate, to: toDate });
		setShowCalendar(true);
	};

	const applyCalendar = () => {
		if (calendarRange?.from && calendarRange?.to) {
			updateRange(calendarRange.from, calendarRange.to);
			setOpen(false);
			setShowCalendar(false);
		}
	};

	const triggerLabel = useMemo(() => {
		if (allTime) {
			return "All time";
		}
		const preset = presets.find((p) => p.value === activePreset);
		if (preset) {
			return preset.label;
		}
		return `${format(fromDate, "MMM d, yyyy")} – ${format(toDate, "MMM d, yyyy")}`;
	}, [allTime, activePreset, presets, fromDate, toDate]);

	return (
		<Popover
			open={open}
			onOpenChange={(isOpen) => {
				setOpen(isOpen);
				if (!isOpen) {
					setShowCalendar(false);
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button variant="outline" size="sm" className="gap-2">
					<CalendarIcon className="h-4 w-4" />
					{triggerLabel}
					<ChevronDownIcon className="h-4 w-4 opacity-50" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				className={cn("p-0", showCalendar ? "w-auto" : "w-56")}
				align="end"
			>
				{!showCalendar ? (
					<div className="py-1">
						{presets.map((preset) => (
							<button
								key={preset.value}
								type="button"
								onClick={() => handlePresetSelect(preset)}
								className={cn(
									"w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
									activePreset === preset.value && "bg-accent/50",
								)}
							>
								{preset.label}
							</button>
						))}
						<button
							type="button"
							onClick={handleAllTimeSelect}
							className={cn(
								"w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
								activePreset === ALL_TIME_PRESET && "bg-accent/50",
							)}
						>
							All time
						</button>
						<div className="my-1 border-t border-border/60" />
						<button
							type="button"
							onClick={openCalendar}
							className={cn(
								"w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
								activePreset === "custom" && "bg-accent/50",
							)}
						>
							Custom range…
						</button>
					</div>
				) : (
					<div className="p-3">
						<Calendar
							mode="range"
							numberOfMonths={2}
							defaultMonth={subMonths(toDate, 1)}
							selected={calendarRange}
							onSelect={setCalendarRange}
							disabled={{ after: today }}
						/>
						<div className="flex items-center justify-between gap-2 border-t border-border/60 px-1 pt-3">
							<button
								type="button"
								onClick={() => setShowCalendar(false)}
								className="text-xs text-muted-foreground hover:text-foreground"
							>
								← Back to presets
							</button>
							<div className="flex items-center gap-3">
								<span className="text-xs text-muted-foreground tabular-nums">
									{calendarRange?.from
										? format(calendarRange.from, "MMM d, yyyy")
										: "Start"}{" "}
									–{" "}
									{calendarRange?.to
										? format(calendarRange.to, "MMM d, yyyy")
										: "End"}
								</span>
								<Button
									size="sm"
									className="h-7"
									disabled={!calendarRange?.from || !calendarRange?.to}
									onClick={applyCalendar}
								>
									Apply
								</Button>
							</div>
						</div>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
