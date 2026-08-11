import type Stripe from "stripe";

export const PRO_BREAKDOWN_COMPONENTS = [
	"seats",
	"extraApiKeys",
	"sso",
	"scim",
] as const;

export type ProBreakdownComponent = (typeof PRO_BREAKDOWN_COMPONENTS)[number];

// Derive the purchased Pro quantities from a subscription's line items by
// matching the configured Stripe price IDs. Returns null when the
// subscription has no seat line item (legacy flat-fee Pro subscriptions), in
// which case the historical plan-default limits continue to apply.
export function extractProQuantities(subscription: Stripe.Subscription): {
	proSeats: number;
	proExtraApiKeys: number;
	proSsoEnabled: boolean;
	proScimEnabled: boolean;
} | null {
	const seatPriceId = process.env.STRIPE_PRO_SEAT_PRICE_ID;
	if (!seatPriceId) {
		return null;
	}
	const items = subscription.items.data;
	const seatItem = items.find((item) => item.price.id === seatPriceId);
	if (!seatItem) {
		return null;
	}
	const extraItem = items.find(
		(item) => item.price.id === process.env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID,
	);
	const ssoItem = items.find(
		(item) => item.price.id === process.env.STRIPE_PRO_SSO_PRICE_ID,
	);
	const scimItem = items.find(
		(item) => item.price.id === process.env.STRIPE_PRO_SCIM_PRICE_ID,
	);
	return {
		proSeats: seatItem.quantity ?? 1,
		proExtraApiKeys: extraItem?.quantity ?? 0,
		proSsoEnabled: !!ssoItem,
		proScimEnabled: !!scimItem,
	};
}

// Per-component USD amounts of a Pro subscription invoice, derived from its
// line items by matching the configured Stripe price IDs. Line amounts are in
// cents and can be negative (proration credits on mid-cycle changes); each
// component sums every matching line so an update invoice's credit+charge
// pair nets out correctly. Returns null when no line matches a Pro price
// (legacy flat-fee subscriptions, or unconfigured price IDs) so those rows
// keep a null breakdown instead of an all-zero one.
export function extractProInvoiceBreakdown(
	invoice: Stripe.Invoice,
): Record<ProBreakdownComponent, string> | null {
	const priceToComponent = new Map<string, ProBreakdownComponent>();
	const priceEnvByComponent: Record<ProBreakdownComponent, string | undefined> =
		{
			seats: process.env.STRIPE_PRO_SEAT_PRICE_ID,
			extraApiKeys: process.env.STRIPE_PRO_EXTRA_API_KEY_PRICE_ID,
			sso: process.env.STRIPE_PRO_SSO_PRICE_ID,
			scim: process.env.STRIPE_PRO_SCIM_PRICE_ID,
		};
	for (const component of PRO_BREAKDOWN_COMPONENTS) {
		const priceId = priceEnvByComponent[component];
		if (priceId) {
			priceToComponent.set(priceId, component);
		}
	}
	if (priceToComponent.size === 0) {
		return null;
	}

	const cents: Record<ProBreakdownComponent, number> = {
		seats: 0,
		extraApiKeys: 0,
		sso: 0,
		scim: 0,
	};
	let matchedAny = false;
	for (const line of invoice.lines?.data ?? []) {
		const priceId = line.pricing?.price_details?.price;
		const component = priceId ? priceToComponent.get(priceId) : undefined;
		if (component) {
			cents[component] += line.amount;
			matchedAny = true;
		}
	}
	if (!matchedAny) {
		return null;
	}

	return {
		seats: (cents.seats / 100).toFixed(2),
		extraApiKeys: (cents.extraApiKeys / 100).toFixed(2),
		sso: (cents.sso / 100).toFixed(2),
		scim: (cents.scim / 100).toFixed(2),
	};
}
