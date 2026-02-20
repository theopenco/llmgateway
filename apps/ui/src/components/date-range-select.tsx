import { subDays, subHours, subMinutes } from "date-fns";
import { ChevronDownIcon } from "lucide-react";
import * as React from "react";
import { useState } from "react";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/lib/components/dropdown-menu";

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
	const [selected, setSelected] = useState(value);

	const selectedOption = RELATIVE_TIME_OPTIONS.find(
		(option) => option.value === selected,
	);

	const handleSelect = (option: RelativeTimeOption) => {
		setSelected(option.value);
		onChange(option.value, option.getRange());
	};

	return (
		<DropdownMenu>
			<DropdownMenuTrigger className="border-input hover:bg-accent hover:text-accent-foreground focus:ring-ring/50 shadow-xs flex h-9 items-center justify-between gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-sm outline-none transition-colors focus:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50">
				{selectedOption?.label ?? "Select time range"}
				<ChevronDownIcon className="h-4 w-4 opacity-50" />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start">
				{RELATIVE_TIME_OPTIONS.map((option) => (
					<DropdownMenuItem
						key={option.value}
						onClick={() => handleSelect(option)}
					>
						{option.label}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
