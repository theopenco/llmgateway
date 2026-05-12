import {
	type BaseMessage,
	isImageUrlContent,
	isInputAudioContent,
	isTextContent,
	type ProviderId,
} from "@llmgateway/models";

import { processImageUrl } from "./process-image-url.js";

type GoogleAudioFormat =
	| "wav"
	| "mp3"
	| "aiff"
	| "aac"
	| "ogg"
	| "flac"
	| "m4a"
	| "mpeg"
	| "mpga"
	| "mp4"
	| "pcm"
	| "webm";

const VERTEX_FAMILY: ReadonlySet<string> = new Set(["google-vertex", "quartz"]);
const AI_STUDIO_FAMILY: ReadonlySet<string> = new Set([
	"google-ai-studio",
	"glacier",
]);

const AI_STUDIO_AUDIO_MIME: Partial<Record<GoogleAudioFormat, string>> = {
	wav: "audio/wav",
	mp3: "audio/mp3",
	aiff: "audio/aiff",
	aac: "audio/aac",
	ogg: "audio/ogg",
	flac: "audio/flac",
};

const VERTEX_AUDIO_MIME: Partial<Record<GoogleAudioFormat, string>> = {
	wav: "audio/wav",
	mp3: "audio/mp3",
	aac: "audio/x-aac",
	ogg: "audio/ogg",
	flac: "audio/flac",
	m4a: "audio/m4a",
	mpeg: "audio/mpeg",
	mpga: "audio/mpga",
	mp4: "audio/mp4",
	pcm: "audio/pcm",
	webm: "audio/webm",
};

/**
 * Returns true if the given provider can accept the given audio format.
 * For Google providers, checks the family-specific MIME map (AI Studio vs
 * Vertex have different format support). For non-Google providers, returns
 * true (this helper has no opinion about them — non-Google providers must be
 * filtered upstream by the `provider.audio` capability flag).
 */
export function googleProviderSupportsAudioFormat(
	providerId: ProviderId | string | undefined,
	format: string,
): boolean {
	const id = providerId ?? "";
	if (VERTEX_FAMILY.has(id)) {
		return format in VERTEX_AUDIO_MIME;
	}
	if (AI_STUDIO_FAMILY.has(id)) {
		return format in AI_STUDIO_AUDIO_MIME;
	}
	return true;
}

/**
 * Thrown when an audio format passes schema validation but is not supported
 * by the resolved Google provider (AI Studio vs Vertex have different MIME
 * support). The gateway maps this to HTTP 400 so the client sees the actual
 * format/provider mismatch instead of a generic 500.
 */
export class UnsupportedAudioFormatError extends Error {
	readonly format: string;
	readonly providerTarget: string;
	constructor(format: string, providerTarget: string) {
		super(`Audio format "${format}" is not supported by ${providerTarget}.`);
		this.name = "UnsupportedAudioFormatError";
		this.format = format;
		this.providerTarget = providerTarget;
	}
}

function resolveGoogleAudioMime(
	format: GoogleAudioFormat,
	providerId: ProviderId | string | undefined,
): string {
	const map = VERTEX_FAMILY.has(providerId ?? "")
		? VERTEX_AUDIO_MIME
		: AI_STUDIO_FAMILY.has(providerId ?? "")
			? AI_STUDIO_AUDIO_MIME
			: { ...AI_STUDIO_AUDIO_MIME, ...VERTEX_AUDIO_MIME };
	const mime = map[format];
	if (!mime) {
		const target = VERTEX_FAMILY.has(providerId ?? "")
			? "Vertex AI"
			: "Google AI Studio";
		throw new UnsupportedAudioFormatError(format, target);
	}
	return mime;
}

// Google-specific message format with all part types
interface GooglePart {
	text?: string;
	thoughtSignature?: string;
	inline_data?: {
		mime_type: string;
		data: string;
	};
	functionCall?: {
		name: string;
		args: Record<string, unknown>;
	};
	functionResponse?: {
		name: string;
		response: {
			result: unknown;
		};
	};
}

interface GoogleMessageExtended {
	role: "user" | "model";
	parts: GooglePart[];
}

/**
 * Transforms OpenAI format messages to Google format, handling:
 * - Text content
 * - Image content (with base64 conversion)
 * - Tool calls (functionCall)
 * - Tool results (functionResponse)
 * - Thought signatures for multi-turn conversations
 */
