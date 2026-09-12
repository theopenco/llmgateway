"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelChart } from "@/components/cost-by-model-chart";
import { getOrgCostByModel } from "@/lib/admin-history";

import type {
	GlobalStatsModelView,
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

const breakdownNouns: Record<
	OrganizationCostGroupBy,
	{ singular: string; plural: string }
> = {
	model: { singular: "Model", plural: "models" },
	project: { singular: "Project", plural: "projects" },
	"api-key": { singular: "API Key", plural: "API keys" },
	user: { singular: "User", plural: "users" },
};

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

export function OrgCostByModel({ orgId }: { orgId: string }) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const pathname = usePathname();
	const window = parseWindow(searchParams.get("window"));
	const groupBy = parseGroupBy(searchParams.get("breakdown"));
	const modelView = parseModelView(searchParams.get("modelView"));
	const breakdownNoun = breakdownNouns[groupBy];

	const fetchData = useCallback(
		async (
			w: TokenWindow,
			view: GlobalStatsModelView,
			group: OrganizationCostGroupBy,
		) => {
			return await getOrgCostByModel(
				orgId,
				w,
				view === "canonical" ? "canonical" : "mapping",
				group,
			);
		},
		[orgId],
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
		<CostByModelChart
			title={`Cost by ${breakdownNoun.singular}`}
			description={`Top 20 ${breakdownNoun.plural} by cost for this organization`}
			fetchData={fetchData}
			externalWindow={window}
			showModelView
			modelView={modelView}
			onModelViewChange={(view) =>
				updateView({ modelView: view === "canonical" ? view : "mapping" })
			}
			allowedModelViews={["mapping", "canonical"]}
			showGroupBy
			groupBy={groupBy}
			onGroupByChange={(value) => updateView({ groupBy: value })}
		/>
	);
}
