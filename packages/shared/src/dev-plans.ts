export const DEV_PLAN_PRICES = {
	lite: 29,
	pro: 79,
	max: 179,
} as const;

export type DevPlanTier = keyof typeof DEV_PLAN_PRICES;

export function getDevPlanCreditsLimit(tier: DevPlanTier): number {
	const multiplier = parseFloat(process.env.DEV_PLAN_CREDITS_MULTIPLIER || "3");
	return DEV_PLAN_PRICES[tier] * multiplier;
}
