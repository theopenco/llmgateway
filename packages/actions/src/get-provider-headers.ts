import type { ProviderId } from "@llmgateway/models";

export interface ProviderHeaderOptions {
	/**
	 * Enable web search beta header for Anthropic
	 */
	webSearchEnabled?: boolean;
	requestId?: string;
	/**
	 * OpenAI-compatible processing tier selected by the caller via the
	 * `service_tier` request field. For Google Vertex AI, "flex" and "priority"
	 * are mapped to the `X-Vertex-AI-LLM-Shared-Request-Type` header (Flex /
	 * Priority PayGo). Other values and other providers ignore this.
	 */
	serviceTier?: string;
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
			return requestIdHeader;
		case "google-vertex": {
			// Map the OpenAI-compatible `service_tier` to Vertex's Flex / Priority
			// PayGo header. Only "flex" and "priority" are valid; standard/default
			// requests omit the header. Flex and Priority PayGo are served only on
			// the global endpoint (the gateway's default Vertex region).
			if (
				options?.serviceTier === "flex" ||
				options?.serviceTier === "priority"
			) {
				return {
					...requestIdHeader,
					"X-Vertex-AI-LLM-Shared-Request-Type": options.serviceTier,
				};
			}
			return requestIdHeader;
		}
		case "quartz":
			return requestIdHeader;
		case "vertex-anthropic":
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
			};
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
		case "azure-ai-foundry":
			return {
				...requestIdHeader,
				"api-key": token,
			};
		case "elevenlabs":
			return {
				...requestIdHeader,
				"xi-api-key": token,
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
		case "embercloud":
		case "deepinfra":
		case "custom":
		default:
			return {
				...requestIdHeader,
				Authorization: `Bearer ${token}`,
			};
	}
}
