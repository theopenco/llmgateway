"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { DetailStatCards, StatCard } from "@/components/detail-stat-cards";
import { HistoryChart, windowOptions } from "@/components/history-chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMappingDetail, getMappingHistory } from "@/lib/admin-history";

import { getProviderIcon } from "@llmgateway/shared";

import type { HistoryWindow } from "@/components/history-chart";
import type { MappingDetail } from "@/lib/types";

function formatPrice(price: string | null) {
	if (!price) {
		return "\u2014";
	}
	const num = parseFloat(price);
	if (num === 0) {
		return "Free";
	}
	if (num < 0.001) {
		return `$${(num * 1_000_000).toFixed(2)}/M`;
	}
	return `$${num.toFixed(4)}`;
}

const validWindows = new Set<HistoryWindow>(windowOptions.map((o) => o.value));

function parseHistoryWindow(value: string | null): HistoryWindow {
	if (value && validWindows.has(value as HistoryWindow)) {
		return value as HistoryWindow;
	}
	return "24h";
}

export function MappingDetailClient({
	providerId,
	modelId,
	mapping: initialMapping,
}: {
	providerId: string;
	modelId: string;
	mapping: MappingDetail;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseHistoryWindow(searchParams.get("window"));
	const [loading, setLoading] = useState(false);
	const [mapping, setMapping] = useState<MappingDetail>(initialMapping);

	const loadDetail = useCallback(
		async (w: HistoryWindow) => {
			setLoading(true);
			try {
				const data = await getMappingDetail(providerId, modelId, w);
				if (data) {
					setMapping(data.mapping);
				}
			} finally {
				setLoading(false);
			}
		},
		[providerId, modelId],
	);

	useEffect(() => {
		void loadDetail(window);
	}, [loadDetail, window]);

	const fetchHistory = useCallback(
		async (w: HistoryWindow) => {
			return await getMappingHistory(providerId, modelId, w);
		},
		[providerId, modelId],
	);

	const ProviderIcon = getProviderIcon(providerId);
	const displayName =
		mapping.modelName !== mapping.modelId ? mapping.modelName : mapping.modelId;

	return (
		<>
			<header className="flex items-start gap-3">
				<ProviderIcon className="mt-1 h-8 w-8 shrink-0 dark:text-white" />
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">
						{mapping.providerId}/{mapping.modelId}
					</h1>
					<p className="mt-1 text-sm text-muted-foreground">
						{mapping.providerName} / {displayName}
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Badge
							variant={mapping.status === "active" ? "secondary" : "outline"}
						>
							{mapping.status}
						</Badge>
						{mapping.region && (
							<Badge variant="outline">{mapping.region}</Badge>
						)}
						{mapping.streaming && <Badge variant="outline">streaming</Badge>}
					</div>
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

			<DetailStatCards stats={mapping} loading={loading} />

			<section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
				<StatCard label="Input Price" value={formatPrice(mapping.inputPrice)} />
				<StatCard
					label="Output Price"
					value={formatPrice(mapping.outputPrice)}
				/>
				<StatCard
					label="Context"
					value={
						mapping.contextSize
							? `${(mapping.contextSize / 1000).toFixed(0)}K`
							: "\u2014"
					}
				/>
				<StatCard
					label="Max Output"
					value={
						mapping.maxOutput
							? `${mapping.maxOutput.toLocaleString("en-US")}`
							: "\u2014"
					}
				/>
			</section>

			<section className="space-y-4">
				<HistoryChart
					title={`${mapping.providerId}/${mapping.modelId} — History`}
					description="Request volume, errors, latency, and tokens over time"
					fetchData={fetchHistory}
					externalWindow={window}
				/>
			</section>
		</>
	);
}
