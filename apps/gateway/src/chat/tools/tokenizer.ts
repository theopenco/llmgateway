import { logger } from "@llmgateway/logger";
import {
	estimateChatMessageTokens,
	type TokenEstimateFallback,
} from "@llmgateway/shared";

/**
 * Converts a message content value (string, array of content parts, null, or
 * undefined) to a plain string. Used by call sites that need a flat string
 * (e.g. for cost estimation) — not for token counting; see
 * `encodeChatMessages` for that.
 */
export function messageContentToString(
	content: string | unknown[] | null | undefined,
): string {
	if (content === null || content === undefined) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	return JSON.stringify(content);
}

/**
 * Rough length-based prompt-token estimate for a chat message array.
 *
 * Backed by the shared `estimateChatMessageTokens` helper. By default this
 * counts text only and ignores multimodal parts (image_url, file, etc.) —
 * image input is priced separately in costs.ts, so the billing-fallback
 * callers must not include it here. Pass `modelId` to additionally count
 * multimodal parts (using the model's per-image token table); this is used for
 * routing decisions that should reflect large image payloads. See issue #2112.
 */
/**
 * Logs when the multimodal estimate had to use a rough default, so unknown
 * models/part types can be collected and the per-model token data improved
 * over time (issue #2112).
 */
function warnOnFallbackEstimate(fallback: TokenEstimateFallback): void {
	logger.warn("Multimodal token estimate fell back to a default", {
		modelId: fallback.modelId,
		imageParts: fallback.imageParts,
		otherParts: fallback.otherParts,
	});
}

export function encodeChatMessages(messages: any[], modelId?: string): number {
	return estimateChatMessageTokens(messages, modelId, warnOnFallbackEstimate);
}
