import type { PlanOption } from "./types";

export const plans: PlanOption[] = [
	{
		name: "Lite",
		price: 29,
		usage: 87,
		description: "For occasional coding",
		tier: "lite",
	},
	{
		name: "Pro",
		price: 79,
		usage: 237,
		description: "For daily development",
		tier: "pro",
		popular: true,
	},
	{
		name: "Max",
		price: 179,
		usage: 537,
		description: "For power users",
		tier: "max",
	},
];
