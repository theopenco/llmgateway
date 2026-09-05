"use client";

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
import { ChevronDownIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { GENERATED_RANGE_PARAM } from "@/hooks/useZonedRangeDefaults";
import { Button } from "@/lib/components/button";
import { Calendar } from "@/lib/components/calendar";
import { Input } from "@/lib/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { cn } from "@/lib/utils";

import {
	formatDayKey,
	shiftDayKey,
	useDisplayTimeZone,
} from "@llmgateway/shared";

import type { DateRange } from "react-day-picker";

interface DatePreset {
	label: string;
	value: string;
	getRange: () => { from: Date; to: Date };
}

interface DateRangePickerProps {
	buildUrl: (path?: string) => string;
	path?: string;
}

function getQuarterLabel(date: Date): string {
	return `Q${getQuarter(date)} ${format(date, "yyyy")}`;
}

/** `timeZone` anchors every preset on that zone's calendar day. The calendar
 *  arithmetic below then operates on the right date, and the day keys written
 *  to the URL match what the analytics endpoints bucket by. */
function buildPresets(timeZone: string): DatePreset[] {
	// Local midnight of the display zone's today: a Date whose *calendar* fields
	// are the ones the presets should reason about.
	const today = new Date(`${formatDayKey(new Date(), timeZone)}T00:00:00`);
	return [
		{
			label: "Custom",
			value: "custom",
			getRange: () => ({ from: subDays(today, 6), to: today }),
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
				const lw = subWeeks(today, 1);
				return {
					from: startOfWeek(lw, { weekStartsOn: 1 }),
					to: endOfWeek(lw, { weekStartsOn: 1 }),
				};
			},
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
			label: "Last year",
			value: "last_year",
			getRange: () => {
				const ly = subYears(today, 1);
				return { from: startOfYear(ly), to: endOfYear(ly) };
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
			label: `This quarter (${getQuarterLabel(today)})`,
			value: "this_quarter",
			getRange: () => ({ from: startOfQuarter(today), to: today }),
		},
		{
			label: `Last quarter (${getQuarterLabel(subQuarters(today, 1))})`,
			value: "last_quarter",
			getRange: () => {
				const lq = subQuarters(today, 1);
				return { from: startOfQuarter(lq), to: endOfQuarter(lq) };
			},
		},
		{
			label: `2 quarters ago (${getQuarterLabel(subQuarters(today, 2))})`,
			value: "2_quarters_ago",
			getRange: () => {
				const q = subQuarters(today, 2);
				return { from: startOfQuarter(q), to: endOfQuarter(q) };
			},
		},
		{
			label: `3 quarters ago (${getQuarterLabel(subQuarters(today, 3))})`,
			value: "3_quarters_ago",
			getRange: () => {
				const q = subQuarters(today, 3);
				return { from: startOfQuarter(q), to: endOfQuarter(q) };
			},
		},
		{
			label: "All time",
			value: "all_time",
			getRange: () => ({ from: new Date(2020, 0, 1), to: today }),
		},
	];
}

function findMatchingPreset(
	from: Date,
	to: Date,
	presets: DatePreset[],
): string {
	for (const preset of presets) {
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

/** `timeZone` anchors the *default* window on that zone's calendar day. The
 *  analytics endpoints bucket in the same zone, so a browser-local "today"
 *  near a midnight boundary would ask for a day the API considers the future
 *  and drop the oldest intended one. Explicit from/to params are already
 *  calendar dates and need no zone. */
function getDateRangeFromParams(
	searchParams: URLSearchParams,
	timeZone: string,
) {
	const fromParam = searchParams.get("from");
	const toParam = searchParams.get("to");

	if (fromParam && toParam) {
		return {
			from: new Date(fromParam + "T00:00:00"),
			to: new Date(toParam + "T00:00:00"),
		};
	}

	const todayKey = formatDayKey(new Date(), timeZone);
	return {
		from: new Date(shiftDayKey(todayKey, -6) + "T00:00:00"),
		to: new Date(todayKey + "T00:00:00"),
	};
}

interface DayRangePickerProps {
	from: Date;
	to: Date;
	onSelect: (from: Date, to: Date) => void;
	onCancel?: () => void;
	applyLabel?: string;
}

export function DayRangePicker({
	from,
	to,
	onSelect,
	onCancel,
	applyLabel = "Apply range",
}: DayRangePickerProps) {
	const { timeZone } = useDisplayTimeZone();
	const today = new Date(`${formatDayKey(new Date(), timeZone)}T00:00:00`);
	const [range, setRange] = useState<DateRange | undefined>({ from, to });
	const canApply = Boolean(range?.from && range.to);

	return (
		<div className="space-y-3">
			<div className="grid grid-cols-2 gap-2 px-3 pt-3 sm:px-0 sm:pt-0">
				<div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
					<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						From
					</p>
					<p className="mt-0.5 text-sm font-medium tabular-nums">
						{range?.from ? format(range.from, "MMM d, yyyy") : "Select a day"}
					</p>
				</div>
				<div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
					<p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
						To
					</p>
					<p className="mt-0.5 text-sm font-medium tabular-nums">
						{range?.to ? format(range.to, "MMM d, yyyy") : "Select a day"}
					</p>
				</div>
			</div>
			<Calendar
				mode="range"
				selected={range}
				onSelect={setRange}
				defaultMonth={range?.from}
				disabled={{ after: today }}
				numberOfMonths={2}
				showOutsideDays={false}
				className="p-0 max-sm:[&_.rdp-month~.rdp-month]:hidden"
			/>
			<div className="flex items-center justify-between border-t px-3 pt-3 sm:px-0">
				<p className="text-xs text-muted-foreground">
					Select a start and end day
				</p>
				<div className="flex items-center gap-2">
					{onCancel && (
						<Button type="button" variant="ghost" size="sm" onClick={onCancel}>
							Cancel
						</Button>
					)}
					<Button
						type="button"
						size="sm"
						disabled={!canApply}
						onClick={() => {
							if (range?.from && range.to) {
								onSelect(range.from, range.to);
							}
						}}
					>
						{applyLabel}
					</Button>
				</div>
			</div>
		</div>
	);
}

export function DateRangePicker({ buildUrl, path }: DateRangePickerProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [showCalendar, setShowCalendar] = useState(false);

	const { timeZone: displayTimeZone } = useDisplayTimeZone();
	const { from, to } = getDateRangeFromParams(searchParams, displayTimeZone);
	const presets = useMemo(
		() => buildPresets(displayTimeZone),
		[displayTimeZone],
	);
	const activePreset = useMemo(
		() => findMatchingPreset(from, to, presets),
		[from, to, presets],
	);

	const filteredPresets = useMemo(
		() =>
			search.trim()
				? presets.filter((p) =>
						p.label.toLowerCase().includes(search.toLowerCase()),
					)
				: presets,
		[search, presets],
	);

	const updateDateRange = (newFrom: Date, newTo: Date) => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("days");
		// The user picked this range, so it must survive a timezone toggle.
		params.delete(GENERATED_RANGE_PARAM);
		params.set("from", format(newFrom, "yyyy-MM-dd"));
		params.set("to", format(newTo, "yyyy-MM-dd"));
		const url = `${path ? buildUrl(path) : buildUrl()}?${params.toString()}`;
		router.push(url as Parameters<typeof router.push>[0]);
	};

	const handlePresetSelect = (preset: DatePreset) => {
		if (preset.value === "custom") {
			setShowCalendar(true);
			return;
		}
		const range = preset.getRange();
		updateDateRange(range.from, range.to);
		setOpen(false);
	};

	const handleCustomSelect = (newFrom: Date, newTo: Date) => {
		updateDateRange(newFrom, newTo);
		setOpen(false);
		setShowCalendar(false);
	};

	const triggerLabel = useMemo(() => {
		const preset = presets.find((p) => p.value === activePreset);
		if (preset && preset.value !== "custom") {
			return preset.label;
		}
		return `${format(from, "MMM d, yyyy")} – ${format(to, "MMM d, yyyy")}`;
	}, [activePreset, from, to, presets]);

	return (
		<Popover
			open={open}
			onOpenChange={(isOpen) => {
				setOpen(isOpen);
				if (!isOpen) {
					setSearch("");
					setShowCalendar(false);
				}
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="border-input hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
				>
					{triggerLabel}
					<ChevronDownIcon className="h-4 w-4 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				className={cn(
					"p-0",
					showCalendar
						? "max-h-[var(--radix-popover-content-available-height)] w-[calc(100vw-2rem)] overflow-y-auto p-3 sm:w-auto"
						: "w-72",
				)}
				align="start"
			>
				{!showCalendar ? (
					<div>
						<div className="px-3 pb-2 pt-3">
							<Input
								autoFocus
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								className="h-8 rounded-none border-0 border-b-2 border-primary bg-transparent px-0 shadow-none focus-visible:ring-0"
							/>
						</div>
						<div className="max-h-72 overflow-y-auto pb-1">
							{filteredPresets.map((preset) => (
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
						</div>
					</div>
				) : (
					<div>
						<DayRangePicker
							from={from}
							to={to}
							onSelect={handleCustomSelect}
							onCancel={() => setShowCalendar(false)}
						/>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

export { getDateRangeFromParams };
