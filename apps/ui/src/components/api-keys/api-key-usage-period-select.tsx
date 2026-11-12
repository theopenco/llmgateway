"use client";

import { format } from "date-fns";
import { CalendarIcon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { useState } from "react";

import { DayRangePicker } from "@/components/date-range-picker";
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

import {
	API_KEY_USAGE_PERIODS,
	apiKeyUsageSelectionLabel,
	type ApiKeyUsageSelection,
} from "./api-key-usage-period";

const itemClass =
	"relative flex w-full cursor-pointer items-center gap-2 rounded-sm py-1.5 pl-2 pr-8 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent";

/** Preset usage periods plus a custom day range, like the dashboard picker. */
export function ApiKeyUsagePeriodSelect({
	value,
	onChange,
}: {
	value: ApiKeyUsageSelection;
	onChange: (value: ApiKeyUsageSelection) => void;
}) {
	const { timeZone } = useDisplayTimeZone();
	const [open, setOpen] = useState(false);
	const [showCalendar, setShowCalendar] = useState(false);

	const todayKey = formatDayKey(new Date(), timeZone);
	const fromKey =
		value.period === "custom" ? value.from : shiftDayKey(todayKey, -6);
	const toKey = value.period === "custom" ? value.to : todayKey;

	const select = (next: ApiKeyUsageSelection) => {
		onChange(next);
		setOpen(false);
		setShowCalendar(false);
	};

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
				<button
					type="button"
					aria-label="Usage period"
					className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 shadow-xs flex h-8 w-full cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-md border bg-transparent px-3 py-2 text-sm outline-none transition-[color,box-shadow] focus-visible:ring-[3px] md:w-auto md:min-w-40"
				>
					<span className="truncate">{apiKeyUsageSelectionLabel(value)}</span>
					<ChevronDownIcon className="text-muted-foreground size-4 shrink-0 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className={cn(
					showCalendar
						? "max-h-[var(--radix-popover-content-available-height)] w-[calc(100vw-2rem)] overflow-y-auto p-3 sm:w-auto"
						: "w-48 p-1",
				)}
			>
				{showCalendar ? (
					<DayRangePicker
						from={new Date(`${fromKey}T00:00:00`)}
						to={new Date(`${toKey}T00:00:00`)}
						onSelect={(from, to) =>
							select({
								period: "custom",
								from: format(from, "yyyy-MM-dd"),
								to: format(to, "yyyy-MM-dd"),
							})
						}
						onCancel={() => setShowCalendar(false)}
					/>
				) : (
					<div role="listbox" aria-label="Usage period">
						{API_KEY_USAGE_PERIODS.map((period) => {
							const active = value.period === period.value;
							return (
								<button
									key={period.value}
									type="button"
									role="option"
									aria-selected={active}
									onClick={() => select({ period: period.value })}
									className={itemClass}
								>
									{period.label}
									{active && <CheckIcon className="absolute right-2 size-4" />}
								</button>
							);
						})}
						<div className="bg-border -mx-1 my-1 h-px" />
						<button
							type="button"
							role="option"
							aria-selected={value.period === "custom"}
							onClick={() => setShowCalendar(true)}
							className={itemClass}
						>
							<CalendarIcon className="text-muted-foreground size-4" />
							Custom range
							{value.period === "custom" && (
								<CheckIcon className="absolute right-2 size-4" />
							)}
						</button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
