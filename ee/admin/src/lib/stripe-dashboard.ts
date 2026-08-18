const BASE = "https://dashboard.stripe.com";

/**
 * Stripe Dashboard search across customers, payments and invoices. Used to jump
 * from an organization to everything Stripe knows about its billing contact.
 */
export function stripeSearchUrl(query: string) {
	return `${BASE}/search?query=${encodeURIComponent(query)}`;
}

/**
 * Deep link for a transaction row, preferring the most specific object we
 * recorded. Refund rows normally also carry the payment intent, so the refund
 * fallback goes through search — there is no stable refund detail route.
 */
export function stripeTransactionUrl(transaction: {
	stripePaymentIntentId?: string | null;
	stripeInvoiceId?: string | null;
	stripeRefundId?: string | null;
}) {
	if (transaction.stripePaymentIntentId) {
		return `${BASE}/payments/${transaction.stripePaymentIntentId}`;
	}
	if (transaction.stripeInvoiceId) {
		return `${BASE}/invoices/${transaction.stripeInvoiceId}`;
	}
	if (transaction.stripeRefundId) {
		return stripeSearchUrl(transaction.stripeRefundId);
	}
	return null;
}
