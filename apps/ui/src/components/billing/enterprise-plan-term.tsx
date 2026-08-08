"use client";

import { CalendarClock } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/lib/components/button";
import { cn } from "@/lib/utils";

import { formatPlanTermLabel, type PlanTerm } from "@llmgateway/shared";

/**
 * Contract dates are stored as the UTC midnight of the agreed calendar day, so
 * they are formatted in UTC as well — otherwise a customer west of Greenwich
 * would see a renewal date one day earlier than the one in their agreement.
 */
export function formatTermDate(date: Date) {
	return date.toLocaleDateString("en-US", {
		timeZone: "UTC",
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

const TONE = {
	active: {
		accent: "text-emerald-600 dark:text-emerald-400",
		fill: "bg-emerald-500",
		knob: "bg-emerald-500",
	},
	expiring: {
		accent: "text-amber-600 dark:text-amber-400",
		fill: "bg-amber-500",
		knob: "bg-amber-500",
	},
	critical: {
		accent: "text-red-600 dark:text-red-400",
		fill: "bg-red-500",
		knob: "bg-red-500",
	},
	expired: {
		accent: "text-red-600 dark:text-red-400",
		fill: "bg-red-500/60",
		knob: "bg-red-500",
	},
} as const;

function TermTrack({ term, trial }: { term: PlanTerm; trial: boolean }) {
	const target = Math.round((term.elapsedFraction ?? 0) * 100);
	// Start at zero and fill on mount so the track draws itself in, which reads
	// as time elapsing rather than as a static bar that happens to be partial.
	const [width, setWidth] = useState(0);

	useEffect(() => {
		const frame = requestAnimationFrame(() => setWidth(target));
		return () => cancelAnimationFrame(frame);
	}, [target]);

	const tone = TONE[term.status];

	return (
		<div className="space-y-2">
			<div className="relative">
				<div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
					<div
						className={cn(
							"h-full rounded-full transition-[width] duration-1000 ease-out motion-reduce:transition-none",
							tone.fill,
						)}
						style={{ width: `${width}%` }}
					/>
				</div>
				<span
					aria-hidden
					className={cn(
						"ring-card absolute top-1/2 h-3 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 transition-[left] duration-1000 ease-out motion-reduce:transition-none",
						tone.knob,
					)}
					style={{ left: `${width}%` }}
				/>
			</div>
			<div className="text-muted-foreground flex items-baseline justify-between text-xs">
				<span>
					Started{" "}
					<span className="text-foreground/80 tabular-nums">
						{term.startedAt ? formatTermDate(term.startedAt) : "—"}
					</span>
				</span>
				<span>
					{term.totalDays !== null
						? `${term.totalDays}-day ${trial ? "trial" : "term"}`
						: null}
				</span>
			</div>
		</div>
	);
}

export function EnterprisePlanTerm({
	term,
	kind = "contract",
}: {
	term: PlanTerm | null;
	kind?: "trial" | "contract";
}) {
	if (!term) {
		return (
			<div className="text-muted-foreground flex items-center gap-2 text-sm">
				<CalendarClock className="h-4 w-4" />
				<span>
					Your agreement has no end date on file. Contact your account team if
					that looks wrong.
				</span>
			</div>
		);
	}

	const tone = TONE[term.status];
	const expired = term.status === "expired";
	const needsAttention = term.status !== "active";
	const trial = kind === "trial";

	return (
		<div className="space-y-5">
			<div className="flex flex-wrap items-end gap-x-8 gap-y-4">
				<div>
					<p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
						{expired
							? trial
								? "Trial ended"
								: "Term ended"
							: trial
								? "Trial remaining"
								: "Remaining"}
					</p>
					<div className="mt-1 flex items-baseline gap-2">
						<span
							className={cn(
								"text-5xl leading-none font-semibold tracking-tight tabular-nums",
								tone.accent,
							)}
						>
							{Math.abs(term.daysLeft)}
						</span>
						<span className="text-muted-foreground text-sm">
							{expired
								? `${Math.abs(term.daysLeft) === 1 ? "day" : "days"} ago`
								: term.daysLeft === 1
									? "day left"
									: "days left"}
						</span>
					</div>
				</div>

				<div className="border-border/60 sm:border-l sm:pl-8">
					<p className="text-muted-foreground text-[11px] font-medium tracking-[0.18em] uppercase">
						{expired ? "Ended on" : trial ? "Trial ends on" : "Renews on"}
					</p>
					<p className="mt-1 text-lg font-medium tabular-nums">
						{formatTermDate(term.expiresAt)}
					</p>
				</div>
			</div>

			{term.elapsedFraction !== null && <TermTrack term={term} trial={trial} />}

			{needsAttention && (
				<div
					className={cn(
						"flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between",
						expired || term.status === "critical"
							? "border-red-500/30 bg-red-500/5"
							: "border-amber-500/30 bg-amber-500/5",
					)}
				>
					<p className="text-sm">
						<span className="font-medium">{formatPlanTermLabel(term)}.</span>{" "}
						<span className="text-muted-foreground">
							{trial
								? expired
									? // A lapsed trial does not switch anything off by itself, so
										// the copy says so rather than implying access is gone.
										"Your enterprise access is unchanged — talk to sales to keep it that way."
									: "Talk to sales to continue on Enterprise when your trial ends."
								: expired
									? "Reach out to renew and keep your enterprise features."
									: "Reach out to renew your agreement before it lapses."}
						</span>
					</p>
					<Button asChild size="sm" variant="outline" className="shrink-0">
						<Link href="/enterprise">
							{trial ? "Talk to sales" : "Contact your account team"}
						</Link>
					</Button>
				</div>
			)}
		</div>
	);
}
