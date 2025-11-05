import { processImageUrl } from "./process-image-url.js";
import {
	type BaseMessage,
	type GoogleMessage,
	isImageUrlContent,
	isTextContent,
	type MessageContent,
} from "./types.js";

/**
 * Transforms Google messages to handle image URLs by converting them to base64
 */
export async function transformGoogleMessages(
	messages: BaseMessage[],
	isProd = false,
	maxImageSizeMB = 20,
	userPlan: "free" | "pro" | null = null,
): Promise<GoogleMessage[]> {
	return await Promise.all(
		messages.map(async (m) => ({
			role: m.role === "assistant" ? "model" : "user", // get rid of system role
			parts: Array.isArray(m.content)
				? await Promise.all(
						m.content.map(async (content: MessageContent) => {
							if (isTextContent(content)) {
								return {
									text: content.text,
								};
							}
							if (isImageUrlContent(content)) {
								const imageUrl = content.image_url.url;
								try {
									const { data, mimeType } = await processImageUrl(
										imageUrl,
										isProd,
										maxImageSizeMB,
										userPlan,
									);
									return {
										inline_data: {
											mime_type: mimeType,
											data: data,
										},
									};
								} catch (error) {
									// Don't expose the URL in the error message for security
									const errorMsg =
										error instanceof Error ? error.message : "Unknown error";
									throw new Error(`Failed to process image: ${errorMsg}`);
								}
							}
							throw new Error(
								`Not supported content type yet: ${content.type}`,
							);
						}),
					)
				: [
						{
							text: m.content,
						},
					],
		})),
	);
}
