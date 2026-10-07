import {
	getPendingSubscriptionInvoices,
	voidOpenSubscriptionInvoices,
} from "@/lib/pending-renewal.js";
import { getStripe } from "@/routes/payments.js";

import { logger } from "@llmgateway/logger";

import type Stripe from "stripe";

const UNPAID_STATUSES: Stripe.Subscription.Status[] = [
	"past_due",
	"unpaid",
	"incomplete",
	"paused",
];

function hasEnded(subscription: Stripe.Subscription): boolean {
	return ["canceled", "incomplete_expired"].includes(subscription.status);
}

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

	if (hasEnded(subscription)) {
		await voidOpenSubscriptionInvoices(subscriptionId);
		return { immediate: true };
	}

	if (!UNPAID_STATUSES.includes(subscription.status)) {
		// Schedule first so a renewal cannot start between invoice discovery
		// and the cancellation update. Inspect the state returned by Stripe.
		const scheduled = await stripe.subscriptions.update(subscriptionId, {
			cancel_at_period_end: true,
		});
		if (hasEnded(scheduled)) {
			await voidOpenSubscriptionInvoices(subscriptionId);
			return { immediate: true };
		}
		if (!UNPAID_STATUSES.includes(scheduled.status)) {
			try {
				const pending = await getPendingSubscriptionInvoices(subscriptionId);
				if (
					!pending.some(
						(invoice) => invoice.billing_reason === "subscription_cycle",
					)
				) {
					return { immediate: false };
				}
			} catch (error) {
				// End now if we cannot rule out an unpaid renewal still retrying.
				logger.error(
					`Failed to inspect renewal invoices for subscription ${subscriptionId}; cancelling immediately`,
					error instanceof Error ? error : new Error(String(error)),
				);
			}
		}
	}

	await stripe.subscriptions.cancel(subscriptionId, {
		invoice_now: false,
		prorate: false,
	});
	logger.info(
		`Cancelled subscription ${subscriptionId} immediately instead of at period end`,
	);
	await voidOpenSubscriptionInvoices(subscriptionId);
	return { immediate: true };
}
