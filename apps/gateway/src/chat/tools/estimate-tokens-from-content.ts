import { estimateTokensFromText } from "@llmgateway/shared";

/**
 * Estimates tokens from content length using a chars/4 heuristic. Backed by
 * the shared text-only estimator.
 */
export function estimateTokensFromContent(content: string): number {
	return estimateTokensFromText(content);
}
