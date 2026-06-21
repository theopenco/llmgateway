import { estimateTokensFromContent } from "./estimate-tokens-from-content.js";

/**
 * Resolve the reasoning-token count to surface for display and logging.
 *
 * Some providers return reasoning *content* but never a reasoning *token*
 * count. The clearest case is AWS Bedrock via the Converse API: its
 * `TokenUsage` struct only exposes `inputTokens` / `outputTokens` /
 * `totalTokens` (+ cache fields) — there is no reasoning field, and the
 * reasoning is bundled into `outputTokens`. Reporting `reasoning_tokens: 0` in
 * that case is misleading (the model did reason), so when the provider didn't
 * itemize the count we approximate it from the returned reasoning text — the
 * same approach other gateways (e.g. OpenRouter) take for Bedrock.
 *
 * This is for display/logging only. Inference cost is computed from the
 * upstream token counts (where Bedrock's reasoning already lives inside
 * `outputTokens`), so the estimate is never fed back into cost calculation and
 * the bundled reasoning is never double-charged.
 */
export function resolveReasoningTokens(
	reasoningTokens: number | null,
	reasoningContent: string | null,
): number | null {
	if (reasoningTokens) {
		return reasoningTokens;
	}
	if (reasoningContent) {
		return estimateTokensFromContent(reasoningContent);
	}
	return reasoningTokens;
}
