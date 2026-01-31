/**
 * Quick heuristic to check if a string might be complete JSON.
 * Returns false if brackets are definitely unbalanced (avoiding expensive JSON.parse).
 * Returns true if it might be valid (still needs JSON.parse to confirm).
 * This is a performance optimization for SSE parsing where we do many validity checks.
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

	// Quick bracket count (doesn't account for strings, but catches obvious imbalances)
	let braces = 0;
	let brackets = 0;
	for (const c of trimmed) {
		if (c === "{") {
			braces++;
		} else if (c === "}") {
			braces--;
		} else if (c === "[") {
			brackets++;
		} else if (c === "]") {
			brackets--;
		}
	}

	return braces === 0 && brackets === 0;
}
