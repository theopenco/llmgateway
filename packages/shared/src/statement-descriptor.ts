// Our Stripe account's shortened (card) statement-descriptor prefix. Stripe
// joins it to a per-charge suffix as `PREFIX* SUFFIX`, and caps the whole
// string at 22 characters.
export const STATEMENT_DESCRIPTOR_PREFIX = "LLMGTWY";

const STATEMENT_DESCRIPTOR_MAX_LENGTH = 22;

// 22 - "LLMGTWY" - "* " = 13.
export const STATEMENT_DESCRIPTOR_SUFFIX_MAX_LENGTH =
	STATEMENT_DESCRIPTOR_MAX_LENGTH - STATEMENT_DESCRIPTOR_PREFIX.length - 2;

/**
 * Coerce developer-supplied text into a suffix Stripe will always accept.
 *
 * This normalizes rather than rejects on purpose: the stored value is sent on
 * every top-up PaymentIntent for the project, so a value Stripe refuses would
 * 400 `paymentIntents.create` and block that project's payments entirely.
 * Verified against the API: a suffix containing `*` is rejected outright, while
 * an over-long one is accepted and silently truncated later — so trimming here
 * is what makes the dashboard preview match the cardholder's statement.
 *
 * Stripe's rules: Latin characters only, at least one letter, and none of
 * `< > \ ' " *`. Returns null when nothing usable survives.
 */
export function normalizeStatementDescriptorSuffix(
	input: string | null | undefined,
): string | null {
	if (!input) {
		return null;
	}

	const cleaned = input
		.normalize("NFKD")
		// Drop combining marks so "Café" degrades to "Cafe" instead of vanishing.
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^A-Za-z0-9 .\-_]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toUpperCase()
		.slice(0, STATEMENT_DESCRIPTOR_SUFFIX_MAX_LENGTH)
		.trim();

	// Stripe requires at least one letter in the suffix.
	if (!/[A-Za-z]/.test(cleaned)) {
		return null;
	}

	return cleaned;
}

/**
 * The full descriptor a cardholder sees, for previewing in the dashboard.
 */
export function formatStatementDescriptor(suffix: string | null): string {
	if (!suffix) {
		return STATEMENT_DESCRIPTOR_PREFIX;
	}
	return `${STATEMENT_DESCRIPTOR_PREFIX}* ${suffix}`;
}
