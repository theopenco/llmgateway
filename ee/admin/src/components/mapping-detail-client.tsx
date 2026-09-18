"use client";

import { ShieldCheck } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { DetailStatCards, StatCard } from "@/components/detail-stat-cards";
import { HistoryChart, windowOptions } from "@/components/history-chart";
import {
	ModelVerificationDialog,
	VerificationStatusBadge,
} from "@/components/model-verification-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getMappingDetail, getMappingHistory } from "@/lib/admin-history";
import { useApi } from "@/lib/fetch-client";

import { getProviderIcon } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { HistoryWindow } from "@/components/history-chart";
import type { ModelVerification } from "@/components/model-verification-dialog";
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
	return "4h";
}

export function MappingDetailClient({
	providerId,
	modelId,
	region,
	mapping: initialMapping,
}: {
	providerId: string;
	modelId: string;
	region?: string;
	mapping: MappingDetail;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseHistoryWindow(searchParams.get("window"));
	const [loading, setLoading] = useState(false);
	const [mapping, setMapping] = useState<MappingDetail>(initialMapping);
	const initialWindowRef = useRef(window);

	const loadDetail = useCallback(
		async (w: HistoryWindow) => {
			setLoading(true);
			try {
				const data = await getMappingDetail(providerId, modelId, w, region);
				if (data) {
					setMapping(data.mapping);
				}
			} finally {
				setLoading(false);
			}
		},
		[providerId, modelId, region],
	);

	useEffect(() => {
		if (window === initialWindowRef.current) {
			return;
		}
		void loadDetail(window);
	}, [loadDetail, window]);

	const fetchHistory = useCallback(
		async (w: HistoryWindow) => {
			return await getMappingHistory(providerId, modelId, w, undefined, region);
		},
		[providerId, modelId, region],
	);

	const $api = useApi();
	const verificationsQuery = $api.useQuery(
		"get",
		"/admin/model-verifications",
		{ params: { query: { providerId } } },
		{
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
	const latestVerification = (verificationsQuery.data?.entries.find(
		(entry) => entry.mappingId === mapping.id,
	)?.verification ?? null) as ModelVerification | null;

	const ProviderIcon = getProviderIcon(providerId);
	const displayName =
		mapping.externalId !== mapping.modelId
			? mapping.externalId
			: mapping.modelId;

	return (
		<>
			<header className="flex items-start gap-3">
				<ProviderIcon className="mt-1 h-8 w-8 shrink-0 dark:text-white" />
				<div className="flex-1">
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
						<VerificationStatusBadge verification={latestVerification} />
					</div>
				</div>
				<ModelVerificationDialog
					title={`${mapping.providerId}/${mapping.modelId}${mapping.region ? `:${mapping.region}` : ""}`}
					mappingId={mapping.id}
					latest={latestVerification}
					onSettled={() => void verificationsQuery.refetch()}
				>
					<Button variant="outline" size="sm" data-testid="verify-mapping">
						<ShieldCheck className="mr-1 h-4 w-4" />
						Verify
					</Button>
				</ModelVerificationDialog>
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
				<StatCard
					label="Cost"
					value={`$${mapping.totalCost.toFixed(4)}`}
					loading={loading}
				/>
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
						mapping.maxOutput ? `${formatNumber(mapping.maxOutput)}` : "\u2014"
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
