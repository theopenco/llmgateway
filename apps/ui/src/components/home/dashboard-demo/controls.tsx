"use client";

import { format, parseISO, subDays } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import {
	buildDatePresets,
	findMatchingPreset,
} from "@/components/date-presets";
import { DayRangePicker } from "@/components/date-range-picker";
import { TrackedLink } from "@/components/home/tracked-link";
import { Input } from "@/lib/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { USAGE_MODE_OPTIONS, type UsageMode } from "@/lib/usage-mode";
import { cn } from "@/lib/utils";

import type { UsageDateRange } from "@/components/dashboard/usage-comparison";

function buildPresets(anchorDay: string) {
	const today = parseISO(anchorDay);
	return buildDatePresets(today, () => ({
		from: subDays(today, 6),
		to: today,
	}));
}

export function defaultDateRange(anchorDay: string): UsageDateRange {
	const today = parseISO(anchorDay);
	return { from: subDays(today, 6), to: today };
}

export function DateRangeControl({
	anchorDay,
	range,
	onChange,
}: {
	anchorDay: string;
	range: UsageDateRange;
	onChange: (range: UsageDateRange, label: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [showCalendar, setShowCalendar] = useState(false);
	const presets = buildPresets(anchorDay);
	const activePreset = findMatchingPreset(range.from, range.to, presets);
	const preset = presets.find((item) => item.value === activePreset);
	const triggerLabel =
		preset && preset.value !== "custom"
			? preset.label
			: `${format(range.from, "MMM d, yyyy")} – ${format(range.to, "MMM d, yyyy")}`;
	const filteredPresets = search.trim()
		? presets.filter((item) =>
				item.label.toLowerCase().includes(search.toLowerCase()),
			)
		: presets;

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
							{filteredPresets.map((item) => (
								<button
									key={item.value}
									type="button"
									onClick={() => {
										if (item.value === "custom") {
											setShowCalendar(true);
											return;
										}
										onChange(item.getRange(), item.label);
										setOpen(false);
									}}
									className={cn(
										"w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
										activePreset === item.value && "bg-accent/50",
									)}
								>
									{item.label}
								</button>
							))}
						</div>
					</div>
				) : (
					<DayRangePicker
						from={range.from}
						to={range.to}
						onCancel={() => setShowCalendar(false)}
						onSelect={(from, to) => {
							onChange({ from, to }, "Custom");
							setOpen(false);
							setShowCalendar(false);
						}}
					/>
				)}
			</PopoverContent>
		</Popover>
	);
}

export function UsageModeControl({
	mode,
	onChange,
	className,
}: {
	mode: UsageMode;
	onChange: (mode: UsageMode) => void;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"inline-flex items-center rounded-lg border border-border/60 bg-muted/40 p-0.5",
				className,
			)}
		>
			{USAGE_MODE_OPTIONS.map((option) => (
				<button
					key={option.value}
					type="button"
					onClick={() => onChange(option.value)}
					title={
						option.value === "api-keys"
							? "Usage served by your own provider keys (not billed to credits)"
							: option.value === "credits"
								? "Usage billed against your credit balance"
								: "All traffic"
					}
					className={cn(
						"rounded-md px-3 py-1 text-xs font-medium transition-colors",
						mode === option.value
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

export type TimeRangeValue = "1h" | "4h" | "24h" | "7d" | "30d";

const TIME_RANGES: TimeRangeValue[] = ["1h", "4h", "24h", "7d", "30d"];

export function TimeRangeControl({
	value,
	onChange,
}: {
	value: TimeRangeValue;
	onChange: (value: TimeRangeValue) => void;
}) {
	return (
		<div className="flex w-full items-center rounded-md border bg-muted p-0.5 sm:inline-flex sm:w-auto">
			{TIME_RANGES.map((range) => (
				<button
					key={range}
					type="button"
					onClick={() => onChange(range)}
					className={cn(
						"flex-1 rounded-sm px-3 py-1 text-sm font-medium transition-colors sm:flex-none",
						value === range
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{range}
				</button>
			))}
		</div>
	);
}

export function EnterpriseBanner({
	view,
	message = "Enterprise feature, shown with sample data.",
}: {
	view: string;
	message?: string;
}) {
	const slug = view.replace(/^org\//, "").replace(/[^a-z0-9]+/g, "_");
	return (
		<div className="flex shrink-0 items-center gap-3 border-b border-blue-500/25 bg-blue-500/[0.07] px-4 py-2.5 text-sm text-blue-900 dark:text-blue-100">
			<span
				aria-hidden
				className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
			/>
			<p className="min-w-0 flex-1 font-medium">{message}</p>
			<TrackedLink
				href="/enterprise#contact"
				location="home_demo"
				cta={`book_demo_${slug}`}
				className="shrink-0 font-medium underline underline-offset-4"
			>
				Book a demo
			</TrackedLink>
		</div>
	);
}
