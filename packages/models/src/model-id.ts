/**
 * Catalogue model ids: lowercase letters, digits, dots and hyphens, starting
 * and ending with a letter or digit (e.g. "deepseek-v4.1-flash"). Every model
 * in the catalogue satisfies it; see model-id.spec.ts.
 */
export const MODEL_ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

const MODEL_ID_EXAMPLE = "deepseek-v4.1-flash";

export function isValidModelId(id: string): boolean {
	return MODEL_ID_PATTERN.test(id);
}

function withoutSeparators(id: string): string {
	return id.replace(/[.-]/g, "");
}

/**
 * Best-effort conversion of what a carrier typed (often their own
 * "provider/Display Name") into a catalogue-style model id.
 */
export function suggestModelId(
	input: string,
	knownIds?: readonly string[],
): string | null {
	const segment = input.slice(input.lastIndexOf("/") + 1);
	const candidate = segment
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, "-")
		.replace(/[^a-z0-9.-]/g, "")
		.replace(/([.-])[.-]+/g, "$1")
		.replace(/^[.-]+|[.-]+$/g, "");
	if (!candidate) {
		return null;
	}
	if (knownIds?.length) {
		if (knownIds.includes(candidate)) {
			return candidate;
		}
		const bare = withoutSeparators(candidate);
		const loose = knownIds.find((id) => withoutSeparators(id) === bare);
		if (loose) {
			return loose;
		}
	}
	return isValidModelId(candidate) ? candidate : null;
}

/** A short, user-facing explanation of why `input` is not a valid model id. */
export function modelIdProblem(input: string): string | null {
	if (isValidModelId(input)) {
		return null;
	}
	if (!input.trim()) {
		return "Enter a model ID.";
	}
	const base = `Use the catalogue model ID, like "${MODEL_ID_EXAMPLE}" — no provider prefix ("deepseek/"), spaces or capitals.`;
	const suggestion = suggestModelId(input);
	return suggestion && suggestion !== input
		? `${base} Did you mean "${suggestion}"?`
		: base;
}
