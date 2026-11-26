import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { getConfig } from "@/lib/config-server";

import { MARKETING_STATS } from "@llmgateway/shared";

import type { paths } from "@/lib/api/v1";

type ModelStats =
	paths["/public/models/stats"]["get"]["responses"][200]["content"]["application/json"];
type Totals = ModelStats["totals"];

const STATS_REVALIDATE_SECONDS = 300;

const flooredCompact = new Intl.NumberFormat("en-US", {
	notation: "compact",
	maximumFractionDigits: 1,
	roundingMode: "floor",
});

async function fetchLast30DayTotals(): Promise<Totals | null> {
	const config = getConfig();
	try {
		const response = await fetch(
			`${config.apiBackendUrl}/public/models/stats?window=30d`,
			{ next: { revalidate: STATS_REVALIDATE_SECONDS } },
		);
		if (!response.ok) {
			console.error("Failed to fetch 30-day model stats:", response.status);
			return null;
		}
		const stats = (await response.json()) as ModelStats;
		return stats.totals;
	} catch (error) {
		console.error("Error fetching 30-day model stats:", error);
		return null;
	}
}

function trafficValue(
	totals: Totals | null | undefined,
	pick: (totals: Totals) => number,
	fallback: string,
): string | null {
	if (totals === undefined) {
		return null;
	}
	return totals ? flooredCompact.format(pick(totals)) : fallback;
}

export function LandingStatsView({
	totals,
}: {
	totals: Totals | null | undefined;
}) {
	const stats = [
		{
			value: trafficValue(
				totals,
				(t) => t.totalTokens,
				MARKETING_STATS.tokensRouted,
			),
			label: "tokens routed",
		},
		{
			value: trafficValue(
				totals,
				(t) => t.totalRequests,
				MARKETING_STATS.requestsRouted,
			),
			label: "requests routed",
		},
		{ value: MARKETING_STATS.models, label: "models" },
		{ value: MARKETING_STATS.providers, label: "providers" },
	];

	return (
		<>
			<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-4">
				{stats.map((stat) => (
					<div
						key={stat.label}
						className="flex flex-col-reverse bg-background px-5 py-4"
					>
						<dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
							{stat.label}
						</dt>
						<dd className="font-display text-2xl font-bold tracking-tight md:text-3xl">
							{stat.value ?? (
								<span
									aria-hidden
									className="inline-block h-[1em] w-20 animate-pulse rounded bg-muted align-middle"
								/>
							)}
						</dd>
					</div>
				))}
			</dl>
			<p className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1 text-xs text-muted-foreground">
				<span>
					{totals === null
						? "Tokens and requests routed to date."
						: "Tokens and requests routed in the last 30 days."}
				</span>
				<Link
					href="/rankings"
					className="group inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
				>
					See live model rankings
					<ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
				</Link>
			</p>
		</>
	);
}

export async function LandingStats() {
	return <LandingStatsView totals={await fetchLast30DayTotals()} />;
}
