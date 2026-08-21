"use client";

// Monthly allowance meter, shared by the full Usage page and the Overview
// summary card. Lives in its own module so the lightweight summary doesn't
// pull the whole UsageOverview graph (charts, Reset Pass, PAYG) into the
// Overview page's bundle.
export function UsageBar({
	used,
	limit,
	lowMessage = "Above 80% of your monthly allowance. Consider upgrading or wait for the next reset.",
	exhaustedMessage = "Allowance reached for this billing cycle. Upgrade to keep coding.",
}: {
	used: number;
	limit: number;
	lowMessage?: string;
	exhaustedMessage?: string;
}) {
	const percentage = limit > 0 ? (used / limit) * 100 : 0;
	const clamped = Math.min(100, percentage);
	const isLow = percentage > 80;
	const isExhausted = percentage >= 100;
	const remaining = Math.max(0, limit - used);

	return (
		<div className="space-y-3">
			<div className="flex items-baseline justify-between gap-3">
				<div className="min-w-0">
					<div className="flex items-baseline gap-2">
						<span className="text-3xl font-bold tracking-tight tabular-nums">
							${used.toFixed(2)}
						</span>
						<span className="text-sm text-muted-foreground">
							of ${limit.toFixed(limit % 1 === 0 ? 0 : 2)} spent
						</span>
					</div>
				</div>
				<div className="text-right text-xs text-muted-foreground">
					<div className="tabular-nums font-medium text-foreground">
						{Math.round(percentage)}% used
					</div>
					<div className="tabular-nums">${remaining.toFixed(2)} remaining</div>
				</div>
			</div>
			<div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
				<div
					className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
						isExhausted
							? "bg-destructive"
							: isLow
								? "bg-yellow-500"
								: "bg-foreground"
					}`}
					style={{ width: `${clamped}%` }}
				/>
			</div>
			{isLow && !isExhausted && (
				<p className="text-xs text-yellow-700 dark:text-yellow-400">
					{lowMessage}
				</p>
			)}
			{isExhausted && (
				<p className="text-xs text-destructive">{exhaustedMessage}</p>
			)}
		</div>
	);
}
