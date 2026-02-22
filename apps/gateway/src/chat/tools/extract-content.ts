import type { Provider } from "@llmgateway/models";

/**
 * Extracts content from streaming data based on provider format
 */
export function extractContent(data: any, provider: Provider): string {
	switch (provider) {
		case "google-ai-studio":
		case "google-vertex":
		case "obsidian": {
			const parts = data.candidates?.[0]?.content?.parts || [];
			const contentParts = parts.filter((part: any) => !part.thought);
			return contentParts.map((part: any) => part.text).join("") || "";
		}
		case "anthropic":
			if (data.type === "content_block_delta" && data.delta?.text) {
				return data.delta.text;
			} else if (data.delta?.text) {
				return data.delta.text;
			}
			return "";
		default: // OpenAI format
			return data.choices?.[0]?.delta?.content || "";
	}
}