export async function transformGoogleMessages(
	messages: BaseMessage[],
	isProd = false,
	maxImageSizeMB = 20,
	userPlan: "free" | "pro" | "enterprise" | null = null,
	// Map of tool_call IDs to their thought signatures (retrieved from cache at gateway level)
	thoughtSignatureCache?: Map<string, string>,
	providerId?: ProviderId | string,
): Promise<GoogleMessageExtended[]> {
	const result: GoogleMessageExtended[] = [];

	for (const m of messages) {
		// Handle tool role messages - these become user messages with functionResponse
		if (m.role === "tool") {
			// Check if there's already a user message for function responses we can append to
			const lastMsg = result[result.length - 1];
			const functionResponsePart: GooglePart = {
				functionResponse: {
					name: m.name ?? "unknown_function",
					response: {
						result: m.content,
					},
				},
			};

			if (lastMsg && lastMsg.role === "user") {
				// Append to existing user message
				lastMsg.parts.push(functionResponsePart);
			} else {
				// Create new user message
				result.push({
					role: "user",
					parts: [functionResponsePart],
				});
			}
			continue;
		}

		// Handle assistant messages with tool_calls
		if (m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0) {
			const parts: GooglePart[] = [];

			// Add text content if present
			if (m.content) {
				if (Array.isArray(m.content)) {
					for (const content of m.content) {
						if (isTextContent(content)) {
							const textPart: GooglePart = { text: content.text };
							// Check for thought_signature in extra_content
							const extraContent = (content as any).extra_content;
							if (extraContent?.google?.thought_signature) {
								textPart.thoughtSignature =
									extraContent.google.thought_signature;
							}
							parts.push(textPart);
						}
					}
				} else if (typeof m.content === "string" && m.content) {
					parts.push({ text: m.content });
				}
			}

			// Add function calls
			for (const toolCall of m.tool_calls) {
				if (toolCall.type === "function") {
					let args: Record<string, unknown> = {};
					try {
						args = JSON.parse(toolCall.function.arguments ?? "{}");
					} catch {
						args = {};
					}
					const functionCallPart: GooglePart = {
						functionCall: {
							name: toolCall.function.name,
							args,
						},
					};
					// Check for thought_signature on the tool call
					const extraContent = (toolCall as any).extra_content;
					if (extraContent?.google?.thought_signature) {
						functionCallPart.thoughtSignature =
							extraContent.google.thought_signature;
					} else if (thoughtSignatureCache && toolCall.id) {
						// Retrieve from cache passed from gateway level
						const cachedSignature = thoughtSignatureCache.get(toolCall.id);
						if (cachedSignature) {
							functionCallPart.thoughtSignature = cachedSignature;
						}
					}
					parts.push(functionCallPart);
				}
			}

			result.push({
				role: "model",
				parts,
			});
			continue;
		}

		// Handle regular messages (user, system, assistant without tool_calls)
		const role = m.role === "assistant" ? "model" : "user";
		const parts: GooglePart[] = [];

		if (Array.isArray(m.content)) {
			for (const content of m.content) {
				if (isTextContent(content)) {
					const textPart: GooglePart = { text: content.text };
					// Check for thought_signature in extra_content
					const extraContent = (content as any).extra_content;
					if (extraContent?.google?.thought_signature) {
						textPart.thoughtSignature = extraContent.google.thought_signature;
					}
					parts.push(textPart);
				} else if (isImageUrlContent(content)) {
					const imageUrl = content.image_url.url;
					try {
						const { data, mimeType } = await processImageUrl(
							imageUrl,
							isProd,
							maxImageSizeMB,
							userPlan,
						);
						parts.push({
							inline_data: {
								mime_type: mimeType,
								data: data,
							},
						});
					} catch (error) {
						// Don't expose the URL in the error message for security
						const errorMsg =
							error instanceof Error ? error.message : "Unknown error";
						throw new Error(`Failed to process image: ${errorMsg}`);
					}
				} else if (isInputAudioContent(content)) {
					const mimeType = resolveGoogleAudioMime(
						content.input_audio.format as GoogleAudioFormat,
						providerId,
					);
					parts.push({
						inline_data: {
							mime_type: mimeType,
							data: content.input_audio.data,
						},
					});
				} else {
					throw new Error(
						`Not supported content type yet: ${(content as any).type}`,
					);
				}
			}
		} else {
			// String content
			parts.push({ text: m.content });
		}

		result.push({ role, parts });
	}

	return result;
}
