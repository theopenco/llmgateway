/**
 * Placeholder inside a `regionConfig.endpointMap` entry for a region whose
 * host is not a fixed domain but is derived from a per-credential workspace
 * identifier. Alibaba's Frankfurt region is only reachable through the
 * workspace-dedicated `{WorkspaceId}.eu-central-1.maas.aliyuncs.com` host —
 * it has no shared DashScope domain — so the endpoint can only be completed
 * once the credential's workspace id is known.
 */
export const REGION_WORKSPACE_ID_PLACEHOLDER = "{workspaceId}";

export interface ProviderEnvConfig {
	required: {
		apiKey?: string;
		[key: string]: string | undefined;
	};
	optional?: Record<string, string>;
	/**
	 * Groups of optional settings where exactly one member must be supplied.
	 * Neither is required on its own, so they cannot live in `required`, but a
	 * credential supplying none or more than one of them is misconfigured.
	 * Validated when a credential is saved and surfaced in the admin form.
	 */
	exclusive?: ProviderEnvExclusiveGroup[];
}

export interface ProviderEnvExclusiveGroup {
	/** Logical env keys, exactly one of which must carry a value. */
	keys: string[];
	/** Explains the choice in the credential form. */
	description: string;
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
	 * Base URL to use for a workspace-scoped region when no workspace id is
	 * configured. Alibaba's Frankfurt region has such a shared entry point, so
	 * the region stays usable from an API key alone; the workspace-dedicated
	 * host remains the better path because the shared one is documented as
	 * trial-only (1000 RPM, no SLA, "not recommended for production").
	 */
	endpointFallbackMap?: Record<string, string>;
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
 * requirement). The full policy is configurable on enterprise plans; DevPass
 * organizations may enable only {@link ProviderCompliancePolicy.blockApiTraining}.
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
	/**
	 * Require the provider to NOT log prompts (promptLogging === false).
	 * @deprecated Existing policies remain supported, but new policies should use
	 * {@link ProviderCompliancePolicy.zeroDataRetention}.
	 */
	blockPromptLogging?: boolean;
	/** Require promptLogging === false and retentionPeriod === "0 days". */
	zeroDataRetention?: boolean;
	/**
	 * Block stealth providers (see {@link isStealthProvider}) — undisclosed
	 * platforms whose data policy and headquarters are unknown. They already
	 * fail every certification/data-policy requirement (fail-closed on a null
	 * `dataPolicy`), so this exists to exclude them even when no other
	 * requirement is active.
	 */
	blockStealthProviders?: boolean;
	/**
	 * Restrict routing to providers headquartered in one of these ISO 3166-1
	 * alpha-2 country codes. Empty/omitted means no country restriction. Only
	 * codes present in the catalogue (see {@link getProviderCountries}) are
	 * meaningful; a provider with an unknown or `null` headquarters is blocked
	 * whenever this list is non-empty (fail-closed).
	 */
	allowedCountries?: string[];
	/**
	 * Deny list of individual providers. Entries are catalogue provider ids
	 * (e.g. "openai") or `custom:<name>` refs (see {@link customProviderRef})
	 * for the org's own custom providers. A listed provider is always blocked,
	 * even when it satisfies every other requirement, and regardless of any
	 * user-, member-, or API-key-level rule that would allow it.
	 */
	blockedProviders?: string[];
	/**
	 * Fine-grained provider allow list. When non-empty, only listed providers
	 * (same ref format as {@link ProviderCompliancePolicy.blockedProviders})
	 * may be routed to — and they must still satisfy every other requirement.
	 * Empty/omitted applies no allow-list restriction.
	 */
	allowedProviders?: string[];
	/**
	 * Deny list of individual models. Entries are catalogue model ids (e.g.
	 * "gpt-5.2") or `<customProvider>/<model>` refs for models served through
	 * an org custom provider. A listed model is always blocked.
	 */
	blockedModels?: string[];
	/**
	 * Fine-grained model allow list. When non-empty, only listed models (same
	 * ref format as {@link ProviderCompliancePolicy.blockedModels}) may be
	 * requested. Empty/omitted applies no allow-list restriction.
	 */
	allowedModels?: string[];
}

/** DevPass exposes only the no-API-training requirement. */
export function narrowPolicyToDevPass(
	policy: ProviderCompliancePolicy,
): ProviderCompliancePolicy | undefined {
	return policy.enabled && policy.blockApiTraining
		? { enabled: true, blockApiTraining: true }
		: undefined;
}

