import { getStripe } from "@/routes/payments.js";

import { logger } from "@llmgateway/logger";

import type Stripe from "stripe";

// Stripe drafts a subscription's cycle-renewal invoice at the period boundary
// and only finalizes and charges it about an hour later. An immediate tier
// upgrade re-anchors the billing cycle (`billing_cycle_anchor: "now"`) and
// charges the full new-tier price, so a still-pending renewal invoice bills a
// cycle the upgrade replaces — left alone it would double-charge the customer
// and its `invoice.payment_succeeded` webhook would clobber the freshly reset
// org state. Call this before re-anchoring to kill any such invoice: drafts
// are finalized without a payment attempt and then voided (auto-generated
// subscription drafts cannot be deleted), open invoices are voided directly.
// Failures are logged and swallowed — a Stripe hiccup here must not block the
// upgrade, and the renewal webhook's staleness guard is the backstop for any
// charge that slips through.
export async function voidPendingCycleRenewalInvoices(
	subscriptionId: string,
): Promise<void> {
	await voidSubscriptionInvoices(subscriptionId, {
		cycleRenewalsOnly: true,
		reason: "superseded by an immediate upgrade",
	});
}

// Voids every pending invoice on a subscription that is being ended while
// unpaid, so Stripe's retry schedule stops charging the card for a cycle the
// customer never received.
export async function voidOpenSubscriptionInvoices(
	subscriptionId: string,
): Promise<void> {
	await voidSubscriptionInvoices(subscriptionId, {
		cycleRenewalsOnly: false,
		reason: "cancelled while unpaid",
	});
}

async function voidSubscriptionInvoices(
	subscriptionId: string,
	{ cycleRenewalsOnly, reason }: { cycleRenewalsOnly: boolean; reason: string },
): Promise<void> {
	const stripe = getStripe();
	let pending: Stripe.Invoice[];
	try {
		const [drafts, open] = await Promise.all([
			stripe.invoices.list({
				subscription: subscriptionId,
				status: "draft",
				limit: 10,
			}),
			stripe.invoices.list({
				subscription: subscriptionId,
				status: "open",
				limit: 10,
			}),
		]);
		pending = [...drafts.data, ...open.data];
	} catch (error) {
		logger.error(
			`Failed to list pending invoices for subscription ${subscriptionId} (${reason})`,
			error instanceof Error ? error : new Error(String(error)),
		);
		return;
	}

	for (const invoice of pending) {
		if (
			!invoice.id ||
			(cycleRenewalsOnly && invoice.billing_reason !== "subscription_cycle")
		) {
			continue;
		}
		try {
			let finalized = invoice;
			if (invoice.status === "draft") {
				finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
					auto_advance: false,
				});
			}
			if (finalized.status === "open") {
				await stripe.invoices.voidInvoice(invoice.id);
				logger.info(
					`Voided pending invoice ${invoice.id} on subscription ${subscriptionId} ${reason}`,
				);
			}
		} catch (error) {
			logger.error(
				`Failed to void pending invoice ${invoice.id} on subscription ${subscriptionId} (${reason}); the renewal webhook's staleness guard will skip its credit reset`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
