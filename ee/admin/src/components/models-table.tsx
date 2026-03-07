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
import { getModelHistory } from "@/lib/admin-history";

import type { HistoryWindow } from "@/components/history-chart";
import type { ModelStats } from "@/lib/types";

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

function ModelRow({ model }: { model: ModelStats }) {
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

	return (
		<>
			<TableRow
				className="cursor-pointer hover:bg-muted/50"
				onClick={() => setExpanded(!expanded)}
			>
				<TableCell>
					<span className="font-medium">
						{model.name !== model.id ? model.name : model.id}
					</span>
					{model.name !== model.id && (
						<p className="text-xs text-muted-foreground">{model.id}</p>
					)}
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
					<TableCell colSpan={12} className="p-4">
						<HistoryChart
							title={`${model.name !== model.id ? model.name : model.id} — History`}
							description="Request volume, errors, latency, and tokens over time"
							fetchData={fetchData}
						/>
					</TableCell>
				</TableRow>
			)}
		</>
	);
}

export function ModelsTable({ models }: { models: ModelStats[] }) {
	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Model</TableHead>
					<TableHead>Family</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Free</TableHead>
					<TableHead>Providers</TableHead>
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
				{models.length === 0 ? (
					<TableRow>
						<TableCell
							colSpan={12}
							className="h-24 text-center text-muted-foreground"
						>
							No models found
						</TableCell>
					</TableRow>
				) : (
					models.map((m) => <ModelRow key={m.id} model={m} />)
				)}
			</TableBody>
		</Table>
	);
}
