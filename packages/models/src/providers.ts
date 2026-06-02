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
	/**
	 * Maps region id to a model-id prefix for providers where the upstream model
	 * identifier varies per region (e.g. AWS Bedrock cross-region inference
	 * profiles: `global.`, `us.`, `eu.`, `apac.`). When unset, no prefix is
	 * applied.
	 */
	modelPrefixMap?: Record<string, string>;
	/**
	 * When true, requests without an explicit `:region` suffix and without a
	 * region locked on the provider key are pinned to `defaultRegion` instead
	 * of being routed to the cheapest candidate. Used by AWS Bedrock, where
	 * `global` is the canonical cross-region default. Providers like Alibaba
	 * (which have only specific regional endpoints and no true global) leave
	 * this unset so the gateway picks the best available region by price.
	 */
	pinDefaultRegion?: boolean;
	/**
	 * When true, a single base credential works for every region (e.g. AWS
	 * Bedrock long-term API keys are IAM-global). The gateway then does not
	 * require a per-region `{ENV}__{REGION}` key to route to non-default
	 * regions in credits/hybrid mode. Providers like Alibaba, whose keys are
	 * region-scoped, leave this unset so non-default regions stay gated behind
	 * a region-specific env key.
	 */
	sharedCredentialAcrossRegions?: boolean;
}

export interface ProviderDataPolicy {
	apiTraining: boolean | null;
	consumerTraining: boolean | null;
	promptLogging: boolean | null;
	retentionPeriod?: string | null;
	soc2?: boolean | null;
	iso27001?: boolean | null;
	gdpr?: boolean | null;
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
	termsUrl?: string | null;
	privacyPolicyUrl?: string | null;
	/** ISO 3166-1 alpha-2 country code for provider headquarters */
	headquarters?: string | null;
	/** Data usage and privacy policy details */
	dataPolicy?: ProviderDataPolicy | null;
}

