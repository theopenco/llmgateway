import {
	models,
	providers,
	expandAllProviderRegions,
	type ProviderDefinition,
	type ProviderModelMapping,
	type ProviderId,
	type VertexTokenType,
	getProviderEnvValue,
	getProviderEnvConfig,
	resolveVertexTokenType,
} from "@llmgateway/models";

import type { ProviderKeyOptions } from "@llmgateway/db";

function appendPath(url: string, path: string): string {
	return `${url.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function getBedrockMantleBaseUrl(url: string, region?: string): string {
	if (url.includes("/openai/v1")) {
		return url;
	}
	if (url.includes("bedrock-mantle.")) {
		return appendPath(url, "/openai/v1");
	}
	if (url.includes("bedrock-runtime.")) {
		const mantleRegion =
			region === "global" || region === "us"
				? "us-west-2"
				: (region ?? "us-west-2");
		return `https://bedrock-mantle.${mantleRegion}.api.aws/openai/v1`;
	}
	return appendPath(url, "/openai/v1");
}

function buildVertexCompatibleEndpoint(
	provider: "google-vertex" | "quartz",
	url: string,
	externalId: string | undefined,
	token: string | undefined,
	stream: boolean | undefined,
	configIndex: number | undefined,
	providerKeyOptions?: ProviderKeyOptions,
	skipEnvVars?: boolean,
	vertexTokenType?: VertexTokenType,
): string {
	const endpoint = stream ? "streamGenerateContent" : "generateContent";
	const model = externalId ?? "gemini-2.5-flash-lite";

	const projectId =
		providerKeyOptions?.google_vertex_project_id ??
		getProviderEnvValue(provider, "project", configIndex);
	const region =
		getProviderEnvValue(provider, "region", configIndex, "global") ?? "global";

	if (!projectId) {
		const providerEnv = getProviderEnvConfig(provider);
		throw new Error(
			`${providerEnv?.required.project ?? "LLM_GOOGLE_CLOUD_PROJECT"} environment variable is required for Vertex-compatible model "${model}"`,
		);
	}

	// Only Google Vertex supports OAuth bearer auth; Quartz always uses the
	// `?key=` API-key query param.
	const tokenType =
		provider === "google-vertex"
			? (vertexTokenType ??
				resolveVertexTokenType(
					provider,
					providerKeyOptions,
					configIndex,
					skipEnvVars,
				))
			: "api-key";
	const baseEndpoint = `${url}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:${endpoint}`;
	const queryParams = [];
	if (token && tokenType === "api-key") {
		queryParams.push(`key=${token}`);
	}
	if (stream) {
		queryParams.push("alt=sse");
	}
	return queryParams.length > 0
		? `${baseEndpoint}?${queryParams.join("&")}`
		: baseEndpoint;
}

/**
 * Static default base URLs for providers whose canonical upstream is a fixed
 * host. Single source of truth for "the provider's default base URL":
 * getProviderEndpoint falls back to these when no key base URL or env
 * override is configured, and service-tier key eligibility compares custom
 * base URLs against them. Providers absent from this map derive their
 * endpoint from env vars, key options (e.g. the Azure resource), or region
 * maps and have no static default.
 */
const PROVIDER_DEFAULT_BASE_URLS: Partial<Record<ProviderId, string>> = {
	openai: "https://api.openai.com",
	anthropic: "https://api.anthropic.com",
	"google-ai-studio": "https://generativelanguage.googleapis.com",
	"google-vertex": "https://aiplatform.googleapis.com",
	"inference.net": "https://api.inference.net",
	"together-ai": "https://api.together.ai",
	mistral: "https://api.mistral.ai",
	xai: "https://api.x.ai",
	groq: "https://api.groq.com/openai",
	cerebras: "https://api.cerebras.ai",
	deepseek: "https://api.deepseek.com",
	perplexity: "https://api.perplexity.ai",
	novita: "https://api.novita.ai/v3/openai",
	moonshot: "https://api.moonshot.ai",
	meta: "https://api.meta.ai",
	nebius: "https://api.tokenfactory.nebius.com",
	zai: "https://api.z.ai",
	nanogpt: "https://nano-gpt.com/api",
	bytedance: "https://ark.ap-southeast.bytepluses.com/api/v3",
	minimax: "https://api.minimax.io",
	sakana: "https://api.sakana.ai",
	reve: "https://api.reve.com",
	xiaomi: "https://api.xiaomimimo.com",
	canopywave: "https://inference.canopywave.io",
	embercloud: "https://api.embercloud.ai",
	deepinfra: "https://api.deepinfra.com/v1/openai",
};

