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
	 * Returns false to discard a regex hit. `before`/`after` carry a limited
	 * window of surrounding text so detectors can require nearby keywords.
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
		const pattern = new RegExp(
			detector.pattern.source,
			detector.pattern.flags.includes("g")
				? detector.pattern.flags
				: detector.pattern.flags + "g",
		);

		for (const match of content.matchAll(pattern)) {
			const start = match.index;
			const end = start + match[0].length;

			if (detector.validate) {
				const before = content.slice(
					Math.max(0, start - CONTEXT_WINDOW),
					start,
				);
				const after = content.slice(end, end + CONTEXT_WINDOW);
				if (!detector.validate(match[0], before, after)) {
					continue;
				}
			}

			matches.push({ detector, value: match[0], start, end });
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

const PLACEHOLDER_VALUE =
	/^(?:[xX*.\-_0]+|your[_-]?\w*|my[_-]?\w*|some[_-]?\w*|example\w*|sample\w*|placeholder\w*|changeme\w*|dummy\w*|redacted\w*|test[_-]?\w*|fake[_-]?\w*|insert\w*|todo\w*)$/;

const TEMPLATE_MARKER =
	/<|>|\$\{|\{\{|%\(|%s|process\.env|os\.environ|import\.meta\.env|env\[|getenv/i;

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
	if (PLACEHOLDER_VALUE.test(trimmed)) {
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
