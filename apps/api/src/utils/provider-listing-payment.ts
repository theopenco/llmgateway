import { Decimal } from "decimal.js";

import { db, tables } from "@llmgateway/db";

import type Stripe from "stripe";

export type ProviderListingPaymentSource = "airside" | "listing_request";

/** Maps checkout-session metadata to the listing-fee flow that created it. */
export function getProviderListingPaymentSource(
	session: Stripe.Checkout.Session,
): ProviderListingPaymentSource | null {
	switch (session.metadata?.type) {
		case "airside_listing_fee":
			return "airside";
		case "provider_listing":
			return "listing_request";
		default:
			return null;
	}
}

/**
 * Records the money a paid listing-fee checkout session brought in. Idempotent
 * per session, so webhook redeliveries and backfill reruns are safe. Returns
 * whether a row was inserted.
 */
export async function recordProviderListingPayment(
	session: Stripe.Checkout.Session,
	options: { paidAt?: Date; refundedAmount?: Decimal } = {},
): Promise<boolean> {
	const source = getProviderListingPaymentSource(session);
	if (!source || session.payment_status !== "paid") {
		return false;
	}

	// The payer row may have been deleted since; keep the revenue, drop the link.
	const companyId = session.metadata?.providerCompanyId;
	const company =
		source === "airside" && companyId
			? await db.query.providerCompany.findFirst({
					where: { id: { eq: companyId } },
					columns: { id: true },
				})
			: undefined;
	const requestId = session.metadata?.submissionId;
	const request =
		source === "listing_request" && requestId
			? await db.query.providerListingRequest.findFirst({
					where: { id: { eq: requestId } },
					columns: { id: true },
				})
			: undefined;

	const inserted = await db
		.insert(tables.providerListingPayment)
		.values({
			source,
			providerCompanyId: company?.id ?? null,
			providerListingRequestId: request?.id ?? null,
			amount: new Decimal(session.amount_total ?? 0).div(100).toString(),
			refundedAmount: (options.refundedAmount ?? new Decimal(0)).toString(),
			currency: (session.currency ?? "usd").toUpperCase(),
			stripeCheckoutSessionId: session.id,
			stripePaymentIntentId:
				typeof session.payment_intent === "string"
					? session.payment_intent
					: (session.payment_intent?.id ?? null),
			paidAt: options.paidAt ?? new Date(),
		})
		.onConflictDoNothing({
			target: tables.providerListingPayment.stripeCheckoutSessionId,
		})
		.returning({ id: tables.providerListingPayment.id });

	return inserted.length > 0;
}
