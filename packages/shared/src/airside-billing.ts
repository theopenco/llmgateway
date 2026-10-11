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
	payg: "LLM Gateway prepays usage on its own account with the carrier.",
	postpaid:
		"The carrier invoices LLM Gateway after each month's usage, paid by wire.",
	payout:
		"The carrier supplies the API key and covers upstream costs; LLM Gateway pays the carrier after each month.",
};
