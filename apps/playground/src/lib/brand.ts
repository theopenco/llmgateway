/**
 * Lounge brand constants — the single source of truth for the product name.
 * Analytics identifiers (PostHog `app: "chat"`, `playground_*` events) and
 * billing ids (chat plan tiers, Stripe products) deliberately keep their
 * original names and must not be derived from these strings.
 */
export const BRAND = {
	/** Product noun, used in running prose: "Lounge keeps Claude and adds GPT". */
	name: "Lounge",
	/** Display form for hero moments: "The Lounge". */
	displayName: "The Lounge",
	/** Formal lockup for metadata, OG and legal surfaces. */
	fullName: "Lounge by LLM Gateway",
	/** Parent brand, unchanged by the rebrand. */
	publisher: "LLM Gateway",
	tagline: "Every frontier model. One membership.",
	url: "https://lounge.llmgateway.io",
} as const;
