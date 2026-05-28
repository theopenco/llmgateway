export const CHAT_PLAN_PRICES = {
	starter: 5,
	plus: 20,
	pro: 50,
} as const;

export type ChatPlanTier = keyof typeof CHAT_PLAN_PRICES;

export type ChatPlanCycle = "monthly" | "annual";

// Two months free when paying annually (effectively 16.7% off)
export const CHAT_PLAN_ANNUAL_DISCOUNT_MONTHS = 2;

/**
 * Annual price for a tier — 12 months minus the discount months.
 * Returns the total billed once per year.
 */
export function getChatPlanAnnualPrice(tier: ChatPlanTier): number {
	return CHAT_PLAN_PRICES[tier] * (12 - CHAT_PLAN_ANNUAL_DISCOUNT_MONTHS);
}

/**
 * Effective monthly price when billed annually (used to display "$X/mo billed yearly").
 */
export function getChatPlanAnnualMonthlyPrice(tier: ChatPlanTier): number {
	return Math.round((getChatPlanAnnualPrice(tier) / 12) * 100) / 100;
}

export const CHAT_PLAN_DEFAULT_CREDITS_MULTIPLIER = 3;

/**
 * Resolve the credits multiplier from the env override, falling back to the
 * default when it's unset or malformed. Reading process.env only yields the
 * override on the server; clients should receive the resolved value as a prop.
 */
export function getChatPlanCreditsMultiplier(): number {
	const parsed = parseFloat(process.env.CHAT_PLAN_CREDITS_MULTIPLIER ?? "");
	return Number.isFinite(parsed) && parsed > 0
		? parsed
		: CHAT_PLAN_DEFAULT_CREDITS_MULTIPLIER;
}

export function getChatPlanCreditsLimit(tier: ChatPlanTier): number {
	return CHAT_PLAN_PRICES[tier] * getChatPlanCreditsMultiplier();
}

/**
 * Premium models that are gated on the Starter tier. Plus and Pro tiers
 * have access to everything. Matched by substring against the requested
 * model id, so this covers all variants (e.g. "claude-opus-4-7" matches
 * "opus" → premium).
 *
 * The wedge for chat plans is multi-model access; we keep the catalogue
 * wide on Starter and only block frontier models so the upgrade path is
 * obvious without crippling the entry tier.
 */
export const CHAT_PLAN_STARTER_BLOCKED_MODEL_PATTERNS = [
	"opus",
	"gpt-5",
	"o3",
	"o1",
	"gemini-2.5-pro",
	"gemini-3",
	"grok-4",
] as const;

export function isChatPlanModelAllowed(
	tier: ChatPlanTier,
	modelId: string,
): boolean {
	if (tier !== "starter") {
		return true;
	}
	const lower = modelId.toLowerCase();
	return !CHAT_PLAN_STARTER_BLOCKED_MODEL_PATTERNS.some((pattern) =>
		lower.includes(pattern),
	);
}
