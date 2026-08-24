"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { ActivityChart } from "@/components/dashboard/activity-chart";
import { UsageModeSelector } from "@/components/shared/usage-mode-selector";
import {
	TimeRangePicker,
	type TimeRangeValue,
} from "@/components/time-range-picker";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";

import {
	parseGroupBy,
	resolveGroupBy,
	shouldStripApiKeyId,
	type GroupBy,
} from "./group-by";

interface ModelUsageClientProps {
	projectId: string;
}

const GROUP_BY_LABELS: Record<GroupBy, { option: string; heading: string }> = {
	model: { option: "Breakdown by model", heading: "Usage by model" },
	apiKey: { option: "Breakdown by API key", heading: "Usage by API key" },
	user: { option: "Breakdown by user", heading: "Usage by user" },
};

export function ModelUsageClient({ projectId }: ModelUsageClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl, orgId, selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const { user } = useUser();

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

	// The per-member breakdown exposes every member's spend, so it carries the
	// same entitlement as the organization-wide member analytics. This only hides
	// the option — the API enforces it independently.
	const isEnterprise = selectedOrganization?.enterpriseAccess === true;
	const { data: teamData } = useTeamMembers(orgId, undefined, {
		enabled: isEnterprise,
	});
	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const canGroupByUser =
		isEnterprise &&
		(currentUserRole === "owner" || currentUserRole === "admin");

	// Get groupBy, apiKeyId and timeRange from URL.
	const groupBy = resolveGroupBy(
		parseGroupBy(searchParams.get("groupBy")),
		canGroupByUser,
	);
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
		if (newGroupBy === "model") {
			params.delete("groupBy");
		} else {
			params.set("groupBy", newGroupBy);
			// Clear api key filter when grouping by another dimension
			params.delete("apiKeyId");
		}
		router.push(`${buildUrl("model-usage")}?${params.toString()}`);
	};

	const apiKeyFilterDisabled = groupBy !== "model";
	const effectiveApiKeyId = apiKeyFilterDisabled ? undefined : apiKeyId;

	// Normalize stale URLs: a non-model groupBy should never coexist with apiKeyId.
	useEffect(() => {
		if (!shouldStripApiKeyId(groupBy, searchParams.has("apiKeyId"))) {
			return;
		}
		const params = new URLSearchParams(searchParams);
		params.delete("apiKeyId");
		router.replace(`${buildUrl("model-usage")}?${params.toString()}`);
	}, [groupBy, searchParams, router, buildUrl]);

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<h2 className="text-3xl font-bold tracking-tight">
						{GROUP_BY_LABELS[groupBy].heading}
					</h2>
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
						<Select
							value={groupBy}
							onValueChange={(v) => updateGroupBy(v as GroupBy)}
						>
							<SelectTrigger size="sm" className="w-full sm:w-[180px]">
								<SelectValue placeholder="Group by" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="model">
									{GROUP_BY_LABELS.model.option}
								</SelectItem>
								<SelectItem value="apiKey">
									{GROUP_BY_LABELS.apiKey.option}
								</SelectItem>
								{canGroupByUser && (
									<SelectItem value="user">
										{GROUP_BY_LABELS.user.option}
									</SelectItem>
								)}
							</SelectContent>
						</Select>
						<Select
							value={effectiveApiKeyId ?? "all"}
							disabled={apiKeyFilterDisabled}
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
