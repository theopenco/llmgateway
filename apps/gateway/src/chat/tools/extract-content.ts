import type { Provider } from "@llmgateway/models";

/**
 * Extracts content from streaming data based on provider format
 */
export function extractContent(data: any, provider: Provider): string {
	switch (provider) {
		case "google-ai-studio":
		case "glacier":
		case "iceberg":
		case "google-vertex":
		case "quartz": {
			const parts = data.candidates?.[0]?.content?.parts ?? [];
			const contentParts = parts.filter((part: any) => !part.thought);
			return contentParts.map((part: any) => part.text).join("") ?? "";
		}
		case "anthropic":
		case "vertex-anthropic":
			if (data.type === "content_block_delta" && data.delta?.text) {
				return data.delta.text;
			} else if (data.delta?.text) {
				return data.delta.text;
			}
			return "";
		default: {
			// OpenAI format. Sum content across every choice so multi-choice
			// streams (n > 1) accumulate into the logging buffer instead of
			// silently dropping indices > 0.
			const choices = Array.isArray(data.choices) ? data.choices : [];
			let combined = "";
			for (const choice of choices) {
				const content = choice?.delta?.content;
				if (typeof content === "string") {
					combined += content;
				}
			}
			return combined;
		}
	}
}
