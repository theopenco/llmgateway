// Our Stripe account's shortened (card) statement-descriptor prefix, i.e. the
// "Shortened descriptor" in Settings → Business details. Stripe joins it to a
// per-charge suffix as `PREFIX* SUFFIX` and caps the whole string at 22.
//
// This must stay in sync with the live account. If the account has no shortened
// descriptor set, Stripe falls back to the full statement descriptor truncated
// to 10 characters, which would leave less room than the budget below assumes
// and silently truncate suffixes on the cardholder's statement.
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
 *
 * Verified against the API with confirmed charges, reading back the resulting
 * charge's `calculated_statement_descriptor`:
 * - A suffix containing `*`, or one with no Latin letter, is rejected outright.
 * - Length is never rejected. Stripe fits the 22-character total by shrinking
 *   the prefix first, and only truncates the suffix once the prefix is at its
 *   own cap — so an over-long suffix is silently cut on the statement.
 *
 * Trimming here is therefore what keeps the dashboard preview equal to what the
 * cardholder actually sees. Returns null when nothing usable survives.
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
