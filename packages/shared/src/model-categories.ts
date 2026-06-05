/**
 * Model category classification used for analytics, dashboard filtering,
 * and tier-aware features.
 *
 * - `premium`: frontier/flagship models (top-tier reasoning, coding, and
 *   multimodal models from the major providers).
 * - `standard`: everything else.
 *
 * The list below is the initial categorization. Update it as the model
 * catalogue evolves.
 */

export type ModelCategory = "standard" | "premium";

export const PREMIUM_MODEL_IDS = new Set<string>([
	// Anthropic — Opus family
	"claude-3-opus",
	"claude-opus-4-20250514",
	"claude-opus-4-1-20250805",
	"claude-opus-4-5-20251101",
	"claude-opus-4-6",
	"claude-opus-4-7",
	"claude-opus-4-8",

	// OpenAI — Pro and reasoning flagships
	"o1",
	"o3",
	"gpt-5-pro",
	"gpt-5.1",
	"gpt-5.2",
	"gpt-5.2-pro",
	"gpt-5.4",
	"gpt-5.4-pro",
	"gpt-5.5",
	"gpt-5.5-pro",
	"gpt-5.1-codex",
	"gpt-5.2-codex",
	"gpt-5.3-codex",

	// Google — Gemini Pro
	"gemini-3-pro-preview",
	"gemini-3.1-pro-preview",

	// xAI — Grok 4 top tier
	"grok-4",
	"grok-4-3",
	"grok-4-20-beta-0309-reasoning",
	"grok-4-20-multi-agent-beta-0309",
]);

export function isPremiumModel(modelId: string): boolean {
	return PREMIUM_MODEL_IDS.has(modelId);
}

export function getModelCategory(modelId: string): ModelCategory {
	return isPremiumModel(modelId) ? "premium" : "standard";
}
