"use client";

import { useRouter, useSearchParams } from "next/navigation";

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

	// Get apiKeyId and timeRange from URL
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

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<h2 className="text-3xl font-bold tracking-tight">Usage by model</h2>
					<div className="flex items-center space-x-2">
						<Select
							value={apiKeyId ?? "all"}
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
					<ActivityChart apiKeyId={apiKeyId} timeRange={timeRange} />
				</div>
			</div>
		</div>
	);
}
