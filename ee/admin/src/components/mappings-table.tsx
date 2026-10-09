"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { ErrorBreakdownCell } from "@/components/error-breakdown";
import { HistoryChart } from "@/components/history-chart";
import { SortHeaderLink } from "@/components/sort-header-link";
import { TokenBreakdownCell } from "@/components/token-breakdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useHistoryClient } from "@/lib/history-client";

import { deriveStabilityMetrics, getProviderIcon } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { HistoryWindow } from "@/components/history-chart";
import type { PageWindow } from "@/lib/page-window";
import type { ModelProviderMappingEntry } from "@/lib/types";
import type { UsageMode } from "@/lib/usage-mode";

function toHistoryWindow(pageWindow: PageWindow): HistoryWindow {
	const map: Record<PageWindow, HistoryWindow> = {
		"1m": "1m",
		"2m": "2m",
		"5m": "5m",
		"15m": "15m",
		"1h": "1h",
		"2h": "2h",
		"4h": "4h",
		"12h": "12h",
		"24h": "24h",
		"2d": "2d",
		"3d": "3d",
		"7d": "7d",
		"30d": "30d",
		"90d": "90d",
	};
	return map[pageWindow] ?? "24h";
}

type MappingSortBy =
	| "providerId"
	| "modelId"
	| "logsCount"
	| "errorsCount"
	| "clientErrorsCount"
	| "gatewayErrorsCount"
	| "upstreamErrorsCount"
	| "cost"
	| "avgTimeToFirstToken"
	| "throughput"
	| "updatedAt";

type SortOrder = "asc" | "desc";

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
	pageWindow,
	usageMode,
	filterQuery,
}: {
	label: string;
	sortKey: MappingSortBy;
	currentSortBy: MappingSortBy;
	currentSortOrder: SortOrder;
	search: string;
	pageWindow?: PageWindow;
	usageMode: UsageMode;
	filterQuery: string;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "desc" ? "asc" : "desc";
	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const windowParam = pageWindow ? `&window=${pageWindow}` : "";
	const modeParam = usageMode === "total" ? "" : `&mode=${usageMode}`;
	const href = `/model-provider-mappings?sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}${windowParam}${modeParam}${filterQuery}`;

	return (
		<SortHeaderLink
			label={label}
			href={href}
			active={isActive}
			order={currentSortOrder}
		/>
	);
}

function formatCost(n: number) {
	return `$${n.toFixed(4)}`;
}

