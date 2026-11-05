"use client";

import { Timer } from "lucide-react";
import Link from "next/link";

import { formatDateTime, useDisplayTimeZone } from "@llmgateway/shared";

interface DailyAllowanceMeterProps {
	used: number;
	limit: number;
	resetsAt: string | null;
	paygEnabled: boolean;
	overflowCovering: boolean;
}

export function DailyAllowanceMeter({
	used,
	limit,
	resetsAt,
	paygEnabled,
	overflowCovering,
}: DailyAllowanceMeterProps) {
	const { timeZone } = useDisplayTimeZone();
	if (limit <= 0) {
		return null;
	}
	const windowExpired =
		resetsAt !== null && new Date(resetsAt).getTime() <= Date.now();
	const activeUsed = windowExpired ? 0 : used;
	const percentage = Math.min(100, (activeUsed / limit) * 100);
	const isExhausted = activeUsed >= limit;

	return (
		<div className="my-4 space-y-3">
			{isExhausted && (
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
			<div className="flex flex-wrap items-center justify-between gap-2 text-sm">
				<span className="flex items-center gap-2 font-medium">
					<Timer className="h-4 w-4" />
					Daily usage cap
				</span>
				<span className="tabular-nums">
					${activeUsed.toFixed(2)} of ${limit.toFixed(2)} ·{" "}
					{Math.round(percentage)}% used
				</span>
			</div>
			<div
				role="progressbar"
				aria-label="Daily usage cap used"
				aria-valuenow={Math.round(percentage)}
				aria-valuemin={0}
				aria-valuemax={100}
				className="h-2 overflow-hidden rounded-full bg-muted"
			>
				<div
					className={
						isExhausted ? "h-full bg-amber-500" : "h-full bg-foreground/70"
					}
					style={{ width: `${percentage}%` }}
				/>
			</div>
			<p className="text-xs text-muted-foreground">
				Applies to all models, separately from the monthly and weekly premium
				allowances.
			</p>
			<p className="text-xs text-muted-foreground">
				{resetsAt && !windowExpired ? (
					<>
						Daily allowance resets{" "}
						<time dateTime={resetsAt}>
							{formatDateTime(resetsAt, timeZone, "monthDayHourMinuteZone")}
						</time>
						.
					</>
				) : (
					"Rolling 24-hour window starts with your next plan-funded request."
				)}
			</p>
		</div>
	);
}
