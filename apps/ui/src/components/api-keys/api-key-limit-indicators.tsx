"use client";

import { AlertTriangleIcon, OctagonAlertIcon } from "lucide-react";

import { Badge } from "@/lib/components/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/lib/components/tooltip";
import { cn } from "@/lib/utils";

import {
	formatApiKeyPeriodResetLabel,
	formatCurrencyAmount,
	formatPeriodWindowLabel,
} from "./api-key-limit-fields";

import type {
	ApiKeyLimitGauge,
	ApiKeyLimitState,
	ApiKeyLimitStatus,
} from "./api-key-limit-status";
import type { ApiKey } from "@/lib/types";

export const apiKeyLimitTextTone: Record<ApiKeyLimitState, string> = {
	ok: "",
	approaching: "text-amber-600 dark:text-amber-500",
	reached: "text-destructive",
};

const barTone: Record<ApiKeyLimitState, string> = {
	ok: "bg-primary/50",
	approaching: "bg-amber-500",
	reached: "bg-destructive",
};

export function ApiKeyLimitMeter({
	className,
	gauge,
}: {
	className?: string;
	gauge: ApiKeyLimitGauge;
}) {
	const percent = Math.min(100, Math.max(0, gauge.ratio * 100));

	return (
		<div
			className={cn(
				"bg-muted h-1 w-20 overflow-hidden rounded-full",
				className,
			)}
		>
			<div
				className={cn("h-full rounded-full", barTone[gauge.state])}
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
}

function formatRatio(gauge: ApiKeyLimitGauge): string {
	return `${formatCurrencyAmount(gauge.usage)} of ${formatCurrencyAmount(gauge.limit)} used (${Math.min(999, Math.round(gauge.ratio * 100))}%)`;
}

export function describeApiKeyLimitStatus(
	apiKey: ApiKey,
	status: ApiKeyLimitStatus,
): string[] {
	const lines: string[] = [];

	if (status.total && status.total.state !== "ok") {
		lines.push(
			status.total.state === "reached"
				? `All-time limit reached — ${formatRatio(status.total)}. This key stays blocked until you raise or remove the limit.`
				: `All-time limit — ${formatRatio(status.total)}.`,
		);
	}

	if (status.period && status.period.state !== "ok") {
		const windowLabel =
			apiKey.periodUsageDurationValue !== null &&
			apiKey.periodUsageDurationUnit !== null
				? formatPeriodWindowLabel(
						apiKey.periodUsageDurationValue,
						apiKey.periodUsageDurationUnit,
					)
				: null;
		const resetLabel = formatApiKeyPeriodResetLabel(
			apiKey.currentPeriodResetAt,
		);
		const period = windowLabel
			? `the current ${windowLabel} period`
			: "the current period";

		lines.push(
			status.period.state === "reached"
				? `Recurring limit reached — ${formatRatio(status.period)} in ${period}. Requests resume automatically ${resetLabel ? `on ${resetLabel}` : "when the next period starts"}.`
				: `Recurring limit — ${formatRatio(status.period)} in ${period}${resetLabel ? `, resets ${resetLabel}` : ""}.`,
		);
	}

	return lines;
}

function limitBadgeLabel(status: ApiKeyLimitStatus): string | null {
	const totalReached = status.total?.state === "reached";
	const periodReached = status.period?.state === "reached";

	if (totalReached && periodReached) {
		return "Limits reached";
	}
	if (totalReached) {
		return "Total limit reached";
	}
	if (periodReached) {
		return "Period limit reached";
	}

	const totalNear = status.total?.state === "approaching";
	const periodNear = status.period?.state === "approaching";

	if (totalNear && periodNear) {
		return "Near limits";
	}
	if (totalNear) {
		return "Near total limit";
	}
	if (periodNear) {
		return "Near period limit";
	}

	return null;
}

export function ApiKeyLimitBadge({
	apiKey,
	status,
}: {
	apiKey: ApiKey;
	status: ApiKeyLimitStatus;
}) {
	const label = limitBadgeLabel(status);
	if (!label) {
		return null;
	}

	const reached = status.state === "reached";
	const Icon = reached ? OctagonAlertIcon : AlertTriangleIcon;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge
					variant="secondary"
					className={cn(
						"flex cursor-help items-center gap-1 px-1 py-[2px] text-xs font-medium",
						reached
							? "bg-destructive/10 text-destructive border-destructive/50"
							: "bg-amber-500/10 text-amber-600 border-amber-600/50 dark:text-amber-500 dark:border-amber-500/50",
					)}
				>
					<Icon className="h-3.5 w-3.5" />
					{label}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>
				<div className="max-w-xs space-y-1 text-xs">
					{describeApiKeyLimitStatus(apiKey, status).map((line) => (
						<p key={line}>{line}</p>
					))}
				</div>
			</TooltipContent>
		</Tooltip>
	);
}
