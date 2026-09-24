/**
 * How a subscriber's renewal date should read, derived in one place so the
 * status badge and the renewal-date cell beside it can never disagree.
 *
 * A plan whose end date has passed is only "renewal processing" when it is not
 * cancelled — Stripe drafts the renewal invoice at the period boundary and
 * charges it about an hour later, so the stored expiry sits in the past until
 * the paid invoice advances it. A *cancelled* plan past that same date is
 * ending, not renewing.
 */
export type RenewalState =
	"past_due" | "processing" | "ended" | "cancelling" | "renewing" | "unknown";

export interface RenewalStateInput {
	hasPaymentIssue: boolean;
	cancelled: boolean;
	expiresAt: string | null;
}

export function getRenewalState(sub: RenewalStateInput): RenewalState {
	if (sub.hasPaymentIssue) {
		return "past_due";
	}
	if (!sub.expiresAt) {
		return "unknown";
	}
	const elapsed = new Date(sub.expiresAt).getTime() <= Date.now();
	if (sub.cancelled) {
		return elapsed ? "ended" : "cancelling";
	}
	return elapsed ? "processing" : "renewing";
}

/**
 * The one-line renewal summary under a subscriber's MRR on the detail pages.
 * Takes the page's own date formatter so the date style stays local to it.
 */
export function formatRenewalSummary(
	sub: RenewalStateInput,
	formatDate: (value: string | null) => string,
): string {
	const when = formatDate(sub.expiresAt);
	switch (getRenewalState(sub)) {
		case "past_due":
			return `Payment failed (due ${when})`;
		case "processing":
			return `Renewal processing (due ${when})`;
		case "ended":
			return `Ended ${when}`;
		case "cancelling":
			return `Ends ${when}`;
		default:
			return `Renews ${when}`;
	}
}

/**
 * The status badge label. Keyed off the server-derived `status` rather than
 * `getRenewalState` so its precedence is preserved — `churned` (tier cleared)
 * outranks a stale expiry date.
 */
export function formatSubscriberStatus(
	status: string,
	hasPaymentIssue: boolean,
	cancelled: boolean,
): string {
	if (hasPaymentIssue) {
		return "past due";
	}
	if (status === "expired" && !cancelled) {
		return "renewal processing";
	}
	if (status === "cancelled_pending") {
		return "cancel pending";
	}
	return status;
}
