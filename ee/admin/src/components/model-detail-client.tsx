"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { windowOptions } from "@/components/history-chart";
import { ModelProviderCharts } from "@/components/model-provider-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getModelDetail, getModelHistory } from "@/lib/admin-history";

import type {
	HistoryWindow,
	HistoryDataPoint,
} from "@/components/history-chart";
import type { ModelProviderStats } from "@/lib/types";

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
}

function aggregateStats(data: HistoryDataPoint[]) {
	const totalRequests = data.reduce((sum, d) => sum + d.logsCount, 0);
	const totalErrors = data.reduce((sum, d) => sum + d.errorsCount, 0);
	const totalCached = data.reduce((sum, d) => sum + d.cachedCount, 0);
	const ttftPoints = data.filter((d) => d.avgTtft !== null);
	const avgTtft =
		ttftPoints.length > 0
			? Math.round(
					ttftPoints.reduce((sum, d) => sum + (d.avgTtft ?? 0), 0) /
						ttftPoints.length,
				)
			: null;
	const errorRate =
		totalRequests > 0
			? ((totalErrors / totalRequests) * 100).toFixed(1)
			: "0.0";
	return { totalRequests, totalErrors, totalCached, avgTtft, errorRate };
}

interface ModelInfo {
	logsCount: number;
	errorsCount: number;
	cachedCount: number;
	avgTimeToFirstToken: number | null;
	family: string;
	status: string;
	free: boolean;
	name: string;
	id: string;
}

const validWindows = new Set<HistoryWindow>(windowOptions.map((o) => o.value));

function parseHistoryWindow(value: string | null): HistoryWindow {
	if (value && validWindows.has(value as HistoryWindow)) {
		return value as HistoryWindow;
	}
	return "4h";
}

export function ModelDetailClient({
	modelId,
	allTimeStats,
	initialWindow,
	providers: initialProviders,
}: {
	modelId: string;
	allTimeStats: ModelInfo;
	initialWindow: HistoryWindow;
	providers: ModelProviderStats[];
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseHistoryWindow(searchParams.get("window"));
	const initialLoadSkippedRef = useRef(false);
	const [loading, setLoading] = useState(false);
	const [providers, setProviders] =
		useState<ModelProviderStats[]>(initialProviders);
	const [stats, setStats] = useState({
		totalRequests: allTimeStats.logsCount,
		totalErrors: allTimeStats.errorsCount,
		totalCached: allTimeStats.cachedCount,
		avgTtft: allTimeStats.avgTimeToFirstToken
			? Math.round(allTimeStats.avgTimeToFirstToken)
			: null,
		errorRate:
			allTimeStats.logsCount > 0
				? ((allTimeStats.errorsCount / allTimeStats.logsCount) * 100).toFixed(1)
				: "0.0",
	});

	const loadStats = useCallback(
		async (w: HistoryWindow) => {
			setLoading(true);
			try {
				const [historyData, detailData] = await Promise.all([
					getModelHistory(modelId, w),
					getModelDetail(modelId, w),
				]);
				if (historyData) {
					setStats(aggregateStats(historyData));
				}
				if (detailData) {
					setProviders(detailData.providers);
				}
			} finally {
				setLoading(false);
			}
		},
		[modelId],
	);

	useEffect(() => {
		if (!initialLoadSkippedRef.current && window === initialWindow) {
			initialLoadSkippedRef.current = true;
			return;
		}
		void loadStats(window);
	}, [initialWindow, loadStats, window]);

	const displayName =
		allTimeStats.name !== allTimeStats.id ? allTimeStats.name : allTimeStats.id;

	return (
		<>
			<header>
				<h1 className="text-3xl font-semibold tracking-tight">{displayName}</h1>
				{allTimeStats.name !== allTimeStats.id && (
					<p className="mt-1 text-sm text-muted-foreground">
						{allTimeStats.id}
					</p>
				)}
				<div className="mt-3 flex flex-wrap items-center gap-2">
					<Badge variant="outline">{allTimeStats.family}</Badge>
					<Badge
						variant={allTimeStats.status === "active" ? "secondary" : "outline"}
					>
						{allTimeStats.status}
					</Badge>
					{allTimeStats.free && <Badge variant="default">Free</Badge>}
				</div>
			</header>

			<div className="flex flex-wrap items-center gap-1">
				{windowOptions.map((opt) => (
					<Button
						key={opt.value}
						variant={window === opt.value ? "default" : "outline"}
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={() => {
							const params = new URLSearchParams(searchParams.toString());
							params.set("window", opt.value);
							router.replace(`${pathname}?${params.toString()}`, {
								scroll: false,
							});
						}}
					>
						{opt.label}
					</Button>
				))}
			</div>

			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<div className="rounded-xl border border-border/60 p-4 shadow-sm">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Total Requests
					</p>
					<p
						className={`mt-1 text-2xl font-semibold tabular-nums ${loading ? "opacity-50" : ""}`}
					>
						{formatNumber(stats.totalRequests)}
					</p>
				</div>
				<div className="rounded-xl border border-border/60 p-4 shadow-sm">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Errors
					</p>
					<p
						className={`mt-1 text-2xl font-semibold tabular-nums ${loading ? "opacity-50" : ""}`}
					>
						{formatNumber(stats.totalErrors)}{" "}
						<span className="text-sm text-muted-foreground">
							({stats.errorRate}%)
						</span>
					</p>
				</div>
				<div className="rounded-xl border border-border/60 p-4 shadow-sm">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Cached
					</p>
					<p
						className={`mt-1 text-2xl font-semibold tabular-nums ${loading ? "opacity-50" : ""}`}
					>
						{formatNumber(stats.totalCached)}
					</p>
				</div>
				<div className="rounded-xl border border-border/60 p-4 shadow-sm">
					<p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
						Avg TTFT
					</p>
					<p
						className={`mt-1 text-2xl font-semibold tabular-nums ${loading ? "opacity-50" : ""}`}
					>
						{stats.avgTtft !== null ? `${stats.avgTtft}ms` : "\u2014"}
					</p>
				</div>
			</section>

			<section className="space-y-4">
				<h2 className="text-xl font-semibold">
					Per-Provider History{" "}
					<span className="text-sm font-normal text-muted-foreground">
						({providers.length} provider{providers.length !== 1 ? "s" : ""})
					</span>
				</h2>
				<ModelProviderCharts
					modelId={modelId}
					providers={providers}
					window={window}
				/>
			</section>
		</>
	);
}
