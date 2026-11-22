/** Lower-cased and stripped of accents, so "Resume" finds "résumé". */
function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

/**
 * True when every word of the query appears somewhere in the fields. Words
 * may match different fields, so "devpass limits" finds an entry tagged
 * DevPass whose title mentions limits.
 */
export function matchesQuery(
	fields: readonly (string | undefined)[],
	query: string,
): boolean {
	const words = normalize(query).split(/\s+/).filter(Boolean);
	if (words.length === 0) {
		return true;
	}
	const haystack = normalize(fields.filter(Boolean).join(" "));
	return words.every((word) => haystack.includes(word));
}
