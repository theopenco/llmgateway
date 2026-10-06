import {
	getSemanticCachePointer,
	normalizedPromptKey,
	semanticCachePointerKey,
} from "@llmgateway/cache";

import type { SemanticCacheMode } from "@llmgateway/db";
import type { BaseMessage } from "@llmgateway/models";

/** Written to the log row so every semantic decision can be audited later. */
export interface SemanticCacheAudit {
	matchedCacheKey: string;
	/** False in shadow mode: the match was recorded but the request went upstream. */
	served: boolean;
}

/** The final user turn's text, or null when it is not text-only. */
function finalUserText(last: BaseMessage | undefined): string | null {
	if (!last || last.role !== "user") {
		return null;
	}
	const { content } = last as { content?: unknown };
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return null;
	}
	const texts: string[] = [];
	for (const part of content) {
		if (
			!part ||
			typeof part !== "object" ||
			!("type" in part) ||
			part.type !== "text" ||
			!("text" in part) ||
			typeof part.text !== "string"
		) {
			return null;
		}
		texts.push(part.text);
	}
	return texts.join("\n");
}

/**
 * Pointer key for a request, or null when its final turn is not a text-only
 * user message. `payload` is the exact-cache payload: everything in it must
 * match exactly except the final user turn's text, which matches by
 * `normalizedPromptKey`.
 */
export function semanticCachePointerFor(options: {
	projectId: string;
	payload: { messages: BaseMessage[] } & Record<string, unknown>;
	stream: boolean;
}): string | null {
	const { messages, ...rest } = options.payload;
	const last = messages[messages.length - 1];
	const text = finalUserText(last);
	if (text === null) {
		return null;
	}
	return semanticCachePointerKey(options.projectId, {
		...rest,
		stream: options.stream,
		context: messages.slice(0, -1),
		last: { ...last, content: undefined },
		prompt: normalizedPromptKey(text),
	});
}

/** The cached response a pointer names, if it still exists. */
export async function findSemanticCacheMatch<T>(
	pointerKey: string,
	mode: Exclude<SemanticCacheMode, "off">,
	load: (cacheKey: string) => Promise<T | null>,
): Promise<{ response: T; audit: SemanticCacheAudit } | null> {
	const matchedCacheKey = await getSemanticCachePointer(pointerKey);
	const response = matchedCacheKey ? await load(matchedCacheKey) : null;
	if (!matchedCacheKey || response === null) {
		return null;
	}
	return { response, audit: { matchedCacheKey, served: mode === "on" } };
}
