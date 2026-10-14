"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { Coins, Zap, Hash } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import {
	AnalyticsDateRange,
	getAnalyticsRange,
} from "@/components/analytics/analytics-date-range";
import { currencyFormatter } from "@/components/analytics/chart-helpers";
import {
	useChartStyle,
	ChartStyleSelector,
} from "@/components/analytics/chart-style";
import { DimensionUsageCard } from "@/components/analytics/dimension-usage-card";
import { RoutingSavingsCard } from "@/components/analytics/routing-savings-card";
import { EnterpriseFeatureCard } from "@/components/contact-sales";
import {
	UsageModeSelector,
	useUsageMode,
} from "@/components/shared/usage-mode-selector";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useTeamMembers } from "@/hooks/useTeam";
import { useUser } from "@/hooks/useUser";
import { useZonedRangeDefaults } from "@/hooks/useZonedRangeDefaults";
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
import { useApi } from "@/lib/fetch-client";
import { applyUsageMode } from "@/lib/usage-mode";

import { formatNumber } from "@llmgateway/shared/number-format";
import {
	OrganizationUsageTimeseries,
	useUsageTimeseriesControls,
} from "@llmgateway/shared/usage-timeseries";

import type { DimensionRow } from "@/components/analytics/chart-helpers";
import type { Route } from "next";

type GroupBy = "model" | "project" | "apiKey" | "user";

interface OrgActivityRow extends DimensionRow {
	cost: number;
	requestCount: number;
	totalTokens: number;
	creditsRequestCount: number;
	apiKeysRequestCount: number;
	creditsCost: number;
	apiKeysCost: number;
}

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
	{ value: "model", label: "Breakdown by model" },
	{ value: "project", label: "Breakdown by project" },
	{ value: "apiKey", label: "Breakdown by API key" },
	{ value: "user", label: "Breakdown by user" },
];

const COPY: Record<GroupBy, { noun: string; overTime: string; top: string }> = {
	model: {
		noun: "model",
		overTime: "Spend across your top models over the selected window",
		top: "Top models by cost across every project",
	},
	project: {
		noun: "project",
		overTime: "Spend across your top projects over the selected window",
		top: "Top projects by cost across the organization",
	},
	apiKey: {
		noun: "API key",
		overTime: "Spend across your top API keys over the selected window",
		top: "Top API keys by cost across every project",
	},
	user: {
		noun: "user",
		overTime: "Spend across your top users over the selected window",
		top: "Top users by cost, attributed to the member who created each API key",
	},
};

function EnterpriseUpgradeCard() {
	return (
		<EnterpriseFeatureCard description="Organization-wide analytics are available on the Enterprise plan">
			Roll cost, tokens, and requests up across every project in your
			organization, and break the spend down by model, project, or API key over
			any time period.
		</EnterpriseFeatureCard>
	);
}

