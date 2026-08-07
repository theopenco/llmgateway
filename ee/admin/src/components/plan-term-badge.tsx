import { cn } from "@/lib/utils";

import {
	formatPlanTermBadge,
	getPlanTerm,
	type PlanTermStatus,
} from "@llmgateway/shared";

/**
 * Contract dates are stored as the UTC midnight of the agreed calendar day, so
 * they are formatted in UTC too — otherwise the admin panel and the customer's
 * own dashboard would disagree about the renewal day by one.
 */
export function formatTermDate(date: Date) {
	return date.toLocaleDateString("en-US", {
		timeZone: "UTC",
		year: "numeric",
		month: "short",
		day: "numeric",
	});
}

const TONE: Record<PlanTermStatus, string> = {
	active:
		"border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
	expiring:
		"border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
	critical: "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400",
	expired: "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-400",
};

const DOT: Record<PlanTermStatus, string> = {
	active: "bg-emerald-500",
	expiring: "bg-amber-500",
	critical: "bg-red-500",
	expired: "bg-red-500",
};

/**
 * Compact countdown for dense admin surfaces. Renders nothing when the plan has
 * no end date, so free/PAYG rows stay visually quiet.
 */
export function PlanTermBadge({
	planExpiresAt,
	planStartedAt,
	className,
}: {
	planExpiresAt: string | null | undefined;
	planStartedAt?: string | null;
	className?: string;
}) {
	const term = getPlanTerm({
		expiresAt: planExpiresAt,
		startedAt: planStartedAt,
	});

	if (!term) {
		return null;
	}

	return (
		<span
			title={`${term.status === "expired" ? "Expired" : "Renews"} ${formatTermDate(term.expiresAt)}`}
			className={cn(
				"inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums",
				TONE[term.status],
				className,
			)}
		>
			<span
				aria-hidden
				className={cn("h-1.5 w-1.5 rounded-full", DOT[term.status])}
			/>
			{formatPlanTermBadge(term)}
		</span>
	);
}
