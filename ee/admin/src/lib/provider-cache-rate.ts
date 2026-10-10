export function providerCacheRate({
	inputTokens,
	cachedTokens,
}: {
	inputTokens: number;
	cachedTokens: number;
}): number | null {
	// Input totals already include provider-cached tokens.
	return inputTokens > 0 ? (cachedTokens / inputTokens) * 100 : null;
}

export function formatProviderCacheRate(rate: number | null): string {
	return rate === null ? "—" : `${rate.toFixed(1)}%`;
}
