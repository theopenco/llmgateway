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

/**
 * A selectable processing tier offered by a provider that trades latency
 * against price relative to the standard on-demand rate. Selected per-request
 * via the OpenAI-compatible `service_tier` field. Currently used by OpenAI,
 * Google Vertex AI, and Google AI Studio.
 */
export interface ServiceTier {
	/** Value the client passes via `service_tier` to select this tier (e.g. "flex", "priority") */
	id: string;
	/** Human-readable tier name (e.g. "Flex", "Priority") */
	name: string;
	/**
	 * Multiplier applied to the standard input/output token prices for this
	 * tier. 0.5 means 50% cheaper, 2.5 means 2.5x standard pricing. Multipliers are
	 * uniform for provider tiers that publish a tier-wide multiplier.
	 */
	multiplier: number;
	/** Short description of the latency/availability trade-off */
	description?: string;
}

export interface ProviderDataPolicy {
	apiTraining: boolean | null;
	consumerTraining: boolean | null;
	promptLogging: boolean | null;
	retentionPeriod?: string | null;
	/**
	 * SOC 2 report type the provider holds: `1` for Type 1, `2` for Type 2.
	 * `null`/omitted means the provider is not SOC 2 certified.
	 */
	soc2?: 1 | 2 | null;
	iso27001?: boolean | null;
	gdpr?: boolean | null;
}

export interface ProviderAdditionalLink {
	desc: string;
	link: string;
}

/**
 * Organization-level compliance policy. When enabled, the gateway only routes
 * to providers whose {@link ProviderDataPolicy} explicitly satisfies every
 * active requirement (fail-closed: unknown/`null` attributes never satisfy a
 * requirement). Configurable on enterprise plans only.
 */
