import {
	models,
	providers,
	expandAllProviderRegions,
	type EnvVarVariant,
	type ProviderDefinition,
	type ProviderModelMapping,
	type ProviderId,
	type VertexTokenType,
	getProviderEnvValue,
	getProviderEnvConfig,
	getRegionEnvVarSuffix,
	getRegionScopedProviderEnvValue,
	getVariantEnvVarNameFor,
	resolveVertexTokenType,
	REGION_WORKSPACE_ID_PLACEHOLDER,
} from "@llmgateway/models";

import type { ProviderKeyOptions } from "@llmgateway/db";

function appendPath(url: string, path: string): string {
	let urlEnd = url.length;
	while (urlEnd > 0 && url[urlEnd - 1] === "/") {
		urlEnd--;
	}

	let pathStart = 0;
	while (pathStart < path.length && path[pathStart] === "/") {
		pathStart++;
	}

	return `${url.slice(0, urlEnd)}/${path.slice(pathStart)}`;
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

/**
 * Fill the workspace placeholder of a workspace-scoped region endpoint
 * (Alibaba Frankfurt), falling back to the region's shared entry point when no
 * workspace id is configured. The workspace id becomes part of the hostname,
 * so it is validated against the character set Model Studio issues (`ws-…`)
 * rather than interpolated blindly.
 */
function resolveWorkspaceScopedEndpoint(
	provider: ProviderId,
	baseUrl: string,
	region: string | undefined,
	workspaceId: string | undefined,
): string {
	if (!baseUrl.includes(REGION_WORKSPACE_ID_PLACEHOLDER)) {
		return baseUrl;
	}

	const envConfig = getProviderEnvConfig(provider);
	const workspaceEnvVar = envConfig?.optional?.workspaceId;
	const regionalEnvVar =
		workspaceEnvVar && region
			? `${workspaceEnvVar}__${getRegionEnvVarSuffix(region)}`
			: workspaceEnvVar;

	if (!workspaceId) {
		// No workspace id: fall back to the region's shared entry point, which
		// resolves the workspace from the API key. Only a region without such a
		// host is unroutable.
		const providerDef = providers.find((p) => p.id === provider) as
			ProviderDefinition | undefined;
		const fallback = region
			? providerDef?.regionConfig?.endpointFallbackMap?.[region]
			: undefined;
		if (fallback) {
			return fallback;
		}
		throw new Error(
			`Provider ${provider} region ${region} is only reachable through a workspace-dedicated endpoint - set the workspace id on the provider key or via the ${regionalEnvVar} env var`,
		);
	}
	if (!/^[a-zA-Z0-9-]{1,64}$/.test(workspaceId)) {
		throw new Error(
			`Provider ${provider} workspace id is invalid - must be 1-64 chars of letters, digits, or hyphens (set via provider options or the ${regionalEnvVar} env var)`,
		);
	}

	return baseUrl.replace(REGION_WORKSPACE_ID_PLACEHOLDER, workspaceId);
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
	variant?: EnvVarVariant,
): string {
	const endpoint = stream ? "streamGenerateContent" : "generateContent";
	const model = externalId ?? "gemini-3.1-flash-lite";

	const credentialConfig = providerKeyOptions?.env_config;
	const projectId =
		credentialConfig?.project ??
		providerKeyOptions?.google_vertex_project_id ??
		(skipEnvVars
			? undefined
			: getProviderEnvValue(
					provider,
					"project",
					configIndex,
					undefined,
					variant,
				));
	const region =
		credentialConfig?.region ??
		(skipEnvVars
			? undefined
			: getProviderEnvValue(
					provider,
					"region",
					configIndex,
					"global",
					variant,
				)) ??
		"global";

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
					variant,
				))
			: "api-key";
	if (!projectId && (provider === "quartz" || tokenType === "oauth")) {
		const providerEnv = getProviderEnvConfig(provider);
		const projectEnv =
			providerEnv?.required.project ??
			providerEnv?.optional?.project ??
			"LLM_GOOGLE_CLOUD_PROJECT";
		throw new Error(
			`${projectEnv} environment variable is required for Vertex-compatible model "${model}"`,
		);
	}

	const baseEndpoint = `${url}${getGoogleVertexPublisherModelPath(model, projectId, region)}:${endpoint}`;
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

