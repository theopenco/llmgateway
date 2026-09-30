import { RE2 } from "re2-wasm";

const MAX_PATTERN_LENGTH = 1000;
// re2-wasm runs in a fixed 16 MB heap and never frees a compiled pattern (or
// a failed compile) by itself, so compile each pattern once and free it on
// eviction.
const MAX_CACHED_PATTERNS = 256;
// Every exec copies its whole input into that heap: scan bounded windows. A
// window overlaps the next one so a match crossing the boundary is still seen.
const WINDOW_LENGTH = 65_536;
const WINDOW_OVERLAP = 4096;

type CompiledPattern = { regex: RE2 } | { error: Error };

const compiledPatterns = new Map<string, CompiledPattern>();

const LONE_SURROGATE =
	/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function freeRegex(regex: RE2): void {
	(regex as unknown as { wrapper: { delete: () => void } }).wrapper.delete();
}

function getRegex(pattern: string, caseSensitive: boolean): RE2 {
	const key = `${caseSensitive ? "s" : "i"}:${pattern}`;
	let compiled = compiledPatterns.get(key);
	if (compiled) {
		compiledPatterns.delete(key);
	} else {
		try {
			if (pattern.length > MAX_PATTERN_LENGTH) {
				throw new Error(
					`Guardrail regex patterns must not exceed ${MAX_PATTERN_LENGTH} characters`,
				);
			}
			compiled = { regex: new RE2(pattern, caseSensitive ? "gu" : "giu") };
		} catch (error) {
			compiled = {
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
		if (compiledPatterns.size >= MAX_CACHED_PATTERNS) {
			const [oldestKey, oldest] = compiledPatterns.entries().next().value!;
			compiledPatterns.delete(oldestKey);
			if ("regex" in oldest) {
				freeRegex(oldest.regex);
			}
		}
	}
	compiledPatterns.set(key, compiled);
	if ("error" in compiled) {
		throw compiled.error;
	}
	return compiled.regex;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}

/** Moves an index off the middle of a surrogate pair. */
function safeBoundary(content: string, index: number): number {
	return index < content.length && isLowSurrogate(content.charCodeAt(index))
		? index + 1
		: index;
}

function codePointLength(value: string): number {
	let length = 0;
	for (const _ of value) {
		length++;
	}
	return length;
}

/**
 * Rejects a pattern RE2 cannot compile or one that matches empty text, which
 * would flag every request.
 */
export function validateGuardrailRegex(pattern: string): void {
	const regex = getRegex(pattern, false);
	regex.lastIndex = 0;
	if (regex.test("")) {
		throw new Error("Guardrail regex patterns must not match empty text");
	}
}

/**
 * Returns every non-empty match of `pattern` in `content`.
 *
 * re2-wasm reports indices in code points and drops lone surrogates
 * inconsistently, so the input is made well-formed and scanning advances by
 * code points.
 */
export function matchGuardrailRegex(
	pattern: string,
	content: string,
	caseSensitive = false,
): string[] {
	const regex = getRegex(pattern, caseSensitive);
	const text = content.replace(LONE_SURROGATE, "\uFFFD");
	const matches: string[] = [];
	for (let start = 0; start < text.length;) {
		const end = safeBoundary(
			text,
			Math.min(text.length, start + WINDOW_LENGTH),
		);
		const window = text.slice(
			start,
			safeBoundary(text, Math.min(text.length, end + WINDOW_OVERLAP)),
		);
		const ownCodePoints =
			end < text.length ? codePointLength(text.slice(start, end)) : Infinity;
		regex.lastIndex = 0;
		for (
			let match = regex.exec(window);
			match !== null && match.index < ownCodePoints;
			match = regex.exec(window)
		) {
			const value = match[0] ?? "";
			if (value) {
				matches.push(value);
			}
			regex.lastIndex = match.index + Math.max(1, codePointLength(value));
		}
		start = end;
	}
	return matches;
}
