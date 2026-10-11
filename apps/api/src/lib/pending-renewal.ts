import { getStripe } from "@/routes/payments.js";

import { logger } from "@llmgateway/logger";

import type Stripe from "stripe";

async function listInvoicesByStatus(
	subscriptionId: string,
	status: "draft" | "open",
): Promise<Stripe.Invoice[]> {
	const invoices: Stripe.Invoice[] = [];
	let startingAfter: string | undefined;
	while (true) {
		const page = await getStripe().invoices.list({
			subscription: subscriptionId,
			status,
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		invoices.push(...page.data);
		if (!page.has_more) {
			return invoices;
		}
		const lastId = page.data.at(-1)?.id;
		if (!lastId || lastId === startingAfter) {
			throw new Error("Stripe invoice pagination did not advance");
		}
		startingAfter = lastId;
	}
}

export async function getPendingSubscriptionInvoices(
	subscriptionId: string,
): Promise<Stripe.Invoice[]> {
	const [drafts, open] = await Promise.all([
		listInvoicesByStatus(subscriptionId, "draft"),
		listInvoicesByStatus(subscriptionId, "open"),
	]);
	return [...drafts, ...open];
}

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
		pending = await getPendingSubscriptionInvoices(subscriptionId);
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

async function listDraftInvoiceLines(
	draft: Stripe.Invoice,
): Promise<Stripe.InvoiceLineItem[]> {
	const lines = [...draft.lines.data];
	if (!draft.lines.has_more || !draft.id) {
		return lines;
	}
	let startingAfter = lines.at(-1)?.id;
	while (true) {
		const page = await getStripe().invoices.listLineItems(draft.id, {
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		lines.push(...page.data);
		if (!page.has_more) {
			return lines;
		}
		const lastId = page.data.at(-1)?.id;
		if (!lastId || lastId === startingAfter) {
			throw new Error("Stripe invoice line pagination did not advance");
		}
		startingAfter = lastId;
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

		// The invoice object only embeds the first page of its lines; repeated
		// changes inside the window can push earlier adjustments past it, so read
		// every line before netting.
		const lines = await listDraftInvoiceLines(draft);

		let adjustmentLineCount = 0;
		const billedCents = lines.reduce((sum, line) => {
			if (line.parent?.type === "subscription_item_details") {
				return sum + line.amount;
			}
			if (
				line.parent?.type === "invoice_item_details" &&
				line.metadata?.devPlanRenewalReprice === "true"
			) {
				adjustmentLineCount++;
				return sum + line.amount;
			}
			return sum;
		}, 0);

		const adjustmentCents = newPrice.unit_amount - billedCents;
		if (adjustmentCents === 0) {
			return;
		}

		// Two concurrent tier-change requests (e.g. a double-clicked confirm) can
		// both read the draft before either adjustment lands and would each add the
		// full difference. Key the create on the draft state they observed so Stripe
		// collapses such duplicates, while a later change in the same window (which
		// sees one more adjustment line) still gets its own adjustment.
		await stripe.invoiceItems.create(
			{
				customer: customerId,
				invoice: draft.id,
				amount: adjustmentCents,
				currency: draft.currency,
				description: `Dev Plan renewal adjusted to ${params.newTier.toUpperCase()} pricing`,
				metadata: {
					subscriptionType: "dev_plan",
					devPlanRenewalReprice: "true",
				},
			},
			{
				idempotencyKey: `dev-plan-renewal-reprice:${draft.id}:${adjustmentLineCount}:${params.newPriceId}`,
			},
		);

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