function MappingRow({
	mapping,
	externalWindow,
	usageMode,
}: {
	mapping: ModelProviderMappingEntry;
	externalWindow?: HistoryWindow;
	usageMode: UsageMode;
}) {
	const [expanded, setExpanded] = useState(false);
	const ProviderIcon = getProviderIcon(mapping.providerId);
	const stability = deriveStabilityMetrics({
		logsCount: mapping.logsCount,
		clientErrorsCount: mapping.clientErrorsCount,
		gatewayErrorsCount: mapping.gatewayErrorsCount,
		upstreamErrorsCount: mapping.upstreamErrorsCount,
	});
	const errorRate = (stability.errorRate ?? 0).toFixed(1);

	const history = useHistoryClient();
	const fetchData = useCallback(
		async (window: HistoryWindow) => {
			return await history.mappingHistory(
				mapping.providerId,
				mapping.modelId,
				window,
				undefined,
				undefined,
				usageMode,
			);
		},
		[history, mapping.providerId, mapping.modelId, usageMode],
	);

	return (
		<>
			<TableRow
				className="cursor-pointer hover:bg-muted/50"
				onClick={() => setExpanded(!expanded)}
			>
				<TableCell>
					<div className="flex items-center gap-2">
						<ProviderIcon className="h-4 w-4 shrink-0 dark:text-white" />
						<div>
							<p className="text-xs text-muted-foreground">
								{mapping.providerId}
							</p>
							<Link
								href={`/providers/${encodeURIComponent(mapping.providerId)}`}
								className="font-medium hover:underline"
								onClick={(e) => e.stopPropagation()}
							>
								{mapping.providerName}
							</Link>
						</div>
					</div>
				</TableCell>
				<TableCell>
					<div>
						<Link
							href={`/model-provider-mappings/${encodeURIComponent(mapping.providerId)}/${encodeURIComponent(mapping.modelId)}`}
							className="font-medium hover:underline"
							onClick={(e) => e.stopPropagation()}
						>
							{mapping.providerId}/{mapping.modelId}
						</Link>
						{mapping.status !== "active" && (
							<Badge variant="outline" className="ml-2">
								{mapping.status}
							</Badge>
						)}
						{mapping.externalId !== mapping.modelId && (
							<p className="text-xs text-muted-foreground">
								{mapping.externalId}
							</p>
						)}
					</div>
				</TableCell>
				<TableCell>
					{mapping.region ? (
						<span className="text-xs text-muted-foreground">
							{mapping.region}
						</span>
					) : (
						<span className="text-xs text-muted-foreground">—</span>
					)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.logsCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatCost(mapping.cost)}
				</TableCell>
				<TableCell>
					<TokenBreakdownCell breakdown={mapping} />
				</TableCell>
				<TableCell>
					<ErrorBreakdownCell
						errorsCount={stability.errorsCount}
						upstreamErrorsCount={mapping.upstreamErrorsCount}
						gatewayErrorsCount={mapping.gatewayErrorsCount}
					/>
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.clientErrorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">{errorRate}%</TableCell>
				<TableCell className="tabular-nums">
					{mapping.avgTimeToFirstToken !== null
						? `${Math.round(mapping.avgTimeToFirstToken)}ms`
						: "\u2014"}
				</TableCell>
				<TableCell className="tabular-nums">
					{mapping.throughput !== null
						? `${mapping.throughput.toFixed(1)} tok/s`
						: "\u2014"}
				</TableCell>
				<TableCell>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						aria-expanded={expanded}
						aria-controls={`mapping-history-${mapping.providerId}-${mapping.modelId}`}
						onClick={(e) => {
							e.stopPropagation();
							setExpanded(!expanded);
						}}
					>
						{expanded ? "Hide" : "History"}
					</Button>
				</TableCell>
			</TableRow>
			{expanded && (
				<TableRow>
					<TableCell
						colSpan={12}
						className="p-4"
						id={`mapping-history-${mapping.providerId}-${mapping.modelId}`}
					>
						<HistoryChart
							title={`${mapping.providerId}/${mapping.modelId} — History`}
							description="Request volume, errors, latency, and tokens over time"
							fetchData={fetchData}
							externalWindow={externalWindow}
						/>
					</TableCell>
				</TableRow>
			)}
		</>
	);
}

export function MappingsTable({
	mappings,
	sortBy = "logsCount",
	sortOrder = "desc",
	search = "",
	pageWindow,
	usageMode = "total",
	filterQuery = "",
}: {
	mappings: ModelProviderMappingEntry[];
	sortBy?: MappingSortBy;
	sortOrder?: SortOrder;
	search?: string;
	pageWindow?: PageWindow;
	usageMode?: UsageMode;
	filterQuery?: string;
}) {
	const externalWindow = pageWindow ? toHistoryWindow(pageWindow) : undefined;

	const sh = (label: string, sortKey: MappingSortBy) => (
		<TableHead>
			<SortableHeader
				label={label}
				sortKey={sortKey}
				currentSortBy={sortBy}
				currentSortOrder={sortOrder}
				search={search}
				pageWindow={pageWindow}
				usageMode={usageMode}
				filterQuery={filterQuery}
			/>
		</TableHead>
	);

	return (
		<Table>
			<TableHeader>
				<TableRow>
					{sh("Provider", "providerId")}
					{sh("Model", "modelId")}
					<TableHead>Region</TableHead>
					{sh("Requests", "logsCount")}
					{sh("Cost", "cost")}
					<TableHead>Tokens</TableHead>
					{sh("Errors", "errorsCount")}
					{sh("Client", "clientErrorsCount")}
					<TableHead>Error Rate</TableHead>
					{sh("Avg TTFT", "avgTimeToFirstToken")}
					{sh("Throughput", "throughput")}
					<TableHead></TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{mappings.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={12}
							className="h-24 text-center text-muted-foreground"
						>
							No mappings found
						</TableCell>
					</TableRow>
				) : (
					mappings.map((m) => (
						<MappingRow
							key={m.id}
							mapping={m}
							externalWindow={externalWindow}
							usageMode={usageMode}
						/>
					))
				)}
			</TableBody>
		</Table>
	);
}
