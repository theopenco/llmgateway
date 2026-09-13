/**
 * Upstream error bodies that report OUR provider account as out of funds —
 * trial quota exhausted, credit balance too low, spending limit reached —
 * rather than a fault in the caller's request. Providers disagree on the
 * status code: some answer 402, others (e.g. Anthropic) a plain 400.
 */
const EXHAUSTED_PROVIDER_ACCOUNT_PATTERNS = [
	/credit balance is too low/i,
	/insufficient balance/i,
	/reaching the monthly spending limit/i,
	/free trial quota for the service has been exhausted/i,
];

export function hasExhaustedProviderAccountError(errorText?: string): boolean {
	if (!errorText) {
		return false;
	}

	return EXHAUSTED_PROVIDER_ACCOUNT_PATTERNS.some((pattern) =>
		pattern.test(errorText),
	);
}
