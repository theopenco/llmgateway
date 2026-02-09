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
