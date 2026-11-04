"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelTimeseriesChart } from "@/components/cost-by-model-timeseries-chart";
import { useUsageMode } from "@/components/usage-mode-selector";
import { useApi } from "@/lib/fetch-client";
import { useHistoryClient } from "@/lib/history-client";

import {
	OrganizationUsageTimeseries,
	useUsageTimeseriesControls,
} from "@llmgateway/shared/usage-timeseries";

import type {
	CostTimeseriesBucket,
	CostTimeseriesGroupBy,
	ModelView,
	ProjectCostTimeseriesGroupBy,
	TokenWindow,
} from "@/lib/types";

const windowDays: Record<TokenWindow, number> = {
	"1h": 1 / 24,
	"4h": 4 / 24,
	"12h": 0.5,
	"1d": 1,
	"7d": 7,
	"30d": 30,
	"90d": 90,
	"365d": 365,
};

const breakdownOptions: {
	value: ProjectCostTimeseriesGroupBy;
	label: string;
}[] = [
	{ value: "model", label: "Model" },
	{ value: "api-key", label: "API Key" },
	{ value: "user", label: "User" },
	{ value: "source", label: "Source" },
];

const controlClass =
	"rounded-md border border-input bg-background px-3 py-1.5 text-xs";

const validWindows = new Set<TokenWindow>([
	"1h",
	"4h",
	"12h",
	"1d",
	"7d",
	"30d",
	"90d",
	"365d",
]);

function parseWindow(value: string | null): TokenWindow {
	if (value && validWindows.has(value as TokenWindow)) {
		return value as TokenWindow;
	}
	return "1d";
}

function parseGroupBy(value: string | null): ProjectCostTimeseriesGroupBy {
	return value === "source" || value === "api-key" || value === "user"
		? value
		: "model";
}

function parseModelView(value: string | null): ModelView {
	return value === "canonical" ? "canonical" : "mapping";
}

interface ProjectTimeseriesProps {
	orgId: string;
	projectId: string;
	window: TokenWindow;
	groupBy: ProjectCostTimeseriesGroupBy;
	onGroupByChange: (next: ProjectCostTimeseriesGroupBy) => void;
}

export function ProjectCostByModelTimeseries({
	orgId,
	projectId,
}: {
	orgId: string;
	projectId: string;
}) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();

	const window = parseWindow(searchParams.get("window"));
	const groupBy = parseGroupBy(searchParams.get("breakdown"));

	const handleGroupByChange = useCallback(
		(next: ProjectCostTimeseriesGroupBy) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next === "model") {
				params.delete("breakdown");
			} else {
				params.set("breakdown", next);
			}
			const query = params.toString();
			router.push(query ? `${pathname}?${query}` : pathname);
		},
		[searchParams, router, pathname],
	);

	const props = {
		orgId,
		projectId,
		window,
		groupBy,
		onGroupByChange: handleGroupByChange,
	};

	// Source rollups carry no model or API key dimension, so they keep the
	// cost/requests/tokens chart instead of the filterable usage chart.
	return groupBy === "source" ? (
		<ProjectSourceTimeseries {...props} />
	) : (
		<ProjectUsageTimeseries {...props} />
	);
}

function ProjectUsageTimeseries({
	orgId,
	projectId,
	window,
	groupBy,
	onGroupByChange,
}: ProjectTimeseriesProps) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const modelView = parseModelView(searchParams.get("modelView"));
	const controls = useUsageTimeseriesControls(windowDays[window]);
	const usageMode = useUsageMode();
	const api = useApi();
	const query = api.useQuery(
		"get",
		"/admin/organizations/{orgId}/projects/{projectId}/cost-by-model-timeseries",
		{
			params: {
				path: { orgId, projectId },
				query: {
					window,
					modelView,
					groupBy,
					...controls.query,
					mode: usageMode,
				},
			},
		},
		{ placeholderData: keepPreviousData },
	);

	const updateModelView = useCallback(
		(next: ModelView) => {
			const params = new URLSearchParams(searchParams.toString());
			if (next === "mapping") {
				params.delete("modelView");
			} else {
				params.set("modelView", next);
			}
			const query = params.toString();
			router.push(query ? `${pathname}?${query}` : pathname);
		},
		[pathname, router, searchParams],
	);

	return (
		<OrganizationUsageTimeseries
			data={query.data?.timeseries}
			loading={query.isFetching}
			error={query.isError}
			retry={() => {
				void query.refetch();
			}}
			controls={controls}
			mode={usageMode}
			groupBy={
				groupBy === "api-key" ? "apiKey" : groupBy === "user" ? "user" : "model"
			}
			modelViewControl={
				<>
					<select
						aria-label="Break down by"
						className={controlClass}
						value={groupBy}
						onChange={(event) =>
							onGroupByChange(
								event.target.value as ProjectCostTimeseriesGroupBy,
							)
						}
					>
						{breakdownOptions.map((option) => (
							<option key={option.value} value={option.value}>
								{option.label}
							</option>
						))}
					</select>
					{groupBy === "model" && (
						<select
							aria-label="Model view"
							className={controlClass}
							value={modelView}
							onChange={(event) => {
								controls.setModel("");
								updateModelView(event.target.value as ModelView);
							}}
						>
							<option value="mapping">Mappings</option>
							<option value="canonical">Canonical</option>
						</select>
					)}
				</>
			}
		/>
	);
}

function ProjectSourceTimeseries({
	orgId,
	projectId,
	window,
	groupBy,
	onGroupByChange,
}: ProjectTimeseriesProps) {
	const history = useHistoryClient();

	const fetchData = useCallback(
		async (
			w: TokenWindow,
			modelView: ModelView,
			g: CostTimeseriesGroupBy,
			bucket: CostTimeseriesBucket | undefined,
		) => {
			return await history.projectCostByModelTimeseries(
				orgId,
				projectId,
				w,
				modelView,
				g === "source" ? "source" : "model",
				bucket,
			);
		},
		[history, orgId, projectId],
	);

	return (
		<CostByModelTimeseriesChart
			title="Cost by Source Over Time"
			description="Stacked breakdown of top 10 sources for this project"
			fetchData={fetchData}
			externalWindow={window}
			groupBy={groupBy}
			onGroupByChange={(value) =>
				onGroupByChange(value === "source" ? "source" : "model")
			}
			groupByOptions={["model", "source"]}
		/>
	);
}
