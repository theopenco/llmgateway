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
import type { ProviderStats } from "@/lib/types";
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

type ProviderSortBy =
	| "name"
	| "status"
	| "logsCount"
	| "errorsCount"
	| "clientErrorsCount"
	| "cachedCount"
	| "totalCost"
	| "avgTimeToFirstToken"
	| "throughput"
	| "modelCount"
	| "updatedAt";

type SortOrder = "asc" | "desc";

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	pageWindow,
	usageMode,
	filterQuery,
}: {
	label: string;
	sortKey: ProviderSortBy;
	currentSortBy: ProviderSortBy;
	currentSortOrder: SortOrder;
	pageWindow?: PageWindow;
	usageMode: UsageMode;
	filterQuery: string;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "desc" ? "asc" : "desc";

	const windowParam = pageWindow ? `&window=${pageWindow}` : "";
	const modeParam = usageMode === "total" ? "" : `&mode=${usageMode}`;
	const href = `/providers?sortBy=${sortKey}&sortOrder=${nextOrder}${windowParam}${modeParam}${filterQuery}`;

	return (
		<SortHeaderLink
			label={label}
			href={href}
			active={isActive}
			order={currentSortOrder}
		/>
	);
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function ProviderRow({
	provider,
	externalWindow,
	usageMode,
}: {
	provider: ProviderStats;
	externalWindow?: HistoryWindow;
	usageMode: UsageMode;
}) {
	const [expanded, setExpanded] = useState(false);
	const stability = deriveStabilityMetrics({
		logsCount: provider.logsCount,
		clientErrorsCount: provider.clientErrorsCount,
		gatewayErrorsCount: provider.gatewayErrorsCount,
		upstreamErrorsCount: provider.upstreamErrorsCount,
	});
	const errorRate = (stability.errorRate ?? 0).toFixed(1);

	const ProviderIcon = getProviderIcon(provider.id);

	const history = useHistoryClient();
	const fetchData = useCallback(
		async (window: HistoryWindow) => {
			return await history.providerHistory(provider.id, window, usageMode);
		},
		[history, provider.id, usageMode],
	);

	return (
		<>
			<TableRow
				className="cursor-pointer hover:bg-muted/50"
				onClick={() => setExpanded(!expanded)}
			>
				<TableCell>
					<div className="flex items-center gap-2">
						<ProviderIcon className="h-5 w-5 shrink-0 dark:text-white" />
						<div>
							<Link
								href={`/providers/${encodeURIComponent(provider.id)}`}
								className="font-medium hover:underline"
								onClick={(e) => e.stopPropagation()}
							>
								{provider.name}
							</Link>
							<p className="text-xs text-muted-foreground">{provider.id}</p>
						</div>
						{provider.status !== "active" && (
							<Badge variant="outline">{provider.status}</Badge>
						)}
					</div>
				</TableCell>
				<TableCell className="tabular-nums">{provider.modelCount}</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(provider.logsCount)}
				</TableCell>
				<TableCell>
					<ErrorBreakdownCell
						errorsCount={stability.errorsCount}
						upstreamErrorsCount={provider.upstreamErrorsCount}
						gatewayErrorsCount={provider.gatewayErrorsCount}
					/>
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(provider.clientErrorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">{errorRate}%</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(provider.cachedCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{currencyFormatter.format(provider.totalCost)}
				</TableCell>
				<TableCell>
					<TokenBreakdownCell breakdown={provider} />
				</TableCell>
				<TableCell className="tabular-nums">
					{provider.avgTimeToFirstToken !== null
						? `${Math.round(provider.avgTimeToFirstToken)}ms`
						: "\u2014"}
				</TableCell>
				<TableCell className="tabular-nums">
					{provider.throughput !== null
						? `${provider.throughput.toFixed(1)} tok/s`
						: "\u2014"}
				</TableCell>
				<TableCell className="text-muted-foreground">
					{formatDate(provider.updatedAt)}
				</TableCell>
				<TableCell>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
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
					<TableCell colSpan={13} className="p-4">
						<HistoryChart
							title={`${provider.name} — History`}
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

export function ProvidersTable({
	providers,
	sortBy = "logsCount",
	sortOrder = "desc",
	pageWindow,
	usageMode = "total",
	filterQuery = "",
}: {
	providers: ProviderStats[];
	sortBy?: ProviderSortBy;
	sortOrder?: SortOrder;
	pageWindow?: PageWindow;
	usageMode?: UsageMode;
	filterQuery?: string;
}) {
	const externalWindow = pageWindow ? toHistoryWindow(pageWindow) : undefined;

	const sh = (label: string, sortKey: ProviderSortBy) => (
		<TableHead>
			<SortableHeader
				label={label}
				sortKey={sortKey}
				currentSortBy={sortBy}
				currentSortOrder={sortOrder}
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
					{sh("Provider", "name")}
					{sh("Models", "modelCount")}
					{sh("Requests", "logsCount")}
					{sh("Errors", "errorsCount")}
					{sh("Client", "clientErrorsCount")}
					<TableHead>Error Rate</TableHead>
					{sh("Cached", "cachedCount")}
					{sh("Cost", "totalCost")}
					<TableHead>Tokens</TableHead>
					{sh("Avg TTFT", "avgTimeToFirstToken")}
					{sh("Throughput", "throughput")}
					{sh("Last Updated", "updatedAt")}
					<TableHead></TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{providers.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={13}
							className="h-24 text-center text-muted-foreground"
						>
							No providers found
						</TableCell>
					</TableRow>
				) : (
					providers.map((p) => (
						<ProviderRow
							key={p.id}
							provider={p}
							externalWindow={externalWindow}
							usageMode={usageMode}
						/>
					))
				)}
			</TableBody>
		</Table>
	);
}
