/**
 * Native-Anthropic clients (e.g. Claude Code) express reasoning through the
 * Messages API `thinking` field (extended thinking) and, on Opus 4.7+, through
 * `output_config.effort` (adaptive thinking). The gateway's `/v1/messages`
 * endpoint translates Anthropic requests into an internal `/v1/chat/completions`
 * call, which speaks the unified reasoning controls (`reasoning.max_tokens`,
 * `reasoning.effort`, `reasoning_effort`). This maps the former onto the latter
 * so the requested effort actually reaches the provider instead of being
 * silently dropped during the Anthropic -> OpenAI transformation.
 */

export interface AnthropicThinkingConfig {
	type: string;
	budget_tokens?: number;
}

/**
 * Mirrors the reasoning-effort enum accepted by the chat completions endpoint
 * (`reasoning.effort` / `reasoning_effort`). Claude Code's effort selector emits
 * the full range, including `xhigh` and `max`, so the Anthropic path must accept
 * them too rather than capping at `low | medium | high`.
 */
export type ReasoningEffort =
	| "none"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";

export interface MappedReasoningFields {
	reasoning?: {
		effort?: ReasoningEffort;
		max_tokens?: number;
	};
	reasoning_effort?: "none";
}

export function mapAnthropicThinkingToReasoning(
	thinking: AnthropicThinkingConfig | undefined,
	effort: ReasoningEffort | undefined,
): MappedReasoningFields {
	// Budget-based extended thinking — what Claude Code sends. Forward the exact
	// token budget so reasoning depth is preserved end to end.
	if (thinking?.type === "enabled" && thinking.budget_tokens !== undefined) {
		return { reasoning: { max_tokens: thinking.budget_tokens } };
	}
	// Adaptive/effort-based reasoning (Opus 4.7+), or a bare `output_config.effort`.
	// When no effort is given, fall back to `high`: it is Anthropic's documented
	// default and is equivalent to omitting the parameter, so this matches what a
	// request sent straight to Anthropic would do instead of under-powering it.
	if (thinking?.type === "adaptive" || effort !== undefined) {
		return { reasoning: { effort: effort ?? "high" } };
	}
	// Thinking enabled without a budget — reason at `high`, Anthropic's default depth.
	if (thinking?.type === "enabled") {
		return { reasoning: { effort: "high" } };
	}
	// Explicitly disabled — turn reasoning off downstream.
	if (thinking?.type === "disabled") {
		return { reasoning_effort: "none" };
	}
	return {};
}
