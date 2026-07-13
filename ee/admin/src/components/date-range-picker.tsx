"use client";

import { endOfMonth, format, startOfMonth } from "date-fns";
import { ChevronDownIcon, ChevronLeftIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import {
	RELATIVE_RANGE_PRESETS,
	findRelativeRangePreset,
	resolveDateRange,
} from "@/lib/date-range";
import { cn } from "@/lib/utils";

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

export function getDateRangeFromParams(searchParams: URLSearchParams) {
	const resolved = resolveDateRange({
		range: searchParams.get("range") ?? undefined,
		from: searchParams.get("from") ?? undefined,
		to: searchParams.get("to") ?? undefined,
	});

	if (resolved.from && resolved.to) {
		return {
			from: new Date(resolved.from + "T00:00:00"),
			to: new Date(resolved.to + "T00:00:00"),
			isAllTime: false,
		};
	}

	// Default: no range/from/to in URL means "all time". Return concrete dates
	// for calendar/display purposes only; callers that build API requests
	// should rely on isAllTime (and omit from/to params) to let the backend
	// use its native all-time aggregate path.
	const today = new Date();
	return {
		from: new Date(2020, 0, 1),
		to: today,
		isAllTime: true,
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
			<div className="min-w-0 flex-1">
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

export function DateRangePicker() {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [showCalendar, setShowCalendar] = useState(false);

	const { from, to, isAllTime } = getDateRangeFromParams(searchParams);
	const today = useMemo(() => new Date(), []);

	const presets = useMemo(
		() => [
			{ label: "Custom", value: "custom" },
			...RELATIVE_RANGE_PRESETS.map((p) => ({
				label: p.getLabel(today),
				value: p.value,
			})),
			{ label: "All time", value: "all_time" },
		],
		[today],
	);

	const activePreset = useMemo(() => {
		const rangeParam = searchParams.get("range") ?? undefined;
		if (findRelativeRangePreset(rangeParam)) {
			return rangeParam as string;
		}
		return isAllTime ? "all_time" : "custom";
	}, [searchParams, isAllTime]);

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
		params.delete("range");
		params.set("from", format(newFrom, "yyyy-MM-dd"));
		params.set("to", format(newTo, "yyyy-MM-dd"));
		router.push(`${pathname}?${params.toString()}`);
	};

	const clearDateRange = () => {
		const params = new URLSearchParams(searchParams.toString());
		params.delete("range");
		params.delete("from");
		params.delete("to");
		const qs = params.toString();
		router.push(qs ? `${pathname}?${qs}` : pathname);
	};

	const handlePresetSelect = (value: string) => {
		if (value === "custom") {
			setShowCalendar(true);
			return;
		}
		// "All time" leaves the URL without range/from/to so the API uses its
		// native all-time aggregate path instead of a concrete 2020→today range.
		if (value === "all_time") {
			clearDateRange();
			setOpen(false);
			return;
		}
		// Relative presets only store the preset value; the concrete dates are
		// resolved against "today" on every request.
		const params = new URLSearchParams(searchParams.toString());
		params.delete("from");
		params.delete("to");
		params.set("range", value);
		router.push(`${pathname}?${params.toString()}`);
		setOpen(false);
	};

	const handleCustomSelect = (newFrom: Date, newTo: Date) => {
		updateDateRange(newFrom, newTo);
		setOpen(false);
		setShowCalendar(false);
	};

	const triggerLabel = useMemo(() => {
		if (activePreset !== "custom") {
			const preset = presets.find((p) => p.value === activePreset);
			if (preset) {
				return preset.label;
			}
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
				align="end"
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
									onClick={() => handlePresetSelect(preset.value)}
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
