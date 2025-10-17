import type { ProviderId } from "./providers.js";

/**
 * Get the appropriate headers for a given provider API call
 */
export function getProviderHeaders(
	provider: ProviderId,
	token: string,
): Record<string, string> {
	switch (provider) {
		case "anthropic":
			return {
				"x-api-key": token,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": "tools-2024-04-04,prompt-caching-2024-07-31",
			};
		case "google-ai-studio":
			return {};
		case "aws-bedrock":
			return {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			};
		case "openai":
		case "inference.net":
		case "xai":
		case "groq":
		case "deepseek":
		case "perplexity":
		case "novita":
		case "moonshot":
		case "alibaba":
		case "nebius":
		case "zai":
		case "canopywave":
		case "custom":
		default:
			return {
				Authorization: `Bearer ${token}`,
			};
	}
}
