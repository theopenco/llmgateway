function extractMinimaxReasoningDetails(reasoningDetails: any): string {
	if (!Array.isArray(reasoningDetails)) {
		return "";
	}

	return reasoningDetails
		.map((detail: any) => detail?.text)
		.filter((text: any): text is string => typeof text === "string")
		.join("");
}

import type { Provider } from "@llmgateway/models";

/**
 * Extracts reasoning content from streaming data based on provider format
 */
export function extractReasoning(data: any, provider: Provider): string {
	switch (provider) {
		case "anthropic": {
			// Handle Anthropic thinking content blocks in streaming format
			if (
				data.type === "content_block_delta" &&
				data.delta?.type === "thinking_delta" &&
				data.delta?.thinking
			) {
				// This is a thinking delta - return the thinking content
				return data.delta.thinking;
			}
			return "";
		}
		case "google-ai-studio":
		case "google-vertex":
		case "obsidian": {
			const parts = data.candidates?.[0]?.content?.parts ?? [];
			const reasoningParts = parts.filter((part: any) => part.thought);
			return reasoningParts.map((part: any) => part.text).join("") ?? "";
		}
		default: {
				const delta = data.choices?.[0]?.delta;
				return (
					delta?.reasoning ??
					delta?.reasoning_content ??
					extractMinimaxReasoningDetails(delta?.reasoning_details)
				);
			}
	}
}


export function extractMinimaxThinking(content: string | null | undefined): {
	content: string | null;
	reasoningContent: string | null;
} {
	if (typeof content !== "string") {
		return { content: content ?? null, reasoningContent: null };
	}

	const thinkPattern = /<think>([\s\S]*?)<\/think>/gi;
	let reasoningContent = "";
	const cleanedContent = content.replace(thinkPattern, (_, thinkText: string) => {
		reasoningContent += thinkText;
		return "";
	});

	const normalizedContent = cleanedContent.trim();
	return {
		content: normalizedContent.length > 0 ? normalizedContent : null,
		reasoningContent: reasoningContent || null,
	};
}