export function getProviderDefaultBaseUrl(
	provider: ProviderId,
): string | undefined {
	return PROVIDER_DEFAULT_BASE_URLS[provider];
}

/**
 * Get the endpoint URL for a provider API call.
 *
 * @param model - The upstream model id sent in the URL path (e.g. for Google
 *   Vertex `/models/${model}:generateContent`). Pass the canonical gateway
 *   model id and the function will resolve the upstream id via the registry;
 *   if you already have the upstream id (Azure deployment override, etc.),
 *   pass it directly.
 * @param modelId - Canonical gateway model id, used to look up
 *   capability info (e.g. supportsResponsesApi). When omitted, falls back to
 *   `model` — but pass the root id explicitly whenever you have it.
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
	imageGenerations?: boolean,
	region?: string,
	skipEnvVars?: boolean,
	modelId?: string,
	vertexTokenType?: VertexTokenType,
): string {
	let externalId = model;
	let providerMapping: ProviderModelMapping | undefined;
	if (model && model !== "custom") {
		const modelInfo = models.find((m) => m.id === (modelId ?? model));
		if (modelInfo) {
			const expandedProviderMappings = expandAllProviderRegions(
				modelInfo.providers,
			);
			providerMapping =
				expandedProviderMappings.find(
					(p) =>
						p.providerId === provider &&
						(region ? p.region === region : !p.region),
				) ??
				expandedProviderMappings.find(
					(p) => p.providerId === provider && !p.region,
				) ??
				expandedProviderMappings.find((p) => p.providerId === provider);
			if (providerMapping) {
				externalId = providerMapping.externalId;
			}
		}
	}
	let url: string | undefined;

	// Helper: read env value only when not in BYOK mode (skipEnvVars).
	// In BYOK mode, only the hardcoded default is used.
	const envValueOrDefault = (
		p: Parameters<typeof getProviderEnvValue>[0],
		key: string,
		defaultValue?: string,
	): string | undefined =>
		skipEnvVars
			? defaultValue
			: (getProviderEnvValue(p, key, configIndex, defaultValue) ??
				defaultValue);

	// Generic region-based base URL resolution.
	// Any provider with a regionConfig + endpointMap can use this.
	let regionBaseUrl: string | undefined;
	if (region) {
		const providerDef = providers.find((p) => p.id === provider) as
			| ProviderDefinition
			| undefined;
		const endpointMap = providerDef?.regionConfig?.endpointMap as
			| Record<string, string>
			| undefined;
		regionBaseUrl = endpointMap?.[region];
	}

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
			case "google-ai-studio":
			case "google-vertex":
			case "xiaomi":
				url =
					envValueOrDefault(
						provider,
						"baseUrl",
						getProviderDefaultBaseUrl(provider),
					) ?? getProviderDefaultBaseUrl(provider);
				break;
			case "glacier":
				url = skipEnvVars
					? undefined
					: getProviderEnvValue("glacier", "baseUrl", configIndex);
				if (!url) {
					throw new Error(
						"Glacier provider requires LLM_GLACIER_BASE_URL environment variable",
					);
				}
				break;
			case "granite":
				url = skipEnvVars
					? undefined
					: getProviderEnvValue("granite", "baseUrl", configIndex);
				if (!url) {
					throw new Error(
						"Granite provider requires LLM_GRANITE_BASE_URL environment variable",
					);
				}
				break;
			case "vertex-openai": {
				const vertexOpenaiDefaultHost =
					regionBaseUrl ?? "https://aiplatform.googleapis.com";
				url =
					envValueOrDefault(
						"vertex-openai",
						"baseUrl",
						vertexOpenaiDefaultHost,
					) ?? vertexOpenaiDefaultHost;
				break;
			}
			case "vertex-anthropic": {
				const vaDefaultRegion =
					providerKeyOptions?.vertex_anthropic_region ??
					getProviderEnvValue(
						"vertex-anthropic",
						"region",
						configIndex,
						"global",
					) ??
					"global";
				const vaDefaultHost =
					vaDefaultRegion === "global"
						? "https://aiplatform.googleapis.com"
						: `https://${vaDefaultRegion}-aiplatform.googleapis.com`;
				url =
					envValueOrDefault("vertex-anthropic", "baseUrl", vaDefaultHost) ??
					vaDefaultHost;
				break;
			}
			case "quartz":
				url = skipEnvVars
					? undefined
					: getProviderEnvValue("quartz", "baseUrl", configIndex);
				if (!url) {
					throw new Error(
						"Quartz provider requires LLM_QUARTZ_BASE_URL environment variable",
					);
				}
				break;
			case "tundra":
				url = skipEnvVars
					? undefined
					: getProviderEnvValue("tundra", "baseUrl", configIndex);
				if (!url) {
					throw new Error(
						"Tundra provider requires LLM_TUNDRA_BASE_URL environment variable",
					);
				}
				break;
			case "alibaba": {
				const alibabaBaseUrl =
					regionBaseUrl ?? "https://dashscope-intl.aliyuncs.com";
				// Use different base URL for image generation vs chat completions
				if (imageGenerations) {
					url = alibabaBaseUrl;
				} else {
					url = `${alibabaBaseUrl}/compatible-mode`;
				}
				break;
			}
			case "aws-bedrock": {
				// Precedence: explicit baseUrl arg (handled above) > env baseUrl >
				// region-derived endpoint > hardcoded default. An explicitly
				// configured base URL (e.g. a proxy / private endpoint) must win
				// over the region endpoint so regional requests don't bypass it.
				const envBaseUrl = skipEnvVars
					? undefined
					: getProviderEnvValue("aws-bedrock", "baseUrl", configIndex);
				url =
					envBaseUrl ??
					regionBaseUrl ??
					"https://bedrock-runtime.us-east-1.amazonaws.com";
				break;
			}
			case "azure": {
				const resource =
					providerKeyOptions?.azure_resource ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue("azure", "resource", configIndex));

				if (!resource) {
					const azureEnv = getProviderEnvConfig("azure");
					throw new Error(
						`Azure resource is required - set via provider options or ${azureEnv?.required.resource ?? "LLM_AZURE_RESOURCE"} env var`,
					);
				}
				url = `https://${resource}.openai.azure.com`;
				break;
			}
			case "azure-ai-foundry": {
				const resource =
					providerKeyOptions?.azure_ai_foundry_resource ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue("azure-ai-foundry", "resource", configIndex));

				if (!resource) {
					const azureFoundryEnv = getProviderEnvConfig("azure-ai-foundry");
					throw new Error(
						`Azure AI Foundry resource is required - set via provider options or ${azureFoundryEnv?.required.resource ?? "LLM_AZURE_AI_FOUNDRY_RESOURCE"} env var`,
					);
				}
				if (!/^[a-zA-Z0-9-]{1,64}$/.test(resource)) {
					const azureFoundryEnv = getProviderEnvConfig("azure-ai-foundry");
					throw new Error(
						`Azure AI Foundry resource is invalid - must be 1-64 chars of letters, digits, or hyphens (set via provider options or ${azureFoundryEnv?.required.resource ?? "LLM_AZURE_AI_FOUNDRY_RESOURCE"} env var)`,
					);
				}
				url = `https://${resource}.services.ai.azure.com`;
				break;
			}
			case "custom":
				if (!baseUrl) {
					throw new Error(`Custom provider requires a baseUrl`);
				}
				url = baseUrl;
				break;
			default: {
				const staticDefault = getProviderDefaultBaseUrl(provider);
				if (!staticDefault) {
					throw new Error(`Provider ${provider} requires a baseUrl`);
				}
				url = staticDefault;
				break;
			}
		}
	}

	if (!url) {
		throw new Error(`Failed to determine base URL for provider ${provider}`);
	}

	switch (provider) {
		case "anthropic":
			return `${url}/v1/messages`;
		case "google-ai-studio": {
			const endpoint = stream ? "streamGenerateContent" : "generateContent";
			const baseEndpoint = externalId
				? `${url}/v1beta/models/${externalId}:${endpoint}`
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
		case "glacier": {
			const endpoint = stream ? "streamGenerateContent" : "generateContent";
			const baseEndpoint = externalId
				? `${url}/v1beta/models/${externalId}:${endpoint}`
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
		case "google-vertex":
		case "quartz":
			return buildVertexCompatibleEndpoint(
				provider,
				url,
				externalId,
				token,
				stream,
				configIndex,
				providerKeyOptions,
				skipEnvVars,
				vertexTokenType,
			);
		case "vertex-openai": {
			const projectId =
				providerKeyOptions?.vertex_openai_project_id ??
				getProviderEnvValue("vertex-openai", "project", configIndex);
			if (!projectId) {
				const providerEnv = getProviderEnvConfig("vertex-openai");
				throw new Error(
					`${providerEnv?.required.project ?? "LLM_VERTEX_OPENAI_PROJECT"} environment variable is required for vertex-openai model "${externalId}"`,
				);
			}
			const vertexRegion =
				region ??
				providerKeyOptions?.vertex_openai_region ??
				getProviderEnvValue("vertex-openai", "region", configIndex, "global") ??
				"global";
			return `${url}/v1/projects/${projectId}/locations/${vertexRegion}/endpoints/openapi/chat/completions`;
		}
		case "vertex-anthropic": {
			// BYOK provider keys hold the customer's service-account JSON; derive
			// the project from it so requests hit their project, not the server's.
			let vaProjectId: string | undefined;
			if (token) {
				try {
					const sa = JSON.parse(token) as { project_id?: string };
					vaProjectId = sa.project_id;
				} catch {
					// token is not service-account JSON (e.g. an OAuth access token);
					// fall back to env-based resolution below
				}
			}
			if (!vaProjectId) {
				vaProjectId = process.env.LLM_VERTEX_ANTHROPIC_PROJECT;
			}
			if (!vaProjectId) {
				const saJson = process.env.LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON;
				if (saJson) {
					try {
						const sa = JSON.parse(saJson) as { project_id?: string };
						vaProjectId = sa.project_id;
					} catch {
						// ignore parse errors; error thrown below
					}
				}
			}
			const vaRegion =
				providerKeyOptions?.vertex_anthropic_region ??
				getProviderEnvValue(
					"vertex-anthropic",
					"region",
					configIndex,
					"global",
				) ??
				"global";

			if (!vaProjectId) {
				throw new Error(
					"vertex-anthropic provider requires LLM_VERTEX_ANTHROPIC_PROJECT or a valid LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON with project_id",
				);
			}

			const vaModel = externalId ?? "claude-sonnet-4-6";
			const vaEndpoint = stream ? "streamRawPredict" : "rawPredict";
			return `${url}/v1/projects/${vaProjectId}/locations/${vaRegion}/publishers/anthropic/models/${vaModel}:${vaEndpoint}`;
		}
		case "perplexity":
			return `${url}/chat/completions`;
		case "novita":
			return `${url}/chat/completions`;
		case "zai":
			if (imageGenerations) {
				return `${url}/api/paas/v4/images/generations`;
			}
			return `${url}/api/paas/v4/chat/completions`;
		case "aws-bedrock": {
			if (providerMapping?.apiFormat === "openai-chat-completions") {
				const mantleBaseUrl = getBedrockMantleBaseUrl(url, region);
				return appendPath(mantleBaseUrl, "/chat/completions");
			}

			const awsRegionPrefix = region
				? (
						providers.find((p) => p.id === "aws-bedrock") as
							| ProviderDefinition
							| undefined
					)?.regionConfig?.modelPrefixMap?.[region]
				: undefined;
			// envValueOrDefault honors skipEnvVars (BYOK), so the server's
			// LLM_AWS_BEDROCK_REGION can't silently affect provider-key routing.
			const prefix =
				providerKeyOptions?.aws_bedrock_region_prefix ??
				awsRegionPrefix ??
				envValueOrDefault("aws-bedrock", "region", "global.") ??
				"global.";

			const endpoint = stream ? "converse-stream" : "converse";
			return `${url}/model/${prefix}${externalId}/${endpoint}`;
		}
		case "azure": {
			const deploymentType =
				providerKeyOptions?.azure_deployment_type ??
				getProviderEnvValue(
					"azure",
					"deploymentType",
					configIndex,
					"ai-foundry",
				) ??
				"ai-foundry";

			if (deploymentType === "openai") {
				// Traditional Azure (deployment-based)
				const apiVersion =
					providerKeyOptions?.azure_api_version ??
					getProviderEnvValue(
						"azure",
						"apiVersion",
						configIndex,
						"2024-10-21",
					) ??
					"2024-10-21";

				if (imageGenerations) {
					// gpt-image models require a preview api-version
					const imageApiVersion =
						providerKeyOptions?.azure_api_version ??
						getProviderEnvValue("azure", "apiVersion", configIndex) ??
						"2025-04-01-preview";
					return `${url}/openai/deployments/${externalId}/images/generations?api-version=${imageApiVersion}`;
				}
				return `${url}/openai/deployments/${externalId}/chat/completions?api-version=${apiVersion}`;
			} else {
				// Azure AI Foundry (unified endpoint)
				if (imageGenerations) {
					// v1 unified API requires the literal "preview" api-version for image endpoints
					return `${url}/openai/v1/images/generations?api-version=preview`;
				}

				const useResponsesApiEnv = getProviderEnvValue(
					"azure",
					"useResponsesApi",
					configIndex,
					"true",
				);

				if (model && useResponsesApiEnv !== "false") {
					const modelDef = models.find((m) => m.id === (modelId ?? model));
					const providerMapping = modelDef?.providers.find(
						(p) => p.providerId === "azure",
					);
					const supportsResponsesApi =
						(providerMapping as ProviderModelMapping)?.supportsResponsesApi ===
						true;

					if (supportsResponsesApi) {
						return `${url}/openai/v1/responses?api-version=preview`;
					}
				}
				return `${url}/openai/v1/chat/completions`;
			}
		}
		case "azure-ai-foundry": {
			const apiVersion =
				providerKeyOptions?.azure_ai_foundry_api_version ??
				getProviderEnvValue(
					"azure-ai-foundry",
					"apiVersion",
					configIndex,
					"2024-05-01-preview",
				) ??
				"2024-05-01-preview";
			return `${url}/models/chat/completions?api-version=${apiVersion}`;
		}
		case "openai": {
			if (imageGenerations) {
				return `${url}/v1/images/generations`;
			}
			// Use responses endpoint for models that support responses API
			if (model) {
				const modelDef = models.find((m) => m.id === (modelId ?? model));
				const providerMapping = modelDef?.providers.find(
					(p) => p.providerId === "openai",
				);
				const supportsResponsesApi =
					(providerMapping as ProviderModelMapping)?.supportsResponsesApi ===
					true;

				if (supportsResponsesApi) {
					return `${url}/v1/responses`;
				}
			}
			return `${url}/v1/chat/completions`;
		}
		case "alibaba":
			if (imageGenerations) {
				return `${url}/api/v1/services/aigc/multimodal-generation/generation`;
			}
			return `${url}/v1/chat/completions`;
		case "bytedance":
			if (imageGenerations) {
				return `${url}/images/generations`;
			}
			return `${url}/chat/completions`;
		case "xai":
			if (imageGenerations) {
				return `${url}/v1/images/generations`;
			}
			return `${url}/v1/chat/completions`;
		case "reve":
			if (imageGenerations) {
				return `${url}/v1/image/create`;
			}
			return `${url}/v1/image/create`;
		case "deepinfra":
			return `${url}/chat/completions`;
		case "sakana": {
			// Fugu exposes reasoning summaries only through the Responses API, but
			// its Responses API streams the whole answer as a single delta on
			// completion. So use the Responses API only for non-streaming requests
			// (where reasoning matters and chunking doesn't); stream over the Chat
			// Completions endpoint, which emits incremental content deltas.
			if (!stream && model) {
				const modelDef = models.find((m) => m.id === (modelId ?? model));
				const providerMapping = modelDef?.providers.find(
					(p) => p.providerId === "sakana",
				);
				const supportsResponsesApi =
					(providerMapping as ProviderModelMapping)?.supportsResponsesApi ===
					true;
				if (supportsResponsesApi) {
					return `${url}/v1/responses`;
				}
			}
			return `${url}/v1/chat/completions`;
		}
		case "inference.net":
		case "llmgateway":
		case "groq":
		case "cerebras":
		case "meta": {
			// Muse Spark only exposes reasoning (as summaries) through the
			// Responses API — Chat Completions redacts reasoning_content entirely.
			if (model) {
				const modelDef = models.find((m) => m.id === (modelId ?? model));
				const providerMapping = modelDef?.providers.find(
					(p) => p.providerId === "meta",
				);
				const supportsResponsesApi =
					(providerMapping as ProviderModelMapping)?.supportsResponsesApi ===
					true;

				if (supportsResponsesApi) {
					return `${url}/v1/responses`;
				}
			}
			return `${url}/v1/chat/completions`;
		}
		case "deepseek":
		case "moonshot":
		case "nebius":
		case "nanogpt":
		case "canopywave":
		case "minimax":
		case "xiaomi":
		case "embercloud":
		case "tundra":
		case "custom":
		default:
			return `${url}/v1/chat/completions`;
	}
}
