export function parseCommaSeparatedEnv(value: string): string[] {
	const entries: string[] = [];
	let current = "";
	let depth = 0;
	let inString = false;
	let escaped = false;

	for (const char of value) {
		if (escaped) {
			current += char;
			escaped = false;
			continue;
		}

		if (inString) {
			current += char;
			if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}

		switch (char) {
			case '"':
				inString = true;
				current += char;
				break;
			case "{":
				depth++;
				current += char;
				break;
			case "}":
				if (depth > 0) {
					depth--;
				}
				current += char;
				break;
			case ",":
				if (depth === 0) {
					entries.push(current);
					current = "";
				} else {
					current += char;
				}
				break;
			default:
				current += char;
		}
	}

	entries.push(current);

	return entries.map((v) => v.trim()).filter((v) => v.length > 0);
}
