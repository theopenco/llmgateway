"use client";

import { useCallback } from "react";

import { HistoryChart } from "@/components/history-chart";
import { Badge } from "@/components/ui/badge";
import { getMappingHistory } from "@/lib/admin-history";

import { getProviderIcon } from "@llmgateway/shared";

import type { HistoryWindow } from "@/components/history-chart";
import type { ModelProviderStats } from "@/lib/types";

function formatNumber(n: number) {
	return new Intl.NumberFormat("en-US").format(n);
}

function ProviderSection({
	modelId,
	provider,
	window,
}: {
	modelId: string;
	provider: ModelProviderStats;
	window: HistoryWindow;
}) {
	const ProviderIcon = getProviderIcon(provider.providerId);

	const fetchData = useCallback(
		async (w: HistoryWindow) => {
			return await getMappingHistory(provider.providerId, modelId, w);
		},
		[provider.providerId, modelId],
	);

	const errorRate =
		provider.logsCount > 0
			? ((provider.errorsCount / provider.logsCount) * 100).toFixed(1)
			: "0.0";

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<ProviderIcon className="h-5 w-5 shrink-0 dark:text-white" />
					<span className="font-medium">{provider.providerName}</span>
					<Badge variant="outline" className="text-xs">
						{provider.providerId}
					</Badge>
				</div>
				<div className="flex items-center gap-4 text-xs text-muted-foreground">
					<span>
						Reqs:{" "}
						<strong className="text-foreground">
							{formatNumber(provider.logsCount)}
						</strong>
					</span>
					<span>
						Errors:{" "}
						<strong className="text-foreground">
							{formatNumber(provider.errorsCount)}
						</strong>{" "}
						({errorRate}%)
					</span>
					{provider.avgTimeToFirstToken !== null && (
						<span>
							Avg TTFT:{" "}
							<strong className="text-foreground">
								{Math.round(provider.avgTimeToFirstToken)}ms
							</strong>
						</span>
					)}
				</div>
			</div>
			<HistoryChart
				title={`${provider.providerName} — History`}
				description={`Request volume, errors, latency, and tokens for ${provider.providerName}`}
				fetchData={fetchData}
				externalWindow={window}
			/>
		</div>
	);
}

export function ModelProviderCharts({
	modelId,
	providers,
	window,
}: {
	modelId: string;
	providers: ModelProviderStats[];
	window: HistoryWindow;
}) {
	if (providers.length === 0) {
		return (
			<div className="flex h-32 items-center justify-center rounded-lg border border-border/60 text-sm text-muted-foreground">
				No providers serve this model
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{providers.map((provider) => (
				<ProviderSection
					key={provider.providerId}
					modelId={modelId}
					provider={provider}
					window={window}
				/>
			))}
		</div>
	);
}
