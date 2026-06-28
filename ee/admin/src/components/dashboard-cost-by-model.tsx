"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

import { CostByModelChart } from "@/components/cost-by-model-chart";
import { getGlobalCostByModel } from "@/lib/admin-history";

import type { GlobalStatsModelView } from "@/lib/types";

const VALID_MODEL_VIEWS: GlobalStatsModelView[] = [
	"mapping",
	"canonical",
	"provider",
];

function parseModelView(value: string | null): GlobalStatsModelView {
	return VALID_MODEL_VIEWS.includes(value as GlobalStatsModelView)
		? (value as GlobalStatsModelView)
		: "mapping";
}

export function DashboardCostByModel({
	from,
	to,
}: {
	from?: string;
	to?: string;
}) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const modelView = parseModelView(searchParams.get("modelView"));

	const setModelView = useCallback(
		(value: GlobalStatsModelView) => {
			const params = new URLSearchParams(searchParams.toString());
			params.set("modelView", value);
			router.replace(`${pathname}?${params.toString()}`, { scroll: false });
		},
		[router, pathname, searchParams],
	);

	const fetchDataRange = useCallback(
		async (
			rangeFrom: string | undefined,
			rangeTo: string | undefined,
			view: GlobalStatsModelView,
		) => {
			return await getGlobalCostByModel(rangeFrom, rangeTo, view);
		},
		[],
	);

	return (
		<CostByModelChart
			title="Cost by Model"
			description="Top 20 by cost across all organizations"
			fetchDataRange={fetchDataRange}
			forceRange
			showModelView
			modelView={modelView}
			onModelViewChange={setModelView}
			from={from}
			to={to}
		/>
	);
}
