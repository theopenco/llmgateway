import { DEV_PLAN_PRICES } from "@llmgateway/shared";

/**
 * Pure math for the GitHub Copilot cost calculator.
 *
 * The model is deliberately simple and fully documented on the page:
 * both sides (Copilot AI Credits and LLM Gateway) are priced from the same
 * token volumes at the same per-million-token rates, so the differences that
 * remain are structural — seat fees and included credits on the Copilot side,
 * prompt caching and the platform fee on the gateway side.
 */

export const WORKING_DAYS_PER_MONTH = 20;

/**
 * A chat "session" is a ~5-turn conversation. Because history is resent on
 * every turn, the whole session totals ~30k input and ~4k output tokens.
 * At mini-class rates this reproduces the widely reported ~$0.016/session;
 * at premium-class rates it lands near the reported ~$0.21/session.
 */
export const CHAT_SESSION_TOKENS = {
	input: 30_000,
	output: 4_000,
} as const;

/**
 * An agent task is a multi-step run that repeatedly resends repo context
 * (system prompt, file trees, diffs) — the dominant cost in agentic coding.
 */
export const AGENT_TASK_TOKENS = {
	input: 150_000,
	output: 8_000,
} as const;

export interface ModelMix {
	id: "premium" | "balanced" | "efficient";
	label: string;
	/** USD per input token (e-6 = USD per million tokens) */
	inputPrice: number;
	/** USD per output token */
	outputPrice: number;
}

export const MODEL_MIXES: ModelMix[] = [
	{
		id: "premium",
		label: "Premium (frontier coding models)",
		inputPrice: 5e-6,
		outputPrice: 25e-6,
	},
	{
		id: "balanced",
		label: "Balanced (premium + efficient mix)",
		inputPrice: 2.6e-6,
		outputPrice: 13.5e-6,
	},
	{
		id: "efficient",
		label: "Efficient (mini-class models)",
		inputPrice: 0.25e-6,
		outputPrice: 2e-6,
	},
];

export interface CopilotPlan {
	id: string;
	label: string;
	seatPrice: number;
	/** USD of AI Credits included per seat per month; null = varies by agreement */
	includedCredits: number | null;
}

export const COPILOT_PLANS: CopilotPlan[] = [
	{
		id: "pro",
		label: "Copilot Pro — $10/user",
		seatPrice: 10,
		includedCredits: 15,
	},
	{
		id: "pro-plus",
		label: "Copilot Pro+ — $39/user",
		seatPrice: 39,
		includedCredits: 70,
	},
	{
		id: "max",
		label: "Copilot Max — $100/user",
		seatPrice: 100,
		includedCredits: 200,
	},
	{
		id: "business",
		label: "Copilot Business — $19/user",
		seatPrice: 19,
		includedCredits: null,
	},
	{
		id: "enterprise",
		label: "Copilot Enterprise — $39/user",
		seatPrice: 39,
		includedCredits: null,
	},
];

export interface UsageProfile {
	id: string;
	label: string;
	chatSessionsPerDay: number;
	agentTasksPerDay: number;
}

export const USAGE_PROFILES: UsageProfile[] = [
	{
		id: "light",
		label: "Light — occasional chat",
		chatSessionsPerDay: 5,
		agentTasksPerDay: 0,
	},
	{
		id: "moderate",
		label: "Moderate — chat all day",
		chatSessionsPerDay: 20,
		agentTasksPerDay: 0,
	},
	{
		id: "heavy",
		label: "Heavy — chat + some agent runs",
		chatSessionsPerDay: 40,
		agentTasksPerDay: 2,
	},
	{
		id: "agentic",
		label: "Agentic — agents doing real work",
		chatSessionsPerDay: 40,
		agentTasksPerDay: 8,
	},
];

/** Cached input tokens are billed at roughly 10% of the input rate. */
export const CACHED_INPUT_PRICE_RATIO = 0.1;
export const DEFAULT_CACHE_HIT_RATE = 0.6;
/** Flat platform fee on credits for managed usage without BYOK. */
export const GATEWAY_CREDIT_FEE = 0.05;

export const DEVPASS_PRICE_RANGE = {
	min: DEV_PLAN_PRICES.lite,
	max: DEV_PLAN_PRICES.max,
} as const;

export interface TokenUsage {
	inputTokens: number;
	outputTokens: number;
}

export function monthlyTokenUsage(
	developers: number,
	chatSessionsPerDay: number,
	agentTasksPerDay: number,
): TokenUsage {
	const sessions = developers * chatSessionsPerDay * WORKING_DAYS_PER_MONTH;
	const tasks = developers * agentTasksPerDay * WORKING_DAYS_PER_MONTH;
	const chatInput = sessions * CHAT_SESSION_TOKENS.input;
	const chatOutput = sessions * CHAT_SESSION_TOKENS.output;
	const taskInput = tasks * AGENT_TASK_TOKENS.input;
	const taskOutput = tasks * AGENT_TASK_TOKENS.output;
	return {
		inputTokens: chatInput + taskInput,
		outputTokens: chatOutput + taskOutput,
	};
}

export interface UsageCost {
	inputCost: number;
	outputCost: number;
	total: number;
}

export function rawUsageCost(usage: TokenUsage, mix: ModelMix): UsageCost {
	const inputCost = usage.inputTokens * mix.inputPrice;
	const outputCost = usage.outputTokens * mix.outputPrice;
	return { inputCost, outputCost, total: inputCost + outputCost };
}

export interface CopilotCost {
	seatCost: number;
	includedCredits: number;
	usageCost: number;
	overage: number;
	total: number;
}

export function copilotMonthlyCost(
	developers: number,
	seatPrice: number,
	includedCreditsPerSeat: number,
	usageCost: number,
): CopilotCost {
	const seatCost = developers * seatPrice;
	const includedCredits = developers * includedCreditsPerSeat;
	const overage = Math.max(0, usageCost - includedCredits);
	return {
		seatCost,
		includedCredits,
		usageCost,
		overage,
		total: seatCost + overage,
	};
}

export interface GatewayCost {
	usageAfterCaching: number;
	fee: number;
	total: number;
}

export function gatewayMonthlyCost(
	usage: TokenUsage,
	mix: ModelMix,
	cacheHitRate: number,
	byok: boolean,
): GatewayCost {
	const { inputCost, outputCost } = rawUsageCost(usage, mix);
	const fullPriceInput = inputCost * (1 - cacheHitRate);
	const cachedInput = inputCost * cacheHitRate * CACHED_INPUT_PRICE_RATIO;
	const usageAfterCaching = fullPriceInput + cachedInput + outputCost;
	const fee = byok ? 0 : usageAfterCaching * GATEWAY_CREDIT_FEE;
	return { usageAfterCaching, fee, total: usageAfterCaching + fee };
}

export function formatUsd(value: number): string {
	return value.toLocaleString("en-US", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: 0,
		maximumFractionDigits: value < 100 ? 2 : 0,
	});
}