function SummaryStat({
	label,
	value,
	icon: Icon,
}: {
	label: string;
	value: string;
	icon: typeof Coins;
}) {
	return (
		<Card>
			<CardContent className="flex items-center gap-3 p-4">
				<div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-md">
					<Icon className="h-5 w-5" />
				</div>
				<div className="min-w-0">
					<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
						{label}
					</p>
					<p className="truncate text-2xl font-semibold tabular-nums">
						{value}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

export function OrgAnalyticsClient() {
	const params = useParams();
	const organizationId = params.orgId as string;
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildOrgUrl, selectedOrganization } = useDashboardNavigation();
	const api = useApi();
	const {
		from: defaultFrom,
		to: defaultTo,
		timeZone: displayTimeZone,
		markGenerated,
		shouldApplyDefaults,
	} = useZonedRangeDefaults();
	const { user } = useUser();
	const { data: teamData } = useTeamMembers(organizationId);

	const isEnterprise = selectedOrganization?.enterpriseAccess === true;
	const currentUserRole = teamData?.members.find(
		(member) => member.userId === user?.id,
	)?.role;
	const isAdmin = currentUserRole === "owner" || currentUserRole === "admin";
	// Distinguish "membership still loading" from "not an admin" so we don't flash
	// the denial card before team membership resolves.
	const membershipLoading = isEnterprise && (!teamData || !user);

	const groupBy: GroupBy = (() => {
		const value = searchParams.get("groupBy");
		return value === "project" || value === "apiKey" || value === "user"
			? value
			: "model";
	})();

	useEffect(() => {
		if (!isEnterprise) {
			return;
		}
		if (!shouldApplyDefaults(searchParams)) {
			return;
		}
		const next = new URLSearchParams(searchParams.toString());
		next.delete("days");
		next.set("from", defaultFrom);
		next.set("to", defaultTo);
		markGenerated(next);
		router.replace(
			`${buildOrgUrl("org/analytics")}?${next.toString()}` as Route,
		);
	}, [
		searchParams,
		router,
		buildOrgUrl,
		isEnterprise,
		defaultFrom,
		defaultTo,
		markGenerated,
		shouldApplyDefaults,
	]);

	const updateGroupBy = (next: GroupBy) => {
		const nextParams = new URLSearchParams(searchParams.toString());
		if (next === "model") {
			nextParams.delete("groupBy");
		} else {
			nextParams.set("groupBy", next);
		}
		router.push(
			`${buildOrgUrl("org/analytics")}?${nextParams.toString()}` as Route,
		);
	};

	const { fromStr, toStr } = getAnalyticsRange(
		isEnterprise,
		searchParams.get("from"),
		searchParams.get("to"),
		displayTimeZone,
	);

	const { data, isLoading } = api.useQuery(
		"get",
		"/analytics/activity",
		{
			params: {
				query: {
					organizationId,
					from: fromStr,
					to: toStr,
					groupBy,
					timezone: displayTimeZone,
				},
			},
		},
		{
			enabled: !!organizationId && isEnterprise && isAdmin,
			refetchOnWindowFocus: false,
			staleTime: 1000 * 60 * 5,
		},
	);

	const usageMode = useUsageMode();
	const rangeDays =
		Math.round((Date.parse(toStr) - Date.parse(fromStr)) / 86_400_000) + 1;
	const timeseriesControls = useUsageTimeseriesControls(rangeDays);
	const { style: chartStyle } = useChartStyle();
	const timeseries = api.useQuery(
		"get",
		"/analytics/activity",
		{
			params: {
				query: {
					organizationId,
					from: fromStr,
					to: toStr,
					groupBy,
					timezone: displayTimeZone,
					...timeseriesControls.query,
					mode: usageMode,
				},
			},
		},
		{
			enabled: !!organizationId && isEnterprise && isAdmin,
			placeholderData: keepPreviousData,
		},
	);

	const routingSavings = api.useQuery(
		"get",
		"/analytics/routing-savings",
		{
			params: {
				query: {
					organizationId,
					from: fromStr,
					to: toStr,
					timezone: displayTimeZone,
				},
			},
		},
		{
			enabled: !!organizationId && isEnterprise && isAdmin,
			refetchOnWindowFocus: false,
			staleTime: 1000 * 60 * 5,
		},
	);

	const rows = ((data?.activity ?? []) as OrgActivityRow[]).map((row) => ({
		...applyUsageMode(row, usageMode),
		breakdown: row.breakdown.map((entry) => applyUsageMode(entry, usageMode)),
	}));

	const totals = rows.reduce(
		(acc, row) => {
			acc.cost += row.cost;
			acc.requestCount += row.requestCount;
			acc.totalTokens += row.totalTokens;
			return acc;
		},
		{ cost: 0, requestCount: 0, totalTokens: 0 },
	);

	const copy = COPY[groupBy];

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">
							Organization analytics
						</h2>
						<p className="text-muted-foreground">
							Cost and usage across every project in your organization
						</p>
					</div>
					{isEnterprise && isAdmin && (
						<div className="flex flex-wrap items-center gap-x-3 gap-y-2">
							<AnalyticsDateRange
								isEnterprise={isEnterprise}
								buildUrl={buildOrgUrl}
								path="org/analytics"
							/>
							<UsageModeSelector />
						</div>
					)}
				</div>

				{!isEnterprise ? (
					<EnterpriseUpgradeCard />
				) : membershipLoading ? (
					<div className="text-muted-foreground py-10 text-center text-sm">
						Loading…
					</div>
				) : !isAdmin ? (
					<Card className="max-w-2xl">
						<CardHeader>
							<CardTitle>Admins only</CardTitle>
							<CardDescription>
								Only organization owners and admins can view organization
								analytics.
							</CardDescription>
						</CardHeader>
					</Card>
				) : (
					<>
						<div className="grid gap-4 sm:grid-cols-3">
							<SummaryStat
								label="Total spend"
								value={currencyFormatter.format(totals.cost)}
								icon={Coins}
							/>
							<SummaryStat
								label="Requests"
								value={formatNumber(totals.requestCount)}
								icon={Zap}
							/>
							<SummaryStat
								label="Tokens"
								value={formatNumber(totals.totalTokens)}
								icon={Hash}
							/>
						</div>

						<div className="flex justify-end">
							<Select
								value={groupBy}
								onValueChange={(v) => updateGroupBy(v as GroupBy)}
							>
								<SelectTrigger size="sm" className="w-full sm:w-[200px]">
									<SelectValue placeholder="Group by" />
								</SelectTrigger>
								<SelectContent>
									{GROUP_BY_OPTIONS.map((option) => (
										<SelectItem key={option.value} value={option.value}>
											{option.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<OrganizationUsageTimeseries
							data={timeseries.data?.timeseries}
							loading={timeseries.isFetching}
							error={timeseries.isError}
							retry={() => {
								void timeseries.refetch();
							}}
							controls={timeseriesControls}
							groupBy={groupBy}
							timeZone={displayTimeZone}
							mode={usageMode}
							lineStyle={chartStyle !== "bar"}
							modelViewControl={
								timeseriesControls.metric !== "cacheRate" ? (
									<ChartStyleSelector />
								) : undefined
							}
						/>
						<DimensionUsageCard
							rows={rows}
							loading={isLoading}
							title={`Cost by ${copy.noun}`}
							description={copy.top}
						/>
						<RoutingSavingsCard
							data={routingSavings.data}
							loading={routingSavings.isLoading}
							showProject
						/>
					</>
				)}
			</div>
		</div>
	);
}
