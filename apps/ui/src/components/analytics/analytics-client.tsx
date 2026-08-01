"use client";

import { format, subDays } from "date-fns";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import {
	AnalyticsDateRange,
	getAnalyticsRange,
} from "@/components/analytics/analytics-date-range";
import { CostByModelCard } from "@/components/analytics/cost-by-model-card";
import { CostByModelOverTimeCard } from "@/components/analytics/cost-by-model-over-time-card";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";
import { useApi } from "@/lib/fetch-client";
import { getBrowserTimeZone } from "@/lib/timezone";

import type { ActivityRow } from "@/components/analytics/chart-helpers";

interface AnalyticsClientProps {
	projectId: string | undefined;
}

export function AnalyticsClient({ projectId }: AnalyticsClientProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const { buildUrl, selectedOrganization } = useDashboardNavigation();
	const api = useApi();
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
			router.replace(`${buildUrl("analytics")}?${params.toString()}`);
		}
	}, [searchParams, router, buildUrl, isEnterprise]);

	const { fromStr, toStr } = getAnalyticsRange(
		isEnterprise,
		searchParams.get("from"),
		searchParams.get("to"),
	);

	const { data, isLoading } = api.useQuery(
		"get",
		"/activity",
		{
			params: {
				query: {
					from: fromStr,
					to: toStr,
					timezone: getBrowserTimeZone(),
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

	const activity = (data?.activity ?? []) as ActivityRow[];

	return (
		<div className="flex flex-col">
			<div className="flex-1 space-y-4 p-4 pt-6 md:p-8">
				<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
					<div>
						<h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
						<p className="text-muted-foreground">
							Cost and usage broken down by model for this project
						</p>
					</div>
					<AnalyticsDateRange
						isEnterprise={isEnterprise}
						buildUrl={buildUrl}
						path="analytics"
					/>
				</div>

				<CostByModelOverTimeCard activity={activity} loading={isLoading} />
				<CostByModelCard activity={activity} loading={isLoading} />
			</div>
		</div>
	);
}
