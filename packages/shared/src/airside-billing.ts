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
