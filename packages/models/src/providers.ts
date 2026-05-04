export interface ProviderEnvConfig {
	required: {
		apiKey?: string;
		[key: string]: string | undefined;
	};
	optional?: Record<string, string>;
}

/**
 * Region routing configuration for providers that support multiple geographic endpoints.
 * Used by the gateway for endpoint URL resolution and by the UI for the region selector.
 */
export interface ProviderRegionConfig {
	/** Key in ProviderKeyOptions where the selected region is stored (e.g. "alibaba_region") */
	optionsKey: string;
	/** Region used when none is explicitly configured */
	defaultRegion: string;
	/** Ordered list of available regions for this provider, used to populate the UI dropdown */
	regions: { id: string; label: string }[];
	/** Maps region id to its base URL */
	endpointMap: Record<string, string>;
}

export interface ProviderDefinition {
	id: string;
	name: string;
	description: string;
	// Environment variable configuration
	env: ProviderEnvConfig;
	// Whether the provider supports streaming
	streaming?: boolean;
	// Whether the provider supports request cancellation
	cancellation?: boolean;
	// Color used for UI representation (hex code)
	color?: string;
	// Website URL
	website?: string | null;
	// Announcement text
	announcement?: string | null;
	// Instructions for creating an API key
	apiKeyInstructions?: string;
	// Learn more URL for API key creation
	learnMore?: string;
	// Priority weight for routing (default: 1). Lower values deprioritize the provider.
	// e.g., 0.8 means 20% lower priority (score multiplied by 1/0.8 = 1.25)
	priority?: number;
	// Whether requests that match the gateway content filter should avoid this provider
	// when an alternative provider is available.
	contentFilter?: boolean;
	/** Region routing config - when set, provider supports multiple geographic endpoints */
	regionConfig?: ProviderRegionConfig;
}

