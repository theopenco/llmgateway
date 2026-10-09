const WORD_START = "(?<![\\p{L}\\p{N}_])";
const WORD_END = "(?![\\p{L}\\p{N}_])";

function escapeLiteral(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createLiteralRegex(
	value: string,
	caseSensitive = false,
	wholeWord = false,
): RegExp {
	const escaped = escapeLiteral(value);
	const pattern = wholeWord ? `${WORD_START}${escaped}${WORD_END}` : escaped;
	return new RegExp(pattern, caseSensitive ? "gu" : "giu");
}

/**
 * Case-insensitive whole-word match that also accepts common English
 * inflections of the last word ("bombs", "hacking", "stabbing", "voting"),
 * without matching inside unrelated words ("between" for "bet").
 */
export function createInflectedWordRegex(value: string): RegExp {
	const word = value.trim();
	const escaped = escapeLiteral(word);
	// Inflections plus common derivations ("investment", "weaponry",
	// "murderous", "violently", "sexuality").
	const suffixes =
		"s|es|d|ed|ing|ings|er|ers|ment|ments|or|ors|ry|ries|ion|ions|ist|ists|ive|ives|al|ance|ances|ence|ences|ous|ously|ly|ity|ities";
	const variants = [`${escaped}(?:${suffixes})?`];
	const last = word.at(-1)?.toLowerCase();
	// Doubled final consonant ("stabbing"); not before "-er", so "bet" does not
	// match "better".
	if (last && "bdgklmnprt".includes(last)) {
		variants.push(`${escaped}${escapeLiteral(last)}(?:ing|ings|ed)`);
	}
	// Dropped final "e" ("voting", "voters", "gambler").
	if (last === "e" && word.length > 2) {
		variants.push(`${escapeLiteral(word.slice(0, -1))}(?:${suffixes})`);
	}
	return new RegExp(`${WORD_START}(?:${variants.join("|")})${WORD_END}`, "giu");
}
