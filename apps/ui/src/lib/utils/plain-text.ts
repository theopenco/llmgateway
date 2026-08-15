/**
 * Flattens the small subset of markdown used in FAQ answers to plain text.
 *
 * Structured data carries the same answers the page renders, but schema.org
 * consumers show `acceptedAnswer.text` verbatim — leaving `[label](url)` or
 * backticks in place would surface the raw syntax in a rich result.
 */
export function plainTextFromMarkdown(value: string): string {
	return (
		value
			// Images before links: the leading ! would otherwise survive the link rule.
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
			.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
			.replace(/`([^`]+)`/g, "$1")
			.replace(/\*\*([^*]+)\*\*/g, "$1")
			.replace(/(^|[^*])\*([^*]+)\*/g, "$1$2")
			.replace(/(^|[^_])_([^_]+)_/g, "$1$2")
			.replace(/\s+/g, " ")
			.trim()
	);
}
