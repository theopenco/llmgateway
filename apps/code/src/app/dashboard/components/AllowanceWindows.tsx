"use client";

import { formatDistanceToNowStrict } from "date-fns";
import { CalendarDays, Gem, Timer } from "lucide-react";
import Link from "next/link";

import { formatDateTime, useDisplayTimeZone } from "@llmgateway/shared";

import type { LucideIcon } from "lucide-react";

export interface AllowanceWindowsProps {
	daily: { used: number; limit: number; resetsAt: string | null };
	weekly?: { used: number; limit: number; resetsAt: string | null };
	monthly: {
		used: number;
		limit: number;
		resetsAt: Date | null;
		exhaustedMessage: string;
	};
	paygEnabled: boolean;
	overflowCovering: boolean;
	resetPassAvailable?: boolean;
}

type Tone = "normal" | "low" | "over" | "exhausted";

interface WindowTile {
	key: string;
	label: string;
	span: string;
	scope: string;
	icon: LucideIcon;
	iconClassName?: string;
	used: number;
	limit: number;
	resetsAt: Date | null;
	resetVerb: string;
	idleHint: string;
	overflowCovering: boolean;
}

const TONE_STROKE: Record<Tone, string> = {
	normal: "stroke-foreground",
	low: "stroke-yellow-500",
	over: "stroke-amber-500",
	exhausted: "stroke-destructive",
};

const TONE_TEXT: Record<Tone, string> = {
	normal: "text-muted-foreground",
	low: "text-yellow-700 dark:text-yellow-400",
	over: "text-amber-600 dark:text-amber-400",
	exhausted: "text-destructive",
};

function toneFor(percentage: number, overflowCovering: boolean): Tone {
	if (percentage >= 100) {
		return overflowCovering ? "over" : "exhausted";
	}
	return percentage > 80 ? "low" : "normal";
}

function formatUsd(value: number) {
	return `$${value.toFixed(value % 1 === 0 && value >= 100 ? 0 : 2)}`;
}

function Ring({ percentage, tone }: { percentage: number; tone: Tone }) {
	const radius = 18;
	const circumference = 2 * Math.PI * radius;
	const filled = (Math.min(100, percentage) / 100) * circumference;
	return (
		<svg viewBox="0 0 44 44" className="h-11 w-11 shrink-0 -rotate-90">
			<circle
				cx="22"
				cy="22"
				r={radius}
				fill="none"
				strokeWidth="4"
				className="stroke-muted"
			/>
			<circle
				cx="22"
				cy="22"
				r={radius}
				fill="none"
				strokeWidth="4"
				strokeLinecap="round"
				strokeDasharray={`${filled} ${circumference}`}
				className={`${TONE_STROKE[tone]} transition-all duration-500`}
			/>
		</svg>
	);
}

function AllowanceTile({ tile }: { tile: WindowTile }) {
	const { timeZone } = useDisplayTimeZone();
	const percentage = tile.limit > 0 ? (tile.used / tile.limit) * 100 : 0;
	const tone = toneFor(percentage, tile.overflowCovering);
	const remaining = Math.max(0, tile.limit - tile.used);
	const Icon = tile.icon;

	return (
		<div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
			<div className="flex items-center justify-between gap-2">
				<span className="flex min-w-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
					<Icon
						className={`h-3.5 w-3.5 shrink-0 ${tile.iconClassName ?? ""}`}
					/>
					<span className="truncate">{tile.label}</span>
				</span>
				<span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
					{tile.span}
				</span>
			</div>
			<div className="flex items-center gap-3">
				<div
					role="progressbar"
					aria-label={`${tile.label} used`}
					aria-valuenow={Math.round(Math.min(100, percentage))}
					aria-valuemin={0}
					aria-valuemax={100}
				>
					<Ring percentage={percentage} tone={tone} />
				</div>
				<div className="min-w-0">
					<div className="truncate text-xl font-semibold tracking-tight tabular-nums">
						{formatUsd(tile.used)}
						<span className="text-sm font-normal text-muted-foreground">
							{" "}
							/ {formatUsd(tile.limit)}
						</span>
					</div>
					<div className={`text-xs tabular-nums ${TONE_TEXT[tone]}`}>
						{percentage > 100
							? "Over cap"
							: `${Math.round(percentage)}% used · ${formatUsd(remaining)} left`}
					</div>
				</div>
			</div>
			<div className="mt-auto space-y-0.5 border-t pt-2.5 text-xs text-muted-foreground">
				{tile.resetsAt ? (
					<p className="truncate">
						{tile.resetVerb}{" "}
						<span className="font-medium text-foreground">
							in {formatDistanceToNowStrict(tile.resetsAt)}
						</span>{" "}
						·{" "}
						<time dateTime={tile.resetsAt.toISOString()}>
							{formatDateTime(
								tile.resetsAt.toISOString(),
								timeZone,
								"monthDayHourMinuteZone",
							)}
						</time>
					</p>
				) : (
					<p className="truncate">{tile.idleHint}</p>
				)}
				<p className="truncate">{tile.scope}</p>
			</div>
		</div>
	);
}

