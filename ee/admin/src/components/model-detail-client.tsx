"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DetailStatCards } from "@/components/detail-stat-cards";
import { HistoryChart, windowOptions } from "@/components/history-chart";
import { ModelProviderCharts } from "@/components/model-provider-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getModelDetail, getModelHistory } from "@/lib/admin-history";

import type { HistoryWindow } from "@/components/history-chart";
import type { ModelDetailResponse, ModelProviderStats } from "@/lib/types";

type ModelInfo = ModelDetailResponse["model"];

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
	providers: initialProviders,
}: {
	modelId: string;
	allTimeStats: ModelInfo;
	providers: ModelProviderStats[];
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseHistoryWindow(searchParams.get("window"));
	const [loading, setLoading] = useState(false);
	const [info, setInfo] = useState<ModelInfo>(allTimeStats);
	const [providers, setProviders] =
		useState<ModelProviderStats[]>(initialProviders);
	const initialWindowRef = useRef(window);

	const loadStats = useCallback(
		async (w: HistoryWindow) => {
			setLoading(true);
			try {
				const detailData = await getModelDetail(modelId, w);
				if (detailData) {
					setInfo(detailData.model);
					setProviders(detailData.providers);
				}
			} finally {
				setLoading(false);
			}
		},
		[modelId],
	);

	useEffect(() => {
		if (window === initialWindowRef.current) {
			return;
		}
		void loadStats(window);
	}, [loadStats, window]);

	const fetchHistory = useCallback(
		async (w: HistoryWindow) => {
			return await getModelHistory(modelId, w);
		},
		[modelId],
	);

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

			<DetailStatCards stats={info} loading={loading} />

			<section className="space-y-4">
				<HistoryChart
					title={`${displayName} — History`}
					description="Aggregated across all providers. Request volume, errors, latency, and tokens over time"
					fetchData={fetchHistory}
					externalWindow={window}
				/>
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
