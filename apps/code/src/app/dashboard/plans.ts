import { useMemo } from "react";

import { useAppConfig } from "@/lib/config";

import { DEV_PLAN_PRICES, type DevPlanTier } from "@llmgateway/shared";

import type { PlanOption } from "./types";

export function getPlans(credits: Record<DevPlanTier, number>): PlanOption[] {
	return [
		{
			name: "Lite",
			price: DEV_PLAN_PRICES.lite,
			usage: credits.lite,
			description: "For occasional coding",
			tier: "lite",
		},
		{
			name: "Pro",
			price: DEV_PLAN_PRICES.pro,
			usage: credits.pro,
			description: "For daily development",
			tier: "pro",
			popular: true,
		},
		{
			name: "Max",
			price: DEV_PLAN_PRICES.max,
			usage: credits.max,
			description: "For power users",
			tier: "max",
		},
	];
}

export function usePlans(): PlanOption[] {
	const { devPlanCredits } = useAppConfig();
	return useMemo(() => getPlans(devPlanCredits), [devPlanCredits]);
}
