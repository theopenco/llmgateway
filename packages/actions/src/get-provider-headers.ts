import type { ProviderId } from "@llmgateway/models";

export interface ProviderHeaderOptions {
	/**
	 * Enable web search beta header for Anthropic
	 */
	webSearchEnabled?: boolean;
}

/**
 * Get the appropriate headers for a given provider API call
 */
export function getProviderHeaders(
	provider: ProviderId,
	token: string,
	options?: ProviderHeaderOptions,
): Record<string, string> {
	switch (provider) {
		case "anthropic": {
			const betaFeatures = ["tools-2024-04-04", "prompt-caching-2024-07-31"];
			if (options?.webSearchEnabled) {
				betaFeatures.push("web-search-2025-03-05");
			}
			return {
				"x-api-key": token,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": betaFeatures.join(","),
			};
		}
		case "google-ai-studio":
		case "google-vertex":
			return {};
		case "obsidian":
			return {
				Authorization: `Bearer ${token}`,
			};
		case "aws-bedrock":
			return {
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			};
		case "azure":
			return {
				"api-key": token,
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