export const providers = [
	{
		id: "llmgateway",
		name: "LLM Gateway",
		description:
			"LLMGateway is a framework for building and deploying large language models.",
		env: {
			required: {
				apiKey: "LLM_LLMGATEWAY_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#6366f1",
		website: "https://llmgateway.io",
		announcement: null,
	},
	{
		id: "openai",
		name: "OpenAI",
		description:
			"OpenAI is an AI research and deployment company. Our mission is to ensure that artificial general intelligence benefits all of humanity.",
		env: {
			required: {
				apiKey: "LLM_OPENAI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#0ea5e9",
		website: "https://openai.com",
		announcement: null,
	},
	{
		id: "anthropic",
		name: "Anthropic",
		description:
			"Anthropic is a research and deployment company focused on building safe and useful AI.",
		env: {
			required: {
				apiKey: "LLM_ANTHROPIC_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#8b5cf6",
		website: "https://anthropic.com",
		announcement: null,
	},
	{
		id: "google-ai-studio",
		name: "Google AI Studio",
		description:
			"Google AI Studio is a platform for accessing Google's Gemini models.",
		env: {
			required: {
				apiKey: "LLM_GOOGLE_AI_STUDIO_API_KEY",
			},
			optional: {
				baseUrl: "LLM_GOOGLE_AI_STUDIO_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4285f4",
		website: "https://ai.google.com",
		announcement: null,
		priority: 0.8,
	},
	{
		id: "glacier",
		name: "Glacier",
		description:
			"Glacier is a stealth provider with Google AI Studio-compatible Gemini endpoints.",
		env: {
			required: {
				apiKey: "LLM_GLACIER_API_KEY",
				baseUrl: "LLM_GLACIER_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4285f4",
		website: null,
		announcement: null,
	},
	{
		id: "google-vertex",
		name: "Google Vertex AI",
		description:
			"Google Vertex AI is a platform for accessing Google's Gemini models via Vertex AI.",
		env: {
			required: {
				apiKey: "LLM_GOOGLE_VERTEX_API_KEY",
				project: "LLM_GOOGLE_CLOUD_PROJECT",
			},
			optional: {
				baseUrl: "LLM_GOOGLE_VERTEX_BASE_URL",
				region: "LLM_GOOGLE_VERTEX_REGION",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4285f4",
		website: "https://cloud.google.com/vertex-ai",
		announcement: null,
	},
	{
		id: "quartz",
		name: "Quartz",
		description:
			"Quartz is a Vertex-compatible provider for accessing Gemini and other Vertex-routed models.",
		env: {
			required: {
				apiKey: "LLM_QUARTZ_API_KEY",
				baseUrl: "LLM_QUARTZ_BASE_URL",
				project: "LLM_QUARTZ_PROJECT",
			},
			optional: {
				region: "LLM_QUARTZ_REGION",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4285f4",
		website: null,
		announcement: null,
		priority: 0.9,
	},
	{
		id: "avalanche",
		name: "Avalanche",
		description: "Avalanche - video generation provider.",
		env: {
			required: {
				apiKey: "LLM_AVALANCHE_API_KEY",
				baseUrl: "LLM_AVALANCHE_BASE_URL",
			},
			optional: {
				fileUploadBaseUrl: "LLM_AVALANCHE_FILE_UPLOAD_BASE_URL",
			},
		},
		streaming: false,
		cancellation: false,
		color: "#0f766e",
		website: null,
		announcement: null,
	},
	{
		id: "groq",
		name: "Groq",
		description: "Groq's ultra-fast LPU inference with various models",
		env: {
			required: {
				apiKey: "LLM_GROQ_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#F55036",
		website: "https://groq.com",
		announcement: null,
	},
	{
		id: "cerebras",
		name: "Cerebras",
		description:
			"Cerebras high-performance inference with ultra-fast throughput",
		env: {
			required: {
				apiKey: "LLM_CEREBRAS_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#6b46c1",
		website: "https://cerebras.ai",
		announcement: null,
	},
	{
		id: "xai",
		name: "xAI",
		description: "xAI's Grok large language models",
		env: {
			required: {
				apiKey: "LLM_X_AI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#000000",
		website: "https://x.ai",
		announcement: null,
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		description:
			"DeepSeek's high-performance language models with OpenAI-compatible API",
		env: {
			required: {
				apiKey: "LLM_DEEPSEEK_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#FF6B00",
		website: "https://deepseek.com",
		announcement: null,
	},
	{
		id: "alibaba",
		name: "Alibaba Cloud",
		description:
			"Alibaba Cloud's Qwen large language models with OpenAI-compatible API",
		env: {
			required: {
				apiKey: "LLM_ALIBABA_API_KEY",
			},
			optional: {
				region: "LLM_ALIBABA_REGION",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#FF6A00",
		website: "https://www.alibabacloud.com",
		announcement: null,
		regionConfig: {
			optionsKey: "alibaba_region",
			defaultRegion: "singapore",
			regions: [
				{ id: "singapore", label: "Singapore (default)" },
				{ id: "us-virginia", label: "US (Virginia)" },
				{ id: "cn-beijing", label: "China (Beijing)" },
			],
			endpointMap: {
				singapore: "https://dashscope-intl.aliyuncs.com",
				"us-virginia": "https://dashscope-us.aliyuncs.com",
				"cn-beijing": "https://dashscope.aliyuncs.com",
			},
		},
	},
	{
		id: "novita",
		name: "NovitaAI",
		description: "NovitaAI's OpenAI-compatible large language models",
		env: {
			required: {
				apiKey: "LLM_NOVITA_AI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#9333ea",
		website: "https://novita.ai",
		announcement: null,
	},
	{
		id: "aws-bedrock",
		name: "AWS Bedrock",
		description: "Amazon Bedrock - fully managed service for foundation models",
		env: {
			required: {
				apiKey: "LLM_AWS_BEDROCK_API_KEY",
			},
			optional: {
				baseUrl: "LLM_AWS_BEDROCK_BASE_URL",
				region: "LLM_AWS_BEDROCK_REGION",
			},
		},
		priority: 0.9,
		streaming: true,
		cancellation: true,
		color: "#FF9900",
		website: "https://aws.amazon.com/bedrock",
		announcement: null,
		apiKeyInstructions:
			"Use AWS Bedrock Long-Term API Keys (not IAM service account or private keys)",
		learnMore: "https://docs.llmgateway.io/integrations/aws-bedrock",
	},
	{
		id: "azure",
		name: "Azure",
		description: "Microsoft Azure - enterprise-grade OpenAI models",
		env: {
			required: {
				apiKey: "LLM_AZURE_API_KEY",
				resource: "LLM_AZURE_RESOURCE",
			},
			optional: {
				deploymentType: "LLM_AZURE_DEPLOYMENT_TYPE",
				apiVersion: "LLM_AZURE_API_VERSION",
				useResponsesApi: "LLM_AZURE_USE_RESPONSES_API",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#0078D4",
		website:
			"https://azure.microsoft.com/en-us/products/ai-services/openai-service",
		announcement: null,
		apiKeyInstructions:
			"The resource name can be found in your Azure base URL: https://<resource-name>.openai.azure.com",
		learnMore: "https://docs.llmgateway.io/integrations/azure",
	},
	{
		id: "azure-ai-foundry",
		name: "Azure AI Foundry",
		description:
			"Microsoft Azure AI Foundry - third-party models (Grok, Llama, Mistral, ...) via the Azure Models inference endpoint",
		env: {
			required: {
				apiKey: "LLM_AZURE_AI_FOUNDRY_API_KEY",
				resource: "LLM_AZURE_AI_FOUNDRY_RESOURCE",
			},
			optional: {
				apiVersion: "LLM_AZURE_AI_FOUNDRY_API_VERSION",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#0078D4",
		website: "https://azure.microsoft.com/en-us/products/ai-foundry",
		announcement: null,
		apiKeyInstructions:
			"The resource name can be found in your Azure AI Foundry base URL: https://<resource-name>.services.ai.azure.com",
		learnMore: "https://docs.llmgateway.io/integrations/azure",
	},
	{
		id: "zai",
		name: "Z AI",
		description: "Z AI's OpenAI-compatible large language models",
		env: {
			required: {
				apiKey: "LLM_Z_AI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#22c55e",
		website: "https://z.ai",
		announcement: null,
	},
	{
		id: "moonshot",
		name: "Moonshot AI",
		description: "Moonshot AI's OpenAI-compatible large language models",
		env: {
			required: {
				apiKey: "LLM_MOONSHOT_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4B9EFF",
		website: "https://moonshot.ai",
		announcement: null,
	},
	{
		id: "perplexity",
		name: "Perplexity",
		description:
			"Perplexity's AI models for search and conversation with real-time web access",
		env: {
			required: {
				apiKey: "LLM_PERPLEXITY_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#20B2AA",
		website: "https://perplexity.ai",
		announcement: null,
	},
	{
		id: "nebius",
		name: "Nebius AI",
		description:
			"Nebius AI Studio - OpenAI-compatible API for large language models",
		env: {
			required: {
				apiKey: "LLM_NEBIUS_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#3b82f6",
		website: "https://nebius.com",
		announcement: null,
	},
	{
		id: "mistral",
		name: "Mistral AI",
		description: "Mistral AI's large language models",
		env: {
			required: {
				apiKey: "LLM_MISTRAL_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#FF7000",
		website: "https://mistral.ai",
		announcement: null,
	},
	{
		id: "inference.net",
		name: "Inference.net",
		description:
			"Inference.net is a platform for running large language models in the cloud.",
		env: {
			required: {
				apiKey: "LLM_INFERENCE_NET_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#10b981",
		website: "https://inference.net",
		announcement: null,
	},
	{
		id: "together-ai",
		name: "Together AI",
		description:
			"Together AI is a platform for running large language models in the cloud with fast inference.",
		env: {
			required: {
				apiKey: "LLM_TOGETHER_AI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#ff6b35",
		website: "https://together.ai",
		announcement: null,
	},
	{
		id: "custom",
		name: "Custom",
		description: "Custom OpenAI-compatible provider with configurable base URL",
		env: {
			required: {},
		},
		streaming: true,
		cancellation: true,
		color: "#6b7280",
		website: null,
		announcement: null,
	},
	{
		id: "nanogpt",
		name: "NanoGPT",
		description: "NanoGPT offers a large selection of models",
		env: {
			required: {
				apiKey: "LLM_NANO_GPT_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#10b981",
		website: "https://nano-gpt.com",
		announcement: null,
	},
	{
		id: "bytedance",
		name: "ByteDance",
		description:
			"ByteDance's ModelArk platform with OpenAI-compatible API for large language models",
		env: {
			required: {
				apiKey: "LLM_BYTEDANCE_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#FF4757",
		website: "https://www.byteplus.com/en/product/modelark",
		announcement: null,
	},
	{
		id: "minimax",
		name: "MiniMax",
		description:
			"MiniMax's large language models with advanced reasoning and coding capabilities",
		env: {
			required: {
				apiKey: "LLM_MINIMAX_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#7C3AED",
		website: "https://minimax.io",
		announcement: null,
	},
	{
		id: "embercloud",
		name: "EmberCloud",
		description:
			"EmberCloud provides access to a variety of large language models via an OpenAI-compatible API",
		env: {
			required: {
				apiKey: "LLM_EMBERCLOUD_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#FF6047",
		website: "https://www.embercloud.ai",
		announcement: null,
	},
] as const satisfies ProviderDefinition[];

export type ProviderId = (typeof providers)[number]["id"];

export function getProviderDefinition(
	providerId: ProviderId | string,
): ProviderDefinition | undefined {
	return providers.find((p) => p.id === providerId);
}
