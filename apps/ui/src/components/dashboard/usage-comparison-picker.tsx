"use client";

import { Check, ChevronDown, GitCompare } from "lucide-react";
import { useState } from "react";

import { DayRangePicker } from "@/components/date-range-picker";
import { Button } from "@/lib/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import { cn } from "@/lib/utils";

import {
	formatUsageDateRange,
	type UsageComparisonMode,
	type UsageDateRange,
} from "./usage-comparison";

const OPTIONS: {
	value: Exclude<UsageComparisonMode, "custom">;
	label: string;
	description: string;
}[] = [
	{
		value: "off",
		label: "No comparison",
		description: "Show only the selected range",
	},
	{
		value: "previous-period",
		label: "Previous period",
		description: "The same number of days immediately before",
	},
	{
		value: "previous-week",
		label: "Week over week",
		description: "The selected dates shifted back 7 days",
	},
	{
		value: "previous-month",
		label: "Month over month",
		description: "The selected dates shifted back one month",
	},
];

interface UsageComparisonPickerProps {
	mode: UsageComparisonMode;
	currentRange: UsageDateRange;
	comparisonRange: UsageDateRange | null;
	disabled?: boolean;
	onChange: (mode: UsageComparisonMode, customRange?: UsageDateRange) => void;
}

function triggerLabel(
	mode: UsageComparisonMode,
	comparisonRange: UsageDateRange | null,
): string {
	if (mode === "off") {
		return "Compare";
	}
	if (mode === "custom" && comparisonRange) {
		return formatUsageDateRange(comparisonRange);
	}
	return OPTIONS.find((option) => option.value === mode)?.label ?? "Compare";
}

export function UsageComparisonPicker({
	mode,
	currentRange,
	comparisonRange,
	disabled = false,
	onChange,
}: UsageComparisonPickerProps) {
	const [open, setOpen] = useState(false);
	const [showCustom, setShowCustom] = useState(false);
	const customDefault = comparisonRange ?? currentRange;

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (!nextOpen) {
					setShowCustom(false);
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={disabled}
					title={
						disabled
							? "Comparison is unavailable for all-time ranges"
							: undefined
					}
					className={cn(
						"max-w-[220px]",
						mode !== "off" && "border-primary/40 bg-primary/5 text-foreground",
					)}
				>
					<GitCompare className="h-3.5 w-3.5" />
					<span className="truncate">
						{triggerLabel(mode, comparisonRange)}
					</span>
					<ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="end"
				className={cn(
					"p-0",
					showCustom
						? "max-h-[var(--radix-popover-content-available-height)] w-[calc(100vw-2rem)] overflow-y-auto p-3 sm:w-auto"
						: "w-80",
				)}
			>
				{showCustom ? (
					<DayRangePicker
						from={customDefault.from}
						to={customDefault.to}
						applyLabel="Compare"
						onCancel={() => setShowCustom(false)}
						onSelect={(from, to) => {
							onChange("custom", { from, to });
							setOpen(false);
						}}
					/>
				) : (
					<div className="p-1">
						<div className="px-2 pb-2 pt-2">
							<p className="text-sm font-medium">Compare usage</p>
							<p className="text-xs text-muted-foreground">
								Overlay ranges by elapsed day
							</p>
						</div>
						{OPTIONS.map((option) => (
							<button
								key={option.value}
								type="button"
								onClick={() => {
									onChange(option.value);
									setOpen(false);
								}}
								className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
							>
								<span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
									{mode === option.value && <Check className="h-3.5 w-3.5" />}
								</span>
								<span>
									<span className="block text-sm font-medium">
										{option.label}
									</span>
									<span className="block text-xs text-muted-foreground">
										{option.description}
									</span>
								</span>
							</button>
						))}
						<button
							type="button"
							onClick={() => setShowCustom(true)}
							className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent"
						>
							<span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
								{mode === "custom" && <Check className="h-3.5 w-3.5" />}
							</span>
							<span>
								<span className="block text-sm font-medium">Custom range</span>
								<span className="block text-xs text-muted-foreground">
									Choose exact comparison days
								</span>
							</span>
						</button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
