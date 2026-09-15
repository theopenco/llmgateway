"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DetailStatCards } from "@/components/detail-stat-cards";
import { HistoryChart, windowOptions } from "@/components/history-chart";
import { ProviderModelsTable } from "@/components/provider-models-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getProviderDetail, getProviderHistory } from "@/lib/admin-history";
import { useApi } from "@/lib/fetch-client";

import { getProviderIcon } from "@llmgateway/shared";

import type { HistoryWindow } from "@/components/history-chart";
import type { ModelVerification } from "@/components/model-verification-dialog";
import type { ProviderDetailResponse, ProviderModelStats } from "@/lib/types";

type ProviderInfo = ProviderDetailResponse["provider"];

const validWindows = new Set<HistoryWindow>(windowOptions.map((o) => o.value));

function parseHistoryWindow(value: string | null): HistoryWindow {
	if (value && validWindows.has(value as HistoryWindow)) {
		return value as HistoryWindow;
	}
	return "4h";
}

export function ProviderDetailClient({
	providerId,
	providerInfo,
	models: initialModels,
}: {
	providerId: string;
	providerInfo: ProviderInfo;
	models: ProviderModelStats[];
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseHistoryWindow(searchParams.get("window"));
	const [loading, setLoading] = useState(false);
	const [info, setInfo] = useState<ProviderInfo>(providerInfo);
	const [models, setModels] = useState<ProviderModelStats[]>(initialModels);
	const initialWindowRef = useRef(window);

	const loadDetail = useCallback(
		async (w: HistoryWindow) => {
			setLoading(true);
			try {
				const data = await getProviderDetail(providerId, w);
				if (data) {
					setInfo(data.provider);
					setModels(data.models);
				}
			} finally {
				setLoading(false);
			}
		},
		[providerId],
	);

	useEffect(() => {
		if (window === initialWindowRef.current) {
			return;
		}
		void loadDetail(window);
	}, [loadDetail, window]);

	const fetchHistory = useCallback(
		async (w: HistoryWindow) => {
			return await getProviderHistory(providerId, w);
		},
		[providerId],
	);

	const $api = useApi();
	const verificationsQuery = $api.useQuery(
		"get",
		"/admin/model-verifications",
		{ params: { query: { providerId } } },
		{
			// Follow queued and running runs so per-check progress lands in the
			// table without a manual refresh.
			refetchInterval: (query) =>
				query.state.data?.entries.some(
					(entry) =>
						entry.verification.status === "queued" ||
						entry.verification.status === "running",
				)
					? 2_000
					: false,
		},
	);
	const verifications = useMemo(() => {
		const byMapping = new Map<string, ModelVerification>();
		for (const entry of verificationsQuery.data?.entries ?? []) {
			if (entry.mappingId) {
				byMapping.set(entry.mappingId, entry.verification as ModelVerification);
			}
		}
		return byMapping;
	}, [verificationsQuery.data]);

	const ProviderIcon = getProviderIcon(providerId);

	return (
		<>
			<header className="flex items-start gap-3">
				<ProviderIcon className="mt-1 h-8 w-8 shrink-0 dark:text-white" />
				<div>
					<h1 className="text-3xl font-semibold tracking-tight">{info.name}</h1>
					<p className="mt-1 text-sm text-muted-foreground">{info.id}</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<Badge variant={info.status === "active" ? "secondary" : "outline"}>
							{info.status}
						</Badge>
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

			<DetailStatCards stats={info} loading={loading} />

			<section className="space-y-4">
				<HistoryChart
					title={`${info.name} — History`}
					description="Request volume, errors, latency, and tokens over time"
					fetchData={fetchHistory}
					externalWindow={window}
				/>
			</section>

			<section className="space-y-4">
				<h2 className="text-xl font-semibold">
					Models{" "}
					<span className="text-sm font-normal text-muted-foreground">
						({models.length})
					</span>
				</h2>
				<div className="min-w-0 overflow-x-auto rounded-lg border border-border/60 bg-card">
					<ProviderModelsTable
						providerId={providerId}
						models={models}
						verifications={verifications}
						onVerificationSettled={() => void verificationsQuery.refetch()}
					/>
				</div>
			</section>
		</>
	);
}
