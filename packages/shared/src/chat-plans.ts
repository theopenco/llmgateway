import { models } from "@llmgateway/models";

import type { ModelDefinition } from "@llmgateway/models";

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
 * Illustrative token shape of a typical chat exchange (one user turn plus the
 * model's reply, with some accumulated context), used ONLY to translate a
 * plan's credit allowance into an approximate message count on the pricing
 * page. This is marketing context, not a billing rate — real usage is metered
 * per request at live provider rates.
 */
const CHAT_PLAN_ESTIMATE_TOKENS = { input: 1500, output: 750 } as const;

/**
 * Representative per-token rates ($/token) for two model classes, used only for
 * the "≈ N messages" estimate. Anchored to the most expensive model in each
 * class (Claude Sonnet for frontier, Claude Haiku for fast) so the estimate is
 * a conservative floor — cheaper frontier models (GPT-5, Gemini Pro) and fast
 * models (GPT-5-mini, Gemini Flash) yield more messages, not fewer. Kept
 * deliberately separate from the live catalogue in @llmgateway/models: these
 * are illustrative copy inputs, not pricing.
 */
const CHAT_PLAN_ESTIMATE_RATES = {
	frontier: { input: 3.0e-6, output: 15.0e-6 },
	fast: { input: 1.0e-6, output: 5.0e-6 },
} as const;

export interface ChatPlanMessageEstimate {
	/** Approx. messages on frontier models (Claude Sonnet / GPT-5 class). */
	frontier: number;
	/** Approx. messages on fast models (Claude Haiku / Gemini Flash class). */
	fast: number;
}

function estimateMessages(
	creditsUsd: number,
	rate: { input: number; output: number },
): number {
	if (creditsUsd <= 0) {
		return 0;
	}
	const inputCost = CHAT_PLAN_ESTIMATE_TOKENS.input * rate.input;
	const outputCost = CHAT_PLAN_ESTIMATE_TOKENS.output * rate.output;
	const perMessage = inputCost + outputCost;
	return perMessage > 0 ? Math.floor(creditsUsd / perMessage) : 0;
}

/**
 * Translate a plan's monthly credit value (in USD) into an approximate number
 * of messages on frontier and fast models. Used on the pricing page and
 * paywall to make the credit allowance legible.
 */
export function estimateChatPlanMessages(
	creditsUsd: number,
): ChatPlanMessageEstimate {
	return {
		frontier: estimateMessages(creditsUsd, CHAT_PLAN_ESTIMATE_RATES.frontier),
		fast: estimateMessages(creditsUsd, CHAT_PLAN_ESTIMATE_RATES.fast),
	};
}

/**
 * Frontier flagships gated on the Starter tier, matched by substring against
 * the requested model id so every dated or regional variant is covered
 * (e.g. "claude-opus-4-7" matches "opus"). Plus and Pro reach everything.
 *
 * Price alone can't draw this line: some flagships (GPT-6.1 Sol at $2/$10,
 * Gemini 3 Pro) undercut Claude Sonnet, which Starter includes. Expensive
 * newcomers are still caught automatically by the Sonnet price ceiling below.
 */
export const CHAT_PLAN_STARTER_BLOCKED_MODEL_PATTERNS = [
	"opus",
	"fable",
	"astra",
	"-sol",
	"gpt-5",
	"o3",
	"o1",
	"gemini-2.5-pro",
	"gemini-3",
	"gemini-4",
	"grok-4",
] as const;

/**
 * Starter's price ceiling, anchored to Claude Sonnet ($3/M input, $15/M
 * output) — the most capable model Starter advertises. A catalogue text model
 * priced above it on any provider is frontier-class and needs Plus.
 */
const CHAT_PLAN_STARTER_MAX_PRICE = { input: 3e-6, output: 15e-6 } as const;

const catalogueById = new Map<string, ModelDefinition>(
	(models as readonly ModelDefinition[]).map((model) => [model.id, model]),
);

function exceedsStarterPriceCeiling(model: ModelDefinition): boolean {
	return model.providers.some((mapping) => {
		const input = parseFloat(mapping.inputPrice ?? "");
		const output = parseFloat(mapping.outputPrice ?? "");
		return (
			input > CHAT_PLAN_STARTER_MAX_PRICE.input ||
			output > CHAT_PLAN_STARTER_MAX_PRICE.output
		);
	});
}

/**
 * The cheapest Lounge membership that includes a model: "starter" when every
 * tier can use it, "plus" when it needs Plus or Pro. Image, video and audio
 * models are always "starter": every tier gets the media studios.
 */
export function getChatPlanMinimumTier(
	modelId: string,
): Extract<ChatPlanTier, "starter" | "plus"> {
	const model = catalogueById.get(modelId);
	if (model?.output?.some((kind) => kind !== "text")) {
		return "starter";
	}
	const lower = modelId.toLowerCase();
	const blocked =
		CHAT_PLAN_STARTER_BLOCKED_MODEL_PATTERNS.some((pattern) =>
			lower.includes(pattern),
		) ||
		(model !== undefined && exceedsStarterPriceCeiling(model));
	return blocked ? "plus" : "starter";
}

export function isChatPlanModelAllowed(
	tier: ChatPlanTier,
	modelId: string,
): boolean {
	return tier !== "starter" || getChatPlanMinimumTier(modelId) === "starter";
}