export interface ProviderDefinition {
	id: string;
	name: string;
	description: string;
	/**
	 * Whether LLM Gateway forwards its opaque per-organization safety identifier
	 * to this provider. Informational only; request preparation does not use it.
	 */
	forwardsSafetyIdentifier: boolean;
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
	/**
	 * Highest `temperature` this provider accepts. The OpenAI schema allows up
	 * to 2, but some providers reject anything above their own ceiling with a
	 * 400, so the gateway clamps the requested value instead of failing.
	 */
	maxTemperature?: number;
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
	usagePolicyUrl?: string | null;
	/** Contracting entity named in the terms applicable to LLM Gateway's account */
	legalEntity: string | null;
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
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://llmgateway.io/legal/terms",
		legalEntity: "Polar Lights LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: true,
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
		termsUrl: "https://openai.com/policies/services-agreement/",
		privacyPolicyUrl: "https://openai.com/policies/privacy-policy",
		usagePolicyUrl: "https://openai.com/policies/usage-policies/",
		legalEntity: "OpenAI OpCo, LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: true,
		description:
			"Anthropic is a research and deployment company focused on building safe and useful AI.",
		env: {
			required: {
				apiKey: "LLM_ANTHROPIC_API_KEY",
			},
			optional: {
				baseUrl: "LLM_ANTHROPIC_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		// the Messages API rejects temperature above 1 ("temperature: range: 0..1")
		maxTemperature: 1,
		color: "#8b5cf6",
		website: "https://anthropic.com",
		statusPageUrl: "https://status.claude.com",
		announcement: null,
		termsUrl: "https://www.anthropic.com/legal/commercial-terms",
		privacyPolicyUrl: "https://www.anthropic.com/privacy",
		usagePolicyUrl: "https://www.anthropic.com/legal/aup",
		legalEntity: "Anthropic, PBC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl:
			"https://policies.google.com/terms?utm_source=ai.google&utm_medium=referral#toc-what-we-expect",
		legalEntity: "Google LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
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
		legalEntity: null,
		headquarters: null,
		dataPolicy: null,
		priority: 1.2,
	},
	{
		id: "iceberg",
		name: "Iceberg",
		forwardsSafetyIdentifier: false,
		description:
			"Iceberg is a stealth provider with Google AI Studio-compatible Gemini endpoints.",
		env: {
			required: {
				apiKey: "LLM_ICEBERG_API_KEY",
				baseUrl: "LLM_ICEBERG_BASE_URL",
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
		legalEntity: null,
		headquarters: null,
		dataPolicy: null,
		priority: 1.2,
	},
	{
		id: "granite",
		name: "Granite",
		forwardsSafetyIdentifier: false,
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
		legalEntity: null,
		headquarters: null,
		dataPolicy: null,
		priority: 1.5,
	},
	{
		id: "google-vertex",
		name: "Google Vertex AI",
		forwardsSafetyIdentifier: false,
		description:
			"Google Vertex AI is a platform for accessing Google's Gemini models via Vertex AI.",
		env: {
			required: {
				apiKey: "LLM_GOOGLE_VERTEX_API_KEY",
			},
			optional: {
				baseUrl: "LLM_GOOGLE_VERTEX_BASE_URL",
				project: "LLM_GOOGLE_CLOUD_PROJECT",
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
		usagePolicyUrl:
			"https://policies.google.com/terms?utm_source=ai.google&utm_medium=referral#toc-what-we-expect",
		legalEntity: "Google LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl:
			"https://policies.google.com/terms?utm_source=ai.google&utm_medium=referral#toc-what-we-expect",
		legalEntity: "Google LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: true,
		description:
			"Access Claude models via Google Cloud Vertex AI with the Anthropic Messages API.",
		env: {
			required: {
				apiKey: "LLM_VERTEX_ANTHROPIC_SERVICE_ACCOUNT_JSON",
				// The GCP project the models are called under; it becomes part of the
				// request path. An env-var deployment can leave it unset — the gateway
				// derives it from the service-account JSON on startup — but a managed
				// credential's JSON is only ever decrypted to mint an access token, so
				// the credential has to carry the project itself.
				project: "LLM_VERTEX_ANTHROPIC_PROJECT",
			},
			optional: {
				baseUrl: "LLM_VERTEX_ANTHROPIC_BASE_URL",
				region: "LLM_VERTEX_ANTHROPIC_REGION",
			},
		},
		streaming: true,
		cancellation: true,
		// same Messages API ceiling as anthropic
		maxTemperature: 1,
		color: "#4285f4",
		website: "https://cloud.google.com/vertex-ai",
		statusPageUrl: "https://status.cloud.google.com",
		announcement: null,
		priority: 0.2,
		termsUrl: "https://cloud.google.com/terms/service-terms",
		privacyPolicyUrl: "https://cloud.google.com/terms/data-processing-addendum",
		usagePolicyUrl:
			"https://policies.google.com/terms?utm_source=ai.google&utm_medium=referral#toc-what-we-expect",
		legalEntity: "Google LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
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
		legalEntity: null,
		headquarters: null,
		dataPolicy: null,
	},
	{
		id: "groq",
		name: "Groq",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://groq.com/terms-of-use",
		legalEntity: "Groq LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			gdpr: true,
		},
	},
	{
		id: "cerebras",
		name: "Cerebras",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://www.cerebras.ai/terms-of-service",
		legalEntity: "Cerebras Systems Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			gdpr: true,
		},
	},
	{
		id: "xai",
		name: "xAI",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://x.ai/legal/acceptable-use-policy",
		legalEntity: "SpaceXAI LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: true,
			retentionPeriod: "30 days",
			soc2: 2,
			gdpr: true,
		},
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl:
			"https://cdn.deepseek.com/policies/en-US/deepseek-terms-of-use.html",
		legalEntity: "Hangzhou DeepSeek Artificial Intelligence Co., Ltd.",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: true,
			promptLogging: true,
			retentionPeriod: null,
		},
		priority: 1.2,
	},
	{
		id: "alibaba",
		name: "Alibaba Cloud",
		forwardsSafetyIdentifier: false,
		description:
			"Alibaba Cloud's Qwen large language models with OpenAI-compatible API",
		env: {
			required: {
				apiKey: "LLM_ALIBABA_API_KEY",
			},
			optional: {
				// No `region` key: the region comes from the model's `:region`
				// suffix or the credential's own region binding, never from a
				// provider-wide setting, so declaring one would only render a dead
				// field on the credential form.
				workspaceId: "LLM_ALIBABA_WORKSPACE_ID",
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
				{ id: "eu-frankfurt", label: "EU (Frankfurt)" },
				{ id: "us-virginia", label: "US (Virginia)" },
				{ id: "cn-beijing", label: "China (Beijing)" },
			],
			endpointMap: {
				singapore: "https://dashscope-intl.aliyuncs.com",
				// Frankfurt is the one Model Studio region with no shared DashScope
				// domain: `dashscope-eu`/`dashscope-de` do not exist and aliasing
				// another region's host would silently execute EU-designated traffic
				// elsewhere. It is served only by the workspace-dedicated host, whose
				// workspace id comes from the credential (see the placeholder docs).
				"eu-frankfurt": `https://${REGION_WORKSPACE_ID_PLACEHOLDER}.eu-central-1.maas.aliyuncs.com`,
				"us-virginia": "https://dashscope-us.aliyuncs.com",
				"cn-beijing": "https://dashscope.aliyuncs.com",
			},
			endpointFallbackMap: {
				// Resolves the workspace from the API key, so Frankfurt still works
				// without one being configured. Alibaba caps it at 1000 RPM with no
				// SLA and advises against production use, so a credential that
				// supplies a workspace id gets the dedicated host instead.
				"eu-frankfurt": "https://trial.eu-central-1.maas.aliyuncs.com",
			},
		},
		termsUrl:
			"https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-product-terms-of-service-v-3-8-0",
		privacyPolicyUrl:
			"https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-privacy-policy",
		usagePolicyUrl:
			"https://www.alibabacloud.com/help/en/legal/latest/alibaba-cloud-international-website-membership-agreement",
		legalEntity: "Alibaba Cloud US LLC",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			promptLogging: true,
			retentionPeriod: null,
			iso27001: true,
		},
	},
	{
		id: "novita",
		name: "NovitaAI",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://novita.ai/legal/acceptable-use-policy",
		legalEntity: "Novita Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
	},
	{
		id: "atlascloud",
		name: "AtlasCloud",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://www.atlascloud.ai/acceptable-use",
		legalEntity: "ATLAS CLOUD AI INC.",
		headquarters: null,
		dataPolicy: {
			apiTraining: null,
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
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://aws.amazon.com/aup/",
		legalEntity: "Amazon Web Services, Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			iso27001: true,
			gdpr: true,
		},
	},
	{
		id: "aws-mantle",
		name: "AWS Mantle",
		forwardsSafetyIdentifier: false,
		description:
			"Amazon Bedrock Mantle - OpenAI frontier models served on AWS via the Responses API",
		env: {
			required: {
				apiKey: "LLM_AWS_MANTLE_API_KEY",
			},
			optional: {
				baseUrl: "LLM_AWS_MANTLE_BASE_URL",
				region: "LLM_AWS_MANTLE_REGION",
			},
		},
		priority: 2,
		streaming: true,
		cancellation: true,
		color: "#FF9900",
		website: "https://aws.amazon.com/bedrock",
		statusPageUrl: "https://health.aws.amazon.com/health/status",
		announcement: null,
		regionConfig: {
			optionsKey: "aws_mantle_region",
			defaultRegion: "us-east-1",
			// Mantle has no cross-region inference profiles at all — the model
			// cards mark Geo and Global as unsupported — so every entry is a
			// concrete AWS region and `pinDefaultRegion` stays unset, letting the
			// gateway route across regions like Alibaba instead of pinning to a
			// synthetic global default the way aws-bedrock does.
			regions: [
				{ id: "us-east-1", label: "US East (N. Virginia)" },
				{ id: "us-east-2", label: "US East (Ohio)" },
				{ id: "us-west-2", label: "US West (Oregon)" },
			],
			endpointMap: {
				"us-east-1": "https://bedrock-mantle.us-east-1.api.aws",
				"us-east-2": "https://bedrock-mantle.us-east-2.api.aws",
				"us-west-2": "https://bedrock-mantle.us-west-2.api.aws",
			},
			// Bedrock long-term API keys are IAM-global: one ABSK key authenticates
			// against every regional Mantle endpoint, so non-default regions do not
			// need their own `LLM_AWS_MANTLE_API_KEY__<REGION>` env key.
			sharedCredentialAcrossRegions: true,
		},
		apiKeyInstructions:
			"Use AWS Bedrock Long-Term API Keys (not IAM service account or private keys)",
		termsUrl: "https://aws.amazon.com/service-terms",
		privacyPolicyUrl: "https://aws.amazon.com/privacy",
		usagePolicyUrl: "https://aws.amazon.com/aup/",
		legalEntity: "Amazon Web Services, Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: true,
		description: "Microsoft Azure - enterprise-grade OpenAI models",
		env: {
			required: {
				apiKey: "LLM_AZURE_API_KEY",
			},
			optional: {
				// A deployment needs either a resource, which builds the
				// https://<resource>.openai.azure.com host, or an explicit base URL
				// for a deployment that speaks the Azure surface from somewhere else
				// (a gateway, a proxy, a private endpoint). Neither is required on
				// its own, so both are optional here and the exclusive group below
				// makes supplying exactly one of them the rule.
				resource: "LLM_AZURE_RESOURCE",
				baseUrl: "LLM_AZURE_BASE_URL",
				deploymentType: "LLM_AZURE_DEPLOYMENT_TYPE",
				apiVersion: "LLM_AZURE_API_VERSION",
				useResponsesApi: "LLM_AZURE_USE_RESPONSES_API",
			},
			exclusive: [
				{
					keys: ["resource", "baseUrl"],
					description:
						"A resource builds the https://<resource>.openai.azure.com host; a base URL points at a deployment serving the Azure surface from anywhere else.",
				},
			],
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
		usagePolicyUrl: "https://www.microsoft.com/en-us/legal/terms-of-use",
		legalEntity: "Microsoft Corporation",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://www.microsoft.com/en-us/legal/terms-of-use",
		legalEntity: "Microsoft Corporation",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			iso27001: true,
			gdpr: true,
		},
	},
	{
		id: "azure-anthropic",
		name: "Azure Anthropic",
		forwardsSafetyIdentifier: true,
		description:
			"Anthropic Claude models on Microsoft Foundry via the Anthropic Messages API",
		env: {
			required: {
				apiKey: "LLM_AZURE_ANTHROPIC_API_KEY",
				resource: "LLM_AZURE_ANTHROPIC_RESOURCE",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#0078D4",
		website:
			"https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/claude-models",
		statusPageUrl: "https://status.ai.azure.com",
		announcement: null,
		apiKeyInstructions:
			"The resource name can be found in your Microsoft Foundry base URL: https://<resource-name>.services.ai.azure.com",
		learnMore: "https://docs.llmgateway.io/integrations/azure",
		termsUrl: "https://www.microsoft.com/licensing/terms",
		privacyPolicyUrl: "https://privacy.microsoft.com/privacystatement",
		usagePolicyUrl: "https://www.microsoft.com/en-us/legal/terms-of-use",
		legalEntity: "Microsoft Corporation",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
		description: "Z AI's OpenAI-compatible large language models",
		env: {
			required: {
				apiKey: "LLM_Z_AI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		// every GLM model rejects temperature above 1 with a 400
		// ("The temperature parameter is illegal", range [0,1])
		maxTemperature: 1,
		color: "#22c55e",
		website: "https://z.ai",
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://docs.z.ai/legal-agreement/terms-of-use",
		privacyPolicyUrl: "https://docs.z.ai/legal-agreement/privacy-policy",
		usagePolicyUrl: "https://chat.z.ai/legal-agreement/terms-of-service",
		legalEntity: "JINGSHENG HENGXING TECHNOLOGY PTE. LTD.",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
		priority: 1.2,
	},
	{
		id: "moonshot",
		name: "Moonshot AI",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://www.kimi.ai/user/agreement/modelUse?version=v2",
		legalEntity: "NOVASCENT PRIVATE LIMITED",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
		priority: 1.2,
	},
	{
		id: "baidu",
		name: "Baidu",
		forwardsSafetyIdentifier: false,
		description:
			"Baidu's Qianfan platform serving DeepSeek, GLM, Kimi, MiMo, and Hy3 models",
		env: {
			required: {
				apiKey: "LLM_BAIDU_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#2932E1",
		website: "https://intl.cloud.baidu.com/product/qianfan.html",
		statusPageUrl: null,
		announcement: null,
		termsUrl:
			"https://intl.cloud.baidu.com/en/doc/Agreements/s/bmesahnjh-intl-en",
		privacyPolicyUrl:
			"https://intl.cloud.baidu.com/en/doc/Agreements/s/Plr0fi68q-intl-en",
		usagePolicyUrl:
			"https://intl.cloud.baidu.com/en/doc/Agreements/s/yjwvy1x03-intl-en",
		legalEntity: "Baidu Holdings Limited",
		headquarters: "CN",
		// Qianfan publishes no API training / prompt logging commitment we can
		// point at, so every attribute stays unknown and fails closed under a
		// compliance policy rather than claiming a guarantee Baidu never made.
		dataPolicy: {
			apiTraining: null,
			promptLogging: null,
			retentionPeriod: null,
		},
	},
	{
		id: "perplexity",
		name: "Perplexity",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://www.perplexity.ai/hub/legal/aup",
		legalEntity: "Perplexity AI, Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			gdpr: true,
		},
	},
	{
		id: "nebius",
		name: "Nebius AI",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://docs.nebius.com/legal/aup",
		legalEntity: "Nebius Group N.V.",
		headquarters: "NL",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			iso27001: true,
		},
	},
	{
		id: "mistral",
		name: "Mistral AI",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://legal.mistral.ai/terms/usage-policy",
		legalEntity: "Mistral AI",
		headquarters: "FR",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
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
		termsUrl: "https://canopywave.com/serviceagreement",
		privacyPolicyUrl: "https://canopywave.com/privacy",
		usagePolicyUrl: "https://canopywave.com/terms",
		legalEntity: "Canopy Wave Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			iso27001: false,
			gdpr: false,
		},
	},
	{
		id: "inference.net",
		name: "Inference.net",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://inference.net/terms-of-service/",
		legalEntity: "Inference R&D, Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: null,
			promptLogging: null,
			retentionPeriod: null,
			soc2: 2,
		},
	},
	{
		id: "together-ai",
		name: "Together AI",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://www.together.ai/terms-of-service",
		legalEntity: "Together Computer, Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
		},
	},
	{
		id: "scx-ai",
		name: "SCX.ai (Turbo)",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://scx.ai/terms",
		legalEntity: "SCX.ai Holdings Limited",
		headquarters: "AU",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 1,
			iso27001: true,
		},
	},
	{
		id: "scx-ai-gp",
		name: "SCX.ai",
		forwardsSafetyIdentifier: false,
		description:
			"SCX.ai is an Australian sovereign AI platform providing OpenAI-compatible general-purpose inference endpoints for a range of open models and SCX's own models, hosted on renewable-powered infrastructure.",
		env: {
			required: {
				apiKey: "LLM_SCX_AI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#1a1a2e",
		website: "https://scx.ai",
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://scx.ai/terms",
		privacyPolicyUrl: "https://scx.ai/privacy",
		usagePolicyUrl: "https://scx.ai/terms",
		legalEntity: "SCX.ai Holdings Limited",
		headquarters: "AU",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 1,
			iso27001: true,
		},
	},
	{
		id: "custom",
		name: "Custom",
		forwardsSafetyIdentifier: false,
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
		legalEntity: null,
		headquarters: null,
		dataPolicy: null,
	},
	{
		id: "nanogpt",
		name: "NanoGPT",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://nano-gpt.com/legal/terms-of-service",
		legalEntity: "NanoGPT LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: null,
			retentionPeriod: null,
		},
	},
	{
		id: "bytedance",
		name: "ByteDance",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl:
			"https://docs.byteplus.com/en/docs/legal/docs-acceptable-use-policy",
		legalEntity: "BytePlus Pte. Ltd.",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://www.minimax.io/audio/doc/terms-of-service.html",
		legalEntity: "Nanonoble Pte. Ltd.",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			promptLogging: true,
			retentionPeriod: null,
		},
		priority: 1.2,
	},
	{
		id: "embercloud",
		name: "EmberCloud",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://www.embercloud.ai/terms",
		legalEntity: "EmberCloud Systems",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: true,
			retentionPeriod: null,
		},
	},
	{
		id: "meta",
		name: "Meta",
		forwardsSafetyIdentifier: false,
		description:
			"Meta's Model API serving Muse reasoning and image models via an OpenAI-compatible API",
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
		usagePolicyUrl: "https://dev.meta.ai/legal/acceptable-use-policy",
		legalEntity: "Meta Platforms, Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		id: "meta-contributor",
		name: "Meta Contributor",
		forwardsSafetyIdentifier: false,
		description:
			"Meta's discounted, training-eligible Model API tier for Muse models",
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
		usagePolicyUrl: "https://dev.meta.ai/legal/acceptable-use-policy",
		legalEntity: "Meta Platforms, Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: true,
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
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://console.sakana.ai/usage-policy",
		legalEntity: "Sakana AI Co., Ltd.",
		headquarters: "JP",
		dataPolicy: null,
	},
	{
		id: "xiaomi",
		name: "Xiaomi",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl:
			"https://static.account.xiaomi.com/html/agreement/user/en_US.html",
		legalEntity: "Xiaomi Technologies Singapore Pte. Ltd.",
		headquarters: "CN",
		dataPolicy: {
			apiTraining: false,
			promptLogging: true,
			retentionPeriod: "30 days",
		},
	},
	{
		id: "deepinfra",
		name: "DeepInfra",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://deepinfra.com/terms",
		legalEntity: "Deep Infra Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
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
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl:
			"https://help.reve.com/hc/en-us/articles/46731490142484-Usage-policy",
		legalEntity: "Reve AI, Inc.",
		headquarters: "US",
		dataPolicy: null,
	},
	{
		id: "elevenlabs",
		name: "ElevenLabs",
		forwardsSafetyIdentifier: false,
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
		usagePolicyUrl: "https://elevenlabs.io/use-policy",
		legalEntity: "Eleven Labs Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: true,
			retentionPeriod: null,
			soc2: 2,
			iso27001: false,
			gdpr: true,
		},
	},
	{
		id: "runware",
		name: "Runware",
		forwardsSafetyIdentifier: false,
		description:
			"Runware provides fast, cost-efficient inference for open and frontier LLMs through an OpenAI-compatible API.",
		env: {
			required: {
				apiKey: "LLM_RUNWARE_API_KEY",
			},
			optional: {
				baseUrl: "LLM_RUNWARE_BASE_URL",
			},
		},
		streaming: true,
		cancellation: false,
		color: "#a8f399",
		website: "https://runware.ai",
		statusPageUrl: "https://status.runware.ai/",
		announcement: "Launch offer: 30% off all Runware models until September 9",
		termsUrl: "https://runware.ai/terms",
		privacyPolicyUrl: "https://runware.ai/privacy",
		usagePolicyUrl: "https://runware.ai/terms",
		legalEntity: "Runware Ltd",
		headquarters: "GB",
		dataPolicy: {
			apiTraining: false,
			promptLogging: true,
			retentionPeriod: "30 days",
		},
	},
	{
		id: "gonka24",
		name: "Gonka24",
		forwardsSafetyIdentifier: false,
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
		termsUrl: "https://gonka24.com/terms",
		privacyPolicyUrl: "https://gonka24.com/privacy",
		usagePolicyUrl: "https://gonka24.com/terms",
		legalEntity: "Investment company Temir LLC",
		headquarters: "KZ",
		dataPolicy: null,
	},
	{
		id: "fireworks",
		name: "Fireworks AI",
		forwardsSafetyIdentifier: false,
		description:
			"Fireworks AI serves open-weight models on a fast, OpenAI-compatible inference platform.",
		env: {
			required: {
				apiKey: "LLM_FIREWORKS_API_KEY",
			},
			optional: {
				baseUrl: "LLM_FIREWORKS_BASE_URL",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#6720FF",
		website: "https://fireworks.ai",
		statusPageUrl: "https://status.fireworks.ai",
		announcement: null,
		serviceTiers: [
			{
				id: "priority",
				name: "Priority",
				multiplier: 1.25,
				description:
					"Queue precedence over standard traffic and protection from load shedding during congestion, at a 25% premium.",
			},
		],
		termsUrl: "https://fireworks.ai/terms-of-service",
		privacyPolicyUrl: "https://fireworks.ai/privacy-policy",
		usagePolicyUrl:
			"https://cdn.sanity.io/files/pv37i0yn/production/60909f1a2f0cae74deb6ba7fc0f6eda8ab3bac4b.pdf",
		legalEntity: "Fireworks AI, Inc.",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
			soc2: 2,
			iso27001: true,
			gdpr: true,
		},
	},
	{
		id: "ranoai",
		name: "RanoAI",
		forwardsSafetyIdentifier: false,
		description:
			"RanoAI serves open-weight large language models on Furiosa RNGD NPU hardware via an OpenAI-compatible inference API.",
		env: {
			required: {
				apiKey: "LLM_RANOAI_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#000000",
		website: "https://ranoai.com",
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://ranoai.com/terms",
		privacyPolicyUrl: "https://ranoai.com/privacy",
		usagePolicyUrl: "https://ranoai.com/terms",
		legalEntity: "Always With You, LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
	},
	{
		id: "consensusprotocol",
		name: "Consensus Protocol",
		forwardsSafetyIdentifier: false,
		description:
			"Consensus Protocol serves open-weight large language models on dedicated GPU hardware it operates, via an OpenAI-compatible inference API.",
		env: {
			required: {
				apiKey: "LLM_CONSENSUSPROTOCOL_API_KEY",
			},
		},
		streaming: true,
		cancellation: true,
		color: "#dc2626",
		website: "https://consensusprotocol.org",
		statusPageUrl: null,
		announcement: null,
		termsUrl: "https://consensusprotocol.org/terms",
		privacyPolicyUrl: "https://consensusprotocol.org/privacy",
		usagePolicyUrl: "https://consensusprotocol.org/terms",
		legalEntity: "Consensus Protocol LLC",
		headquarters: "US",
		dataPolicy: {
			apiTraining: false,
			promptLogging: false,
			retentionPeriod: "0 days",
		},
		additionalLinks: [
			{
				desc: "Inference data handling",
				link: "https://consensusprotocol.org/data-policy",
			},
		],
	},
] as const satisfies ProviderDefinition[];

export type ProviderId = (typeof providers)[number]["id"];

export function getProviderDefinition(
	providerId: ProviderId | string,
): ProviderDefinition | undefined {
	return providers.find((p) => p.id === providerId);
}

/**
 * The region a credential must be pinned to in order to serve a request that
 * resolved no region — but only for providers whose credentials are
 * region-scoped, i.e. those with no global region, where every credential is
 * necessarily bound to one region (Alibaba).
 *
 * Undefined for providers not scoped by region at all, and deliberately
 * undefined for providers with a credential shared across regions (AWS
 * Bedrock, whose `global` is a real region): there a region-pinned credential
 * is a deliberate scoping by the operator and must never be substituted for a
 * region the request actually asked for — the request fails instead.
 */
export function getRegionScopedDefaultRegion(
	providerId: ProviderId | string,
): string | undefined {
	const regionConfig = getProviderDefinition(providerId)?.regionConfig;
	if (!regionConfig || regionConfig.sharedCredentialAcrossRegions) {
		return undefined;
	}
	return regionConfig.defaultRegion;
}

/**
 * Whether a region's preferred endpoint is completed with a per-credential
 * workspace id. The workspace id is worth collecting for such a region even
 * when a shared fallback exists, so the UI asks for it here.
 */
export function regionEndpointUsesWorkspaceId(
	providerId: ProviderId | string,
	region: string,
): boolean {
	const endpoint =
		getProviderDefinition(providerId)?.regionConfig?.endpointMap[region];
	return Boolean(endpoint?.includes(REGION_WORKSPACE_ID_PLACEHOLDER));
}

/**
 * Whether a region is unreachable without a workspace id — true only when its
 * endpoint is workspace-scoped and no shared fallback host exists. Routing
 * consults this so a region it cannot build a URL for is never selected.
 */
export function regionEndpointRequiresWorkspaceId(
	providerId: ProviderId | string,
	region: string,
): boolean {
	if (!regionEndpointUsesWorkspaceId(providerId, region)) {
		return false;
	}
	const regionConfig = getProviderDefinition(providerId)?.regionConfig;
	return !regionConfig?.endpointFallbackMap?.[region];
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

/** Self-attested compliance posture for a deployment outside the catalogue. */
export interface ProviderComplianceAttestation {
	soc2?: 1 | 2 | null;
	iso27001?: boolean | null;
	gdpr?: boolean | null;
	apiTraining?: boolean | null;
	promptLogging?: boolean | null;
	retentionPeriod?: string | null;
	/** ISO 3166-1 alpha-2 country the deployment is operated from. */
	headquarters?: string | null;
}

/**
 * Whether a provider is a "stealth" provider — one that has no default base URL
 * and instead requires the base URL to be supplied via a `baseUrl` env var
 * (`env.required.baseUrl`). Because the platform behind such a provider is
 * undisclosed, users cannot self-configure a provider key for it (they can't
 * know the endpoint), so these are hidden from the UI provider selector.
 */
export function isStealthProvider(
	provider: ProviderId | ProviderDefinition,
): boolean {
	const def =
		typeof provider === "string"
			? providers.find((p) => p.id === provider)
			: provider;
	return Boolean(def?.env.required.baseUrl);
}

/**
 * Machine-readable reason a provider (or attestation) fails a compliance
 * policy. Requirement keys mirror {@link ProviderCompliancePolicy}; the list
 * keys report a hit on the fine-grained provider lists, and `noAttestation`
 * marks a custom provider with no self-attested posture on file.
 */
export type ComplianceFailureReason =
	| "requireSoc2"
	| "requireSoc2Type2"
	| "requireIso27001"
	| "requireSoc2OrIso27001"
	| "requireGdpr"
	| "blockApiTraining"
	| "blockPromptLogging"
	| "zeroDataRetention"
	| "blockStealthProviders"
	| "allowedCountries"
	| "blockedProviders"
	| "allowedProviders"
	| "noAttestation";

/**
 * Every active requirement of the policy that the data policy does not
 * explicitly satisfy (fail-closed, so a missing data policy fails all active
 * requirements). Empty when compliant; always empty for a disabled policy.
 */
export function getDataPolicyComplianceFailures(
	dataPolicy: ProviderDataPolicy | null | undefined,
	headquarters: string | null | undefined,
	policy: ProviderCompliancePolicy,
): ComplianceFailureReason[] {
	if (!policy.enabled) {
		return [];
	}
	const failures: ComplianceFailureReason[] = [];
	if (policy.requireSoc2 && !dataPolicy?.soc2) {
		failures.push("requireSoc2");
	}
	if (policy.requireSoc2Type2 && dataPolicy?.soc2 !== 2) {
		failures.push("requireSoc2Type2");
	}
	if (policy.requireIso27001 && dataPolicy?.iso27001 !== true) {
		failures.push("requireIso27001");
	}
	if (
		policy.requireSoc2OrIso27001 &&
		!(dataPolicy?.soc2 === 2 || dataPolicy?.iso27001 === true)
	) {
		failures.push("requireSoc2OrIso27001");
	}
	if (policy.requireGdpr && dataPolicy?.gdpr !== true) {
		failures.push("requireGdpr");
	}
	if (policy.blockApiTraining && dataPolicy?.apiTraining !== false) {
		failures.push("blockApiTraining");
	}
	if (policy.blockPromptLogging && dataPolicy?.promptLogging !== false) {
		failures.push("blockPromptLogging");
	}
	if (
		policy.zeroDataRetention &&
		(dataPolicy?.promptLogging !== false ||
			dataPolicy.retentionPeriod !== "0 days")
	) {
		failures.push("zeroDataRetention");
	}
	if (
		policy.allowedCountries &&
		policy.allowedCountries.length > 0 &&
		(!headquarters || !policy.allowedCountries.includes(headquarters))
	) {
		failures.push("allowedCountries");
	}
	return failures;
}

/**
 * Core fail-closed compliance predicate shared by catalogue providers and
 * self-attested custom deployments: any active requirement that the data
 * policy does not explicitly satisfy (including a missing policy) fails.
 * A disabled policy treats everything as compliant.
 */
export function isDataPolicyCompliant(
	dataPolicy: ProviderDataPolicy | null | undefined,
	headquarters: string | null | undefined,
	policy: ProviderCompliancePolicy,
): boolean {
	return (
		getDataPolicyComplianceFailures(dataPolicy, headquarters, policy).length ===
		0
	);
}

/**
 * Policy-list ref for one of the org's own custom providers. Custom providers
 * share the single catalogue id "custom", so restriction lists address them as
 * `custom:<name>` (the provider key's routing-prefix name) to stay
 * unambiguous next to catalogue provider ids.
 */
export function customProviderRef(customProviderName: string): string {
	return `custom:${customProviderName}`;
}

/**
 * Policy-list ref for a model served by one of the org's custom providers,
 * addressed as `<name>/<model>` (the custom provider's routing-prefix name
 * plus the custom-catalog model name).
 */
export function customModelRef(
	customProviderName: string,
	modelName: string,
): string {
	return `${customProviderName}/${modelName}`;
}

/**
 * Whether a provider ref passes the policy's fine-grained provider lists.
 * The deny list always wins; a non-empty allow list blocks every provider
 * not on it. This is only the list check — certification/data-policy
 * requirements are evaluated separately.
 */
export function isProviderRefAllowedByPolicy(
	providerRef: string,
	policy: ProviderCompliancePolicy,
): boolean {
	return getProviderRefPolicyListFailures(providerRef, policy).length === 0;
}

/**
 * The fine-grained provider-list checks a provider ref fails: an entry on the
 * deny list, or absence from a non-empty allow list. Empty when the ref passes
 * both lists; always empty for a disabled policy.
 */
export function getProviderRefPolicyListFailures(
	providerRef: string,
	policy: ProviderCompliancePolicy,
): ComplianceFailureReason[] {
	if (!policy.enabled) {
		return [];
	}
	const failures: ComplianceFailureReason[] = [];
	if (policy.blockedProviders?.includes(providerRef)) {
		failures.push("blockedProviders");
	}
	if (
		policy.allowedProviders &&
		policy.allowedProviders.length > 0 &&
		!policy.allowedProviders.includes(providerRef)
	) {
		failures.push("allowedProviders");
	}
	return failures;
}

/**
 * Whether a model passes the policy's fine-grained model lists. `modelRefs`
 * holds every ref the requested model answers to (the catalogue model id, and
 * for custom providers additionally `<customProvider>/<model>`): the model is
 * blocked when any ref is on the deny list, and a non-empty allow list must
 * contain at least one of the refs.
 */
export function isModelAllowedByPolicy(
	modelRefs: readonly string[],
	policy: ProviderCompliancePolicy,
): boolean {
	if (!policy.enabled) {
		return true;
	}
	if (policy.blockedModels?.some((ref) => modelRefs.includes(ref))) {
		return false;
	}
	if (
		policy.allowedModels &&
		policy.allowedModels.length > 0 &&
		!policy.allowedModels.some((ref) => modelRefs.includes(ref))
	) {
		return false;
	}
	return true;
}

/**
 * Whether a provider satisfies an organization's compliance policy. Fail-closed:
 * any active requirement that the provider's {@link ProviderDataPolicy} does not
 * explicitly satisfy (including a missing `dataPolicy`) makes the provider
 * non-compliant, as does an entry on the policy's fine-grained provider lists.
 * A disabled policy treats every provider as compliant.
 */
export function isProviderCompliant(
	provider: ProviderDefinition,
	policy: ProviderCompliancePolicy,
): boolean {
	return getProviderComplianceFailures(provider, policy).length === 0;
}

/**
 * Every requirement a catalogue provider fails: the certification/data-policy
 * checks plus the provider-level stealth check. Deliberately excludes the
 * fine-grained provider lists, so callers editing those lists (the dashboard
 * pickers) can show whether a provider would otherwise satisfy the policy.
 */
export function getProviderRequirementFailures(
	provider: ProviderDefinition,
	policy: ProviderCompliancePolicy,
): ComplianceFailureReason[] {
	const failures = getDataPolicyComplianceFailures(
		provider.dataPolicy,
		provider.headquarters,
		policy,
	);
	if (
		policy.enabled &&
		policy.blockStealthProviders &&
		isStealthProvider(provider)
	) {
		failures.push("blockStealthProviders");
	}
	return failures;
}

/**
 * Every reason a catalogue provider fails an organization's compliance policy:
 * fine-grained provider-list hits plus unmet certification/data-policy
 * requirements. Empty when the provider is compliant.
 */
export function getProviderComplianceFailures(
	provider: ProviderDefinition,
	policy: ProviderCompliancePolicy,
): ComplianceFailureReason[] {
	return [
		...getProviderRefPolicyListFailures(provider.id, policy),
		...getProviderRequirementFailures(provider, policy),
	];
}

/**
 * Whether a self-attested compliance posture satisfies an organization's
 * compliance policy. Fail-closed: a missing attestation never satisfies an
 * enabled policy.
 */
export function isAttestationCompliant(
	attestation: ProviderComplianceAttestation | null | undefined,
	policy: ProviderCompliancePolicy,
): boolean {
	return getAttestationComplianceFailures(attestation, policy).length === 0;
}

/**
 * Every reason a self-attested compliance posture fails an organization's
 * compliance policy. A missing attestation fails closed as `noAttestation`
 * (even when no individual requirement is active). Empty when compliant.
 */
export function getAttestationComplianceFailures(
	attestation: ProviderComplianceAttestation | null | undefined,
	policy: ProviderCompliancePolicy,
): ComplianceFailureReason[] {
	if (!policy.enabled) {
		return [];
	}
	if (!attestation) {
		return ["noAttestation"];
	}
	return getDataPolicyComplianceFailures(
		{
			apiTraining: attestation.apiTraining ?? null,
			promptLogging: attestation.promptLogging ?? null,
			retentionPeriod: attestation.retentionPeriod ?? null,
			soc2: attestation.soc2 ?? null,
			iso27001: attestation.iso27001 ?? null,
			gdpr: attestation.gdpr ?? null,
		},
		attestation.headquarters ?? null,
		policy,
	);
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
	KZ: "Kazakhstan",
	AU: "Australia",
	GB: "United Kingdom",
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
