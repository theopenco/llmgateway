import { models, type ProviderModelMapping } from "./models.js";

import type { ProviderId } from "./providers.js";
import type { ProviderKeyOptions } from "@llmgateway/db";

/**
 * Get the nth value from a comma-separated environment variable
 * Used for related environment variables (e.g., regions) that should match the API key index
 */
function getNthEnvValue(
	envValue: string | undefined,
	index: number,
	defaultValue?: string,
): string | undefined {
	if (!envValue) {
		return defaultValue;
	}

	const values = envValue
		.split(",")
		.map((v) => v.trim())
		.filter((v) => v.length > 0);

	if (values.length === 0) {
		return defaultValue;
	}

	// If index is out of bounds, use the last value
	// This allows having fewer region/project entries than API keys
	if (index >= values.length) {
		return values[values.length - 1];
	}

	return values[index];
}

/**
 * Get the endpoint URL for a provider API call
 */
export function getProviderEndpoint(
	provider: ProviderId,
	baseUrl?: string,
	model?: string,
	token?: string,
	stream?: boolean,
	supportsReasoning?: boolean,
	hasExistingToolCalls?: boolean,
	providerKeyOptions?: ProviderKeyOptions,
	configIndex?: number,
): string {
	let modelName = model;
	if (model && model !== "custom") {
		const modelInfo = models.find((m) => m.id === model);
		if (modelInfo) {
			const providerMapping = modelInfo.providers.find(
				(p) => p.providerId === provider,
			);
			if (providerMapping) {
				modelName = providerMapping.modelName;
			}
		}
	}
	let url: string;

	if (baseUrl) {
		url = baseUrl;
	} else {
		switch (provider) {
			case "llmgateway":
				if (model === "custom" || model === "auto") {
					// For custom model, use a default URL for testing
					url = "https://api.openai.com";
				} else {
					throw new Error(`Provider ${provider} requires a baseUrl`);
				}
				break;
			case "openai":
				url = "https://api.openai.com";
				break;
			case "anthropic":
				url = "https://api.anthropic.com";
				break;
			case "google-ai-studio":
				url = "https://generativelanguage.googleapis.com";
				break;
			case "google-vertex":
				url = "https://aiplatform.googleapis.com";
				break;
			case "inference.net":
				url = "https://api.inference.net";
				break;
			case "together.ai":
				url = "https://api.together.ai";
				break;
			case "cloudrift":
				url = "https://inference.cloudrift.ai";
				break;
			case "mistral":
				url = "https://api.mistral.ai";
				break;
			case "xai":
				url = "https://api.x.ai";
				break;
			case "groq":
				url = "https://api.groq.com/openai";
				break;
			case "deepseek":
				url = "https://api.deepseek.com";
				break;
			case "perplexity":
				url = "https://api.perplexity.ai";
				break;
			case "novita":
				url = "https://api.novita.ai/v3/openai";
				break;
			case "moonshot":
				url = "https://api.moonshot.ai";
				break;
			case "alibaba":
				url = "https://dashscope-intl.aliyuncs.com/compatible-mode";
				break;
			case "nebius":
				url = "https://api.studio.nebius.com";
				break;
			case "zai":
				url = "https://api.z.ai";
				break;
			case "routeway":
				url = "https://api.routeway.ai";
				break;
			case "routeway-discount":
				url =
					process.env.LLM_ROUTEWAY_DISCOUNT_BASE_URL || "https://example.com";
				break;
			case "nanogpt":
				url = "https://nano-gpt.com/api";
				break;
			case "aws-bedrock":
				url =
					process.env.LLM_AWS_BEDROCK_BASE_URL ||
					"https://bedrock-runtime.us-east-1.amazonaws.com";
				break;
			case "azure": {
				let resource =
					providerKeyOptions?.azure_resource || process.env.LLM_AZURE_RESOURCE;

				// Support multiple resources via comma-separated values
				if (configIndex !== undefined && !providerKeyOptions?.azure_resource) {
					resource = getNthEnvValue(
						process.env.LLM_AZURE_RESOURCE,
						configIndex,
					);
				}

				if (!resource) {
					throw new Error(
						"Azure resource is required - set via provider options or LLM_AZURE_RESOURCE env var",
					);
				}
				url = `https://${resource}.openai.azure.com`;
				break;
			}
			case "canopywave":
				url = "https://inference.canopywave.io";
				break;
			case "custom":
				if (!baseUrl) {
					throw new Error(`Custom provider requires a baseUrl`);
				}
				url = baseUrl;
				break;
			default:
				throw new Error(`Provider ${provider} requires a baseUrl`);
		}
	}

	switch (provider) {
		case "anthropic":
			return `${url}/v1/messages`;
		case "google-ai-studio": {
			const endpoint = stream ? "streamGenerateContent" : "generateContent";
			const baseEndpoint = modelName
				? `${url}/v1beta/models/${modelName}:${endpoint}`
				: `${url}/v1beta/models/gemini-2.0-flash:${endpoint}`;
			const queryParams = [];
			if (token) {
				queryParams.push(`key=${token}`);
			}
			if (stream) {
				queryParams.push("alt=sse");
			}
			return queryParams.length > 0
				? `${baseEndpoint}?${queryParams.join("&")}`
				: baseEndpoint;
		}
		case "google-vertex": {
			const endpoint = stream ? "streamGenerateContent" : "generateContent";
			const model = modelName || "gemini-2.5-flash-lite";

			// Special handling for some models which require a non-global location
			let baseEndpoint: string;
			if (
				model === "gemini-2.0-flash-lite" ||
				model === "gemini-2.5-flash-lite"
			) {
				baseEndpoint = `${url}/v1/publishers/google/models/${model}:${endpoint}`;
			} else {
				const projectIdRaw = process.env.LLM_GOOGLE_CLOUD_PROJECT;
				const projectId =
					configIndex !== undefined
						? getNthEnvValue(projectIdRaw, configIndex)
						: projectIdRaw;

				const regionRaw = process.env.LLM_GOOGLE_VERTEX_REGION;
				const region =
					configIndex !== undefined
						? getNthEnvValue(regionRaw, configIndex, "global") || "global"
						: regionRaw || "global";

				if (!projectId) {
					throw new Error(
						"LLM_GOOGLE_CLOUD_PROJECT environment variable is required for gemini-2.5-flash-preview-09-2025",
					);
				}

				baseEndpoint = `${url}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:${endpoint}`;
			}

			const queryParams = [];
			if (token) {
				queryParams.push(`key=${token}`);
			}
			if (stream) {
				queryParams.push("alt=sse");
			}
			return queryParams.length > 0
				? `${baseEndpoint}?${queryParams.join("&")}`
				: baseEndpoint;
		}
		case "perplexity":
			return `${url}/chat/completions`;
		case "novita":
			return `${url}/chat/completions`;
		case "zai":
			return `${url}/api/paas/v4/chat/completions`;
		case "aws-bedrock": {
			let prefix =
				providerKeyOptions?.aws_bedrock_region_prefix ||
				process.env.LLM_AWS_BEDROCK_REGION ||
				"us.";

			// Support multiple regions via comma-separated values
			if (
				configIndex !== undefined &&
				!providerKeyOptions?.aws_bedrock_region_prefix
			) {
				prefix =
					getNthEnvValue(
						process.env.LLM_AWS_BEDROCK_REGION,
						configIndex,
						"us.",
					) || "us.";
			}

			const endpoint = stream ? "converse-stream" : "converse";
			return `${url}/model/${prefix}${modelName}/${endpoint}`;
		}
		case "azure": {
			let deploymentType =
				providerKeyOptions?.azure_deployment_type ||
				process.env.LLM_AZURE_DEPLOYMENT_TYPE ||
				"ai-foundry";

			// Support multiple deployment types via comma-separated values
			if (
				configIndex !== undefined &&
				!providerKeyOptions?.azure_deployment_type
			) {
				deploymentType =
					getNthEnvValue(
						process.env.LLM_AZURE_DEPLOYMENT_TYPE,
						configIndex,
						"ai-foundry",
					) || "ai-foundry";
			}

			if (deploymentType === "openai") {
				// Traditional Azure (deployment-based)
				let apiVersion =
					providerKeyOptions?.azure_api_version ||
					process.env.LLM_AZURE_API_VERSION ||
					"2024-10-21";

				// Support multiple API versions via comma-separated values
				if (
					configIndex !== undefined &&
					!providerKeyOptions?.azure_api_version
				) {
					apiVersion =
						getNthEnvValue(
							process.env.LLM_AZURE_API_VERSION,
							configIndex,
							"2024-10-21",
						) || "2024-10-21";
				}

				return `${url}/openai/deployments/${modelName}/chat/completions?api-version=${apiVersion}`;
			} else {
				// Azure AI Foundry (unified endpoint)
				return `${url}/openai/v1/chat/completions`;
			}
		}
		case "openai":
			// Use responses endpoint for reasoning models that support responses API
			// but not when there are existing tool calls in the conversation
			if (
				supportsReasoning &&
				model &&
				!hasExistingToolCalls &&
				process.env.USE_RESPONSES_API === "true"
			) {
				const modelDef = models.find((m) => m.id === model);
				const providerMapping = modelDef?.providers.find(
					(p) => p.providerId === "openai",
				);
				const supportsResponsesApi =
					(providerMapping as ProviderModelMapping)?.supportsResponsesApi !==
					false;

				if (supportsResponsesApi) {
					return `${url}/v1/responses`;
				}
			}
			return `${url}/v1/chat/completions`;
		case "inference.net":
		case "llmgateway":
		case "cloudrift":
		case "xai":
		case "groq":
		case "deepseek":
		case "moonshot":
		case "alibaba":
		case "nebius":
		case "routeway":
		case "routeway-discount":
		case "nanogpt":
		case "canopywave":
		case "custom":
		default:
			return `${url}/v1/chat/completions`;
	}
}
