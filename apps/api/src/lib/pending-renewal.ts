import { getStripe } from "@/routes/payments.js";

import { logger } from "@llmgateway/logger";

import type Stripe from "stripe";

async function listInvoicesByStatus(
	subscriptionId: string,
	status: "draft" | "open",
): Promise<Stripe.Invoice[]> {
	const stripe = getStripe();
	const invoices: Stripe.Invoice[] = [];
	let startingAfter: string | undefined;

	do {
		const page = await stripe.invoices.list({
			subscription: subscriptionId,
			status,
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		invoices.push(...page.data);

		if (!page.has_more) {
			break;
		}

		const lastInvoice = page.data.at(-1);
		if (!lastInvoice) {
			throw new Error(
				`Stripe returned an empty invoice page with has_more for subscription ${subscriptionId}`,
			);
		}
		startingAfter = lastInvoice.id;
	} while (true);

	return invoices;
}

// Stripe drafts a subscription's cycle-renewal invoice at the period boundary
// and only finalizes and charges it about an hour later. Callers use this list
// to detect a renewal already in progress before replacing or ending its cycle.
export async function getPendingCycleRenewalInvoices(
	subscriptionId: string,
): Promise<Stripe.Invoice[]> {
	const [drafts, open] = await Promise.all([
		listInvoicesByStatus(subscriptionId, "draft"),
		listInvoicesByStatus(subscriptionId, "open"),
	]);
	return [...drafts, ...open].filter(
		(invoice) => invoice.billing_reason === "subscription_cycle" && invoice.id,
	);
}

// Drafts are finalized without a payment attempt and then voided because
// auto-generated subscription drafts cannot be deleted. Open invoices are
// voided directly. Failures are logged and swallowed: an upgrade must continue,
// and the renewal webhook's staleness guard handles a charge that races an
// upgrade before the invoice can be voided.
export async function voidPendingCycleRenewalInvoices(
	subscriptionId: string,
	pendingInvoices?: Stripe.Invoice[],
): Promise<void> {
	const stripe = getStripe();
	let pending: Stripe.Invoice[];
	try {
		pending =
			pendingInvoices ?? (await getPendingCycleRenewalInvoices(subscriptionId));
	} catch (error) {
		logger.error(
			`Failed to list pending cycle-renewal invoices for subscription ${subscriptionId}`,
			error instanceof Error ? error : new Error(String(error)),
		);
		return;
	}

	for (const invoice of pending) {
		if (!invoice.id) {
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
					`Voided pending cycle-renewal invoice ${invoice.id} on subscription ${subscriptionId}`,
				);
			}
		} catch (error) {
			logger.error(
				`Failed to void pending cycle-renewal invoice ${invoice.id} on subscription ${subscriptionId}`,
				error instanceof Error ? error : new Error(String(error)),
			);
		}
	}
}
