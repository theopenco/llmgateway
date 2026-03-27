"use client";

import { cn } from "@/lib/utils";

const TIME_RANGES = [
	{ value: "1h", label: "1h" },
	{ value: "4h", label: "4h" },
	{ value: "24h", label: "24h" },
	{ value: "7d", label: "7d" },
	{ value: "30d", label: "30d" },
] as const;

export type TimeRangeValue = (typeof TIME_RANGES)[number]["value"];

interface TimeRangePickerProps {
	value: TimeRangeValue;
	onChange: (value: TimeRangeValue) => void;
}

export function TimeRangePicker({ value, onChange }: TimeRangePickerProps) {
	return (
		<div className="inline-flex items-center rounded-md border bg-muted p-0.5">
			{TIME_RANGES.map((range) => (
				<button
					key={range.value}
					type="button"
					onClick={() => onChange(range.value)}
					className={cn(
						"px-3 py-1 text-sm font-medium rounded-sm transition-colors",
						value === range.value
							? "bg-background text-foreground shadow-sm"
							: "text-muted-foreground hover:text-foreground",
					)}
				>
					{range.label}
				</button>
			))}
		</div>
	);
}
