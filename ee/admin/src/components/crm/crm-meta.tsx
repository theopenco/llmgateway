import { cn } from "@/lib/utils";

import type { paths } from "@/lib/api/v1";

export type CrmAccountsResponse =
	paths["/admin/crm/accounts"]["get"]["responses"][200]["content"]["application/json"];
export type CrmAccount = CrmAccountsResponse["accounts"][number];
export type CrmAccountDetail =
	paths["/admin/crm/accounts/{id}"]["get"]["responses"][200]["content"]["application/json"];
export type CrmSegment = CrmAccount["segment"];
export type CrmStage = CrmAccount["stage"];

export const SEGMENTS: {
	value: CrmSegment;
	label: string;
	dot: string;
	chip: string;
}[] = [
	{
		value: "customer",
		label: "Customer",
		dot: "bg-emerald-500",
		chip: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
	},
	{
		value: "trial",
		label: "Trial",
		dot: "bg-amber-500",
		chip: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300",
	},
	{
		value: "lead",
		label: "Reached out",
		dot: "bg-sky-500",
		chip: "bg-sky-500/10 text-sky-700 ring-sky-500/25 dark:text-sky-300",
	},
	{
		value: "prospect",
		label: "Prospect",
		dot: "bg-violet-500",
		chip: "bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300",
	},
];

export const STAGES: { value: CrmStage; label: string; bar: string }[] = [
	{ value: "lead", label: "New lead", bar: "bg-sky-500" },
	{ value: "qualified", label: "Qualified", bar: "bg-indigo-500" },
	{ value: "trial", label: "Trial", bar: "bg-amber-500" },
	{ value: "negotiation", label: "Negotiation", bar: "bg-orange-500" },
	{ value: "customer", label: "Customer", bar: "bg-emerald-500" },
	{ value: "churned", label: "Churned", bar: "bg-rose-500" },
	{ value: "lost", label: "Lost", bar: "bg-zinc-400" },
];

export function stageLabel(stage: CrmStage): string {
	return STAGES.find((s) => s.value === stage)?.label ?? stage;
}

export function SegmentChip({
	segment,
	className,
}: {
	segment: CrmSegment;
	className?: string;
}) {
	const meta = SEGMENTS.find((s) => s.value === segment)!;
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
				meta.chip,
				className,
			)}
		>
			<span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
			{meta.label}
		</span>
	);
}

const SCORE_COLORS = {
	healthy: "text-emerald-500",
	watch: "text-amber-500",
	at_risk: "text-rose-500",
} as const;

export function ScoreRing({
	score,
	label,
	size = 36,
	className,
}: {
	score: number;
	label: keyof typeof SCORE_COLORS;
	size?: number;
	className?: string;
}) {
	const stroke = size > 48 ? 6 : 3.5;
	const r = (size - stroke) / 2;
	const c = 2 * Math.PI * r;
	const filled = score / 100;
	return (
		<span
			className={cn("relative inline-flex shrink-0", className)}
			style={{ width: size, height: size }}
			title={`${score}/100`}
		>
			<svg width={size} height={size} className="-rotate-90">
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					strokeWidth={stroke}
					className="stroke-muted"
				/>
				<circle
					cx={size / 2}
					cy={size / 2}
					r={r}
					fill="none"
					strokeWidth={stroke}
					strokeLinecap="round"
					strokeDasharray={c}
					strokeDashoffset={c * (1 - filled)}
					className={cn("stroke-current transition-all", SCORE_COLORS[label])}
				/>
			</svg>
			<span
				className={cn(
					"absolute inset-0 flex items-center justify-center font-mono font-semibold tabular-nums",
					size > 48 ? "text-lg" : "text-[11px]",
				)}
			>
				{score}
			</span>
		</span>
	);
}

export function money(
	value: number | null | undefined,
	compact = true,
): string {
	if (value === null || value === undefined) {
		return "—";
	}
	return new Intl.NumberFormat("en-US", {
		style: "currency",
		currency: "USD",
		notation: compact && Math.abs(value) >= 10_000 ? "compact" : "standard",
		maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
	}).format(value);
}

export function relativeDays(iso: string | null | undefined): string {
	if (!iso) {
		return "—";
	}
	const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
	if (days === 0) {
		return "today";
	}
	if (days === 1) {
		return "tomorrow";
	}
	if (days === -1) {
		return "yesterday";
	}
	return days > 0 ? `in ${days}d` : `${Math.abs(days)}d ago`;
}

export function shortDate(iso: string | null | undefined): string {
	if (!iso) {
		return "—";
	}
	return new Date(iso).toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

export function trendPct(current: number, previous: number): number | null {
	if (previous <= 0) {
		return current > 0 ? null : 0;
	}
	const ratio = current / previous;
	return Math.round((ratio - 1) * 100);
}

export function accountHref(id: string): string {
	return `/crm/${encodeURIComponent(id)}`;
}

export function initials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((p) => p[0]!.toUpperCase())
		.join("");
}
