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
			`Failed to list pending invoices for subscription ${subscriptionId} before re-anchoring its billing cycle`,
			error instanceof Error ? error : new Error(String(error)),
		);
		return;
	}

	for (const invoice of pending) {
		if (invoice.billing_reason !== "subscription_cycle" || !invoice.id) {
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
					`Voided pending cycle-renewal invoice ${invoice.id} on subscription ${subscriptionId} superseded by an immediate upgrade`,
				);
			}
		} catch (error) {
			logger.error(
				`Failed to void pending cycle-renewal invoice ${invoice.id} on subscription ${subscriptionId}; the renewal webhook's staleness guard will skip its credit reset`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}

function resolveCustomerId(
	customer: string | { id?: string } | null | undefined,
): string | null {
	if (!customer) {
		return null;
	}
	return typeof customer === "string" ? customer : (customer.id ?? null);
}

// A scheduled tier change (a downgrade, or an upgrade deferred to renewal) swaps
// the subscription item's price with proration suppressed and no cycle re-anchor,
// expecting the upcoming renewal invoice to bill the new tier. But Stripe drafts
// that `subscription_cycle` invoice up to ~an hour before finalizing it, so a
// change landing inside that window leaves an already-drafted invoice billing the
// OLD price — which then charges while the renewal webhook applies the new tier
// and its credit allotment (e.g. a pro→lite downgrade billed $79 but granted lite
// credits, or a deferred lite→pro upgrade billed $29 while granting pro credits).
//
// Re-price the draft with an adjustment invoice item so the upcoming charge
// matches the tier taking effect at renewal. The adjustment targets the draft's
// net plan amount (its subscription lines plus any adjustment lines from earlier
// changes in the same window), keeping it idempotent and correct across
// consecutive changes (downgrade → upgrade, downgrade → cancel-downgrade) and a
// no-op when the draft was created after the swap already at the new price.
//
// Best-effort: a failure only reverts to the pre-existing near-boundary mismatch,
// so it must never fail the tier change itself.
export async function repriceDraftRenewalInvoice(params: {
	subscriptionId: string;
	customer: string | { id?: string } | null | undefined;
	newPriceId: string;
	newTier: string;
}): Promise<void> {
	const stripe = getStripe();
	try {
		const customerId = resolveCustomerId(params.customer);
		if (!customerId) {
			logger.warn(
				"Skipping draft renewal invoice re-price: subscription customer not found",
				{ subscriptionId: params.subscriptionId },
			);
			return;
		}

		const drafts = await stripe.invoices.list({
			subscription: params.subscriptionId,
			status: "draft",
			limit: 10,
		});
		const draft = drafts.data.find(
			(invoice) => invoice.billing_reason === "subscription_cycle",
		);
		if (!draft?.id) {
			return;
		}

		const newPrice = await stripe.prices.retrieve(params.newPriceId);
		if (typeof newPrice.unit_amount !== "number") {
			logger.warn(
				"Skipping draft renewal invoice re-price: new price has no unit_amount",
				{ subscriptionId: params.subscriptionId, priceId: params.newPriceId },
			);
			return;
		}

		const billedCents = draft.lines.data.reduce((sum, line) => {
			if (line.parent?.type === "subscription_item_details") {
				return sum + line.amount;
			}
			if (
				line.parent?.type === "invoice_item_details" &&
				line.metadata?.devPlanRenewalReprice === "true"
			) {
				return sum + line.amount;
			}
			return sum;
		}, 0);

		const adjustmentCents = newPrice.unit_amount - billedCents;
		if (adjustmentCents === 0) {
			return;
		}

		await stripe.invoiceItems.create({
			customer: customerId,
			invoice: draft.id,
			amount: adjustmentCents,
			currency: draft.currency,
			description: `Dev Plan renewal adjusted to ${params.newTier.toUpperCase()} pricing`,
			metadata: {
				subscriptionType: "dev_plan",
				devPlanRenewalReprice: "true",
			},
		});

		logger.info(
			`Re-priced draft renewal invoice ${draft.id} for subscription ${params.subscriptionId}: ${adjustmentCents} cent adjustment to ${params.newTier}`,
		);
	} catch (error) {
		logger.error(
			"Failed to re-price draft renewal invoice after dev plan tier change",
			error instanceof Error ? error : new Error(String(error)),
		);
	}
}
