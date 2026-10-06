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

import { deriveStabilityMetrics } from "@llmgateway/shared";
import { formatNumber } from "@llmgateway/shared/number-format";

import type { HistoryWindow } from "@/components/history-chart";
import type { PageWindow } from "@/lib/page-window";
import type { ModelStats } from "@/lib/types";
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

type ModelSortBy =
	| "name"
	| "family"
	| "status"
	| "free"
	| "logsCount"
	| "totalCost"
	| "errorsCount"
	| "clientErrorsCount"
	| "gatewayErrorsCount"
	| "upstreamErrorsCount"
	| "cachedCount"
	| "avgTimeToFirstToken"
	| "throughput"
	| "providerCount"
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
	sortKey: ModelSortBy;
	currentSortBy: ModelSortBy;
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
	const href = `/models?page=1&sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}${windowParam}${modeParam}${filterQuery}`;

	return (
		<SortHeaderLink
			label={label}
			href={href}
			active={isActive}
			order={currentSortOrder}
		/>
	);
}

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function ModelRow({
	model,
	externalWindow,
	usageMode,
}: {
	model: ModelStats;
	externalWindow?: HistoryWindow;
	usageMode: UsageMode;
}) {
	const [expanded, setExpanded] = useState(false);
	const stability = deriveStabilityMetrics({
		logsCount: model.logsCount,
		clientErrorsCount: model.clientErrorsCount,
		gatewayErrorsCount: model.gatewayErrorsCount,
		upstreamErrorsCount: model.upstreamErrorsCount,
	});
	const errorRate = (stability.errorRate ?? 0).toFixed(1);

	const history = useHistoryClient();
	const fetchData = useCallback(
		async (window: HistoryWindow) => {
			return await history.modelHistory(model.id, window, usageMode);
		},
		[history, model.id, usageMode],
	);

	return (
		<>
			<TableRow
				className="cursor-pointer hover:bg-muted/50"
				onClick={() => setExpanded(!expanded)}
			>
				<TableCell>
					<Link
						href={`/models/${encodeURIComponent(model.id)}`}
						className="hover:underline"
						onClick={(e) => e.stopPropagation()}
					>
						<span className="font-medium">
							{model.name !== model.id ? model.name : model.id}
						</span>
						{model.name !== model.id && (
							<p className="text-xs text-muted-foreground">{model.id}</p>
						)}
					</Link>
					{model.status !== "active" && (
						<Badge variant="outline" className="ml-2">
							{model.status}
						</Badge>
					)}
				</TableCell>
				<TableCell>
					<Badge variant="outline">{model.family}</Badge>
				</TableCell>
				<TableCell>
					{model.free ? (
						<Badge variant="default">Free</Badge>
					) : (
						<span className="text-muted-foreground">{"\u2014"}</span>
					)}
				</TableCell>
				<TableCell className="tabular-nums">{model.providerCount}</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(model.logsCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					${model.totalCost.toFixed(4)}
				</TableCell>
				<TableCell>
					<TokenBreakdownCell breakdown={model} />
				</TableCell>
				<TableCell>
					<ErrorBreakdownCell
						errorsCount={stability.errorsCount}
						upstreamErrorsCount={model.upstreamErrorsCount}
						gatewayErrorsCount={model.gatewayErrorsCount}
					/>
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(model.clientErrorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">{errorRate}%</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(model.cachedCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{model.avgTimeToFirstToken !== null
						? `${Math.round(model.avgTimeToFirstToken)}ms`
						: "\u2014"}
				</TableCell>
				<TableCell className="tabular-nums">
					{model.throughput !== null
						? `${model.throughput.toFixed(1)} tok/s`
						: "\u2014"}
				</TableCell>
				<TableCell className="text-muted-foreground">
					{formatDate(model.updatedAt)}
				</TableCell>
				<TableCell>
					<div className="flex items-center gap-1">
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
						<Button
							variant="outline"
							size="sm"
							className="h-7 px-2 text-xs"
							asChild
						>
							<Link
								href={`/models/${encodeURIComponent(model.id)}`}
								onClick={(e) => e.stopPropagation()}
							>
								Details
							</Link>
						</Button>
					</div>
				</TableCell>
			</TableRow>
			{expanded && (
				<TableRow>
					<TableCell colSpan={15} className="p-4">
						<HistoryChart
							title={`${model.name !== model.id ? model.name : model.id} — History`}
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

export function ModelsTable({
	models,
	sortBy = "logsCount",
	sortOrder = "desc",
	search = "",
	pageWindow,
	usageMode = "total",
	filterQuery = "",
}: {
	models: ModelStats[];
	sortBy?: ModelSortBy;
	sortOrder?: SortOrder;
	search?: string;
	pageWindow?: PageWindow;
	usageMode?: UsageMode;
	filterQuery?: string;
}) {
	const externalWindow = pageWindow ? toHistoryWindow(pageWindow) : undefined;

	const sh = (label: string, sortKey: ModelSortBy) => (
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
					{sh("Model", "name")}
					{sh("Family", "family")}
					{sh("Free", "free")}
					{sh("Providers", "providerCount")}
					{sh("Requests", "logsCount")}
					{sh("Cost", "totalCost")}
					<TableHead>Tokens</TableHead>
					{sh("Errors", "errorsCount")}
					{sh("Client", "clientErrorsCount")}
					<TableHead>Error Rate</TableHead>
					{sh("Cached", "cachedCount")}
					{sh("Avg TTFT", "avgTimeToFirstToken")}
					{sh("Throughput", "throughput")}
					{sh("Last Updated", "updatedAt")}
					<TableHead></TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{models.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={15}
							className="h-24 text-center text-muted-foreground"
						>
							No models found
						</TableCell>
					</TableRow>
				) : (
					models.map((m) => (
						<ModelRow
							key={m.id}
							model={m}
							externalWindow={externalWindow}
							usageMode={usageMode}
						/>
					))
				)}
			</TableBody>
		</Table>
	);
}
