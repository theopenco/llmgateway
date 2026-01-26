import {
	type BaseMessage,
	isImageUrlContent,
	isTextContent,
} from "@llmgateway/models";

import { processImageUrl } from "./process-image-url.js";

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
): Promise<GoogleMessageExtended[]> {
	const result: GoogleMessageExtended[] = [];

	for (const m of messages) {
		// Handle tool role messages - these become user messages with functionResponse
		if (m.role === "tool") {
			// Check if there's already a user message for function responses we can append to
			const lastMsg = result[result.length - 1];
			const functionResponsePart: GooglePart = {
				functionResponse: {
					name: m.name || "unknown_function",
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
						args = JSON.parse(toolCall.function.arguments || "{}");
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
