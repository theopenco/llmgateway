"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { ActivityChart } from "@/components/dashboard/activity-chart";
import {
	TimeRangePicker,
	type TimeRangeValue,
} from "@/components/time-range-picker";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";

interface ModelUsageClientProps {
	projectId: string;
}

type GroupBy = "model" | "apiKey";

export function ModelUsageClient({ projectId }: ModelUsageClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl } = useDashboardNavigation();
	const api = useApi();

	// Fetch API keys for the project
	const { data: apiKeysData } = api.useQuery(
		"get",
		"/keys/api",
		{
			params: {
				query: {
					projectId: projectId || "",
				},
			},
		},
		{
			enabled: !!projectId,
		},
	);

	const apiKeys =
		apiKeysData?.apiKeys.filter((key) => key.status !== "deleted") ?? [];

	// Get groupBy, apiKeyId and timeRange from URL
	const groupBy: GroupBy =
		searchParams.get("groupBy") === "apiKey" ? "apiKey" : "model";
	const apiKeyId = searchParams.get("apiKeyId") ?? undefined;
	const timeRange = (searchParams.get("timeRange") as TimeRangeValue) ?? "24h";

	// Function to update apiKeyId in URL
	const updateApiKeyIdInUrl = (newApiKeyId: string | undefined) => {
		const params = new URLSearchParams(searchParams);
		if (newApiKeyId) {
			params.set("apiKeyId", newApiKeyId);
		} else {
			params.delete("apiKeyId");
		}
		router.push(`${buildUrl("model-usage")}?${params.toString()}`);
	};

	// Function to update timeRange in URL
	const updateTimeRange = (newTimeRange: TimeRangeValue) => {
		const params = new URLSearchParams(searchParams);
		params.set("timeRange", newTimeRange);
		// Remove date-range params since timeRange replaces them
		params.delete("from");
		params.delete("to");
		params.delete("days");
		router.push(`${buildUrl("model-usage")}?${params.toString()}`);
	};

	const updateGroupBy = (newGroupBy: GroupBy) => {
		const params = new URLSearchParams(searchParams);
		if (newGroupBy === "apiKey") {
			params.set("groupBy", "apiKey");
			// Clear api key filter when grouping by api key
			params.delete("apiKeyId");
		} else {
			params.delete("groupBy");
		}
		router.push(`${buildUrl("model-usage")}?${params.toString()}`);
	};

	const apiKeyFilterDisabled = groupBy === "apiKey";
	const effectiveApiKeyId = apiKeyFilterDisabled ? undefined : apiKeyId;

	// Normalize stale URLs: groupBy=apiKey should never coexist with apiKeyId
	useEffect(() => {
		if (groupBy === "apiKey" && searchParams.has("apiKeyId")) {
			const params = new URLSearchParams(searchParams);
			params.delete("apiKeyId");
			router.replace(`${buildUrl("model-usage")}?${params.toString()}`);
		}
	}, [groupBy, searchParams, router, buildUrl]);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<h2 className="text-3xl font-bold tracking-tight">
						{groupBy === "apiKey" ? "Usage by API key" : "Usage by model"}
					</h2>
					<div className="flex items-center space-x-2">
						<Select
							value={groupBy}
							onValueChange={(v) => updateGroupBy(v as GroupBy)}
						>
							<SelectTrigger size="sm" className="w-[180px]">
								<SelectValue placeholder="Group by" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="model">Breakdown by model</SelectItem>
								<SelectItem value="apiKey">Breakdown by API key</SelectItem>
							</SelectContent>
						</Select>
						<Select
							value={effectiveApiKeyId ?? "all"}
							disabled={apiKeyFilterDisabled}
							onValueChange={(value) =>
								updateApiKeyIdInUrl(value === "all" ? undefined : value)
							}
						>
							<SelectTrigger size="sm" className="w-[180px]">
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
					</div>
				</div>
				<div className="space-y-4">
					<ActivityChart
						apiKeyId={effectiveApiKeyId}
						timeRange={timeRange}
						groupBy={groupBy}
					/>
				</div>
			</div>
		</div>
	);
}
