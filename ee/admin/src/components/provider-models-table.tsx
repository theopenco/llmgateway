"use client";

import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";

import type { ProviderModelStats } from "@/lib/types";

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
}

export function ProviderModelsTable({
	providerId,
	models,
}: {
	providerId: string;
	models: ProviderModelStats[];
}) {
	if (models.length === 0) {
		return (
			<div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
				No models served by this provider
			</div>
		);
	}

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead>Model</TableHead>
					<TableHead>Region</TableHead>
					<TableHead>Status</TableHead>
					<TableHead>Requests</TableHead>
					<TableHead>Errors</TableHead>
					<TableHead>Client</TableHead>
					<TableHead>Gateway</TableHead>
					<TableHead>Upstream</TableHead>
					<TableHead>Error Rate</TableHead>
					<TableHead>Cached</TableHead>
					<TableHead>Avg TTFT</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{models.map((m) => {
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
								{m.region ?? "\u2014"}
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
									: "\u2014"}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
		</Table>
	);
}
