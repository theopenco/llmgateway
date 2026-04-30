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
import { getModelHistory } from "@/lib/admin-history";
import { cn } from "@/lib/utils";

import type { HistoryWindow } from "@/components/history-chart";
import type { PageWindow } from "@/lib/page-window";
import type { ModelStats } from "@/lib/types";

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
}: {
	label: string;
	sortKey: ModelSortBy;
	currentSortBy: ModelSortBy;
	currentSortOrder: SortOrder;
	search: string;
	pageWindow?: PageWindow;
}) {
	const isActive = currentSortBy === sortKey;
	const nextOrder = isActive && currentSortOrder === "asc" ? "desc" : "asc";

	const searchParam = search ? `&search=${encodeURIComponent(search)}` : "";
	const windowParam = pageWindow ? `&window=${pageWindow}` : "";
	const href = `/models?page=1&sortBy=${sortKey}&sortOrder=${nextOrder}${searchParam}${windowParam}`;

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

function formatDate(dateString: string) {
	return new Date(dateString).toLocaleDateString("en-US", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
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

function formatDiscount(discount: string | null) {
	if (!discount) {
		return null;
	}
	const num = parseFloat(discount);
	if (num <= 0) {
		return null;
	}
	return `${(num * 100).toFixed(0)}%`;
}

function ModelRow({
	model,
	externalWindow,
}: {
	model: ModelStats;
	externalWindow?: HistoryWindow;
}) {
	const [expanded, setExpanded] = useState(false);
	const errorRate =
		model.logsCount > 0
			? ((model.errorsCount / model.logsCount) * 100).toFixed(1)
			: "0.0";

	const fetchData = useCallback(
		async (window: HistoryWindow) => {
			return await getModelHistory(model.id, window);
		},
		[model.id],
	);

	const hasTokenPricing = model.inputPrice && parseFloat(model.inputPrice) > 0;
	const discountLabel = formatDiscount(model.discount);

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
				</TableCell>
				<TableCell>
					<Badge variant="outline">{model.family}</Badge>
				</TableCell>
				<TableCell>
					<Badge variant={model.status === "active" ? "secondary" : "outline"}>
						{model.status}
					</Badge>
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
				<TableCell className="tabular-nums text-xs">
					{hasTokenPricing ? (
						<>
							{formatPrice(model.inputPrice)} / {formatPrice(model.outputPrice)}
						</>
					) : model.requestPrice && parseFloat(model.requestPrice) > 0 ? (
						<span className="text-amber-500">
							{formatPrice(model.requestPrice)}/req
						</span>
					) : (
						<span className="text-muted-foreground">{"\u2014"}</span>
					)}
				</TableCell>
				<TableCell className="tabular-nums text-xs">
					{discountLabel ? (
						<Badge variant="secondary" className="text-xs">
							{discountLabel} off
						</Badge>
					) : (
						<span className="text-muted-foreground">{"\u2014"}</span>
					)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(model.errorsCount)}
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
}: {
	models: ModelStats[];
	sortBy?: ModelSortBy;
	sortOrder?: SortOrder;
	search?: string;
	pageWindow?: PageWindow;
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
			/>
		</TableHead>
	);

	return (
		<Table>
			<TableHeader>
				<TableRow>
					{sh("Model", "name")}
					{sh("Family", "family")}
					{sh("Status", "status")}
					{sh("Free", "free")}
					{sh("Providers", "providerCount")}
					{sh("Requests", "logsCount")}
					{sh("Cost", "totalCost")}
					<TableHead>Pricing</TableHead>
					<TableHead>Discount</TableHead>
					{sh("Errors", "errorsCount")}
					<TableHead>Error Rate</TableHead>
					{sh("Cached", "cachedCount")}
					{sh("Avg TTFT", "avgTimeToFirstToken")}
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
						<ModelRow key={m.id} model={m} externalWindow={externalWindow} />
					))
				)}
			</TableBody>
		</Table>
	);
}
