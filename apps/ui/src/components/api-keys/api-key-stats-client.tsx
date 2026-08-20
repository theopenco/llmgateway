"use client";

import { format, subDays } from "date-fns";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import {
	AnalyticsDateRange,
	getAnalyticsRange,
} from "@/components/analytics/analytics-date-range";
import { currencyFormatter } from "@/components/analytics/chart-helpers";
import { CostByModelCard } from "@/components/analytics/cost-by-model-card";
import { CostByModelOverTimeCard } from "@/components/analytics/cost-by-model-over-time-card";
import {
	UsageModeSelector,
	useUsageMode,
} from "@/components/shared/usage-mode-selector";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import { useApi } from "@/lib/fetch-client";
import { getBrowserTimeZone } from "@/lib/timezone";
import { applyUsageModeToDaily } from "@/lib/usage-mode";

import type { Route } from "next";

interface ApiKeyStatsClientProps {
	projectId: string | undefined;
	keyId: string;
}

export function ApiKeyStatsClient({
	projectId,
	keyId,
}: ApiKeyStatsClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl, selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const usageMode = useUsageMode();
	const isEnterprise = selectedOrganization?.plan === "enterprise";

	useEffect(() => {
		if (!isEnterprise) {
			return;
		}
		if (!searchParams.get("from") || !searchParams.get("to")) {
			const params = new URLSearchParams(searchParams.toString());
			params.delete("days");
			const today = new Date();
			params.set("from", format(subDays(today, 6), "yyyy-MM-dd"));
			params.set("to", format(today, "yyyy-MM-dd"));
			router.replace(
				`${buildUrl(`api-keys/${keyId}`)}?${params.toString()}` as Route,
			);
		}
	}, [searchParams, router, buildUrl, keyId, isEnterprise]);

	const { fromStr, toStr } = getAnalyticsRange(
		isEnterprise,
		searchParams.get("from"),
		searchParams.get("to"),
	);

	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{ params: { query: { projectId: projectId ?? "" } } },
		{ enabled: !!projectId },
	);
	const apiKey = apiKeysData?.apiKeys.find((k) => k.id === keyId);

	const { data, isLoading } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: fromStr,
					to: toStr,
					timezone: getBrowserTimeZone(),
					apiKeyId: keyId,
					...(projectId ? { projectId } : {}),
				},
			},
		},
		{
			enabled: !!projectId,
			refetchOnWindowFocus: false,
			staleTime: 1000 * 60 * 5,
		},
	);

	const activity = useMemo(
		() =>
			(data?.activity ?? []).map((day) =>
				applyUsageModeToDaily(day, usageMode),
			),
		[data, usageMode],
	);

	const summary = useMemo(() => {
		return activity.reduce(
			(acc, row) => {
				acc.cost += row.cost;
				acc.totalTokens += row.totalTokens;
				acc.requestCount += row.requestCount;
				acc.errorCount += row.errorCount;
				acc.clientErrorCount += row.clientErrorCount;
				return acc;
			},
			{
				cost: 0,
				totalTokens: 0,
				requestCount: 0,
				errorCount: 0,
				clientErrorCount: 0,
			},
		);
	}, [activity]);

	// Errors are only tracked blended, so the rate is computed against all
	// traffic regardless of the selected usage mode.
	const blendedRequestCount = useMemo(
		() =>
			(data?.activity ?? []).reduce(
				(sum, row) => sum + row.requestCount - row.clientErrorCount,
				0,
			),
		[data],
	);

	const errorRate =
		blendedRequestCount > 0
			? (summary.errorCount / blendedRequestCount) * 100
			: 0;

	const stats = [
		{ label: "Total Cost", value: currencyFormatter.format(summary.cost) },
		{ label: "Total Tokens", value: summary.totalTokens.toLocaleString() },
		{ label: "Requests", value: summary.requestCount.toLocaleString() },
		{ label: "Error Rate", value: `${errorRate.toFixed(1)}%` },
	];

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<Link
					href={buildUrl("api-keys")}
					className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
					prefetch={true}
				>
					<ArrowLeftIcon className="h-4 w-4" />
					Back to API keys
				</Link>

				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div className="min-w-0">
						<h2 className="truncate text-3xl font-bold tracking-tight">
							{apiKey?.description || "API Key"}
						</h2>
						<p className="font-mono text-sm text-muted-foreground">
							{apiKey?.maskedToken ?? keyId}
						</p>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<UsageModeSelector />
						<AnalyticsDateRange
							isEnterprise={isEnterprise}
							buildUrl={buildUrl}
							path={`api-keys/${keyId}`}
						/>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
					{stats.map((stat) => (
						<Card key={stat.label}>
							<CardHeader className="pb-2">
								<CardTitle className="text-xs font-medium text-muted-foreground">
									{stat.label}
								</CardTitle>
							</CardHeader>
							<CardContent>
								<div className="text-2xl font-bold">
									{isLoading ? "—" : stat.value}
								</div>
							</CardContent>
						</Card>
					))}
				</div>

				<CostByModelOverTimeCard
					activity={activity}
					loading={isLoading}
					description="Stacked breakdown of the top 10 models used by this API key"
				/>
				<CostByModelCard
					activity={activity}
					loading={isLoading}
					description="Top 20 models by cost for this API key"
				/>
			</div>
		</div>
	);
}
