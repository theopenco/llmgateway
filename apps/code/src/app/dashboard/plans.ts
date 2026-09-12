import { DEV_PLAN_PRICES, getDevPlanCreditsLimit } from "@llmgateway/shared";

import type { PlanOption } from "./types";

export const plans: PlanOption[] = [
	{
		name: "Lite",
		price: DEV_PLAN_PRICES.lite,
		usage: getDevPlanCreditsLimit("lite"),
		description: "For occasional coding",
		tier: "lite",
	},
	{
		name: "Pro",
		price: DEV_PLAN_PRICES.pro,
		usage: getDevPlanCreditsLimit("pro"),
		description: "For daily development",
		tier: "pro",
		popular: true,
	},
	{
		name: "Max",
		price: DEV_PLAN_PRICES.max,
		usage: getDevPlanCreditsLimit("max"),
		description: "For power users",
		tier: "max",
	},
];
