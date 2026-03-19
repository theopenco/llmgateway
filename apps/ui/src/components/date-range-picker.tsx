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
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Input } from "@/lib/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { cn } from "@/lib/utils";

interface DatePreset {
	label: string;
	value: string;
	getRange: () => { from: Date; to: Date };
}

interface DateRangePickerProps {
	buildUrl: (path?: string) => string;
	path?: string;
}

const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

function getQuarterLabel(date: Date): string {
	return `Q${getQuarter(date)} ${format(date, "yyyy")}`;
}

function buildPresets(): DatePreset[] {
	const today = new Date();
	return [
		{
			label: "Custom",
			value: "custom",
			getRange: () => ({ from: subDays(today, 6), to: today }),
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

function getDateRangeFromParams(searchParams: URLSearchParams) {
	const fromParam = searchParams.get("from");
	const toParam = searchParams.get("to");

	if (fromParam && toParam) {
		return {
			from: new Date(fromParam + "T00:00:00"),
			to: new Date(toParam + "T00:00:00"),
		};
	}

	const today = new Date();
	return {
		from: subDays(today, 6),
		to: today,
	};
}

function compareMonth(a: Date, b: Date): number {
	// eslint-disable-next-line no-mixed-operators
	const aMonths = a.getFullYear() * 12 + a.getMonth();
	// eslint-disable-next-line no-mixed-operators
	const bMonths = b.getFullYear() * 12 + b.getMonth();
	return aMonths - bMonths;
}

interface MonthRangePickerProps {
	from: Date;
	to: Date;
	onSelect: (from: Date, to: Date) => void;
}

function MonthRangePicker({ from, to, onSelect }: MonthRangePickerProps) {
	const today = new Date();
	const [leftYear, setLeftYear] = useState(() => today.getFullYear() - 1);
	const [pendingFrom, setPendingFrom] = useState<Date | null>(null);
	const [hoverMonth, setHoverMonth] = useState<Date | null>(null);
	const rightYear = leftYear + 1;

	const handleMonthClick = (year: number, monthIdx: number) => {
		if (
			year > today.getFullYear() ||
			(year === today.getFullYear() && monthIdx > today.getMonth())
		) {
			return;
		}
		const clicked = new Date(year, monthIdx, 1);
		if (!pendingFrom) {
			setPendingFrom(clicked);
		} else {
			const [start, end] =
				clicked < pendingFrom ? [clicked, pendingFrom] : [pendingFrom, clicked];
			onSelect(startOfMonth(start), endOfMonth(end));
			setPendingFrom(null);
			setHoverMonth(null);
		}
	};

	const getEffectiveRange = (): { lo: Date; hi: Date } => {
		if (pendingFrom && hoverMonth) {
			return pendingFrom <= hoverMonth
				? { lo: pendingFrom, hi: hoverMonth }
				: { lo: hoverMonth, hi: pendingFrom };
		}
		return { lo: from, hi: to };
	};

	const isFutureMonth = (year: number, monthIdx: number) =>
		year > today.getFullYear() ||
		(year === today.getFullYear() && monthIdx > today.getMonth());

	const renderYearPanel = (year: number) => {
		const { lo, hi } = getEffectiveRange();
		return (
			<div className="flex-1 min-w-0">
				<div className="mb-2 text-center text-sm font-medium">{year}</div>
				<div className="grid grid-cols-3 gap-1">
					{MONTH_NAMES.map((name, idx) => {
						const d = new Date(year, idx, 1);
						const disabled = isFutureMonth(year, idx);
						const inRange =
							!disabled && compareMonth(d, lo) >= 0 && compareMonth(d, hi) <= 0;
						const isStart =
							!disabled && year === lo.getFullYear() && idx === lo.getMonth();
						const isEnd =
							!disabled && year === hi.getFullYear() && idx === hi.getMonth();
						return (
							<button
								key={name}
								type="button"
								disabled={disabled}
								onClick={() => handleMonthClick(year, idx)}
								onMouseEnter={() => {
									if (pendingFrom) {
										setHoverMonth(new Date(year, idx, 1));
									}
								}}
								onMouseLeave={() => {
									if (pendingFrom) {
										setHoverMonth(null);
									}
								}}
								className={cn(
									"rounded px-2 py-1.5 text-sm transition-colors",
									disabled
										? "cursor-not-allowed opacity-30"
										: "cursor-pointer hover:bg-accent",
									inRange && "bg-accent/40",
									(isStart || isEnd) &&
										"bg-primary text-primary-foreground hover:bg-primary/90",
								)}
							>
								{name}
							</button>
						);
					})}
				</div>
			</div>
		);
	};

	return (
		<div>
			<div className="flex items-start gap-3">
				<button
					type="button"
					onClick={() => setLeftYear((y) => y - 1)}
					className="mt-1 rounded p-1 hover:bg-accent"
				>
					<ChevronLeftIcon className="h-4 w-4" />
				</button>
				<div className="flex flex-1 gap-6">
					{renderYearPanel(leftYear)}
					{renderYearPanel(rightYear)}
				</div>
			</div>
			{pendingFrom && (
				<p className="mt-2 text-center text-xs text-muted-foreground">
					Select end month
				</p>
			)}
		</div>
	);
}

export function DateRangePicker({ buildUrl, path }: DateRangePickerProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [showCalendar, setShowCalendar] = useState(false);

	const { from, to } = getDateRangeFromParams(searchParams);
	const presets = useMemo(() => buildPresets(), []);
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
				className={cn("p-0", showCalendar ? "w-[500px]" : "w-72")}
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
					<div className="p-4">
						<div className="mb-4 flex items-center gap-4">
							<div>
								<p className="text-xs text-muted-foreground">From</p>
								<p className="text-sm font-medium">
									{format(from, "MMM d, yyyy")}
								</p>
							</div>
							<span className="text-muted-foreground">–</span>
							<div>
								<p className="text-xs text-muted-foreground">To</p>
								<p className="text-sm font-medium">
									{format(to, "MMM d, yyyy")}
								</p>
							</div>
						</div>
						<MonthRangePicker
							from={from}
							to={to}
							onSelect={handleCustomSelect}
						/>
						<button
							type="button"
							onClick={() => setShowCalendar(false)}
							className="mt-3 text-xs text-muted-foreground hover:text-foreground"
						>
							← Back to presets
						</button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}

export { getDateRangeFromParams };
