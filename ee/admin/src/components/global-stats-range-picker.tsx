"use client";

import { format, subMonths } from "date-fns";
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
import {
	buildPresets,
	resolveGlobalStatsRange,
	DEFAULT_GLOBAL_STATS_PRESET,
	ALL_TIME_PRESET,
} from "@/lib/global-stats-range";
import { cn } from "@/lib/utils";

import { formatDayKey } from "@llmgateway/shared";

import type { DatePreset } from "@/lib/global-stats-range";
import type { DateRange } from "react-day-picker";

export function GlobalStatsRangePicker() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);
	const [showCalendar, setShowCalendar] = useState(false);
	const [calendarRange, setCalendarRange] = useState<DateRange | undefined>();

	const today = useMemo(
		() => new Date(`${formatDayKey(new Date(), "UTC")}T12:00:00`),
		[],
	);
	const presets = useMemo(() => buildPresets(today), [today]);

	const { allTime, range, from, to } = resolveGlobalStatsRange(searchParams);
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
		if (range === "24h") {
			return "24h";
		}
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
	}, [allTime, range, presets, from, to]);

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

	const handleRelativeSelect = (range: "all" | "24h") => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("from");
		params.delete("to");
		params.set("range", range);
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
		if (range === "24h") {
			return "Last 24 hours";
		}
		if (allTime) {
			return "All time";
		}
		const preset = presets.find((p) => p.value === activePreset);
		if (preset) {
			return preset.label;
		}
		return `${format(fromDate, "MMM d, yyyy")} – ${format(toDate, "MMM d, yyyy")}`;
	}, [allTime, range, activePreset, presets, fromDate, toDate]);

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
						<button
							type="button"
							onClick={() => handleRelativeSelect("24h")}
							className={cn(
								"w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
								range === "24h" && "bg-accent/50",
							)}
						>
							Last 24 hours
						</button>
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
							onClick={() => handleRelativeSelect("all")}
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
						<p className="mb-2 text-xs text-muted-foreground">
							Calendar dates use UTC.
						</p>
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
