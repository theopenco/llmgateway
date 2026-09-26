import { RE2 } from "re2-wasm";

export function compileGuardrailRegex(
	pattern: string,
	caseSensitive = false,
): RE2 {
	if (pattern.length > 1000) {
		throw new Error("Guardrail regex patterns must not exceed 1000 characters");
	}
	return new RE2(pattern, caseSensitive ? "gu" : "giu");
}
