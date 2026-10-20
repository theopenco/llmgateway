"use client";

import {
	AlertTriangleIcon,
	ClockAlertIcon,
	ShieldCheckIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/lib/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/lib/components/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { cn } from "@/lib/utils";

import {
	UNUSED_CRITICAL_DAYS,
	UNUSED_WARNING_DAYS,
	describeApiKeyUnusedInsight,
	formatApiKeyLimitSuggestion,
} from "./api-key-insights";

import type {
	ApiKeyUnusedInsight,
	ApiKeyLimitSuggestion,
} from "./api-key-insights";

const levelTone = {
	warning:
		"border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
	critical: "border-destructive/40 bg-destructive/10 text-destructive",
} as const;

export function ApiKeyUnusedBadge({
	insight,
}: {
	insight: ApiKeyUnusedInsight | null;
}) {
	if (!insight) {
		return null;
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span
					className={cn(
						"inline-flex cursor-help items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs font-medium",
						levelTone[insight.level],
					)}
				>
					<ClockAlertIcon className="h-3 w-3" />
					{insight.neverUsed ? "Never used" : `Unused ${insight.daysUnused}d`}
				</span>
			</TooltipTrigger>
			<TooltipContent>
				<p className="max-w-xs text-xs">
					{describeApiKeyUnusedInsight(insight)}
				</p>
			</TooltipContent>
		</Tooltip>
	);
}

/** Banner summarizing active keys that look abandoned. */
export function ApiKeyInsightsSummary({
	warningCount,
	criticalCount,
	showingUnused,
	onShowUnused,
	onSelectUnused,
}: {
	warningCount: number;
	criticalCount: number;
	showingUnused: boolean;
	onShowUnused: () => void;
	onSelectUnused: () => void;
}) {
	const total = warningCount + criticalCount;
	if (!total) {
		return null;
	}

	const critical = criticalCount > 0;

	return (
		<div
			className={cn(
				"flex flex-col gap-2 rounded-md border px-3 py-2 text-sm md:flex-row md:items-center",
				levelTone[critical ? "critical" : "warning"],
			)}
		>
			<AlertTriangleIcon className="hidden h-4 w-4 shrink-0 md:block" />
			<p className="flex-1">
				<strong>
					{total} active key{total === 1 ? "" : "s"}
				</strong>{" "}
				{total === 1 ? "has" : "have"} not been used in {UNUSED_WARNING_DAYS}+
				days
				{critical
					? `, ${criticalCount} of them for ${UNUSED_CRITICAL_DAYS}+ days`
					: ""}
				. Unused keys are a leak risk; deactivate the ones you no longer need.
			</p>
			<div className="flex gap-2">
				{!showingUnused && (
					<Button
						variant="outline"
						size="sm"
						className="h-7 bg-background"
						onClick={onShowUnused}
					>
						Show unused
					</Button>
				)}
				<Button
					variant="outline"
					size="sm"
					className="h-7 bg-background"
					onClick={onSelectUnused}
				>
					Select unused
				</Button>
			</div>
		</div>
	);
}

/** Muted nudge to cap a low-spend key that has no limit. */
export function ApiKeyLimitSuggestionHint({
	suggestion,
	onApply,
}: {
	suggestion: ApiKeyLimitSuggestion | null;
	onApply: (suggestion: ApiKeyLimitSuggestion) => Promise<boolean>;
}) {
	const [open, setOpen] = useState(false);
	const [isApplying, setIsApplying] = useState(false);

	if (!suggestion) {
		return null;
	}

	const label = formatApiKeyLimitSuggestion(suggestion);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<button
					type="button"
					className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer items-center gap-1 rounded-md border border-dashed px-1.5 py-0.5 text-xs transition-colors"
				>
					<ShieldCheckIcon className="h-3 w-3" />
					Suggest {label}
				</button>
			</PopoverTrigger>
			<PopoverContent align="start" className="w-72 space-y-3 text-sm">
				<p>
					This key spends little and has no limit. A cap of{" "}
					<strong>{label}</strong> keeps a leaked key from running up costs
					without getting in the way of its current usage.
				</p>
				<p className="text-muted-foreground text-xs">
					Change or remove it anytime from the key's limits.
				</p>
				<div className="flex justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						disabled={isApplying}
						onClick={() => setOpen(false)}
					>
						Not now
					</Button>
					<Button
						size="sm"
						disabled={isApplying}
						onClick={async () => {
							setIsApplying(true);
							try {
								if (await onApply(suggestion)) {
									setOpen(false);
								}
							} finally {
								setIsApplying(false);
							}
						}}
					>
						{isApplying ? "Setting..." : `Set ${label}`}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}
