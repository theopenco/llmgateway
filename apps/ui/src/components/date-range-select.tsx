import { startOfDay, subDays, subHours, subMinutes } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import * as React from "react";
import { useMemo, useState } from "react";

import { Input } from "@/lib/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { cn } from "@/lib/utils";

export interface DateRange {
	start: Date;
	end: Date;
}

interface RelativeTimeOption {
	label: string;
	value: string;
	getRange: () => DateRange;
}

const RELATIVE_TIME_OPTIONS: RelativeTimeOption[] = [
	{
		label: "Today",
		value: "today",
		getRange: () => ({
			start: startOfDay(new Date()),
			end: new Date(),
		}),
	},
	{
		label: "Last 1 minute",
		value: "1m",
		getRange: () => ({
			start: subMinutes(new Date(), 1),
			end: new Date(),
		}),
	},
	{
		label: "Last 5 minutes",
		value: "5m",
		getRange: () => ({
			start: subMinutes(new Date(), 5),
			end: new Date(),
		}),
	},
	{
		label: "Last 30 minutes",
		value: "30m",
		getRange: () => ({
			start: subMinutes(new Date(), 30),
			end: new Date(),
		}),
	},
	{
		label: "Last 1 hour",
		value: "1h",
		getRange: () => ({
			start: subHours(new Date(), 1),
			end: new Date(),
		}),
	},
	{
		label: "Last 2 hours",
		value: "2h",
		getRange: () => ({
			start: subHours(new Date(), 2),
			end: new Date(),
		}),
	},
	{
		label: "Last 4 hours",
		value: "4h",
		getRange: () => ({
			start: subHours(new Date(), 4),
			end: new Date(),
		}),
	},
	{
		label: "Last 12 hours",
		value: "12h",
		getRange: () => ({
			start: subHours(new Date(), 12),
			end: new Date(),
		}),
	},
	{
		label: "Last 24 hours",
		value: "24h",
		getRange: () => ({
			start: subHours(new Date(), 24),
			end: new Date(),
		}),
	},
	{
		label: "Last 3 days",
		value: "3days",
		getRange: () => ({
			start: subDays(new Date(), 3),
			end: new Date(),
		}),
	},
	{
		label: "Last 7 days",
		value: "7days",
		getRange: () => ({
			start: subDays(new Date(), 7),
			end: new Date(),
		}),
	},
	{
		label: "Last 14 days",
		value: "14days",
		getRange: () => ({
			start: subDays(new Date(), 14),
			end: new Date(),
		}),
	},
	{
		label: "Last 30 days",
		value: "30days",
		getRange: () => ({
			start: subDays(new Date(), 30),
			end: new Date(),
		}),
	},
];

interface DateRangeSelectProps {
	value?: string;
	onChange: (value: string, range: DateRange) => void;
}

export function DateRangeSelect({ value, onChange }: DateRangeSelectProps) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState(value);

	const selectedOption = RELATIVE_TIME_OPTIONS.find(
		(option) => option.value === selected,
	);

	const filteredOptions = useMemo(
		() =>
			search.trim()
				? RELATIVE_TIME_OPTIONS.filter((o) =>
						o.label.toLowerCase().includes(search.toLowerCase()),
					)
				: RELATIVE_TIME_OPTIONS,
		[search],
	);

	const handleSelect = (option: RelativeTimeOption) => {
		setSelected(option.value);
		onChange(option.value, option.getRange());
		setOpen(false);
	};

	return (
		<Popover
			open={open}
			onOpenChange={(isOpen) => {
				setOpen(isOpen);
				if (!isOpen) {
					setSearch("");
				}
			}}
		>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="border-input hover:bg-accent hover:text-accent-foreground flex h-9 items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm transition-colors"
				>
					{selectedOption?.label ?? "Select time range"}
					<ChevronDownIcon className="h-4 w-4 opacity-50" />
				</button>
			</PopoverTrigger>
			<PopoverContent className="w-52 p-0" align="start">
				<div className="px-3 pb-2 pt-3">
					<Input
						autoFocus
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="h-8 rounded-none border-0 border-b-2 border-primary bg-transparent px-0 shadow-none focus-visible:ring-0"
					/>
				</div>
				<div className="max-h-72 overflow-y-auto pb-1">
					{filteredOptions.map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => handleSelect(option)}
							className={cn(
								"w-full px-3 py-2 text-left text-sm transition-colors hover:bg-accent",
								selected === option.value && "bg-accent/50",
							)}
						>
							{option.label}
						</button>
					))}
				</div>
			</PopoverContent>
		</Popover>
	);
}
