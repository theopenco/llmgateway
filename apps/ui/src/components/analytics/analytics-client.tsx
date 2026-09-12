"use client";

import { Coins, Hash, Layers } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo } from "react";

import {
	AnalyticsDateRange,
	getAnalyticsRange,
} from "@/components/analytics/analytics-date-range";
import {
	currencyFormatter,
	toDimensionRows,
	UNATTRIBUTED_NOTE,
} from "@/components/analytics/chart-helpers";
import { CostByModelCard } from "@/components/analytics/cost-by-model-card";
import { CostByModelOverTimeCard } from "@/components/analytics/cost-by-model-over-time-card";
import { DimensionUsageCard } from "@/components/analytics/dimension-usage-card";
import { DimensionUsageOverTimeCard } from "@/components/analytics/dimension-usage-over-time-card";
import { MetricCard } from "@/components/dashboard/metric-card";
import {
	UsageModeSelector,
	useUsageMode,
} from "@/components/shared/usage-mode-selector";
import {
	parseGroupBy,
	resolveGroupBy,
	type GroupBy,
} from "@/components/usage/group-by";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { useZonedRangeDefaults } from "@/hooks/useZonedRangeDefaults";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/lib/components/select";
import { useApi } from "@/lib/fetch-client";
import { applyUsageModeToDaily } from "@/lib/usage-mode";

import type { DailyActivity } from "@/types/activity";

interface AnalyticsClientProps {
	projectId: string | undefined;
}

const COPY: Record<
	GroupBy,
	{ option: string; overTime: string; ranked: string; description: string }
> = {
	model: {
		option: "Breakdown by model",
		overTime: "Cost by model over time",
		ranked: "Cost by model",
		description: "Cost and usage broken down by model for this project",
	},
	apiKey: {
		option: "Breakdown by API key",
		overTime: "Cost by API key over time",
		ranked: "Cost by API key",
		description: "Cost and usage broken down by API key for this project",
	},
	user: {
		option: "Breakdown by user",
		overTime: "Cost by user over time",
		ranked: "Cost by user",
		description: UNATTRIBUTED_NOTE,
	},
};

const compactNumber = new Intl.NumberFormat("en-US", { notation: "compact" });

export function AnalyticsClient({ projectId }: AnalyticsClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl, orgId, selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const {
		from: defaultFrom,
		to: defaultTo,
		timeZone: displayTimeZone,
		markGenerated,
		shouldApplyDefaults,
	} = useZonedRangeDefaults();
	const { user } = useUser();
	const isEnterprise = selectedOrganization?.enterpriseAccess === true;

	// The per-member breakdown exposes every member's spend, so it carries the
	// same entitlement as the API gate: enterprise, and an org owner/admin. This
	// only hides the option — the API enforces it independently.
	const { data: teamData } = useTeamMembers(orgId, undefined, {
		enabled: isEnterprise,
	});
	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const canGroupByUser =
		isEnterprise &&
		(currentUserRole === "owner" || currentUserRole === "admin");

	const groupBy = resolveGroupBy(
		parseGroupBy(searchParams.get("groupBy")),
		canGroupByUser,
	);

	useEffect(() => {
		if (!isEnterprise) {
			return;
		}
		if (!shouldApplyDefaults(searchParams)) {
			return;
		}
		const params = new URLSearchParams(searchParams.toString());
		params.delete("days");
		params.set("from", defaultFrom);
		params.set("to", defaultTo);
		markGenerated(params);
		router.replace(`${buildUrl("analytics")}?${params.toString()}`);
	}, [
		searchParams,
		router,
		buildUrl,
		isEnterprise,
		defaultFrom,
		defaultTo,
		markGenerated,
		shouldApplyDefaults,
	]);

	const updateGroupBy = (newGroupBy: GroupBy) => {
		const params = new URLSearchParams(searchParams);
		if (newGroupBy === "model") {
			params.delete("groupBy");
		} else {
			params.set("groupBy", newGroupBy);
		}
		router.push(`${buildUrl("analytics")}?${params.toString()}`);
	};

	const { fromStr, toStr } = getAnalyticsRange(
		isEnterprise,
		searchParams.get("from"),
		searchParams.get("to"),
		displayTimeZone,
	);

	const { data, isLoading } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: fromStr,
					to: toStr,
					timezone: displayTimeZone,
					groupBy,
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

	const usageMode = useUsageMode();
	const activity: DailyActivity[] = useMemo(
		() =>
			(data?.activity ?? []).map((day) =>
				applyUsageModeToDaily(day, usageMode),
			),
		[data, usageMode],
	);

	const rows = useMemo(
		() => toDimensionRows(activity, groupBy),
		[activity, groupBy],
	);

	// Totals come from the same rows the charts read, so the header and the
	// breakdown can never disagree.
	const totals = useMemo(
		() =>
			activity.reduce(
				(acc, day) => ({
					cost: acc.cost + day.cost,
					requestCount: acc.requestCount + day.requestCount,
					totalTokens: acc.totalTokens + day.totalTokens,
				}),
				{ cost: 0, requestCount: 0, totalTokens: 0 },
			),
		[activity],
	);

	const copy = COPY[groupBy];
	const dimensionNoun = groupBy === "apiKey" ? "API key" : groupBy;

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
						<p className="text-muted-foreground">{copy.description}</p>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
						<Select
							value={groupBy}
							onValueChange={(v) => updateGroupBy(v as GroupBy)}
						>
							<SelectTrigger size="sm" className="w-full sm:w-[180px]">
								<SelectValue placeholder="Group by" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="model">{COPY.model.option}</SelectItem>
								<SelectItem value="apiKey">{COPY.apiKey.option}</SelectItem>
								{canGroupByUser && (
									<SelectItem value="user">{COPY.user.option}</SelectItem>
								)}
							</SelectContent>
						</Select>
						<AnalyticsDateRange
							isEnterprise={isEnterprise}
							buildUrl={buildUrl}
							path="analytics"
						/>
						<UsageModeSelector />
					</div>
				</div>

				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
					<MetricCard
						label="Total cost"
						value={currencyFormatter.format(totals.cost)}
						accent="green"
						icon={<Coins className="h-4 w-4" />}
						trend={activity.map((day) => day.cost)}
						isLoading={isLoading}
					/>
					<MetricCard
						label="Requests"
						value={compactNumber.format(totals.requestCount)}
						accent="blue"
						icon={<Hash className="h-4 w-4" />}
						trend={activity.map((day) => day.requestCount)}
						isLoading={isLoading}
					/>
					<MetricCard
						label="Tokens"
						value={compactNumber.format(totals.totalTokens)}
						accent="purple"
						icon={<Layers className="h-4 w-4" />}
						trend={activity.map((day) => day.totalTokens)}
						isLoading={isLoading}
					/>
				</div>

				{/* The model dimension keeps its dedicated cards: they carry the
				    Mappings/Canonical toggle, which is model-specific and has no
				    equivalent for api keys or users. */}
				{groupBy === "model" ? (
					<>
						<CostByModelOverTimeCard activity={activity} loading={isLoading} />
						<CostByModelCard activity={activity} loading={isLoading} />
					</>
				) : (
					<>
						<DimensionUsageOverTimeCard
							rows={rows}
							loading={isLoading}
							title={copy.overTime}
							description={`Stacked ${dimensionNoun} spend across the selected range`}
						/>
						<DimensionUsageCard
							rows={rows}
							loading={isLoading}
							title={copy.ranked}
							description={`Ranked ${dimensionNoun} totals across the selected range`}
						/>
					</>
				)}
			</div>
		</div>
	);
}
