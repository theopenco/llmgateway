export const CHAT_PLAN_PRICES = {
	starter: 9,
	plus: 19,
	pro: 49,
} as const;

export type ChatPlanTier = keyof typeof CHAT_PLAN_PRICES;

// Chat plans are billed monthly only. The cycle type is retained for the
// persisted column and Stripe metadata, which always resolve to "monthly".
export type ChatPlanCycle = "monthly";

/**
 * Tapered credit multipliers. The entry tier stays margin-positive even when
 * fully drained; higher tiers earn the more generous multiple as a reward for
 * committing. We're independent (not VC-subsidized), so the floor can't run at
 * a loss the way a land-grab pricing model can afford to.
 */
export const CHAT_PLAN_CREDITS_MULTIPLIERS = {
	starter: 2,
	plus: 2.5,
	pro: 3,
} as const;

/**
 * Resolve a tier's credits multiplier. The CHAT_PLAN_CREDITS_MULTIPLIER env var,
 * when set, is a flat ops override applied to every tier (escape hatch for
 * promos); otherwise the tapered per-tier default applies. Reading process.env
 * only yields the override on the server; clients should receive the resolved
 * values as a prop.
 */
export function getChatPlanCreditsMultiplier(tier: ChatPlanTier): number {
	const override = parseFloat(process.env.CHAT_PLAN_CREDITS_MULTIPLIER ?? "");
	return Number.isFinite(override) && override > 0
		? override
		: CHAT_PLAN_CREDITS_MULTIPLIERS[tier];
}

/**
 * Resolve every tier's multiplier at once — used to hand the full set to the
 * client, which renders a different multiplier per card.
 */
export function getChatPlanCreditsMultipliers(): Record<ChatPlanTier, number> {
	return {
		starter: getChatPlanCreditsMultiplier("starter"),
		plus: getChatPlanCreditsMultiplier("plus"),
		pro: getChatPlanCreditsMultiplier("pro"),
	};
}

export function getChatPlanCreditsLimit(tier: ChatPlanTier): number {
	return CHAT_PLAN_PRICES[tier] * getChatPlanCreditsMultiplier(tier);
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
