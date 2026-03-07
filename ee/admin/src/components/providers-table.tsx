"use client";

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
import { getProviderHistory } from "@/lib/admin-history";

import { getProviderIcon } from "@llmgateway/shared";

import type { HistoryWindow } from "@/components/history-chart";
import type { ProviderStats } from "@/lib/admin-providers";

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

function ProviderRow({ provider }: { provider: ProviderStats }) {
	const [expanded, setExpanded] = useState(false);
	const errorRate =
		provider.logsCount > 0
			? ((provider.errorsCount / provider.logsCount) * 100).toFixed(1)
			: "0.0";

	const ProviderIcon = getProviderIcon(provider.id);

	const fetchData = useCallback(
		async (window: HistoryWindow) => {
			return await getProviderHistory(provider.id, window);
		},
		[provider.id],
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
							<span className="font-medium">{provider.name}</span>
							<p className="text-xs text-muted-foreground">{provider.id}</p>
						</div>
					</div>
				</TableCell>
				<TableCell>
					<Badge
						variant={provider.status === "active" ? "secondary" : "outline"}
					>
						{provider.status}
					</Badge>
				</TableCell>
				<TableCell className="tabular-nums">{provider.modelCount}</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(provider.logsCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(provider.errorsCount)}
				</TableCell>
				<TableCell className="tabular-nums">{errorRate}%</TableCell>
				<TableCell className="tabular-nums">
					{formatNumber(provider.cachedCount)}
				</TableCell>
				<TableCell className="tabular-nums">
					{provider.avgTimeToFirstToken !== null
						? `${Math.round(provider.avgTimeToFirstToken)}ms`
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
					<TableCell colSpan={10} className="p-4">
						<HistoryChart
							title={`${provider.name} — History`}
							description="Request volume, errors, latency, and tokens over time"
							fetchData={fetchData}
						/>
					</TableCell>
				</TableRow>
			)}
		</>
	);
}

export function ProvidersTable({ providers }: { providers: ProviderStats[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Provider</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Models</TableHead>
					<TableHead>Requests</TableHead>
					<TableHead>Errors</TableHead>
					<TableHead>Error Rate</TableHead>
					<TableHead>Cached</TableHead>
					<TableHead>Avg TTFT</TableHead>
					<TableHead>Last Updated</TableHead>
					<TableHead></TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{providers.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={10}
							className="h-24 text-center text-muted-foreground"
						>
							No providers found
						</TableCell>
					</TableRow>
				) : (
					providers.map((p) => <ProviderRow key={p.id} provider={p} />)
				)}
			</TableBody>
		</Table>
	);
}
