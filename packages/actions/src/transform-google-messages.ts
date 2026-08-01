import {
	type BaseMessage,
	isFileContent,
	isImageUrlContent,
	isInputAudioContent,
	isTextContent,
	type ProviderId,
} from "@llmgateway/models";

import { parseDataUrl } from "./parse-data-url.js";
import { processImageUrl } from "./process-image-url.js";
import { RequestError } from "./request-error.js";

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
	"iceberg",
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
	public readonly format: string;
	public readonly providerTarget: string;
	public constructor(format: string, providerTarget: string) {
		super(`Audio format "${format}" is not supported by ${providerTarget}.`);
		this.name = "UnsupportedAudioFormatError";
		this.format = format;
		this.providerTarget = providerTarget;
	}
}

/**
 * Thrown when a `file` content block is structurally invalid for Google
 * providers (e.g. missing `file_data`, or `file_data` that isn't a base64
 * data URL). The gateway maps this to HTTP 400 so the client gets an
 * actionable validation error instead of a generic 500.
 */
export class InvalidFileContentError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "InvalidFileContentError";
	}
}

/**
 * Thrown when an upstream Google provider rejects the request because the
 * document MIME we passed isn't supported by that specific model. We don't
 * pre-validate the MIME on our side — Gemini's per-model support varies and
 * Google's API is authoritative. Instead we parse Google's own error response
 * after the fact (see `parseGoogleUpstreamDocumentError`) and re-emit as this
 * typed error so the client sees a clean 400 with a consistent shape.
 */
export class UnsupportedDocumentFormatError extends Error {
	public readonly mimeType: string;
	public readonly providerTarget: string;
	public constructor(mimeType: string, providerTarget: string) {
		super(
			`Document MIME type "${mimeType}" is not supported by ${providerTarget}.`,
		);
		this.name = "UnsupportedDocumentFormatError";
		this.mimeType = mimeType;
		this.providerTarget = providerTarget;
	}
}

/**
 * Parses an upstream error response body from a Google provider. If the body
 * matches Google's "Unsupported MIME type: <mime>" pattern (HTTP 400 with
 * status `INVALID_ARGUMENT`), returns a typed `UnsupportedDocumentFormatError`
 * the gateway can throw to surface a clean 400 to the client. Returns null
 * for any other error shape — the caller falls back to its normal error path.
 *
 * Empirically verified against Google AI Studio generateContent — the error
 * shape is:
 *   { "error": { "code": 400, "status": "INVALID_ARGUMENT",
 *                "message": "Unsupported MIME type: application/msword" } }
 */
export function parseGoogleUpstreamDocumentError(
	errorBody: string,
	providerId: ProviderId | string | undefined,
): UnsupportedDocumentFormatError | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(errorBody);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") {
		return null;
	}
	const err = (parsed as { error?: unknown }).error;
	if (!err || typeof err !== "object") {
		return null;
	}
	const message = (err as { message?: unknown }).message;
	if (typeof message !== "string") {
		return null;
	}
	const match = message.match(/^Unsupported MIME type:\s*(.+?)\.?\s*$/i);
	if (!match) {
		return null;
	}
	return new UnsupportedDocumentFormatError(
		match[1].trim(),
		resolveGoogleProviderTarget(providerId),
	);
}

/**
 * Parses a `data:<mime>[;param=value]*;base64,<data>` URL into its parts.
 * Returns null when the value isn't a base64 data URL. Optional RFC 2397
 * MIME parameters (e.g. `;charset=utf-8`) are accepted but stripped, since
 * Google's `inline_data.mime_type` expects a bare type/subtype.
 *
 * Delegates to `parseDataUrl` so the (potentially multi-megabyte) base64 body
 * is never scanned or copied by a regex — only the short header is parsed.
 */
function parseFileDataUrl(
	fileData: string,
): { mimeType: string; data: string } | null {
	const parsed = parseDataUrl(fileData);
	if (!parsed || !parsed.isBase64 || !parsed.mediaType) {
		return null;
	}
	return { mimeType: parsed.mediaType, data: parsed.data };
}

function resolveGoogleProviderTarget(
	providerId: ProviderId | string | undefined,
): string {
	return VERTEX_FAMILY.has(providerId ?? "") ? "Vertex AI" : "Google AI Studio";
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
						// Preserve the RequestError type (and its status code) so the
						// gateway returns a 4xx and logs a client_error row instead of
						// treating a client-caused image failure as an unhandled 500.
						if (error instanceof RequestError) {
							throw new RequestError(
								`Failed to process image: ${errorMsg}`,
								error.statusCode,
							);
						}
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
				} else if (isFileContent(content)) {
					if (!content.file.file_data) {
						throw new InvalidFileContentError(
							"Google providers require base64 file_data on `file` content blocks; file_id references are not supported.",
						);
					}
					const parsed = parseFileDataUrl(content.file.file_data);
					if (!parsed) {
						throw new InvalidFileContentError(
							"Invalid file_data: expected a base64-encoded data URL (e.g. 'data:application/pdf;base64,...').",
						);
					}
					// MIME support varies across Gemini models, so we don't pre-validate;
					// Google's API is authoritative. If it rejects with "Unsupported MIME
					// type: X", `parseGoogleUpstreamDocumentError` (called by the gateway
					// after the upstream call) re-emits it as a typed
					// UnsupportedDocumentFormatError -> clean HTTP 400 for the client.
					parts.push({
						inline_data: {
							mime_type: parsed.mimeType,
							data: parsed.data,
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
