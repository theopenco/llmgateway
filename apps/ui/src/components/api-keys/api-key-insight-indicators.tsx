"use client";

import { AlertTriangleIcon, ClockAlertIcon } from "lucide-react";

import { Button } from "@/lib/components/button";
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
} from "./api-key-insights";

import type { ApiKeyUnusedInsight } from "./api-key-insights";

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
