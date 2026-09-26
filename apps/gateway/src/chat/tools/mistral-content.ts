/**
 * Mistral serves thinking models (e.g. `zai-glm-5-3`) with `content` as an
 * array of typed chunks instead of a plain string: `text` chunks hold the
 * answer and `thinking` chunks hold the reasoning. Flatten both back into the
 * OpenAI shape the rest of the pipeline expects.
 */
export function normalizeMistralContent(content: unknown): {
	content: string | null;
	reasoning: string | null;
} {
	if (!Array.isArray(content)) {
		return {
			content: typeof content === "string" ? content : null,
			reasoning: null,
		};
	}

	let text = "";
	let reasoning = "";

	for (const chunk of content) {
		if (!chunk || typeof chunk !== "object") {
			continue;
		}
		const block = chunk as {
			type?: unknown;
			text?: unknown;
			thinking?: unknown;
		};
		if (block.type === "thinking") {
			reasoning += flattenText(block.thinking);
		} else if (typeof block.text === "string") {
			text += block.text;
		}
	}

	return { content: text, reasoning: reasoning || null };
}

function flattenText(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (!Array.isArray(value)) {
		return "";
	}
	let out = "";
	for (const entry of value) {
		if (entry && typeof entry === "object") {
			const { text } = entry as { text?: unknown };
			if (typeof text === "string") {
				out += text;
			}
		} else if (typeof entry === "string") {
			out += entry;
		}
	}
	return out;
}
