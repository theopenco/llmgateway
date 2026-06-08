import { models, type ModelDefinition } from "@llmgateway/models";

const CHARS_PER_TOKEN = 4;

/**
 * Fallback per-image token count when a model has no
 * `imageInputTokensByResolution` table. Mirrors `LEGACY_TOKENS_PER_INPUT_IMAGE`
 * in apps/gateway/src/lib/costs.ts so the estimate and the cost calculation
 * agree on the same default.
 */
const DEFAULT_TOKENS_PER_IMAGE = 560;

/**
 * File / audio / video parts have no per-model token table yet. We charge a
 * flat, deliberately rough estimate so the fallback prompt-token count isn't
 * wildly low for these payloads, without serializing the raw blob (which would
 * massively over-count via chars/4). Tuned to the same order of magnitude as a
 * single image.
 */
const DEFAULT_TOKENS_PER_NON_TEXT_PART = 560;

interface ContentPart {
	type?: string;
	text?: string;
	image_url?: unknown;
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
 * Resolve the per-image token count for a model id, mirroring the per-model
 * `imageInputTokensByResolution` tables used for billing in costs.ts. We don't
 * know the provider/region that will ultimately serve the request at estimate
 * time, so we take the first provider mapping that declares a table and prefer
 * its `default` resolution entry. When the model has no table we fall back to
 * `DEFAULT_TOKENS_PER_IMAGE` and report `isDefault` so callers can surface the
 * unknown case.
 */
function resolveTokensPerImage(modelId: string): {
	tokens: number;
	isDefault: boolean;
} {
	const model = models.find((m) => m.id === modelId) as
		| ModelDefinition
		| undefined;
	if (model) {
		for (const provider of model.providers) {
			const byResolution = provider.imageInputTokensByResolution;
			if (byResolution) {
				const tokens =
					byResolution.default ??
					Object.values(byResolution)[0] ??
					DEFAULT_TOKENS_PER_IMAGE;
				return { tokens, isDefault: false };
			}
		}
	}
	return { tokens: DEFAULT_TOKENS_PER_IMAGE, isDefault: true };
}

/**
 * Reported when {@link estimateChatMessageTokens} had to fall back to a rough
 * default because the model has no per-image table (`imageParts`) or because
 * file/audio/video parts have no per-model token data yet (`otherParts`).
 */
export interface TokenEstimateFallback {
	modelId: string;
	imageParts: number;
	otherParts: number;
}

function isImagePart(part: ContentPart): boolean {
	return (
		part.type === "image_url" ||
		part.type === "image" ||
		Boolean(part.image_url)
	);
}

function isOtherNonTextPart(part: ContentPart): boolean {
	return (
		part.type === "file" ||
		part.type === "input_file" ||
		part.type === "audio" ||
		part.type === "input_audio" ||
		part.type === "video"
	);
}

/**
 * Returns a rough prompt-token estimate for a chat message array.
 *
 * Text payload is counted as chars/4. When a `modelId` is supplied, multimodal
 * parts are also counted: each `image_url`/`image` part contributes the model's
 * per-image token count (from `imageInputTokensByResolution`, defaulting to
 * `DEFAULT_TOKENS_PER_IMAGE`), and file/audio/video parts contribute a flat
 * `DEFAULT_TOKENS_PER_NON_TEXT_PART`. The raw image/file blob is never counted
 * via chars/4 — that would both over-count the payload here and double-count
 * against the separate `imageInputCost` in costs.ts.
 *
 * When no `modelId` is supplied the estimate stays text-only (the historical
 * behavior), so callers on the billing path — where image input is priced
 * separately — can opt out of multimodal counting and avoid double-counting.
 *
 * Tracked in https://github.com/theopenco/llmgateway/issues/2112.
 */
export function estimateChatMessageTokens(
	messages: MessageLike[],
	modelId?: string,
	onFallback?: (fallback: TokenEstimateFallback) => void,
): number {
	if (!messages || messages.length === 0) {
		return 0;
	}
	const countMultimodal = modelId !== undefined;
	let tokensPerImage = 0;
	let imageRateIsDefault = false;
	if (countMultimodal) {
		const resolved = resolveTokensPerImage(modelId);
		tokensPerImage = resolved.tokens;
		imageRateIsDefault = resolved.isDefault;
	}

	let totalLength = 0;
	let nonTextTokens = 0;
	let fallbackImageParts = 0;
	let fallbackOtherParts = 0;
	for (const message of messages) {
		const content = message.content;
		if (typeof content === "string") {
			totalLength += content.length;
			continue;
		}
		if (Array.isArray(content)) {
			for (const part of content) {
				if (!part || typeof part !== "object") {
					continue;
				}
				if (typeof part.text === "string") {
					totalLength += part.text.length;
					continue;
				}
				if (!countMultimodal) {
					continue;
				}
				if (isImagePart(part)) {
					nonTextTokens += tokensPerImage;
					if (imageRateIsDefault) {
						fallbackImageParts++;
					}
				} else if (isOtherNonTextPart(part)) {
					nonTextTokens += DEFAULT_TOKENS_PER_NON_TEXT_PART;
					fallbackOtherParts++;
				}
			}
		}
	}

	if (
		countMultimodal &&
		onFallback &&
		(fallbackImageParts > 0 || fallbackOtherParts > 0)
	) {
		onFallback({
			modelId: modelId as string,
			imageParts: fallbackImageParts,
			otherParts: fallbackOtherParts,
		});
	}

	const textTokens =
		totalLength === 0
			? 0
			: Math.max(1, Math.round(totalLength / CHARS_PER_TOKEN));
	return textTokens + nonTextTokens;
}