export const providers: ProviderDefinition[] = [
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
		termsUrl: "https://llmgateway.io/terms",
		privacyPolicyUrl: "https://llmgateway.io/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: false,
			iso27001: false,
			gdpr: false,
		},
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
		termsUrl: "https://openai.com/policies/terms-of-use",
		privacyPolicyUrl: "https://openai.com/policies/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: true,
			promptLogging: true,
			retentionPeriod: null,
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
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
		termsUrl: "https://www.anthropic.com/terms",
		privacyPolicyUrl: "https://www.anthropic.com/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: true,
			promptLogging: true,
			retentionPeriod: "30 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
	},
	{
		id: "anthropic-discount",
		name: "Anthropic (Discount)",
		description:
			"Anthropic-compatible provider routed through a discounted endpoint configured via environment variables.",
		env: {
			required: {
				apiKey: "LLM_ANTHROPIC_DISCOUNT_API_KEY",
				baseUrl: "LLM_ANTHROPIC_DISCOUNT_BASE_URL",
			},
		},
		priority: 1.5,
		streaming: true,
		cancellation: true,
		color: "#8b5cf6",
		website: null,
		announcement: null,
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
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
		termsUrl: "https://ai.google.dev/gemini-api/terms",
		privacyPolicyUrl: "https://cloud.google.com/terms/data-processing-addendum",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: true,
			promptLogging: true,
			retentionPeriod: "55 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
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
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
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
		priority: 0.8,
		termsUrl: "https://cloud.google.com/terms/service-terms",
		privacyPolicyUrl: "https://policies.google.com/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
	},
	{
		id: "vertex-openai",
		name: "Vertex AI (OpenAI-compatible)",
		description:
			"Access partner models (e.g. xAI Grok) via Google Cloud Vertex AI's OpenAI-compatible Chat Completions endpoint.",
		env: {
			required: {
				apiKey: "LLM_VERTEX_OPENAI_SERVICE_ACCOUNT_JSON",
				project: "LLM_VERTEX_OPENAI_PROJECT",
			},
			optional: {
				baseUrl: "LLM_VERTEX_OPENAI_BASE_URL",
				region: "LLM_VERTEX_OPENAI_REGION",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4285f4",
		website: "https://cloud.google.com/vertex-ai",
		announcement: null,
		priority: 0.9,
		termsUrl: "https://cloud.google.com/terms/service-terms",
		privacyPolicyUrl: "https://cloud.google.com/terms/data-processing-addendum",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
	},
	{
		id: "vertex-anthropic",
		name: "Vertex AI (Anthropic)",
		description:
			"Access Claude models via Google Cloud Vertex AI with the Anthropic Messages API.",
		env: {
			required: {
				apiKey: "LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON",
			},
			optional: {
				baseUrl: "LLM_VERTEX_ANTHROPIC_BASE_URL",
				region: "LLM_VERTEX_ANTHROPIC_REGION",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4285f4",
		website: "https://cloud.google.com/vertex-ai",
		announcement: null,
		priority: 0.9,
		termsUrl: "https://cloud.google.com/terms/service-terms",
		privacyPolicyUrl: "https://cloud.google.com/terms/data-processing-addendum",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
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
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
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
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
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
		termsUrl: "https://groq.com/terms-of-use",
		privacyPolicyUrl: "https://groq.com/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			gdpr: true,
		},
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
		termsUrl: "https://cerebras.ai/terms-of-service",
		privacyPolicyUrl: "https://cerebras.ai/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			gdpr: true,
		},
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
		priority: 0.1,
		termsUrl: "https://x.ai/legal/terms-of-service",
		privacyPolicyUrl: "https://x.ai/legal/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: true,
			retentionPeriod: "30 days",
			soc2: true,
			gdpr: true,
		},
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
		termsUrl:
			"https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html",
		privacyPolicyUrl:
			"https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: true,
			consumerTraining: true,
			promptLogging: true,
			retentionPeriod: null,
		},
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
		termsUrl:
			"https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-product-terms-of-service-v-3-8-0",
		privacyPolicyUrl:
			"https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-privacy-policy",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: null,
			promptLogging: true,
			retentionPeriod: null,
			iso27001: true,
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
		termsUrl: "https://novita.ai/legal/terms-of-service",
		privacyPolicyUrl: "https://novita.ai/legal/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
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
		regionConfig: {
			optionsKey: "aws_bedrock_region",
			defaultRegion: "global",
			pinDefaultRegion: true,
			sharedCredentialAcrossRegions: true,
			regions: [
				// Cross-region inference profile groups (spread inference across the
				// pool — AWS picks the actual region per request).
				{ id: "global", label: "Global (default)" },
				{ id: "us", label: "US" },
				{ id: "eu", label: "EU" },
				{ id: "apac", label: "Asia Pacific" },
				// Specific AWS regions for data-residency requirements. Only models
				// that support direct invocation in the chosen region will work —
				// Claude 4+ requires an inference profile and will reject these.
				{ id: "us-east-1", label: "US East (N. Virginia)" },
				{ id: "us-east-2", label: "US East (Ohio)" },
				{ id: "us-west-2", label: "US West (Oregon)" },
				{ id: "eu-central-1", label: "EU (Frankfurt)" },
				{ id: "eu-west-1", label: "EU (Ireland)" },
				{ id: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
				{ id: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
				{ id: "ap-southeast-2", label: "Asia Pacific (Sydney)" },
			],
			endpointMap: {
				global: "https://bedrock-runtime.us-east-1.amazonaws.com",
				us: "https://bedrock-runtime.us-east-1.amazonaws.com",
				eu: "https://bedrock-runtime.eu-central-1.amazonaws.com",
				apac: "https://bedrock-runtime.ap-northeast-1.amazonaws.com",
				"us-east-1": "https://bedrock-runtime.us-east-1.amazonaws.com",
				"us-east-2": "https://bedrock-runtime.us-east-2.amazonaws.com",
				"us-west-2": "https://bedrock-runtime.us-west-2.amazonaws.com",
				"eu-central-1": "https://bedrock-runtime.eu-central-1.amazonaws.com",
				"eu-west-1": "https://bedrock-runtime.eu-west-1.amazonaws.com",
				"ap-northeast-1":
					"https://bedrock-runtime.ap-northeast-1.amazonaws.com",
				"ap-southeast-1":
					"https://bedrock-runtime.ap-southeast-1.amazonaws.com",
				"ap-southeast-2":
					"https://bedrock-runtime.ap-southeast-2.amazonaws.com",
			},
			modelPrefixMap: {
				global: "global.",
				us: "us.",
				eu: "eu.",
				apac: "apac.",
				// Specific AWS regions invoke the bare model ID for true single-region
				// residency. Empty string (not undefined) so it short-circuits the
				// `aws_bedrock_region_prefix` env-var default of "global.".
				"us-east-1": "",
				"us-east-2": "",
				"us-west-2": "",
				"eu-central-1": "",
				"eu-west-1": "",
				"ap-northeast-1": "",
				"ap-southeast-1": "",
				"ap-southeast-2": "",
			},
		},
		termsUrl: "https://aws.amazon.com/service-terms",
		privacyPolicyUrl: "https://aws.amazon.com/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
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
		termsUrl: "https://www.microsoft.com/licensing/terms",
		privacyPolicyUrl: "https://privacy.microsoft.com/privacystatement",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
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
		termsUrl: "https://www.microsoft.com/licensing/terms",
		privacyPolicyUrl: "https://privacy.microsoft.com/privacystatement",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
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
		termsUrl: "https://docs.z.ai/legal-agreement/terms-of-use",
		privacyPolicyUrl: "https://docs.z.ai/legal-agreement/privacy-policy",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: null,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
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
		termsUrl: "https://www.kimi.com/user/agreement/modelUse?version=v2",
		privacyPolicyUrl:
			"https://www.kimi.com/user/agreement/userPrivacy?version=v2",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: null,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
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
		termsUrl: "https://www.perplexity.ai/hub/legal/terms-of-service",
		privacyPolicyUrl: "https://www.perplexity.ai/hub/legal/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			gdpr: true,
		},
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
		termsUrl: "https://docs.nebius.com/legal/terms-of-use",
		privacyPolicyUrl: "https://docs.nebius.com/legal/privacy",
		headquarters: "NL",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			iso27001: true,
		},
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
		termsUrl: "https://legal.mistral.ai/terms/commercial-terms-of-service",
		privacyPolicyUrl: "https://mistral.ai/terms/#privacy-policy",
		headquarters: "FR",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: true,
			retentionPeriod: "30 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
	},
	{
		id: "canopywave",
		name: "CanopyWave",
		description:
			"CanopyWave is a platform for running large language models with OpenAI-compatible API",
		env: {
			required: {
				apiKey: "LLM_CANOPY_WAVE_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#10b981",
		website: "https://canopywave.io",
		announcement: null,
		termsUrl: "https://canopywave.io/terms",
		privacyPolicyUrl: "https://canopywave.io/privacy",
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
		termsUrl: "https://inference.net/terms-of-service",
		privacyPolicyUrl: "https://inference.net/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: null,
			consumerTraining: null,
			promptLogging: null,
			retentionPeriod: null,
			soc2: true,
		},
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
		termsUrl: "https://www.together.ai/terms-of-service",
		privacyPolicyUrl: "https://www.together.ai/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
		},
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
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
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
		termsUrl: "https://nano-gpt.com/legal/terms-of-service",
		privacyPolicyUrl: "https://nano-gpt.com/legal/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: null,
			retentionPeriod: null,
		},
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
		termsUrl: "https://docs.byteplus.com/en/docs/legal/docs-terms-of-service",
		privacyPolicyUrl:
			"https://docs.byteplus.com/en/docs/legal/docs-privacy-policy",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: null,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
		},
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
		termsUrl: "https://intl.minimaxi.com/protocol/terms-of-service",
		privacyPolicyUrl: "https://intl.minimaxi.com/protocol/privacy-policy",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: null,
			promptLogging: true,
			retentionPeriod: null,
		},
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
		termsUrl: "https://www.embercloud.ai/terms",
		privacyPolicyUrl: "https://www.embercloud.ai/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: true,
			retentionPeriod: null,
		},
	},
	{
		id: "xiaomi",
		name: "Xiaomi",
		description:
			"Xiaomi MiMo API Open Platform provides access to the MiMo series of large language models.",
		env: {
			required: {
				apiKey: "LLM_XIAOMI_API_KEY",
			},
			optional: {
				baseUrl: "LLM_XIAOMI_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#FF6900",
		website: "https://platform.xiaomimimo.com",
		announcement: null,
		termsUrl: "https://platform.xiaomimimo.com/docs/terms/user-agreement",
		privacyPolicyUrl:
			"https://platform.xiaomimimo.com/docs/terms/privacy-policy",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: null,
			promptLogging: true,
			retentionPeriod: "30 days",
		},
	},
	{
		id: "deepinfra",
		name: "DeepInfra",
		description:
			"DeepInfra inference platform with OpenAI-compatible API for hosting open-source models.",
		env: {
			required: {
				apiKey: "LLM_DEEPINFRA_API_KEY",
			},
			optional: {
				baseUrl: "LLM_DEEPINFRA_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#6366F1",
		website: "https://deepinfra.com",
		announcement: null,
		termsUrl: "https://deepinfra.com/terms",
		privacyPolicyUrl: "https://deepinfra.com/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: true,
			iso27001: true,
			gdpr: true,
		},
	},
] as const satisfies ProviderDefinition[];

export type ProviderId = (typeof providers)[number]["id"];

export function getProviderDefinition(
	providerId: ProviderId | string,
): ProviderDefinition | undefined {
	return providers.find((p) => p.id === providerId);
}
