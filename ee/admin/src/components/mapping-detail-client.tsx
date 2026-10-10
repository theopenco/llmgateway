"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";

import { DetailStatCards, StatCard } from "@/components/detail-stat-cards";
import { HistoryChart, windowOptions } from "@/components/history-chart";
import {
	ModelVerificationDialog,
	VerificationStatusBadge,
} from "@/components/model-verification-dialog";
import { AdminOnly } from "@/components/role-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useApi } from "@/lib/fetch-client";
import { useHistoryClient } from "@/lib/history-client";
import { publicModelUrl } from "@/lib/public-urls";

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
	// The server rendered the stats for the initial window; only refetch for others.
	const [initialWindow] = useState(window);
	const $api = useApi();
	const detailQuery = $api.useQuery(
		"get",
		"/admin/providers/{providerId}/models/{modelId}",
		{
			params: {
				path: { providerId, modelId: encodeURIComponent(modelId) },
				query: { window, ...(region ? { region } : {}) },
			},
		},
		{ enabled: window !== initialWindow, placeholderData: keepPreviousData },
	);
	const detail = window === initialWindow ? undefined : detailQuery.data;
	const mapping: MappingDetail = detail?.mapping ?? initialMapping;
	const loading = window !== initialWindow && detailQuery.isFetching;

	const history = useHistoryClient();
	const fetchHistory = useCallback(
		async (w: HistoryWindow) => {
			return await history.mappingHistory(
				providerId,
				modelId,
				w,
				undefined,
				region,
			);
		},
		[history, providerId, modelId, region],
	);

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

	// Match the history chart's scope: it counts BYOK traffic, and a region-less
	// mapping's history also rolls up its regional rows, which only the
	// model-wide filter covers.
	const recentErrorsScope = mapping.region
		? `mapping=${encodeURIComponent(`${mapping.providerId}/${mapping.modelId}:${mapping.region}`)}`
		: `modelId=${encodeURIComponent(mapping.modelId)}`;
	const recentErrorsHref = `/unstable-mappings?${recentErrorsScope}&includeByok=true`;

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
				<Button asChild variant="outline" size="sm">
					<a
						href={publicModelUrl(mapping.modelId, mapping.providerId)}
						target="_blank"
						rel="noopener noreferrer"
					>
						<ExternalLink className="mr-1 h-4 w-4" />
						Model card
					</a>
				</Button>
				<Button asChild variant="outline" size="sm">
					<Link href={recentErrorsHref}>
						<AlertTriangle className="mr-1 h-4 w-4" />
						Recent errors
					</Link>
				</Button>
				<ModelVerificationDialog
					title={`${mapping.providerId}/${mapping.modelId}${mapping.region ? `:${mapping.region}` : ""}`}
					mappingId={mapping.id}
					latest={latestVerification}
					onSettled={() => void verificationsQuery.refetch()}
				>
					<Button variant="outline" size="sm" data-testid="verify-mapping">
						<ShieldCheck className="mr-1 h-4 w-4" />
						<AdminOnly fallback="Verification">Verify</AdminOnly>
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
