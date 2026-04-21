import type { ProviderId } from "@llmgateway/models";

export interface ProviderHeaderOptions {
	/**
	 * Enable web search beta header for Anthropic
	 */
	webSearchEnabled?: boolean;
	requestId?: string;
}

/**
 * Get the appropriate headers for a given provider API call
 */
export function getProviderHeaders(
	provider: ProviderId,
	token: string,
	options?: ProviderHeaderOptions,
): Record<string, string> {
	const requestIdHeader: Record<string, string> = {};
	if (options?.requestId) {
		requestIdHeader["x-request-id"] = options.requestId;
	}

	switch (provider) {
		case "anthropic": {
			const betaFeatures = ["tools-2024-04-04", "prompt-caching-2024-07-31"];
			if (options?.webSearchEnabled) {
				betaFeatures.push("web-search-2025-03-05");
			}
			return {
				...requestIdHeader,
				"x-api-key": token,
				"anthropic-version": "2023-06-01",
				"anthropic-beta": betaFeatures.join(","),
			};
		}
		case "google-ai-studio":
		case "glacier":
		case "google-vertex":
		case "quartz":
			return requestIdHeader;
		case "avalanche":
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
			};
		case "aws-bedrock":
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
				"Content-Type": "application/json",
			};
		case "azure":
			return {
				...requestIdHeader,
				"api-key": token,
			};
		case "openai":
		case "inference.net":
		case "xai":
		case "groq":
		case "deepseek":
		case "bluestone":
		case "perplexity":
		case "novita":
		case "moonshot":
		case "alibaba":
		case "nebius":
		case "zai":
		case "canopywave":
		case "embercloud":
		case "custom":
		default:
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
			};
	}
}
