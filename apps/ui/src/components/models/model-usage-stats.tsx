"use client";

import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import Link from "next/link";

import { useApi } from "@/lib/fetch-client";
import { formatCompact } from "@/lib/provider-stats";
import { cn } from "@/lib/utils";

// Compact usage line for the model detail hero: tokens processed over the
// last 7 days, trend vs the previous week, and the model's rank with a link
// to the public rankings page. Renders nothing when the model has no traffic.
export function ModelUsageStats({ modelId }: { modelId: string }) {
	const api = useApi();

	const { data } = api.useQuery(
		"get",
		"/public/models/stats",
		{ params: { query: { window: "7d" as const } } },
		{
			refetchOnWindowFocus: false,
			staleTime: 5 * 60_000,
		},
	);

	const rankIndex = data?.models.findIndex((m) => m.modelId === modelId) ?? -1;
	if (rankIndex < 0) {
		return null;
	}
	const stats = data!.models[rankIndex];
	const isUp = (stats.trendPercent ?? 0) >= 0;

	return (
		<Link
			href="/rankings"
			className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-border/60 px-2.5 py-1 text-xs md:text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
			title="Tokens processed through LLM Gateway over the last 7 days"
		>
			<BarChart3 className="h-3.5 w-3.5" />
			<span className="font-medium text-foreground">
				{formatCompact(stats.totalTokens)}
			</span>
			tokens this week
			{stats.trendPercent !== null && (
				<span
					className={cn(
						"inline-flex items-center gap-0.5 font-medium tabular-nums",
						isUp
							? "text-green-600 dark:text-green-400"
							: "text-red-600 dark:text-red-400",
					)}
				>
					{isUp ? (
						<TrendingUp className="h-3 w-3" />
					) : (
						<TrendingDown className="h-3 w-3" />
					)}
					{`${isUp ? "+" : ""}${stats.trendPercent.toFixed(1)}%`}
				</span>
			)}
			<span className="text-muted-foreground">·</span>
			<span>#{rankIndex + 1} in rankings</span>
		</Link>
	);
}
