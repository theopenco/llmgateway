// Private-use code point, so a placeholder can never collide with real prose
// (a digit-based marker would be eaten by any answer that mentions a number).
const SENTINEL = "";

/**
 * Flattens the small subset of markdown used in FAQ answers to plain text.
 *
 * Structured data carries the same answers the page renders, but schema.org
 * consumers show `acceptedAnswer.text` verbatim — leaving `[label](url)` or
 * backticks in place would surface the raw syntax in a rich result.
 */
export function plainTextFromMarkdown(value: string): string {
	// Code spans are lifted out before emphasis is stripped: an identifier like
	// `snake_case_name` is not italics, and running the underscore rule over it
	// would eat characters out of the middle of the word.
	const spans: string[] = [];
	const withPlaceholders = value.replace(/`([^`]+)`/g, (_, code: string) => {
		spans.push(code);
		return `${SENTINEL}${spans.length - 1}${SENTINEL}`;
	});

	const flattened = withPlaceholders
		// Images before links: the leading ! would otherwise survive the link rule.
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
		.replace(/\*\*([^*]+)\*\*/g, "$1")
		.replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
		.replace(/(^|[^_])_([^_]+)_/g, "$1$2")
		.replace(/\s+/g, " ")
		.trim();

	return flattened.replace(
		new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, "g"),
		(_, index: string) => spans[Number(index)] ?? "",
	);
}
