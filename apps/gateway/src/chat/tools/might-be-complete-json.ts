/**
 * Quick heuristic to check if a string might be complete JSON.
 * Returns false if brackets are definitely unbalanced (avoiding expensive JSON.parse).
 * Returns true if it might be valid (still needs JSON.parse to confirm).
 * This is a performance optimization for SSE parsing where we do many validity checks.
 *
 * For large strings (e.g. base64 image data), we use an optimized approach:
 * scan from both ends inward to find the structural boundaries, avoiding
 * a full O(n) scan of multi-MB payloads.
 */
export function mightBeCompleteJson(str: string): boolean {
	const trimmed = str.trim();
	if (trimmed.length === 0) {
		return false;
	}

	const firstChar = trimmed[0];
	const lastChar = trimmed[trimmed.length - 1];

	// Quick check: must start with { or [ and end with } or ]
	if (firstChar === "{") {
		if (lastChar !== "}") {
			return false;
		}
	} else if (firstChar === "[") {
		if (lastChar !== "]") {
			return false;
		}
	} else {
		// Not a JSON object or array
		return false;
	}

	// For large payloads (e.g. containing base64 image data), scanning the entire
	// string character-by-character is extremely expensive (O(n) on multi-MB data).
	// Instead, we scan from the start and end inward, only examining the structural
	// JSON boundaries. Large base64 strings in the middle are inside a JSON string
	// value, so we only need to verify the outer structure is balanced.
	//
	// The threshold is set at 100KB - below this, the full scan is fast enough.
	// Above this, payloads almost always contain large opaque string values
	// (base64 images, long text) where scanning every character is wasteful.
	const LARGE_PAYLOAD_THRESHOLD = 100 * 1024;
	if (trimmed.length > LARGE_PAYLOAD_THRESHOLD) {
		return mightBeCompleteJsonLarge(trimmed);
	}

	// Count brackets/braces, skipping content inside strings
	let braces = 0;
	let brackets = 0;
	let inString = false;
	let i = 0;

	while (i < trimmed.length) {
		const c = trimmed[i];

		if (inString) {
			if (c === "\\") {
				// Skip escaped character
				i += 2;
				continue;
			} else if (c === '"') {
				inString = false;
			}
		} else {
			if (c === '"') {
				inString = true;
			} else if (c === "{") {
				braces++;
			} else if (c === "}") {
				braces--;
			} else if (c === "[") {
				brackets++;
			} else if (c === "]") {
				brackets--;
			}
		}
		i++;
	}

	// If still in string, the JSON is incomplete
	if (inString) {
		return false;
	}

	return braces === 0 && brackets === 0;
}

/**
 * Optimized heuristic for large JSON payloads (100KB+).
 *
 * This function must honor the same contract as `mightBeCompleteJson`: it may
 * only return `false` when the payload is *definitely* incomplete. Returning a
 * false negative here is not merely a wasted `JSON.parse` — the SSE scanner in
 * chat.ts uses this result to decide where an event ends, so a spurious `false`
 * makes it over-consume and merge two SSE events into one string, which then
 * throws a `json_parse_error` ("Unexpected non-whitespace character after JSON").
 *
 * We scan a bounded window from the start. The common large-payload case is a
 * single opaque string value (e.g. a base64 image): a *truncated* one ends
 * mid-string, so its last char is not `}`/`]` and the caller's cheap first/last
 * char check already rejects it before we get here. That means anything reaching
 * this function already *looks* complete. Rather than trying to prove balance
 * cheaply — which is unsound for large, densely-structured JSON (e.g. an OpenAI
 * `response.created` event with a big `tools` array), where the structural depth
 * lives across the whole payload and not just at the ends — we defer the final
 * decision to `JSON.parse` and return `true`. We still return an exact answer
 * for payloads whose structure fits inside the scan window.
 */
function mightBeCompleteJsonLarge(trimmed: string): boolean {
	const SCAN_LIMIT = 8192; // scan at most 8KB from the start

	// Forward scan: count structural depth until we run out of window
	let braces = 0;
	let brackets = 0;
	let inString = false;
	let i = 0;
	const forwardEnd = Math.min(trimmed.length, SCAN_LIMIT);

	while (i < forwardEnd) {
		const c = trimmed[i];
		if (inString) {
			if (c === "\\") {
				i += 2;
				continue;
			} else if (c === '"') {
				inString = false;
			}
		} else {
			if (c === '"') {
				inString = true;
			} else if (c === "{") {
				braces++;
			} else if (c === "}") {
				braces--;
			} else if (c === "[") {
				brackets++;
			} else if (c === "]") {
				brackets--;
			}
		}
		i++;
	}

	// If the whole payload fit inside the window, we have an exact answer.
	if (i >= trimmed.length) {
		return !inString && braces === 0 && brackets === 0;
	}

	// The structure extends beyond our scan window. We cannot cheaply prove the
	// payload is unbalanced (a mismatch measured only at the ends is unsound for
	// densely-structured JSON), so we must not return a false negative here.
	// The first/last char check already passed, so let JSON.parse decide.
	return true;
}
