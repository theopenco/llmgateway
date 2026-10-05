import { RE2JS } from "re2js";

const MAX_PATTERN_LENGTH = 1000;
// Bound retained patterns and validation errors; allocations are GC-managed.
const MAX_CACHED_PATTERNS = 256;
// Overlap bounded windows to include matches that cross a boundary.
const WINDOW_LENGTH = 65_536;
const WINDOW_OVERLAP = 4096;

type CompiledPattern = { regex: RE2JS } | { error: Error };

const compiledPatterns = new Map<string, CompiledPattern>();

const LONE_SURROGATE =
	/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

function getRegex(pattern: string, caseSensitive: boolean): RE2JS {
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
			compiled = {
				regex: RE2JS.compile(
					RE2JS.translateRegExp(pattern),
					caseSensitive ? 0 : RE2JS.CASE_INSENSITIVE,
				),
			};
		} catch (error) {
			compiled = {
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
		if (compiledPatterns.size >= MAX_CACHED_PATTERNS) {
			const [oldestKey] = compiledPatterns.entries().next().value!;
			compiledPatterns.delete(oldestKey);
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

/**
 * Rejects a pattern RE2 cannot compile or one that matches empty text, which
 * would flag every request.
 */
export function validateGuardrailRegex(pattern: string): void {
	const regex = getRegex(pattern, false);
	if (regex.matcher("").find()) {
		throw new Error("Guardrail regex patterns must not match empty text");
	}
}

/**
 * Returns every non-empty match of `pattern` in `content`.
 *
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
		const matcher = regex.matcher(window);
		while (matcher.find() && matcher.start() < end - start) {
			const value = matcher.group();
			if (value) {
				matches.push(value);
			}
		}
		start = end;
	}
	return matches;
}
