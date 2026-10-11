"use client";

import { keepPreviousData } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { useUsageMode } from "@/components/usage-mode-selector";
import { useApi } from "@/lib/fetch-client";

import {
	OrganizationUsageTimeseries,
	useUsageTimeseriesControls,
} from "@llmgateway/shared/usage-timeseries";

import type {
	ModelView,
	OrganizationCostGroupBy,
	TokenWindow,
} from "@/lib/types";

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

function parseGroupBy(value: string | null): OrganizationCostGroupBy {
	return value === "project" || value === "api-key" || value === "user"
		? value
		: "model";
}

function parseModelView(value: string | null): ModelView {
	return value === "canonical" ? "canonical" : "mapping";
}

export function OrgCostByModelTimeseries({ orgId }: { orgId: string }) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseWindow(searchParams.get("window"));
	const groupBy = parseGroupBy(searchParams.get("breakdown"));
	const modelView = parseModelView(searchParams.get("modelView"));
	const days = {
		"1h": 1 / 24,
		"4h": 4 / 24,
		"12h": 0.5,
		"1d": 1,
		"7d": 7,
		"30d": 30,
		"90d": 90,
		"365d": 365,
	}[window];
	const controls = useUsageTimeseriesControls(days);
	const usageMode = useUsageMode();
	const api = useApi();
	const query = api.useQuery(
		"get",
		"/admin/organizations/{orgId}/cost-by-model-timeseries",
		{
			params: {
				path: { orgId },
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

	const updateView = useCallback(
		(updates: { groupBy?: OrganizationCostGroupBy; modelView?: ModelView }) => {
			const params = new URLSearchParams(searchParams.toString());
			if (updates.groupBy) {
				if (updates.groupBy === "model") {
					params.delete("breakdown");
				} else {
					params.set("breakdown", updates.groupBy);
				}
			}
			if (updates.modelView) {
				if (updates.modelView === "mapping") {
					params.delete("modelView");
				} else {
					params.set("modelView", updates.modelView);
				}
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
			groupBy={groupBy === "api-key" ? "apiKey" : groupBy}
			onGroupByChange={(value) =>
				updateView({ groupBy: value === "apiKey" ? "api-key" : value })
			}
			modelViewControl={
				groupBy === "model" ? (
					<select
						aria-label="Model view"
						className="rounded-md border border-input bg-background px-3 py-1.5 text-xs"
						value={modelView}
						onChange={(event) => {
							controls.setModel("");
							updateView({ modelView: event.target.value as ModelView });
						}}
					>
						<option value="mapping">Mappings</option>
						<option value="canonical">Canonical</option>
					</select>
				) : undefined
			}
		/>
	);
}
