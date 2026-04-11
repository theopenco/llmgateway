"use client";

import { Lock } from "lucide-react";

import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { useAppConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

const FREE_RANGES = [
	{ value: "1h", label: "1h" },
	{ value: "4h", label: "4h" },
	{ value: "24h", label: "24h" },
	{ value: "7d", label: "7d" },
] as const;

const PRO_RANGES = [{ value: "30d", label: "30d" }] as const;

export type TimeRangeValue =
	| (typeof FREE_RANGES)[number]["value"]
	| (typeof PRO_RANGES)[number]["value"];

interface TimeRangePickerProps {
	value: TimeRangeValue;
	onChange: (value: TimeRangeValue) => void;
}

export function TimeRangePicker({ value, onChange }: TimeRangePickerProps) {
	const config = useAppConfig();
	const isGated = config.hosted;

	return (
		<TooltipProvider>
			<div className="inline-flex items-center rounded-md border bg-muted p-0.5">
				{FREE_RANGES.map((range) => (
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
				{PRO_RANGES.map((range) =>
					isGated ? (
						<Tooltip key={range.value}>
							<TooltipTrigger asChild>
								<button
									type="button"
									disabled
									aria-disabled="true"
									className="px-3 py-1 text-sm font-medium rounded-sm text-muted-foreground/40 cursor-not-allowed inline-flex items-center gap-1"
								>
									{range.label}
									<Lock className="h-3 w-3" />
								</button>
							</TooltipTrigger>
							<TooltipContent
								side="bottom"
								className="max-w-[200px] text-center"
							>
								<p className="text-xs font-medium">Extended analytics</p>
								<p className="text-xs text-muted-foreground">
									Available on Enterprise or self-hosted
								</p>
							</TooltipContent>
						</Tooltip>
					) : (
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
					),
				)}
			</div>
		</TooltipProvider>
	);
}
