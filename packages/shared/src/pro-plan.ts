// Pro plan pricing. The Pro plan has no feature differences from Free — it
// raises the team-seat and API-key limits and unlocks paid add-ons. All
// billing is monthly, per seat.
export const PRO_PLAN_PRICES = {
	// USD per seat per month. Every seat includes one API key.
	seat: 25,
	// USD per month for each API key beyond the number of seats.
	extraApiKey: 5,
	// USD per month for the SSO & SCIM add-on (flat, org-wide).
	sso: 300,
} as const;

// Seats purchasable self-serve. Larger teams go through enterprise sales.
export const PRO_PLAN_MAX_SEATS = 500;

// Upper bound on billable extra API keys, purely a sanity cap for the
// self-serve form (matches the enterprise-plan API-key ceiling).
export const PRO_PLAN_MAX_EXTRA_API_KEYS = 500;

export interface ProPlanSelection {
	seats: number;
	extraApiKeys: number;
	ssoAddon: boolean;
}

// Monthly USD total for a Pro configuration. Prices are whole dollars, so
// plain integer arithmetic is exact here.
export function getProPlanMonthlyTotal(selection: ProPlanSelection): number {
	const seatCost = selection.seats * PRO_PLAN_PRICES.seat;
	const extraKeyCost = selection.extraApiKeys * PRO_PLAN_PRICES.extraApiKey;
	const ssoCost = selection.ssoAddon ? PRO_PLAN_PRICES.sso : 0;
	return seatCost + extraKeyCost + ssoCost;
}
