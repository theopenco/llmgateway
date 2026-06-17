const CREDIT_ERROR_PATTERN =
	/(available credits|insufficient (?:credits|balance|funds)|add credits|out of credits|not enough credits)/i;

/**
 * The gateway returns HTTP 402 for credit/balance shortfalls (and an
 * insufficient-credits message on a few other paths). In the Chat plan context
 * these should upsell a subscription rather than tell the user to "add credits",
 * since top-ups don't apply there.
 */
export function isInsufficientCreditsError(
	status: number | undefined,
	message: string | undefined,
): boolean {
	if (status === 402) {
		return true;
	}
	return typeof message === "string" && CREDIT_ERROR_PATTERN.test(message);
}

export function chatPlanCreditErrorMessage(
	subscribed: boolean,
	noun: string,
): string {
	return subscribed
		? `You've used all your plan credits. Upgrade your plan to continue generating ${noun}.`
		: `Subscribe to a plan to continue generating ${noun}.`;
}
