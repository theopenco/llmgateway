"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { HistoryChart } from "@/components/history-chart";
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

type SortBy = "logsCount" | "errorsCount" | "cost" | "modelId" | "providerId";
type SortOrder = "asc" | "desc";

export interface ProjectMappingEntry {
	modelId: string;
	providerId: string;
	providerName: string;
	logsCount: number;
	errorsCount: number;
	cachedCount: number;
	cost: number;
	totalTokens: number;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 4,
});

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
}

function formatCompactNumber(value: number): string {
	if (value >= 1_000_000_000) {
		return `${(value / 1_000_000_000).toFixed(1)}B`;
	}
	if (value >= 1_000_000) {
		return `${(value / 1_000_000).toFixed(1)}M`;
	}
	if (value >= 1_000) {
		return `${(value / 1_000).toFixed(1)}k`;
	}
	return value.toLocaleString("en-US");
}

function toHistoryWindow(pageWindow: PageWindow): HistoryWindow {
	return pageWindow as HistoryWindow;
}

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	search,
	pageWindow,
	basePath,
}: {
	label: string;
	sortKey: SortBy;
	currentSortBy: SortBy;
	currentSortOrder: SortOrder;
	search: string;
	pageWindow: string;
	basePath: string;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";
	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const href = `${basePath}?sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}&window=${pageWindow}`;

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

function MappingRow({
	mapping,
	projectId,
	externalWindow,
}: {
	mapping: ProjectMappingEntry;
	projectId: string;
	externalWindow?: HistoryWindow;
}) {
	const [expanded, setExpanded] = useState(false);
	const ProviderIcon = getProviderIcon(mapping.providerId);
	const errorRate =
		mapping.logsCount > 0
			? ((mapping.errorsCount / mapping.logsCount) * 100).toFixed(1)
			: "0.0";
	const displayModel = mapping.modelId.includes("/")
		? mapping.modelId.split("/").slice(1).join("/")
		: mapping.modelId;

	const fetchData = useCallback(
		async (window: HistoryWindow) => {
			return await getMappingHistory(
				mapping.providerId,
				mapping.modelId,
				window,
				projectId,
			);
		},
		[mapping.providerId, mapping.modelId, projectId],
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
						<span className="font-medium">{mapping.providerName}</span>
					</div>
				</TableCell>
				<TableCell>{displayModel}</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.logsCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.errorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">{errorRate}%</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(mapping.cachedCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatCompactNumber(mapping.totalTokens)}
				</TableCell>
				<TableCell className="tabular-nums">
					{currencyFormatter.format(mapping.cost)}
				</TableCell>
				<TableCell>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						aria-expanded={expanded}
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
					<TableCell colSpan={9} className="p-4">
						<HistoryChart
							title={`${mapping.providerId}/${displayModel} — History`}
							description="Hourly request volume, errors, tokens, and cost for this project"
							fetchData={fetchData}
							externalWindow={externalWindow}
						/>
					</TableCell>
				</TableRow>
			)}
		</>
	);
}

export function ProjectMappingsTable({
	mappings,
	projectId,
	sortBy,
	sortOrder,
	search,
	pageWindow,
	basePath,
}: {
	mappings: ProjectMappingEntry[];
	projectId: string;
	sortBy: SortBy;
	sortOrder: SortOrder;
	search: string;
	pageWindow: PageWindow;
	basePath: string;
}) {
	const externalWindow = toHistoryWindow(pageWindow);

	const sh = (label: string, sortKey: SortBy) => (
		<TableHead>
			<SortableHeader
				label={label}
				sortKey={sortKey}
				currentSortBy={sortBy}
				currentSortOrder={sortOrder}
				search={search}
				pageWindow={pageWindow}
				basePath={basePath}
			/>
		</TableHead>
	);

	return (
		<Table>
			<TableHeader>
				<TableRow>
					{sh("Provider", "providerId")}
					{sh("Model", "modelId")}
					{sh("Requests", "logsCount")}
					{sh("Errors", "errorsCount")}
					<TableHead>Error Rate</TableHead>
					<TableHead>Cached</TableHead>
					<TableHead>Tokens</TableHead>
					{sh("Cost", "cost")}
					<TableHead></TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{mappings.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={9}
							className="h-24 text-center text-muted-foreground"
						>
							No usage data found
						</TableCell>
					</TableRow>
				) : (
					mappings.map((m) => (
						<MappingRow
							key={`${m.providerId}-${m.modelId}`}
							mapping={m}
							projectId={projectId}
							externalWindow={externalWindow}
						/>
					))
				)}
			</TableBody>
		</Table>
	);
}
