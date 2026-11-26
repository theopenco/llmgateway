/**
 * Per-token price tables for the chat comparison pages. Lounge's side is the
 * live catalogue rate; the other side is the model maker's own API list rate
 * (or OpenRouter's standard endpoint), copied on the date below.
 */

import { liveRate, perInputToken, perOutputToken } from "@/lib/catalogue-rates";

import type { ModelPriceRow, ModelPricing } from "@/lib/comparisons";

const CHECKED_ON = "October 31, 2026";

interface TokenModel {
	label: string;
	id: string;
	/** Published input and output rate per 1M tokens, or null if not sold. */
	rate: readonly [number, number] | null;
	themLabel?: string;
}

const SOURCES = {
	openai: {
		label: "OpenAI API pricing",
		url: "https://developers.openai.com/api/docs/pricing",
	},
	anthropic: {
		label: "Claude API pricing",
		url: "https://platform.claude.com/docs/en/docs/about-claude/pricing",
	},
	google: {
		label: "Gemini API pricing",
		url: "https://ai.google.dev/gemini-api/docs/pricing",
	},
	xai: {
		label: "xAI models and pricing",
		url: "https://docs.x.ai/docs/models",
	},
	openrouter: {
		label: "OpenRouter model endpoints (standard tier)",
		url: "https://openrouter.ai/models",
	},
};

const GPT_6_ASTRA: TokenModel = {
	label: "GPT-6 Astra",
	id: "gpt-6-astra",
	rate: [10, 50],
};
const GPT_6_1_SOL: TokenModel = {
	label: "GPT-6.1 Sol",
	id: "gpt-6.1-sol",
	rate: [2, 10],
};
const GPT_6_1_TERRA: TokenModel = {
	label: "GPT-6.1 Terra",
	id: "gpt-6.1-terra",
	rate: [1, 5],
};
const GPT_6_LUNA: TokenModel = {
	label: "GPT-6 Luna",
	id: "gpt-6-luna",
	rate: [0.1, 0.5],
};
const CLAUDE_FABLE_5_1: TokenModel = {
	label: "Claude Fable 5.1",
	id: "claude-fable-5-1",
	rate: [10, 50],
};
const CLAUDE_OPUS_5_5: TokenModel = {
	label: "Claude Opus 5.5",
	id: "claude-opus-5-5",
	rate: [4, 20],
};
const CLAUDE_SONNET_5_5: TokenModel = {
	label: "Claude Sonnet 5.5",
	id: "claude-sonnet-5-5",
	rate: [2, 10],
};
const CLAUDE_HAIKU_5_5: TokenModel = {
	label: "Claude Haiku 5.5",
	id: "claude-haiku-5-5",
	rate: [0.1, 0.5],
};
/** Google's launch price, valid through November 30, 2026. */
const GEMINI_4_ARGON: TokenModel = {
	label: "Gemini 4 Argon",
	id: "gemini-4-argon",
	rate: [2, 10],
};
const GEMINI_3_8_FLASH: TokenModel = {
	label: "Gemini 3.8 Flash",
	id: "gemini-3.8-flash",
	rate: [0.75, 3.75],
};
const GROK_4_7: TokenModel = {
	label: "Grok 4.7",
	id: "grok-4-7",
	rate: [2, 6],
};

function tokenRows(models: TokenModel[]): ModelPriceRow[] {
	return models.flatMap((model) => {
		const input = liveRate(model.id, perInputToken);
		const output = liveRate(model.id, perOutputToken);
		if (input === null || output === null) {
			return [];
		}
		const label = model.themLabel ?? "Not offered";
		return [
			{
				model: `${model.label} · input`,
				us: input * 1_000_000,
				them: model.rate?.[0] ?? null,
				themLabel: label,
			},
			{
				model: `${model.label} · output`,
				us: output * 1_000_000,
				them: model.rate?.[1] ?? null,
				themLabel: label,
			},
		];
	});
}

const MIXED_MODELS = [
	GPT_6_1_SOL,
	CLAUDE_SONNET_5_5,
	GEMINI_3_8_FLASH,
	GROK_4_7,
];

const MIXED_SOURCES = [
	SOURCES.openai,
	SOURCES.anthropic,
	SOURCES.google,
	SOURCES.xai,
];

function makerPricing(intro: string): ModelPricing {
	return {
		heading: "What the models cost per token",
		intro,
		unit: "per 1M tokens",
		themName: "Model maker's API",
		rows: tokenRows(MIXED_MODELS),
		sources: MIXED_SOURCES,
		checkedOn: CHECKED_ON,
	};
}

export const chatModelPricing: Record<string, ModelPricing> = {
	chatgpt: {
		heading: "What the models cost per token",
		intro:
			"ChatGPT plans don't price per token. Here is OpenAI's own API rate for each model next to what Lounge charges for it.",
		unit: "per 1M tokens",
		themName: "OpenAI API",
		rows: tokenRows([GPT_6_ASTRA, GPT_6_1_SOL, GPT_6_1_TERRA, GPT_6_LUNA]),
		sources: [SOURCES.openai],
		checkedOn: CHECKED_ON,
	},
	claude: {
		heading: "What the models cost per token",
		intro:
			"Claude plans don't price per token. Here is Anthropic's own API rate for each model next to what Lounge charges for it.",
		unit: "per 1M tokens",
		themName: "Claude API",
		rows: tokenRows([
			CLAUDE_FABLE_5_1,
			CLAUDE_OPUS_5_5,
			CLAUDE_SONNET_5_5,
			CLAUDE_HAIKU_5_5,
		]),
		sources: [SOURCES.anthropic],
		checkedOn: CHECKED_ON,
	},
	gemini: {
		heading: "What the models cost per token",
		intro:
			"Google AI plans don't price per token. Here is the Gemini API rate for each model next to what Lounge charges. Gemini 4 Argon is at Google's launch price until November 30, 2026, and Gemini 3.8 Flash until December 31, 2026.",
		unit: "per 1M tokens",
		themName: "Gemini API",
		rows: tokenRows([GEMINI_4_ARGON, GEMINI_3_8_FLASH]),
		sources: [SOURCES.google],
		checkedOn: CHECKED_ON,
	},
	poe: makerPricing(
		"Poe charges points per message, set per bot, so it has no per-token price. This is what each model costs on its maker's own API, next to Lounge.",
	),
	"t3-chat": makerPricing(
		"T3 Chat is a flat subscription with a usage bar, so it has no per-token price. This is what each model costs on its maker's own API, next to Lounge.",
	),
	perplexity: makerPricing(
		"Perplexity plans don't price per token. This is what each model costs on its maker's own API, next to Lounge.",
	),
	openrouter: {
		heading: "Same model, cost per token",
		intro:
			"OpenRouter's standard endpoint for each model, before the fee it takes when you buy credits.",
		unit: "per 1M tokens",
		rows: tokenRows([
			GPT_6_1_SOL,
			CLAUDE_OPUS_5_5,
			CLAUDE_SONNET_5_5,
			GEMINI_3_8_FLASH,
			GROK_4_7,
		]),
		sources: [SOURCES.openrouter],
		checkedOn: CHECKED_ON,
	},
};
