"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { HistoryChart } from "@/components/history-chart";
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
import { getMappingHistory } from "@/lib/admin-history";
import { cn } from "@/lib/utils";

import { getProviderIcon } from "@llmgateway/shared";

import type { HistoryWindow } from "@/components/history-chart";
import type { PageWindow } from "@/lib/page-window";
import type { ModelProviderMappingEntry } from "@/lib/types";

function toHistoryWindow(pageWindow: PageWindow): HistoryWindow {
	const map: Record<PageWindow, HistoryWindow> = {
		"1h": "1h",
		"2h": "2h",
		"4h": "4h",
		"12h": "12h",
		"24h": "24h",
		"2d": "2d",
		"7d": "7d",
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
	| "avgTimeToFirstToken"
	| "updatedAt";

type SortOrder = "asc" | "desc";

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
	pageWindow,
}: {
	label: string;
	sortKey: MappingSortBy;
	currentSortBy: MappingSortBy;
	currentSortOrder: SortOrder;
	search: string;
	pageWindow?: PageWindow;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";
	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const windowParam = pageWindow ? `&window=${pageWindow}` : "";
	const href = `/model-provider-mappings?sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}${windowParam}`;

	return (
		<Link
			href={href}
			className={cn(
				"flex items-center gap-1 hover:text-foreground transition-colors",
				isActive ? "text-foreground" : "text-muted-foreground",
			)}
		>
			{label}
			{isActive ? (
				currentSortOrder === "asc" ? (
					<ArrowUp className="h-3.5 w-3.5" />
				) : (
					<ArrowDown className="h-3.5 w-3.5" />
				)
			) : (
				<ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
			)}
		</Link>
	);
}

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
}

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

function MappingRow({
	mapping,
	externalWindow,
}: {
	mapping: ModelProviderMappingEntry;
	externalWindow?: HistoryWindow;
}) {
	const [expanded, setExpanded] = useState(false);
	const ProviderIcon = getProviderIcon(mapping.providerId);
	const errorRate =
		mapping.logsCount > 0
			? ((mapping.errorsCount / mapping.logsCount) * 100).toFixed(1)
			: "0.0";

	const fetchData = useCallback(
		async (window: HistoryWindow) => {
			return await getMappingHistory(
				mapping.providerId,
				mapping.modelId,
				window,
			);
		},
		[mapping.providerId, mapping.modelId],
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
						{mapping.modelName !== mapping.modelId && (
							<p className="text-xs text-muted-foreground">
								{mapping.modelName}
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
				<TableCell>
					<Badge
						variant={mapping.status === "active" ? "secondary" : "outline"}
					>
						{mapping.status}
					</Badge>
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.logsCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.errorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.clientErrorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.gatewayErrorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.upstreamErrorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">{errorRate}%</TableCell>
				<TableCell className="tabular-nums">
					{mapping.avgTimeToFirstToken !== null
						? `${Math.round(mapping.avgTimeToFirstToken)}ms`
						: "\u2014"}
				</TableCell>
				<TableCell className="tabular-nums text-xs">
					{formatPrice(mapping.inputPrice)}
				</TableCell>
				<TableCell className="tabular-nums text-xs">
					{formatPrice(mapping.outputPrice)}
				</TableCell>
				<TableCell className="tabular-nums text-xs">
					{mapping.contextSize
						? `${(mapping.contextSize / 1000).toFixed(0)}K`
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
						colSpan={15}
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
}: {
	mappings: ModelProviderMappingEntry[];
	sortBy?: MappingSortBy;
	sortOrder?: SortOrder;
	search?: string;
	pageWindow?: PageWindow;
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
					<TableHead>Status</TableHead>
					{sh("Requests", "logsCount")}
					{sh("Errors", "errorsCount")}
					{sh("Client", "clientErrorsCount")}
					{sh("Gateway", "gatewayErrorsCount")}
					{sh("Upstream", "upstreamErrorsCount")}
					<TableHead>Error Rate</TableHead>
					{sh("Avg TTFT", "avgTimeToFirstToken")}
					<TableHead>Input Price</TableHead>
					<TableHead>Output Price</TableHead>
					<TableHead>Context</TableHead>
					<TableHead></TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{mappings.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={15}
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
						/>
					))
				)}
			</TableBody>
		</Table>
	);
}
