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
		case "google-vertex": {
			const parts = data.candidates?.[0]?.content?.parts || [];
			const reasoningParts = parts.filter((part: any) => part.thought);
			return reasoningParts.map((part: any) => part.text).join("") || "";
		}
		default: // OpenAI format (includes GLM/ZAI which use reasoning_content)
			return (
				data.choices?.[0]?.delta?.reasoning ||
				data.choices?.[0]?.delta?.reasoning_content ||
				""
			);
	}
}
