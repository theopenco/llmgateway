const CHARS_PER_TOKEN = 4;

interface ContentPart {
	type?: string;
	text?: string;
}

interface MessageLike {
	content?: string | ContentPart[] | null;
}

/**
 * Cheap chars/4 token estimate. Intentionally inaccurate — used on the
 * gateway hot path where running a real tokenizer is too expensive.
 */
export function estimateTokensFromText(
	text: string | null | undefined,
): number {
	if (!text) {
		return 0;
	}
	return Math.max(1, Math.round(text.length / CHARS_PER_TOKEN));
}

/**
 * Returns the rough text-token count for a chat message array.
 *
 * Only text payload is counted. Multimodal parts (image_url, file, audio,
 * video, etc.) are intentionally ignored — image input billing is computed
 * separately from `imageInputTokensByResolution` in costs.ts, so counting
 * the serialized blob here would double-count. Tool/audio/video inputs are
 * also not yet modeled and would distort the estimate if included verbatim.
 *
 * TODO: add multimodal-aware estimation that mirrors the per-model image
 * token tables. Tracked in https://github.com/theopenco/llmgateway/issues/2112.
 */
export function estimateChatMessageTokens(messages: MessageLike[]): number {
	if (!messages || messages.length === 0) {
		return 0;
	}
	let totalLength = 0;
	for (const message of messages) {
		const content = message.content;
		if (typeof content === "string") {
			totalLength += content.length;
			continue;
		}
		if (Array.isArray(content)) {
			for (const part of content) {
				if (part && typeof part === "object" && typeof part.text === "string") {
					totalLength += part.text.length;
				}
			}
		}
	}
	if (totalLength === 0) {
		return 0;
	}
	return Math.max(1, Math.round(totalLength / CHARS_PER_TOKEN));
}
