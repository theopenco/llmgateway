import type Stripe from "stripe";

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