export function getGoogleVertexPublisherModelPath(
	model: string,
	projectId?: string,
	region = "global",
): string {
	const modelPath = `publishers/google/models/${model}`;
	return projectId
		? `/v1/projects/${projectId}/locations/${region}/${modelPath}`
		: `/v1/${modelPath}`;
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
	"scx-ai": "https://api.scx.ai",
	"scx-ai-gp": "https://api.scx.ai",
	mistral: "https://api.mistral.ai",
	xai: "https://api.x.ai",
	groq: "https://api.groq.com/openai",
	cerebras: "https://api.cerebras.ai",
	deepseek: "https://api.deepseek.com",
	perplexity: "https://api.perplexity.ai",
	novita: "https://api.novita.ai/v3/openai",
	runware: "https://api.runware.ai",
	moonshot: "https://api.moonshot.ai",
	meta: "https://api.meta.ai",
	"meta-contributor": "https://api.meta.ai",
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
	gonka24: "https://api.gonka24.com",
	fireworks: "https://api.fireworks.ai/inference",
	ranoai: "https://api.ranoai.com",
	baidu: "https://api.baiduqianfan.ai",
	consensusprotocol: "https://api.consensusprotocol.org",
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
 *   `model` — but pass the canonical model id explicitly whenever you have it.
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
	variant?: EnvVarVariant,
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

	// Settings carried by a managed (platform-owned) credential, keyed by the
	// provider's logical env keys. Always wins over the environment: a managed
	// credential is meant to describe itself completely so the deployment does
	// not need the matching LLM_* vars set at all.
	const credentialConfig = providerKeyOptions?.env_config;

	// Helper: read env value only when not in BYOK mode (skipEnvVars).
	// In BYOK mode, only the hardcoded default is used.
	const envValueOrDefault = (
		p: Parameters<typeof getProviderEnvValue>[0],
		key: string,
		defaultValue?: string,
	): string | undefined =>
		credentialConfig?.[key] ??
		(skipEnvVars
			? defaultValue
			: (getProviderEnvValue(p, key, configIndex, defaultValue, variant) ??
				defaultValue));

	// Generic region-based base URL resolution.
	// Any provider with a regionConfig + endpointMap can use this.
	let regionBaseUrl: string | undefined;
	if (region) {
		const providerDef = providers.find((p) => p.id === provider) as
			ProviderDefinition | undefined;
		const endpointMap = providerDef?.regionConfig?.endpointMap as
			Record<string, string> | undefined;
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
			case "anthropic":
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
				url =
					credentialConfig?.baseUrl ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue(
								"glacier",
								"baseUrl",
								configIndex,
								undefined,
								variant,
							));
				if (!url) {
					throw new Error(
						"Glacier provider requires LLM_GLACIER_BASE_URL environment variable",
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
					credentialConfig?.region ??
					providerKeyOptions?.vertex_anthropic_region ??
					getProviderEnvValue(
						"vertex-anthropic",
						"region",
						configIndex,
						"global",
						variant,
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
				url =
					credentialConfig?.baseUrl ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue(
								"quartz",
								"baseUrl",
								configIndex,
								undefined,
								variant,
							));
				if (!url) {
					throw new Error(
						"Quartz provider requires LLM_QUARTZ_BASE_URL environment variable",
					);
				}
				break;
			case "alibaba": {
				const alibabaBaseUrl = resolveWorkspaceScopedEndpoint(
					"alibaba",
					regionBaseUrl ?? "https://dashscope-intl.aliyuncs.com",
					region,
					credentialConfig?.workspaceId ??
						providerKeyOptions?.alibaba_workspace_id ??
						(skipEnvVars
							? undefined
							: getRegionScopedProviderEnvValue(
									"alibaba",
									"workspaceId",
									region,
									configIndex,
									variant,
								)),
				);
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
				const envBaseUrl =
					credentialConfig?.baseUrl ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue(
								"aws-bedrock",
								"baseUrl",
								configIndex,
								undefined,
								variant,
							));
				url =
					envBaseUrl ??
					regionBaseUrl ??
					"https://bedrock-runtime.us-east-1.amazonaws.com";
				break;
			}
			case "aws-mantle": {
				// Bedrock Mantle: OpenAI frontier models on AWS, Responses API only.
				// The selected region normally resolves through regionConfig's
				// endpointMap; the env var stays supported as a deployment-level
				// override, and us-east-1 is the fallback because it is the only
				// region carrying the whole GPT-5.6 family (Sol is not in us-west-2).
				const envBaseUrl = skipEnvVars
					? undefined
					: getProviderEnvValue(
							"aws-mantle",
							"baseUrl",
							configIndex,
							undefined,
							variant,
						);
				const mantleRegion =
					envValueOrDefault("aws-mantle", "region", "us-east-1") ?? "us-east-1";
				url =
					envBaseUrl ??
					regionBaseUrl ??
					`https://bedrock-mantle.${mantleRegion}.api.aws`;
				break;
			}
			case "azure": {
				// An explicit base URL wins over the resource: it is the only way to
				// reach a deployment that serves the Azure surface from a host other
				// than <resource>.openai.azure.com.
				//
				// Exactly one of the two belongs on any single credential, which is
				// enforced where credentials are authored. Precedence still matters
				// here because the two can arrive from different layers — a managed
				// credential supplying a base URL must override a deployment-wide
				// LLM_AZURE_RESOURCE rather than conflict with it.
				const azureBaseUrl =
					credentialConfig?.baseUrl ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue(
								"azure",
								"baseUrl",
								configIndex,
								undefined,
								variant,
							));

				if (azureBaseUrl) {
					url = azureBaseUrl;
					break;
				}

				const resource =
					credentialConfig?.resource ??
					providerKeyOptions?.azure_resource ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue(
								"azure",
								"resource",
								configIndex,
								undefined,
								variant,
							));

				if (!resource) {
					const azureEnv = getProviderEnvConfig("azure");
					throw new Error(
						`Azure requires a resource or a base URL - set either via provider options or the ${azureEnv?.optional?.resource ?? "LLM_AZURE_RESOURCE"} / ${azureEnv?.optional?.baseUrl ?? "LLM_AZURE_BASE_URL"} env vars`,
					);
				}
				url = `https://${resource}.openai.azure.com`;
				break;
			}
			case "azure-ai-foundry": {
				const resource =
					credentialConfig?.resource ??
					providerKeyOptions?.azure_ai_foundry_resource ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue(
								"azure-ai-foundry",
								"resource",
								configIndex,
								undefined,
								variant,
							));

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
			case "azure-anthropic": {
				const resource =
					credentialConfig?.resource ??
					providerKeyOptions?.azure_anthropic_resource ??
					(skipEnvVars
						? undefined
						: getProviderEnvValue(
								"azure-anthropic",
								"resource",
								configIndex,
								undefined,
								variant,
							));

				if (!resource) {
					const azureAnthropicEnv = getProviderEnvConfig("azure-anthropic");
					throw new Error(
						`Azure Anthropic resource is required - set via provider options or ${azureAnthropicEnv?.required.resource ?? "LLM_AZURE_ANTHROPIC_RESOURCE"} env var`,
					);
				}
				if (!/^[a-zA-Z0-9-]{1,64}$/.test(resource)) {
					const azureAnthropicEnv = getProviderEnvConfig("azure-anthropic");
					throw new Error(
						`Azure Anthropic resource is invalid - must be 1-64 chars of letters, digits, or hyphens (set via provider options or ${azureAnthropicEnv?.required.resource ?? "LLM_AZURE_ANTHROPIC_RESOURCE"} env var)`,
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
				variant,
			);
		case "vertex-openai": {
			const projectId =
				credentialConfig?.project ??
				providerKeyOptions?.vertex_openai_project_id ??
				getProviderEnvValue(
					"vertex-openai",
					"project",
					configIndex,
					undefined,
					variant,
				);
			if (!projectId) {
				const providerEnv = getProviderEnvConfig("vertex-openai");
				throw new Error(
					`${providerEnv?.required.project ?? "LLM_VERTEX_OPENAI_PROJECT"} environment variable is required for vertex-openai model "${externalId}"`,
				);
			}
			const vertexRegion =
				region ??
				credentialConfig?.region ??
				providerKeyOptions?.vertex_openai_region ??
				getProviderEnvValue(
					"vertex-openai",
					"region",
					configIndex,
					"global",
					variant,
				) ??
				"global";
			return `${url}/v1/projects/${projectId}/locations/${vertexRegion}/endpoints/openapi/chat/completions`;
		}
		case "vertex-anthropic": {
			// A managed credential states its project outright: by the time a
			// request is built its service-account JSON has already been exchanged
			// for an access token, so nothing downstream can derive one from it.
			let vaProjectId = credentialConfig?.project;
			// BYOK provider keys hold the customer's service-account JSON; derive
			// the project from it so requests hit their project, not the server's.
			if (!vaProjectId && token) {
				try {
					const sa = JSON.parse(token) as { project_id?: string };
					vaProjectId = sa.project_id;
				} catch {
					// token is not service-account JSON (e.g. an OAuth access token);
					// fall back to env-based resolution below
				}
			}
			if (!vaProjectId) {
				vaProjectId = getProviderEnvValue(
					"vertex-anthropic",
					"project",
					configIndex,
					undefined,
					variant,
				);
			}
			if (!vaProjectId) {
				const saJson =
					process.env[
						getVariantEnvVarNameFor(
							"LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON",
							variant,
						) ?? "LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON"
					];
				if (saJson) {
					try {
						const sa = JSON.parse(saJson) as { project_id?: string };
						vaProjectId = sa.project_id;
					} catch {
						// ignore parse errors; error thrown below
					}
				}
			}
			// Same precedence as vaDefaultRegion above, which picks the host: the
			// two must agree or the request goes to one region's host with another
			// region in its path.
			const vaRegion =
				credentialConfig?.region ??
				providerKeyOptions?.vertex_anthropic_region ??
				getProviderEnvValue(
					"vertex-anthropic",
					"region",
					configIndex,
					"global",
					variant,
				) ??
				"global";

			if (!vaProjectId) {
				throw new Error(
					"vertex-anthropic provider requires a project setting on the credential, LLM_VERTEX_ANTHROPIC_PROJECT, or a valid LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON with project_id",
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
							ProviderDefinition | undefined
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
		case "aws-mantle":
			// Bedrock Mantle only exposes the OpenAI Responses API — Chat
			// Completions requests are rejected upstream.
			return appendPath(url, "/openai/v1/responses");
		case "azure": {
			const deploymentType =
				providerKeyOptions?.azure_deployment_type ??
				credentialConfig?.deploymentType ??
				getProviderEnvValue(
					"azure",
					"deploymentType",
					configIndex,
					"ai-foundry",
					variant,
				) ??
				"ai-foundry";

			if (deploymentType === "openai") {
				// Traditional Azure (deployment-based)
				const apiVersion =
					providerKeyOptions?.azure_api_version ??
					credentialConfig?.apiVersion ??
					getProviderEnvValue(
						"azure",
						"apiVersion",
						configIndex,
						"2024-10-21",
						variant,
					) ??
					"2024-10-21";

				if (imageGenerations) {
					// gpt-image models require a preview api-version
					const imageApiVersion =
						providerKeyOptions?.azure_api_version ??
						credentialConfig?.apiVersion ??
						getProviderEnvValue(
							"azure",
							"apiVersion",
							configIndex,
							undefined,
							variant,
						) ??
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

				const useResponsesApiEnv =
					credentialConfig?.useResponsesApi ??
					getProviderEnvValue(
						"azure",
						"useResponsesApi",
						configIndex,
						"true",
						variant,
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
				credentialConfig?.apiVersion ??
				getProviderEnvValue(
					"azure-ai-foundry",
					"apiVersion",
					configIndex,
					"2024-05-01-preview",
					variant,
				) ??
				"2024-05-01-preview";
			return `${url}/models/chat/completions?api-version=${apiVersion}`;
		}
		case "azure-anthropic":
			// Claude models on Microsoft Foundry are only served through the
			// Anthropic Messages API; there is no OpenAI-compatible surface.
			return `${url}/anthropic/v1/messages`;
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
		case "meta-contributor":
		case "meta": {
			// Muse Spark only exposes reasoning (as summaries) through the
			// Responses API — Chat Completions redacts reasoning_content entirely.
			if (model) {
				const modelDef = models.find((m) => m.id === (modelId ?? model));
				const providerMapping = modelDef?.providers.find(
					(p) => p.providerId === provider,
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
		case "baidu":
		case "deepseek":
		case "moonshot":
		case "nebius":
		case "nanogpt":
		case "canopywave":
		case "minimax":
		case "xiaomi":
		case "embercloud":
		case "scx-ai":
		case "scx-ai-gp":
		case "ranoai":
		case "consensusprotocol":
		case "custom":
		default:
			return `${url}/v1/chat/completions`;
	}
}
