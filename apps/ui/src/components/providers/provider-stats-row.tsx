"use client";

import { Activity, CheckCircle2, Cpu, Gauge, Zap } from "lucide-react";

import { useApi } from "@/lib/fetch-client";
import { formatCompact, gateProviderStats } from "@/lib/provider-stats";
import { cn } from "@/lib/utils";

// Live 7-day performance band for a provider detail page, from the same
// public stats endpoint the /providers grid uses. Renders nothing until the
// provider has traffic.
export function ProviderStatsRow({ providerId }: { providerId: string }) {
	const api = useApi();

	const { data: providerStats } = api.useQuery(
		"get",
		"/public/providers/stats",
		{ params: { query: { window: "7d" as const } } },
		{ refetchOnWindowFocus: false, staleTime: 5 * 60_000 },
	);

	const row = providerStats?.providers.find((p) => p.providerId === providerId);
	if (!row || row.logsCount === 0) {
		return null;
	}

	const gated = gateProviderStats({
		logsCount: row.logsCount,
		uptime: row.uptime,
		avgTimeToFirstToken: row.avgTimeToFirstToken,
		timeToFirstTokenCount: row.timeToFirstTokenCount,
		throughput: row.throughput,
	});
	const totalTokens = row.totalTokens;

	const stats: Array<{
		key: string;
		label: string;
		icon: React.ElementType;
		value: string | null;
		valueClassName?: string;
	}> = [
		{
			key: "requests",
			label: "Requests (7d)",
			icon: Activity,
			value: formatCompact(row.logsCount),
		},
		{
			key: "tokens",
			label: "Tokens processed (7d)",
			icon: Cpu,
			value: totalTokens > 0 ? formatCompact(totalTokens) : null,
		},
		{
			key: "uptime",
			label: "Uptime (7d)",
			icon: CheckCircle2,
			value: gated.uptime !== null ? `${gated.uptime.toFixed(2)}%` : null,
			valueClassName:
				gated.uptime === null
					? undefined
					: gated.uptime >= 99
						? "text-green-600 dark:text-green-400"
						: gated.uptime >= 95
							? "text-amber-500"
							: "text-red-500",
		},
		{
			key: "ttft",
			label: "Avg time to first token",
			icon: Gauge,
			value:
				gated.avgTimeToFirstToken !== null
					? `${(gated.avgTimeToFirstToken / 1000).toFixed(2)}s`
					: null,
		},
		{
			key: "throughput",
			label: "Throughput",
			icon: Zap,
			value:
				gated.throughput !== null
					? `${Math.round(gated.throughput).toLocaleString()} tok/s`
					: null,
		},
	];

	const visible = stats.filter((stat) => stat.value !== null);
	if (visible.length === 0) {
		return null;
	}

	return (
		<section className="border-y border-border/60 bg-muted/20">
			<div className="container mx-auto grid grid-cols-2 gap-px px-4 py-6 sm:grid-cols-3 lg:grid-cols-5">
				{visible.map((stat) => {
					const Icon = stat.icon;
					return (
						<div key={stat.key} className="px-3 py-2">
							<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
								<Icon className="h-3.5 w-3.5" />
								{stat.label}
							</div>
							<p
								className={cn(
									"mt-1 text-xl font-bold tabular-nums md:text-2xl",
									stat.valueClassName,
								)}
							>
								{stat.value}
							</p>
						</div>
					);
				})}
			</div>
		</section>
	);
}
