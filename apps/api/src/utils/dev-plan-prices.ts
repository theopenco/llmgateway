import type { DevPlanCycle, DevPlanTier } from "@llmgateway/shared";
import type Stripe from "stripe";

const DEV_PLAN_PRICE_ENV_KEYS: Record<
	DevPlanCycle,
	Record<DevPlanTier, string>
> = {
	monthly: {
		lite: "STRIPE_DEV_PLAN_LITE_PRICE_ID",
		pro: "STRIPE_DEV_PLAN_PRO_PRICE_ID",
		max: "STRIPE_DEV_PLAN_MAX_PRICE_ID",
	},
	annual: {
		lite: "STRIPE_DEV_PLAN_LITE_ANNUAL_PRICE_ID",
		pro: "STRIPE_DEV_PLAN_PRO_ANNUAL_PRICE_ID",
		max: "STRIPE_DEV_PLAN_MAX_ANNUAL_PRICE_ID",
	},
};

export function getDevPlanPriceId(
	tier: DevPlanTier,
	cycle: DevPlanCycle = "monthly",
): string | undefined {
	return process.env[DEV_PLAN_PRICE_ENV_KEYS[cycle][tier]];
}

function getDevPlanTierFromPriceId(priceId: string): DevPlanTier | null {
	for (const cycle of Object.keys(DEV_PLAN_PRICE_ENV_KEYS) as DevPlanCycle[]) {
		for (const tier of Object.keys(
			DEV_PLAN_PRICE_ENV_KEYS[cycle],
		) as DevPlanTier[]) {
			if (process.env[DEV_PLAN_PRICE_ENV_KEYS[cycle][tier]] === priceId) {
				return tier;
			}
		}
	}
	return null;
}

// The tier an invoice actually billed, resolved from its line items' price
// ids. Null when no line carries a known dev plan price (e.g. the price env
// vars are unset, or the invoice predates line pricing data).
export function getDevPlanTierFromInvoice(
	invoice: Stripe.Invoice,
): DevPlanTier | null {
	for (const line of invoice.lines?.data ?? []) {
		const priceId = line.pricing?.price_details?.price;
		if (!priceId) {
			continue;
		}
		const tier = getDevPlanTierFromPriceId(priceId);
		if (tier) {
			return tier;
		}
	}
	return null;
}
