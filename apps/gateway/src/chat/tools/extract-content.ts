import type { Provider } from "@llmgateway/models";

/**
 * Extracts content from streaming data based on provider format
 */
export function extractContent(data: any, provider: Provider): string {
	switch (provider) {
		case "google-ai-studio":
		case "google-vertex": {
			const parts = data.candidates?.[0]?.content?.parts || [];
			// Filter parts that are NOT thoughts and map text content
			// Use the same logic as transformStreamingToOpenai for consistency
			return (
				parts
					.filter((part: any) => !part.thought)
					.map((part: any) => (typeof part.text === "string" ? part.text : ""))
					.join("") || ""
			);
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
