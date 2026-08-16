/**
 * Shared machinery for pattern detectors (PII, secrets).
 *
 * Detectors are matched in a single pass and validated with an optional
 * `validate` callback so a regex can stay broad while context/structure checks
 * keep the false-positive rate low. Overlapping matches are resolved in favour
 * of the detector listed first, so ordering is significant.
 */
export interface Detector {
	id: string;
	/** Human readable label used in violation/redaction logs. */
	label: string;
	/** Replacement inserted for a confirmed match. */
	replacement: string;
	pattern: RegExp;
	/**
	 * Replace only the first capture group rather than the whole match. Needed
	 * where the match includes structure that must survive redaction, such as
	 * the key and quotes around a JSON password value.
	 */
	redactGroup?: boolean;
	/**
	 * Returns false to discard a regex hit. `value` is the span that would be
	 * replaced (the capture group when `redactGroup` is set); `before`/`after`
	 * carry a limited window of surrounding text so detectors can require
	 * nearby keywords.
	 */
	validate?: (value: string, before: string, after: string) => boolean;
}

export interface DetectorMatch {
	detector: Detector;
	value: string;
	start: number;
	end: number;
}

/** Characters of context handed to `validate` on each side of a match. */
const CONTEXT_WINDOW = 48;

export function findMatches(
	content: string,
	detectors: Detector[],
): DetectorMatch[] {
	const matches: DetectorMatch[] = [];

	for (const detector of detectors) {
		// `g` to walk every occurrence, `d` for the capture-group spans that
		// `redactGroup` detectors replace.
		const flags = detector.pattern.flags.replace(/[gd]/g, "") + "gd";
		const pattern = new RegExp(detector.pattern.source, flags);

		for (const match of content.matchAll(pattern)) {
			const span = detector.redactGroup
				? firstGroupSpan(match)
				: [match.index, match.index + match[0].length];
			if (!span) {
				continue;
			}

			const [start, end] = span;
			const value = content.slice(start, end);

			if (detector.validate) {
				const matchStart = match.index;
				const matchEnd = match.index + match[0].length;
				const before = content.slice(
					Math.max(0, matchStart - CONTEXT_WINDOW),
					matchStart,
				);
				const after = content.slice(matchEnd, matchEnd + CONTEXT_WINDOW);
				if (!detector.validate(value, before, after)) {
					continue;
				}
			}

			matches.push({ detector, value, start, end });
		}
	}

	// Earlier detectors win over later ones on overlap; within a detector,
	// earlier positions win.
	matches.sort((a, b) => {
		if (a.start !== b.start) {
			return a.start - b.start;
		}
		return b.end - a.end;
	});

	const deduped: DetectorMatch[] = [];
	let cursor = -1;
	for (const match of matches) {
		if (match.start < cursor) {
			continue;
		}
		deduped.push(match);
		cursor = match.end;
	}

	return deduped;
}

/** Span of the first capture group that participated in the match. */
function firstGroupSpan(match: RegExpExecArray): [number, number] | undefined {
	const indices = match.indices;
	if (!indices) {
		return undefined;
	}
	for (let group = 1; group < indices.length; group++) {
		const span = indices[group];
		if (span) {
			return span;
		}
	}
	return undefined;
}

export function redactMatches(
	content: string,
	matches: DetectorMatch[],
): string {
	if (matches.length === 0) {
		return content;
	}

	let result = "";
	let cursor = 0;
	for (const match of matches) {
		result += content.slice(cursor, match.start) + match.detector.replacement;
		cursor = match.end;
	}
	return result + content.slice(cursor);
}

/**
 * Shannon entropy in bits per character. Random tokens sit above ~4 bits;
 * English prose, hex digests and snake_case identifiers sit well below.
 */
export function shannonEntropy(value: string): number {
	if (!value) {
		return 0;
	}

	const counts = new Map<string, number>();
	for (const char of value) {
		counts.set(char, (counts.get(char) ?? 0) + 1);
	}

	let entropy = 0;
	for (const count of counts.values()) {
		const p = count / value.length;
		entropy -= p * Math.log2(p);
	}
	return entropy;
}

/** Luhn checksum, used to reject digit runs that merely look like card numbers. */
export function luhn(digits: string): boolean {
	let sum = 0;
	let double = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let digit = digits.charCodeAt(i) - 48;
		if (digit < 0 || digit > 9) {
			return false;
		}
		if (double) {
			digit *= 2;
			if (digit > 9) {
				digit -= 9;
			}
		}
		sum += digit;
		double = !double;
	}
	return sum % 10 === 0;
}

/**
 * Words that carry no secret on their own. A value counts as a placeholder only
 * when *every* one of its separator-delimited words comes from this list, so
 * `YOUR_API_KEY_HERE` is discarded while `testingSecret123` — which a prefix
 * match would have thrown away — is still treated as a credential.
 */
const PLACEHOLDER_WORDS = new Set([
	"a",
	"api",
	"apikey",
	"bar",
	"baz",
	"change",
	"changeme",
	"dummy",
	"example",
	"fake",
	"foo",
	"here",
	"insert",
	"key",
	"me",
	"my",
	"none",
	"null",
	"password",
	"placeholder",
	"pwd",
	"redacted",
	"replace",
	"sample",
	"secret",
	"some",
	"string",
	"test",
	"testing",
	"the",
	"todo",
	"token",
	"undefined",
	"value",
	"your",
]);

const MASK_VALUE = /^[xX*.\-_0\s]+$/;

// `<...>` must form a token: a bare angle bracket appears in real passwords.
const TEMPLATE_MARKER =
	/<[^<>]*>|\$\{|\{\{|%\(|%s|process\.env|os\.environ|import\.meta\.env|env\[|getenv/i;

/**
 * True for values that are obviously not real credentials: template
 * placeholders, env-var references, masked values and SCREAMING_SNAKE stand-ins
 * such as `YOUR_API_KEY_HERE`.
 */
export function isPlaceholderSecret(value: string): boolean {
	const trimmed = value.trim().replace(/^['"]|['"]$/g, "");
	if (!trimmed) {
		return true;
	}
	if (TEMPLATE_MARKER.test(trimmed)) {
		return true;
	}
	if (MASK_VALUE.test(trimmed)) {
		return true;
	}
	const words = trimmed
		.toLowerCase()
		.split(/[_\-.\s]+/)
		.filter(Boolean);
	if (
		words.length > 0 &&
		words.every((word) => PLACEHOLDER_WORDS.has(word) || /^\d+$/.test(word))
	) {
		return true;
	}
	// A single repeated character, e.g. "********" or "xxxxxxxx".
	if (new Set(trimmed).size === 1) {
		return true;
	}
	// SCREAMING_SNAKE_CASE is a placeholder convention, never a real secret.
	if (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(trimmed)) {
		return true;
	}
	return false;
}
