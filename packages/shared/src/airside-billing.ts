import Decimal from "decimal.js";

/** How an Airside carrier's upstream usage is settled. Set by admins only. */
export const AIRSIDE_BILLING_MODES = ["payg", "postpaid", "payout"] as const;

export type AirsideBillingMode = (typeof AIRSIDE_BILLING_MODES)[number];

export const AIRSIDE_BILLING_MODE_LABELS: Record<AirsideBillingMode, string> = {
	payg: "Pay-as-you-go",
	postpaid: "Post-billing",
	payout: "Payout",
};

export const AIRSIDE_BILLING_MODE_DESCRIPTIONS: Record<
	AirsideBillingMode,
	string
> = {
	payg: "LLM Gateway holds an account on the carrier's platform with a card on auto top-up, so usage is charged as it happens.",
	postpaid:
		"LLM Gateway holds an account on the carrier's platform set to post-paid. The carrier invoices on the 1st for the previous month and LLM Gateway pays once a month.",
	payout:
		"The carrier supplies the API key and invoices LLM Gateway on the 1st for the previous month. LLM Gateway pays out by USD wire, weekly or monthly.",
};

/**
 * Monthly payout statement lifecycle: the worker refreshes `draft` statements
 * from traffic rollups; `approved` freezes the amounts; `paid` records the
 * manual wire.
 */
export const AIRSIDE_PAYOUT_STATUSES = ["draft", "approved", "paid"] as const;

export type AirsidePayoutStatus = (typeof AIRSIDE_PAYOUT_STATUSES)[number];

export const AIRSIDE_PAYOUT_STATUS_LABELS: Record<AirsidePayoutStatus, string> =
	{
		draft: "Preview",
		approved: "Approved",
		paid: "Paid",
	};

/** What is left to pay out: billed traffic less the gateway fee, adjusted. */
export function airsidePayoutAmount(statement: {
	grossAmount: Decimal.Value;
	gatewayFeeAmount: Decimal.Value;
	adjustmentAmount: Decimal.Value;
}): Decimal {
	return new Decimal(statement.grossAmount)
		.minus(statement.gatewayFeeAmount)
		.plus(statement.adjustmentAmount);
}

/** The UTC calendar month before `now`: [start, end). */
export function previousUtcMonth(now: Date): { start: Date; end: Date } {
	const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
	const start = new Date(
		Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1),
	);
	return { start, end };
}
