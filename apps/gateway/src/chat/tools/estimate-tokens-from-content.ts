/**
 * Estimates tokens from content length using simple division
 */
export function estimateTokensFromContent(content: string): number {
	return Math.max(1, Math.round(content.length / 4));
}