function activeWindow(
	used: number,
	resetsAt: string | null,
): { used: number; resetsAt: Date | null } {
	const reset = resetsAt ? new Date(resetsAt) : null;
	if (reset && reset.getTime() <= Date.now()) {
		return { used: 0, resetsAt: null };
	}
	return { used, resetsAt: reset };
}

export function AllowanceWindows({
	daily,
	weekly,
	monthly,
	paygEnabled,
	overflowCovering,
	resetPassAvailable = false,
}: AllowanceWindowsProps) {
	const tiles: WindowTile[] = [];

	const day = activeWindow(daily.used, daily.resetsAt);
	const dailyExhausted = daily.limit > 0 && day.used >= daily.limit;
	if (daily.limit > 0) {
		tiles.push({
			key: "daily",
			label: "Daily usage cap",
			span: "24h",
			scope: "All models",
			icon: Timer,
			used: day.used,
			limit: daily.limit,
			resetsAt: day.resetsAt,
			resetVerb: "Resets",
			idleHint: "Rolling window starts with your next request",
			overflowCovering,
		});
	}

	const week = weekly ? activeWindow(weekly.used, weekly.resetsAt) : null;
	const weeklyPercentage =
		weekly && week && weekly.limit > 0 ? (week.used / weekly.limit) * 100 : 0;
	if (weekly && week && weekly.limit > 0) {
		tiles.push({
			key: "weekly",
			label: "Premium weekly",
			span: "7d",
			scope: "Premium models only",
			icon: Gem,
			iconClassName: "text-amber-500",
			used: week.used,
			limit: weekly.limit,
			resetsAt: week.resetsAt,
			resetVerb: "Resets",
			idleHint: "Window starts with your first premium request",
			overflowCovering,
		});
	}

	const monthlyPercentage =
		monthly.limit > 0 ? (monthly.used / monthly.limit) * 100 : 0;
	if (monthly.limit > 0) {
		tiles.push({
			key: "monthly",
			label: "Monthly allowance",
			span: "Cycle",
			scope: "All models",
			icon: CalendarDays,
			used: monthly.used,
			limit: monthly.limit,
			resetsAt:
				monthly.resetsAt && monthly.resetsAt.getTime() > Date.now()
					? monthly.resetsAt
					: null,
			resetVerb: "Renews",
			idleHint: "Billing cycle allowance",
			overflowCovering,
		});
	}

	const gridCols =
		tiles.length >= 3
			? "sm:grid-cols-3"
			: tiles.length === 2
				? "sm:grid-cols-2"
				: "";

	return (
		<div className="space-y-3">
			{dailyExhausted && (
				<div
					role="status"
					className={
						overflowCovering
							? "space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
							: "space-y-2 rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
					}
				>
					<p className="font-semibold">Daily usage cap reached</p>
					<p>
						{overflowCovering
							? "Requests are now billed to your pay-as-you-go credits at provider rates. This spending does not increase your monthly or weekly premium usage meters."
							: paygEnabled
								? "Requests are paused because your pay-as-you-go credits balance is empty. Top up credits or wait for the daily reset."
								: "Requests are paused. Enable pay-as-you-go overflow with a positive credits balance, upgrade for a higher daily allowance, or wait for the daily reset."}
					</p>
					<Link
						href="/dashboard/usage#payg-card"
						className="inline-block font-medium underline underline-offset-4"
					>
						{paygEnabled
							? overflowCovering
								? "Manage pay-as-you-go credits"
								: "Top up credits"
							: "Enable pay-as-you-go overflow"}
					</Link>
				</div>
			)}
			<div className={`grid gap-3 ${gridCols}`}>
				{tiles.map((tile) => (
					<AllowanceTile key={tile.key} tile={tile} />
				))}
			</div>
			{monthlyPercentage >= 100 ? (
				<p className="text-xs text-destructive">{monthly.exhaustedMessage}</p>
			) : monthlyPercentage > 80 ? (
				<p className="text-xs text-yellow-700 dark:text-yellow-400">
					Above 80% of your monthly allowance. Consider upgrading or wait for
					the next reset.
				</p>
			) : null}
			{weeklyPercentage >= 100 ? (
				overflowCovering ? (
					<p className="text-xs text-amber-600 dark:text-amber-400">
						Past the weekly premium allowance — pay-as-you-go overflow is
						billing premium usage to your credits balance at provider rates.
					</p>
				) : (
					<p className="text-xs text-destructive">
						{resetPassAvailable
							? "Weekly premium allowance reached — redeem a Reset Pass below for an instant reset, or use standard models within your daily and monthly allowances."
							: "Weekly premium allowance reached for this window."}
					</p>
				)
			) : weeklyPercentage > 80 ? (
				<p className="text-xs text-yellow-700 dark:text-yellow-400">
					Above 80% of your weekly premium allowance. Standard models do not use
					this weekly allowance.
				</p>
			) : null}
		</div>
	);
}