export interface ProviderCompliancePolicy {
	enabled: boolean;
	/** Require a SOC 2 report of any type (Type 1 or Type 2). */
	requireSoc2?: boolean;
	/** Require specifically a SOC 2 Type 2 report (the stricter attestation). */
	requireSoc2Type2?: boolean;
	requireIso27001?: boolean;
	/** Require either a SOC 2 Type 2 report or ISO 27001 certification. */
	requireSoc2OrIso27001?: boolean;
	requireGdpr?: boolean;
	/** Require the provider to NOT train on API prompts (apiTraining === false). */
	blockApiTraining?: boolean;
	/** Require the provider to NOT log prompts (promptLogging === false). */
	blockPromptLogging?: boolean;
	/**
	 * Restrict routing to providers headquartered in one of these ISO 3166-1
	 * alpha-2 country codes. Empty/omitted means no country restriction. Only
	 * codes present in the catalogue (see {@link getProviderCountries}) are
	 * meaningful; a provider with an unknown or `null` headquarters is blocked
	 * whenever this list is non-empty (fail-closed).
	 */
	allowedCountries?: string[];
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
	// Provider-owned service status URL
	statusPageUrl?: string | null;
	// Announcement text
	announcement?: string | null;
	// Short marketing badge shown on this provider's model cards (e.g. "Up to 4x faster")
	modelCardBadge?: string | null;
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
	/**
	 * Selectable processing tiers (e.g. Flex / Priority) offered by this
	 * provider. Chosen per-request via the `service_tier` field. When unset,
	 * the provider only offers the standard on-demand tier.
	 */
	serviceTiers?: ServiceTier[];
	termsUrl?: string | null;
	privacyPolicyUrl?: string | null;
	/** ISO 3166-1 alpha-2 country code for provider headquarters */
	headquarters?: string | null;
	/** Data usage and privacy policy details */
	dataPolicy?: ProviderDataPolicy | null;
	/** Additional provider policy links shown in the Data & Privacy card */
	additionalLinks?: ProviderAdditionalLink[];
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
		statusPageUrl: "https://status.llmgateway.io",
		announcement: null,
		termsUrl: "https://llmgateway.io/terms",
		privacyPolicyUrl: "https://llmgateway.io/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: null,
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
			optional: {
				baseUrl: "LLM_OPENAI_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#0ea5e9",
		website: "https://openai.com",
		statusPageUrl: "https://status.openai.com",
		announcement: null,
		termsUrl: "https://openai.com/policies/terms-of-use",
		privacyPolicyUrl: "https://openai.com/policies/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: true,
			promptLogging: true,
			retentionPeriod: null,
			soc2: 2,
			iso27001: true,
			gdpr: true,
		},
		serviceTiers: [
			{
				id: "flex",
				name: "Flex",
				multiplier: 0.5,
				description:
					"50% lower cost in exchange for slower responses and occasional resource unavailability.",
			},
			{
				id: "priority",
				name: "Priority",
				multiplier: 2.5,
				description:
					"Premium low-latency tier with faster, more consistent processing.",
			},
		],
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
		statusPageUrl: "https://status.claude.com",
		announcement: null,
		termsUrl: "https://www.anthropic.com/terms",
		privacyPolicyUrl: "https://www.anthropic.com/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: true,
			promptLogging: true,
			retentionPeriod: "30 days",
			soc2: 2,
			iso27001: true,
			gdpr: true,
		},
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
		statusPageUrl: "https://aistudio.google.com/status",
		announcement: null,
		priority: 0.8,
		serviceTiers: [
			{
				id: "flex",
				name: "Flex",
				multiplier: 0.5,
				description:
					"50% lower cost in exchange for variable latency and best-effort availability.",
			},
			{
				id: "priority",
				name: "Priority",
				multiplier: 1.8,
				description:
					"Premium low-latency tier prioritized above standard and flex traffic, at an 80% premium.",
			},
		],
		termsUrl: "https://ai.google.dev/gemini-api/terms",
		privacyPolicyUrl: "https://cloud.google.com/terms/data-processing-addendum",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: true,
			promptLogging: true,
			retentionPeriod: "55 days",
			soc2: 2,
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
		statusPageUrl: null,
		announcement: null,
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
		priority: 1.2,
	},
	{
		id: "granite",
		name: "Granite",
		description:
			"Granite is a stealth provider with OpenAI-compatible chat completions endpoints.",
		env: {
			required: {
				apiKey: "LLM_GRANITE_API_KEY",
				baseUrl: "LLM_GRANITE_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4285f4",
		website: null,
		statusPageUrl: null,
		announcement: null,
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
		priority: 1.5,
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
				tokenType: "LLM_GOOGLE_VERTEX_TOKEN_TYPE",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#4285f4",
		website: "https://cloud.google.com/vertex-ai",
		statusPageUrl: "https://status.cloud.google.com",
		announcement: null,
		serviceTiers: [
			{
				id: "flex",
				name: "Flex",
				multiplier: 0.5,
				description:
					"50% lower cost in exchange for variable latency and best-effort availability. Served on the global endpoint.",
			},
			{
				id: "priority",
				name: "Priority",
				multiplier: 1.8,
				description:
					"Premium low-latency tier prioritized above standard and flex traffic, at an 80% premium. Served on the global endpoint.",
			},
		],
		termsUrl: "https://cloud.google.com/terms/service-terms",
		privacyPolicyUrl: "https://policies.google.com/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: "https://status.cloud.google.com",
		announcement: null,
		priority: 0.2,
		regionConfig: {
			optionsKey: "vertex_openai_region",
			defaultRegion: "global",
			regions: [{ id: "global", label: "Global (default)" }],
			endpointMap: {
				global: "https://aiplatform.googleapis.com",
			},
		},
		termsUrl: "https://cloud.google.com/terms/service-terms",
		privacyPolicyUrl: "https://cloud.google.com/terms/data-processing-addendum",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: "https://status.cloud.google.com",
		announcement: null,
		priority: 0.2,
		termsUrl: "https://cloud.google.com/terms/service-terms",
		privacyPolicyUrl: "https://cloud.google.com/terms/data-processing-addendum",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: null,
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
		statusPageUrl: null,
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
		statusPageUrl: "https://groqstatus.com",
		announcement: null,
		termsUrl: "https://groq.com/terms-of-use",
		privacyPolicyUrl: "https://groq.com/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: "https://status.cerebras.ai",
		announcement: null,
		termsUrl: "https://cerebras.ai/terms-of-service",
		privacyPolicyUrl: "https://cerebras.ai/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: "https://status.x.ai",
		announcement: null,
		termsUrl: "https://x.ai/legal/terms-of-service",
		privacyPolicyUrl: "https://x.ai/legal/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: true,
			retentionPeriod: "30 days",
			soc2: 2,
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
		statusPageUrl: "https://status.deepseek.com",
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
		priority: 1.2,
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
		statusPageUrl: "https://status.alibabacloud.com",
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
		statusPageUrl: "https://status.novita.ai",
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
		id: "atlascloud",
		name: "AtlasCloud",
		description:
			"AtlasCloud provides unified APIs for video, image, audio, and language generation models.",
		env: {
			required: {
				apiKey: "LLM_ATLASCLOUD_API_KEY",
			},
			optional: {
				baseUrl: "LLM_ATLASCLOUD_BASE_URL",
			},
		},
		streaming: false,
		cancellation: false,
		color: "#0F766E",
		website: "https://www.atlascloud.ai",
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://atlascloud.ai/privacy",
		privacyPolicyUrl: "https://www.atlascloud.ai/privacy",
		headquarters: null,
		dataPolicy: {
			apiTraining: null,
			consumerTraining: null,
			promptLogging: null,
			retentionPeriod: "varies by service; Enterprise ZDR available",
			soc2: 2,
			gdpr: true,
		},
		additionalLinks: [
			{
				desc: "Zero Data Retention and DPA",
				link: "https://www.atlascloud.ai/zero-data-retention",
			},
			{
				desc: "Data deletion policy",
				link: "https://www.atlascloud.ai/data-deletion-policy",
			},
		],
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
		priority: 2,
		streaming: true,
		cancellation: true,
		color: "#FF9900",
		website: "https://aws.amazon.com/bedrock",
		statusPageUrl: "https://health.aws.amazon.com/health/status",
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
				{ id: "au", label: "Australia" },
				{ id: "jp", label: "Japan" },
				// Specific AWS regions for data-residency requirements.
				{ id: "us-east-1", label: "US East (N. Virginia)" },
				{ id: "us-east-2", label: "US East (Ohio)" },
				{ id: "us-west-2", label: "US West (Oregon)" },
				{ id: "eu-central-1", label: "EU (Frankfurt)" },
				{ id: "eu-north-1", label: "EU (Stockholm)" },
				{ id: "eu-west-1", label: "EU (Ireland)" },
				{ id: "eu-west-2", label: "EU (London)" },
				{ id: "eu-west-3", label: "EU (Paris)" },
				{ id: "ap-northeast-1", label: "Asia Pacific (Tokyo)" },
				{ id: "ap-northeast-2", label: "Asia Pacific (Seoul)" },
				{ id: "ap-southeast-1", label: "Asia Pacific (Singapore)" },
			],
			endpointMap: {
				global: "https://bedrock-runtime.us-east-1.amazonaws.com",
				us: "https://bedrock-runtime.us-east-1.amazonaws.com",
				eu: "https://bedrock-runtime.eu-central-1.amazonaws.com",
				apac: "https://bedrock-runtime.ap-northeast-1.amazonaws.com",
				au: "https://bedrock-runtime.ap-southeast-2.amazonaws.com",
				jp: "https://bedrock-runtime.ap-northeast-1.amazonaws.com",
				"us-east-1": "https://bedrock-runtime.us-east-1.amazonaws.com",
				"us-east-2": "https://bedrock-runtime.us-east-2.amazonaws.com",
				"us-west-2": "https://bedrock-runtime.us-west-2.amazonaws.com",
				"eu-central-1": "https://bedrock-runtime.eu-central-1.amazonaws.com",
				"eu-north-1": "https://bedrock-runtime.eu-north-1.amazonaws.com",
				"eu-west-1": "https://bedrock-runtime.eu-west-1.amazonaws.com",
				"eu-west-2": "https://bedrock-runtime.eu-west-2.amazonaws.com",
				"eu-west-3": "https://bedrock-runtime.eu-west-3.amazonaws.com",
				"ap-northeast-1":
					"https://bedrock-runtime.ap-northeast-1.amazonaws.com",
				"ap-northeast-2":
					"https://bedrock-runtime.ap-northeast-2.amazonaws.com",
				"ap-southeast-1":
					"https://bedrock-runtime.ap-southeast-1.amazonaws.com",
			},
			modelPrefixMap: {
				global: "global.",
				us: "us.",
				eu: "eu.",
				apac: "apac.",
				au: "au.",
				jp: "jp.",
				"us-east-1": "",
				"us-east-2": "",
				"us-west-2": "",
				"eu-central-1": "",
				"eu-north-1": "",
				"eu-west-1": "",
				"eu-west-2": "",
				"eu-west-3": "",
				"ap-northeast-1": "",
				"ap-northeast-2": "",
				"ap-southeast-1": "",
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
			soc2: 2,
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
		statusPageUrl: "https://status.ai.azure.com",
		announcement: null,
		apiKeyInstructions:
			"The resource name can be found in your Azure base URL: https://<resource-name>.openai.azure.com",
		learnMore: "https://docs.llmgateway.io/integrations/azure",
		priority: 2,
		termsUrl: "https://www.microsoft.com/licensing/terms",
		privacyPolicyUrl: "https://privacy.microsoft.com/privacystatement",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: "https://status.ai.azure.com",
		announcement: null,
		apiKeyInstructions:
			"The resource name can be found in your Azure AI Foundry base URL: https://<resource-name>.services.ai.azure.com",
		learnMore: "https://docs.llmgateway.io/integrations/azure",
		priority: 1.5,
		termsUrl: "https://www.microsoft.com/licensing/terms",
		privacyPolicyUrl: "https://privacy.microsoft.com/privacystatement",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://docs.z.ai/legal-agreement/terms-of-use",
		privacyPolicyUrl: "https://docs.z.ai/legal-agreement/privacy-policy",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
		priority: 1.2,
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
		statusPageUrl: "https://status.moonshot.cn",
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
		priority: 1.2,
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
		statusPageUrl: "https://status.perplexity.com",
		announcement: null,
		termsUrl: "https://www.perplexity.ai/hub/legal/terms-of-service",
		privacyPolicyUrl: "https://www.perplexity.ai/hub/legal/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: "https://status.nebius.com",
		announcement: null,
		termsUrl: "https://docs.nebius.com/legal/terms-of-use",
		privacyPolicyUrl: "https://docs.nebius.com/legal/privacy",
		headquarters: "NL",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
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
		statusPageUrl: "https://status.mistral.ai",
		announcement: null,
		termsUrl: "https://legal.mistral.ai/terms/commercial-terms-of-service",
		privacyPolicyUrl: "https://mistral.ai/terms/#privacy-policy",
		headquarters: "FR",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: true,
			retentionPeriod: "30 days",
			soc2: 2,
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
		website: "https://canopywave.com",
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://canopywave.com/terms",
		privacyPolicyUrl: "https://canopywave.com/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 1,
			iso27001: false,
			gdpr: false,
		},
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
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://inference.net/terms-of-service",
		privacyPolicyUrl: "https://inference.net/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: null,
			consumerTraining: null,
			promptLogging: null,
			retentionPeriod: null,
			soc2: 2,
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
		statusPageUrl: "https://status.together.ai",
		announcement: null,
		termsUrl: "https://www.together.ai/terms-of-service",
		privacyPolicyUrl: "https://www.together.ai/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
		},
	},
	{
		id: "scx-ai",
		name: "SCX.ai",
		description:
			"SCX.ai is an Australian sovereign AI platform providing OpenAI-compatible Turbo inference endpoints — up to 4x faster than comparable providers — for a range of open models and SCX's own models, hosted on renewable-powered infrastructure.",
		env: {
			required: {
				apiKey: "LLM_SCX_AI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#1a1a2e",
		modelCardBadge: "Up to 4x faster",
		website: "https://scx.ai",
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://scx.ai/terms",
		privacyPolicyUrl: "https://scx.ai/privacy",
		headquarters: "AU",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
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
		statusPageUrl: null,
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
		statusPageUrl: "https://status.nano-gpt.com",
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
		statusPageUrl: "https://status.volcengine.com",
		announcement: null,
		termsUrl: "https://docs.byteplus.com/en/docs/legal/docs-terms-of-service",
		privacyPolicyUrl:
			"https://docs.byteplus.com/en/docs/legal/docs-privacy-policy",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: null,
			promptLogging: false,
			retentionPeriod: "24 hours",
			soc2: 2,
		},
		additionalLinks: [
			{
				desc: "AI Terms",
				link: "https://docs.byteplus.com/en/docs/legal/docs-service-specific-terms",
			},
		],
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
		statusPageUrl: "https://status.minimaxi.com",
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
		priority: 1.2,
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
		statusPageUrl: "https://www.embercloud.ai/status",
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
		id: "meta",
		name: "Meta",
		description:
			"Meta's Model API serving the Muse Spark multimodal reasoning models via an OpenAI-compatible API",
		env: {
			required: {
				apiKey: "LLM_META_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#0668E1",
		website: "https://dev.meta.ai",
		statusPageUrl: null,
		announcement: null,
		apiKeyInstructions:
			"Create an API key in the API keys tab of the Meta Model API dashboard.",
		learnMore: "https://dev.meta.ai/docs/getting-started/authentication",
		termsUrl: "https://dev.meta.ai/legal/terms-of-service",
		privacyPolicyUrl: "https://www.facebook.com/privacy/policy/",
		headquarters: "US",
		dataPolicy: {
			// Paid (pay-as-you-go) services are never trained on; only the free
			// unpaid tier may be used for training per the Data Commitments page.
			apiTraining: false,
			consumerTraining: true,
			promptLogging: true,
			retentionPeriod: null,
			soc2: null,
			iso27001: null,
			gdpr: true,
		},
		additionalLinks: [
			{
				desc: "Data Commitments",
				link: "https://dev.meta.ai/legal/commitments",
			},
			{
				desc: "Acceptable Use Policy",
				link: "https://dev.meta.ai/legal/acceptable-use-policy",
			},
		],
	},
	{
		id: "sakana",
		name: "Sakana AI",
		description:
			"Sakana AI's Fugu multi-agent orchestration models, served through a single OpenAI-compatible API.",
		env: {
			required: {
				apiKey: "LLM_SAKANA_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#FF5A5F",
		website: "https://sakana.ai",
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://console.sakana.ai/terms-of-service",
		privacyPolicyUrl: "https://console.sakana.ai/privacy-policy",
		headquarters: "JP",
		dataPolicy: null,
	},
	{
		id: "tundra",
		name: "Tundra",
		description: "Tundra is a stealth provider with an OpenAI-compatible API.",
		env: {
			required: {
				apiKey: "LLM_TUNDRA_API_KEY",
				baseUrl: "LLM_TUNDRA_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#5b8db8",
		website: null,
		statusPageUrl: null,
		announcement: null,
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
		priority: 1.1,
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
		statusPageUrl: null,
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
		statusPageUrl: "https://status.deepinfra.com",
		announcement: null,
		termsUrl: "https://deepinfra.com/terms",
		privacyPolicyUrl: "https://deepinfra.com/privacy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			iso27001: true,
			gdpr: true,
		},
	},
	{
		id: "reve",
		name: "Reve",
		description:
			"Reve's image generation models with native 4K resolution and code-based controllable image creation.",
		env: {
			required: {
				apiKey: "LLM_REVE_API_KEY",
			},
		},
		streaming: false,
		cancellation: false,
		color: "#1a1a2e",
		website: "https://reve.com",
		statusPageUrl: "https://status.reve.com",
		announcement: null,
		termsUrl:
			"https://help.reve.com/hc/en-us/articles/46731550696468-Terms-of-service",
		privacyPolicyUrl:
			"https://help.reve.com/hc/en-us/articles/46731763484692-Privacy-policy",
		headquarters: "US",
		dataPolicy: null,
	},
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		description:
			"ElevenLabs provides lifelike, low-latency text-to-speech models in 70+ languages.",
		env: {
			required: {
				apiKey: "LLM_ELEVENLABS_API_KEY",
			},
			optional: {
				baseUrl: "LLM_ELEVENLABS_BASE_URL",
			},
		},
		streaming: false,
		cancellation: true,
		color: "#000000",
		website: "https://elevenlabs.io",
		statusPageUrl: "https://status.elevenlabs.io",
		announcement: null,
		termsUrl: "https://elevenlabs.io/terms-of-use",
		privacyPolicyUrl: "https://elevenlabs.io/privacy-policy",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			consumerTraining: false,
			promptLogging: true,
			retentionPeriod: null,
			soc2: 2,
			iso27001: false,
			gdpr: true,
		},
	},
	{
		id: "gonka24",
		name: "Gonka24",
		description:
			"Gonka24 serves open-weight large language models via an OpenAI-compatible inference gateway.",
		env: {
			required: {
				apiKey: "LLM_GONKA_24_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#000000",
		website: "https://gonka24.com",
		statusPageUrl: null,
		announcement: null,
		termsUrl: null,
		privacyPolicyUrl: null,
		headquarters: null,
		dataPolicy: null,
	},
] as const satisfies ProviderDefinition[];

export type ProviderId = (typeof providers)[number]["id"];

export function getProviderDefinition(
	providerId: ProviderId | string,
): ProviderDefinition | undefined {
	return providers.find((p) => p.id === providerId);
}

/**
 * Look up a provider's configured service tier (e.g. Flex / Priority) by id.
 */
export function getServiceTier(
	providerId: ProviderId | string,
	tierId: string,
): ServiceTier | undefined {
	return getProviderDefinition(providerId)?.serviceTiers?.find(
		(t) => t.id === tierId,
	);
}

/**
 * Whether a provider satisfies an organization's compliance policy. Fail-closed:
 * any active requirement that the provider's {@link ProviderDataPolicy} does not
 * explicitly satisfy (including a missing `dataPolicy`) makes the provider
 * non-compliant. A disabled policy treats every provider as compliant.
 */
export function isProviderCompliant(
	provider: ProviderDefinition,
	policy: ProviderCompliancePolicy,
): boolean {
	if (!policy.enabled) {
		return true;
	}
	const dataPolicy = provider.dataPolicy;
	if (policy.requireSoc2 && !dataPolicy?.soc2) {
		return false;
	}
	if (policy.requireSoc2Type2 && dataPolicy?.soc2 !== 2) {
		return false;
	}
	if (policy.requireIso27001 && dataPolicy?.iso27001 !== true) {
		return false;
	}
	if (
		policy.requireSoc2OrIso27001 &&
		!(dataPolicy?.soc2 === 2 || dataPolicy?.iso27001 === true)
	) {
		return false;
	}
	if (policy.requireGdpr && dataPolicy?.gdpr !== true) {
		return false;
	}
	if (policy.blockApiTraining && dataPolicy?.apiTraining !== false) {
		return false;
	}
	if (policy.blockPromptLogging && dataPolicy?.promptLogging !== false) {
		return false;
	}
	if (
		policy.allowedCountries &&
		policy.allowedCountries.length > 0 &&
		(!provider.headquarters ||
			!policy.allowedCountries.includes(provider.headquarters))
	) {
		return false;
	}
	return true;
}

export interface ProviderCountry {
	/** ISO 3166-1 alpha-2 country code */
	code: string;
	/** Human-readable country name */
	name: string;
	/** Unicode flag emoji derived from the country code */
	flag: string;
}

/**
 * English display names for the country codes that appear as provider
 * headquarters in the catalogue. Kept intentionally small: the site only ever
 * surfaces countries that are actually referenced by a provider definition.
 * Every distinct `headquarters` value in {@link providers} MUST have an entry
 * here — enforced by a unit test so new country additions can't ship without
 * a display name.
 */
export const PROVIDER_COUNTRY_NAMES: Record<string, string> = {
	US: "United States",
	CN: "China",
	NL: "Netherlands",
	FR: "France",
	JP: "Japan",
	AU: "Australia",
};

/** Convert an ISO 3166-1 alpha-2 country code to its Unicode flag emoji. */
export function countryCodeToFlag(code: string): string {
	return code
		.toUpperCase()
		.replace(/[^A-Z]/g, "")
		.replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

/**
 * Distinct provider-headquarters countries defined in the catalogue, sorted by
 * name. This is the authoritative, closed set of countries the compliance
 * country selector may offer.
 */
export function getProviderCountries(): ProviderCountry[] {
	const codes = new Set<string>();
	for (const provider of providers) {
		if (provider.headquarters) {
			codes.add(provider.headquarters);
		}
	}
	return Array.from(codes)
		.map((code) => ({
			code,
			name: PROVIDER_COUNTRY_NAMES[code] ?? code,
			flag: countryCodeToFlag(code),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Format a service tier's price multiplier relative to standard for display,
 * e.g. 1.8 → "1.8× (+80%)", 0.5 → "0.5× (−50%)". Returns an empty string for
 * the standard multiplier (1).
 */
export function formatServiceTierMultiplier(multiplier: number): string {
	if (multiplier === 1) {
		return "";
	}
	const delta =
		multiplier < 1
			? `−${Math.round((1 - multiplier) * 100)}%`
			: `+${Math.round((multiplier - 1) * 100)}%`;
	return `${multiplier}× (${delta})`;
}
