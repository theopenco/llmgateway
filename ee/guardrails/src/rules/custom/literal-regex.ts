export function createLiteralRegex(
	value: string,
	caseSensitive = false,
	wholeWord = false,
): RegExp {
	const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = wholeWord
		? `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`
		: escaped;
	return new RegExp(pattern, caseSensitive ? "gu" : "giu");
}
