import { voidOpenSubscriptionInvoices } from "@/lib/pending-renewal.js";
import { getStripe } from "@/routes/payments.js";

import { logger } from "@llmgateway/logger";

import type Stripe from "stripe";

const UNPAID_STATUSES: Stripe.Subscription.Status[] = ["past_due", "unpaid"];

// Customer-initiated plan cancellation. `cancel_at_period_end` leaves an
// unpaid renewal invoice on Stripe's retry schedule until the period ends, so a
// customer whose renewal already failed keeps seeing charge attempts after
// cancelling. Their allowance is frozen for that cycle anyway, so end such a
// subscription now and void the invoice instead of deferring the cancel.
export async function cancelPlanSubscription(
	subscriptionId: string,
): Promise<{ immediate: boolean }> {
	const stripe = getStripe();
	const subscription = await stripe.subscriptions.retrieve(subscriptionId);

	if (!UNPAID_STATUSES.includes(subscription.status)) {
		await stripe.subscriptions.update(subscriptionId, {
			cancel_at_period_end: true,
		});
		return { immediate: false };
	}

	await stripe.subscriptions.cancel(subscriptionId, {
		invoice_now: false,
		prorate: false,
	});
	logger.info(
		`Cancelled ${subscription.status} subscription ${subscriptionId} immediately instead of at period end`,
	);
	await voidOpenSubscriptionInvoices(subscriptionId);
	return { immediate: true };
}
