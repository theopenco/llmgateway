"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

import type { ProviderModelStats } from "@/lib/types";

type SortKey =
	| "logsCount"
	| "errorsCount"
	| "clientErrorsCount"
	| "gatewayErrorsCount"
	| "upstreamErrorsCount"
	| "errorRate"
	| "cachedCount"
	| "avgTimeToFirstToken"
	| "totalCost";

type SortOrder = "asc" | "desc";

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
}

function formatCost(n: number) {
	return `$${n.toFixed(4)}`;
}

function errorRateOf(m: ProviderModelStats) {
	return m.logsCount > 0 ? (m.errorsCount / m.logsCount) * 100 : 0;
}

function getValue(m: ProviderModelStats, key: SortKey): number {
	switch (key) {
		case "errorRate":
			return errorRateOf(m);
		case "avgTimeToFirstToken":
			return m.avgTimeToFirstToken ?? -1;
		default:
			return m[key] ?? 0;
	}
}

function SortableHeader({
	label,
	sortKey,
	currentSortBy,
	currentSortOrder,
	onSort,
}: {
	label: string;
	sortKey: SortKey;
	currentSortBy: SortKey | null;
	currentSortOrder: SortOrder;
	onSort: (key: SortKey) => void;
}) {
	const isActive = currentSortBy === sortKey;
	return (
		<button
			type="button"
			onClick={() => onSort(sortKey)}
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
		</button>
	);
}

export function ProviderModelsTable({
	providerId,
	models,
}: {
	providerId: string;
	models: ProviderModelStats[];
}) {
	const [sortBy, setSortBy] = useState<SortKey | null>("logsCount");
	const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

	const handleSort = (key: SortKey) => {
		if (sortBy === key) {
			setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
		} else {
			setSortBy(key);
			setSortOrder("desc");
		}
	};

	const sortedModels = useMemo(() => {
		if (!sortBy) {
			return models;
		}
		const dir = sortOrder === "asc" ? 1 : -1;
		return [...models].sort((a, b) => {
			const av = getValue(a, sortBy);
			const bv = getValue(b, sortBy);
			if (av === bv) {
				return 0;
			}
			return av < bv ? -1 * dir : 1 * dir;
		});
	}, [models, sortBy, sortOrder]);

	if (models.length === 0) {
		return (
			<div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
				No models served by this provider
			</div>
		);
	}

	const sh = (label: string, key: SortKey) => (
		<TableHead>
			<SortableHeader
				label={label}
				sortKey={key}
				currentSortBy={sortBy}
				currentSortOrder={sortOrder}
				onSort={handleSort}
			/>
		</TableHead>
	);

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Model</TableHead>
					<TableHead>Region</TableHead>
					<TableHead>Status</TableHead>
					{sh("Requests", "logsCount")}
					{sh("Cost", "totalCost")}
					{sh("Errors", "errorsCount")}
					{sh("Client", "clientErrorsCount")}
					{sh("Gateway", "gatewayErrorsCount")}
					{sh("Upstream", "upstreamErrorsCount")}
					{sh("Error Rate", "errorRate")}
					{sh("Cached", "cachedCount")}
					{sh("Avg TTFT", "avgTimeToFirstToken")}
				</TableRow>
			</TableHeader>
			<TableBody>
				{sortedModels.map((m) => {
					const errorRate =
						m.logsCount > 0
							? ((m.errorsCount / m.logsCount) * 100).toFixed(1)
							: "0.0";
					return (
						<TableRow key={m.mappingId} className="hover:bg-muted/50">
							<TableCell>
								<Link
									href={`/model-provider-mappings/${encodeURIComponent(providerId)}/${encodeURIComponent(m.modelId)}`}
									className="font-medium hover:underline"
								>
									{m.modelId}
								</Link>
								{m.modelName !== m.modelId && (
									<p className="text-xs text-muted-foreground">{m.modelName}</p>
								)}
							</TableCell>
							<TableCell className="text-xs text-muted-foreground">
								{m.region ?? "—"}
							</TableCell>
							<TableCell>
								<Badge
									variant={m.status === "active" ? "secondary" : "outline"}
								>
									{m.status}
								</Badge>
							</TableCell>
							<TableCell className="tabular-nums">
								{formatNumber(m.logsCount)}
							</TableCell>
							<TableCell className="tabular-nums">
								{formatCost(m.totalCost)}
							</TableCell>
							<TableCell className="tabular-nums">
								{formatNumber(m.errorsCount)}
							</TableCell>
							<TableCell className="tabular-nums">
								{formatNumber(m.clientErrorsCount)}
							</TableCell>
							<TableCell className="tabular-nums">
								{formatNumber(m.gatewayErrorsCount)}
							</TableCell>
							<TableCell className="tabular-nums">
								{formatNumber(m.upstreamErrorsCount)}
							</TableCell>
							<TableCell className="tabular-nums">{errorRate}%</TableCell>
							<TableCell className="tabular-nums">
								{formatNumber(m.cachedCount)}
							</TableCell>
							<TableCell className="tabular-nums">
								{m.avgTimeToFirstToken !== null
									? `${Math.round(m.avgTimeToFirstToken)}ms`
									: "—"}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
