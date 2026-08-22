"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

import {
	UsageModeSelector,
	useUsageMode,
} from "@/components/shared/usage-mode-selector";
import {
	TimeRangePicker,
	type TimeRangeValue,
} from "@/components/time-range-picker";
import { CacheRateChart } from "@/components/usage/cache-rate-chart";
import { CostBreakdownChart } from "@/components/usage/cost-breakdown-chart";
import { ErrorRateChart } from "@/components/usage/error-rate-chart";
import { ModelUsageTable } from "@/components/usage/model-usage-table";
import { UsageChart } from "@/components/usage/usage-chart";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/lib/components/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@/lib/components/tabs";
import { useApi } from "@/lib/fetch-client";
import { USAGE_MODE_ALL_TRAFFIC_NOTE } from "@/lib/usage-mode";

import {
	formatDayKey,
	shiftDayKey,
	useDisplayTimeZone,
} from "@llmgateway/shared";

import type { ActivitT } from "@/types/activity";

interface UsageClientProps {
	initialActivityData?: ActivitT;
	projectId: string | undefined;
}

/** Day keys for a range, in the zone the queries bucket by. Deriving them
 *  from the browser calendar would ask for a day the API considers the future
 *  whenever the two zones are on different dates. */
function timeRangeToDayKeys(timeRange: TimeRangeValue, timeZone: string) {
	const now = new Date();
	const today = formatDayKey(now, timeZone);
	switch (timeRange) {
		case "1h":
		case "4h":
			return { from: today, to: today };
		case "24h":
			return { from: shiftDayKey(today, -1), to: today };
		case "7d":
			return { from: shiftDayKey(today, -7), to: today };
		case "30d":
			return { from: shiftDayKey(today, -30), to: today };
	}
}

export function UsageClient({
	initialActivityData,
	projectId,
}: UsageClientProps) {
	const router = useRouter();
	const { timeZone: displayTimeZone } = useDisplayTimeZone();
	// Ranges this component wrote, so a zone toggle can refresh them without
	// clobbering one the user chose.
	const generated = useRef<Set<string>>(new Set());
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();
	const api = useApi();
	const usageMode = useUsageMode();

	// Fetch API keys for the project
	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: {
					projectId: projectId ?? "",
				},
			},
		},
		{
			enabled: !!projectId,
		},
	);

	const apiKeys =
		apiKeysData?.apiKeys.filter((key) => key.status !== "deleted") ?? [];

	// Get apiKeyId and timeRange from URL
	const apiKeyId = searchParams.get("apiKeyId") ?? undefined;
	const timeRange = (searchParams.get("timeRange") as TimeRangeValue) ?? "7d";

	// If no from/to params, set them based on timeRange
	useEffect(() => {
		const { from, to } = timeRangeToDayKeys(timeRange, displayTimeZone);
		const currentFrom = searchParams.get("from");
		const currentTo = searchParams.get("to");
		// Leave a range the user picked alone; refresh one we generated, so a
		// zone toggle moves it instead of stranding it in the previous zone.
		if (
			currentFrom &&
			currentTo &&
			!generated.current.has(`${currentFrom}|${currentTo}`)
		) {
			return;
		}
		if (currentFrom === from && currentTo === to) {
			return;
		}
		generated.current.add(`${from}|${to}`);
		const params = new URLSearchParams(searchParams);
		params.delete("days");
		params.set("from", from);
		params.set("to", to);
		if (!params.has("timeRange")) {
			params.set("timeRange", timeRange);
		}
		router.replace(`${buildUrl("usage")}?${params.toString()}`);
	}, [searchParams, router, buildUrl, timeRange, displayTimeZone]);

	// Function to update apiKeyId in URL
	const updateApiKeyIdInUrl = (newApiKeyId: string | undefined) => {
		const params = new URLSearchParams(searchParams);
		if (newApiKeyId) {
			params.set("apiKeyId", newApiKeyId);
		} else {
			params.delete("apiKeyId");
		}
		router.push(`${buildUrl("usage")}?${params.toString()}`);
	};

	// Function to update timeRange in URL
	const updateTimeRange = (newTimeRange: TimeRangeValue) => {
		const { from, to } = timeRangeToDayKeys(newTimeRange, displayTimeZone);
		generated.current.add(`${from}|${to}`);
		const params = new URLSearchParams(searchParams);
		params.set("timeRange", newTimeRange);
		params.set("from", from);
		params.set("to", to);
		params.delete("days");
		router.push(`${buildUrl("usage")}?${params.toString()}`);
	};

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Usage & Metrics</h2>
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
						<Select
							value={apiKeyId ?? "all"}
							onValueChange={(value) =>
								updateApiKeyIdInUrl(value === "all" ? undefined : value)
							}
						>
							<SelectTrigger size="sm" className="w-full sm:w-[180px]">
								<SelectValue placeholder="All API Keys" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All API Keys</SelectItem>
								{apiKeys.map((key) => (
									<SelectItem key={key.id} value={key.id}>
										{key.description}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<TimeRangePicker value={timeRange} onChange={updateTimeRange} />
						<UsageModeSelector />
					</div>
				</div>
				<Tabs defaultValue="requests" className="space-y-4">
					<TabsList className="max-w-full overflow-x-auto">
						<TabsTrigger value="requests">Requests</TabsTrigger>
						<TabsTrigger value="models">Models</TabsTrigger>
						<TabsTrigger value="errors">Errors</TabsTrigger>
						<TabsTrigger value="cache">Cache</TabsTrigger>
						<TabsTrigger value="costs">Costs</TabsTrigger>
					</TabsList>
					<TabsContent value="requests" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Request Volume</CardTitle>
								<CardDescription>
									Number of API requests over time
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<UsageChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="models" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Top Used Models</CardTitle>
								<CardDescription>Usage breakdown by model</CardDescription>
							</CardHeader>
							<CardContent>
								<ModelUsageTable
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="errors" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Error Rate</CardTitle>
								<CardDescription>
									API request error rate over time
									{usageMode !== "total" && ` — ${USAGE_MODE_ALL_TRAFFIC_NOTE}`}
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<ErrorRateChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="cache" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Cache Rate</CardTitle>
								<CardDescription>
									API request cache rate over time
									{usageMode !== "total" && ` — ${USAGE_MODE_ALL_TRAFFIC_NOTE}`}
								</CardDescription>
							</CardHeader>
							<CardContent className="h-[400px]">
								<CacheRateChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
					<TabsContent value="costs" className="space-y-4">
						<Card>
							<CardHeader>
								<CardTitle>Cost Breakdown</CardTitle>
								<CardDescription>
									Estimated costs by provider and model
								</CardDescription>
							</CardHeader>
							<CardContent>
								<CostBreakdownChart
									initialData={apiKeyId ? undefined : initialActivityData}
									projectId={projectId}
									apiKeyId={apiKeyId}
								/>
							</CardContent>
						</Card>
					</TabsContent>
				</Tabs>
			</div>
		</div>
	);
}
