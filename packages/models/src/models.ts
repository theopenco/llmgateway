import { alibabaModels } from "./models/alibaba.js";
import { anthropicModels } from "./models/anthropic.js";
import { atlascloudModels } from "./models/atlascloud.js";
import { bytedanceModels } from "./models/bytedance.js";
import { deepseekModels } from "./models/deepseek.js";
import { elevenlabsModels } from "./models/elevenlabs.js";
import { googleModels } from "./models/google.js";
import { llmgatewayModels } from "./models/llmgateway.js";
import { metaModels } from "./models/meta.js";
import { microsoftModels } from "./models/microsoft.js";
import { minimaxModels } from "./models/minimax.js";
import { mistralModels } from "./models/mistral.js";
import { moonshotModels } from "./models/moonshot.js";
import { nousresearchModels } from "./models/nousresearch.js";
import { nvidiaModels } from "./models/nvidia.js";
import { openaiModels } from "./models/openai.js";
import { perplexityModels } from "./models/perplexity.js";
import { reveModels } from "./models/reve.js";
import { xaiModels } from "./models/xai.js";
import { xiaomiModels } from "./models/xiaomi.js";
import { zaiModels } from "./models/zai.js";

import type { providers } from "./providers.js";

export type Provider = (typeof providers)[number]["id"];

export type Model = (typeof models)[number]["providers"][number]["externalId"];

/**
 * Decimal-safe price representation. Always a string so values are preserved
 * exactly (no IEEE-754 noise) all the way from model definition through to
 * the Decimal-based cost engine.
 */
export type Price = string;

/**
 * Pricing tier for models with context-length based pricing
 */
export interface PricingTier {
	/**
	 * Name of the pricing tier (e.g., "128K", "1M")
	 */
	name: string;
	/**
	 * Maximum number of tokens for this tier (use Infinity for the highest tier)
	 */
	upToTokens: number;
	/**
	 * Price per input token in USD for this tier
	 */
	inputPrice: Price;
	/**
	 * Price per output token in USD for this tier
	 */
	outputPrice: Price;
	/**
	 * Price per cached input token in USD for this tier.
	 * Used when the cache hit was NOT explicitly requested by the caller. For
	 * Alibaba this is the implicit-cache rate (20% of input); for Anthropic this
	 * is the explicit-cache read rate (10%) since Anthropic only has explicit
	 * caching; for OpenAI this is the automatic prompt-cache rate.
	 */
	cachedInputPrice?: Price;
	/**
	 * Price per cached input token when the request used `cache_control` to
	 * explicitly mark content for caching (provider-specific explicit-cache hit
	 * rate). When unset, falls back to `cachedInputPrice`. Currently only set on
	 * Alibaba Qwen, where explicit hits bill at 10% vs. implicit at 20%.
	 */
	cacheReadInputPrice?: Price;
	/**
	 * Price per cache write input token in USD for this tier (5-minute TTL).
	 * For Anthropic, this is the 1.25x base-input rate.
	 */
	cacheWriteInputPrice?: Price;
	/**
	 * Price per cache write input token in USD for this tier (1-hour TTL).
	 * For Anthropic, this is the 2x base-input rate. When unset, 1-hour writes
	 * fall back to `cacheWriteInputPrice` (the 5-minute rate).
	 */
	cacheWriteInputPrice1h?: Price;
}

/**
 * Pricing and availability for a specific geographic region.
 * When defined on a ProviderModelMapping, the first entry is the default region.
 * Top-level inputPrice/outputPrice always reflect the default (first) region
 * for backwards compatibility.
 */
export interface ProviderRegion {
	/**
	 * Region identifier (e.g. "singapore", "us-virginia", "cn-beijing")
	 */
	id: string;
	/**
	 * Price per input token in USD for this region.
	 * When absent, falls back to the mapping-level inputPrice.
	 */
	inputPrice?: Price;
	/**
	 * Price per output token in USD for this region.
	 * When absent, falls back to the mapping-level outputPrice.
	 */
	outputPrice?: Price;
	/**
	 * Price per cached input token in USD for this region
	 */
	cachedInputPrice?: Price;
	/**
	 * Price per cached input token when the request used `cache_control` to
	 * explicitly mark content for caching. When unset, falls back to
	 * `cachedInputPrice`. See PricingTier docs.
	 */
	cacheReadInputPrice?: Price;
	/**
	 * Price per cache write input token in USD for this region (5-minute TTL)
	 */
	cacheWriteInputPrice?: Price;
	/**
	 * Price per cache write input token in USD for this region (1-hour TTL).
	 * When unset, 1-hour writes fall back to `cacheWriteInputPrice`.
	 */
	cacheWriteInputPrice1h?: Price;
	/**
	 * Context-length based pricing tiers for this region.
	 * When absent, falls back to the mapping-level pricingTiers.
	 */
	pricingTiers?: PricingTier[];
	/**
	 * Price per request in USD for this region.
	 * When absent, falls back to the mapping-level requestPrice.
	 */
	requestPrice?: Price;
	/**
	 * Price per web search query in USD for this region.
	 * When absent, falls back to the mapping-level webSearchPrice.
	 */
	webSearchPrice?: Price;
	/**
	 * Context window size in tokens for this region.
	 * When absent, falls back to the mapping-level contextSize.
	 */
	contextSize?: number;
	/**
	 * Maximum output size in tokens for this region.
	 * When absent, falls back to the mapping-level maxOutput.
	 */
	maxOutput?: number;
	/**
	 * Streaming support override for this region.
	 * When absent, falls back to the mapping-level streaming.
	 */
	streaming?: boolean | "only";
	/**
	 * Test skip/only for this specific region.
	 * When absent, falls back to the mapping-level test.
	 */
	test?: "skip" | "only";
}

export interface ProviderModelMapping {
	providerId: (typeof providers)[number]["id"];
	/**
	 * Provider-specific upstream model id used when calling the upstream
	 * provider. Distinct from the root `ModelDefinition.id` and from any
	 * human-readable display name.
	 */
	externalId: string;
	/**
	 * Price per input token in USD
	 */
	inputPrice?: Price;
	/**
	 * Price per output token in USD
	 */
	outputPrice?: Price;
	/**
	 * Price per output audio token in USD (for speech generation / text-to-speech
	 * models where audio output is billed separately from text). When unset,
	 * audio output tokens fall back to `outputPrice`.
	 */
	outputAudioPrice?: Price;
	/**
	 * Price per input character in USD. Used by speech generation models that
	 * bill on input characters rather than tokens (e.g. OpenAI `tts-1`), since
	 * the OpenAI speech endpoint returns audio bytes without token usage.
	 */
	inputCharacterPrice?: Price;
	/**
	 * Price per image output token in USD (for models with separate text/image output pricing)
	 */
	imageOutputPrice?: Price;
	/**
	 * Price per cached input token in USD.
	 * Used when the cache hit was NOT explicitly requested by the caller. For
	 * Alibaba this is the implicit-cache rate (20% of input); for Anthropic this
	 * is the explicit-cache read rate (10%) since Anthropic only has explicit
	 * caching; for OpenAI this is the automatic prompt-cache rate.
	 */
	cachedInputPrice?: Price;
	/**
	 * Price per cached input token when the request used `cache_control` to
	 * explicitly mark content for caching (provider-specific explicit-cache hit
	 * rate). When unset, falls back to `cachedInputPrice`. Currently only set on
	 * Alibaba Qwen, where explicit hits bill at 10% vs. implicit at 20%.
	 */
	cacheReadInputPrice?: Price;
	/**
	 * Price per cache write input token in USD (5-minute TTL).
	 * For Anthropic, this is the 1.25x base-input rate.
	 */
	cacheWriteInputPrice?: Price;
	/**
	 * Price per cache write input token in USD (1-hour TTL).
	 * For Anthropic, this is the 2x base-input rate. When unset, 1-hour writes
	 * fall back to `cacheWriteInputPrice` (the 5-minute rate).
	 */
	cacheWriteInputPrice1h?: Price;
	/**
	 * Minimum number of tokens required for a segment to be cacheable.
	 * Prompts smaller than this threshold won't be cached even with cache_control set.
	 * Model-specific: Claude 3 Haiku requires 2048, Claude Opus 4.5 requires 4096, most others require 1024.
	 */
	minCacheableTokens?: number;
	/**
	 * Price per image input in USD
	 */
	imageInputPrice?: Price;
	/**
	 * Price per audio input token in USD. When unset, audio input tokens are
	 * billed at the regular `inputPrice` (used for providers that don't price
	 * audio separately, e.g. Gemini 2.5 Pro where audio follows the text tier).
	 */
	inputAudioPrice?: Price;
	/**
	 * Price per cached image input token in USD. Used by image-output models
	 * (e.g. gpt-image-2) where OpenAI bills cached image tokens at a different
	 * rate than cached text tokens. When unset, cached image tokens fall back
	 * to `cachedInputPrice`.
	 */
	cachedImageInputPrice?: Price;
	/**
	 * Price per cached audio input token in USD. Used by Google Gemini models
	 * which list a separate context-cache rate for audio that's higher than the
	 * text/image/video cache rate. When unset, cached audio tokens fall back to
	 * `cachedInputPrice`.
	 */
	cachedInputAudioPrice?: Price;
	/**
	 * Resolution-based token counts for image output.
	 * Maps resolution keys (e.g., "1K", "2K", "4K", "default") to tokens per image.
	 * The per-token price comes from imageOutputPrice.
	 * Use "default" key as a fallback when no imageSize is specified.
	 */
	imageOutputTokensByResolution?: Record<string, number>;
	/**
	 * Resolution-based token counts for image input.
	 * Maps resolution keys (e.g., "1K", "2K", "4K", "default") to tokens per image.
	 * The per-token price comes from imageInputPrice.
	 * Use "default" key as a fallback when no imageSize is specified.
	 */
	imageInputTokensByResolution?: Record<string, number>;
	/**
	 * Price per request in USD
	 */
	requestPrice?: Price;
	/**
	 * Price per second in USD for video generation models.
	 * Maps billing keys like "default", "4k", "default_audio", "4k_audio",
	 * "default_video", and "4k_video" to per-second pricing.
	 */
	perSecondPrice?: Record<string, Price>;
	/**
	 * Pricing tiers for models with context-length based pricing.
	 * When set, inputPrice and outputPrice represent the base tier.
	 * Tiers should be sorted by upToTokens in ascending order.
	 */
	pricingTiers?: PricingTier[];
	/**
	 * Maximum context window size in tokens
	 */
	contextSize?: number;
	/**
	 * Maximum output size in tokens
	 */
	maxOutput?: number;
	/**
	 * Whether this specific model supports streaming for this provider.
	 * - true: supports both streaming and non-streaming
	 * - false: does not support streaming
	 * - "only": only supports streaming (non-streaming requests are auto-converted).
	 *   Some providers enforce stream-only for certain models (e.g. Alibaba QwQ series).
	 *   Ref: https://www.alibabacloud.com/help/en/model-studio/stream
	 */
	streaming: boolean | "only";
	/**
	 * Whether this specific model supports vision (image inputs) for this provider
	 */
	vision?: boolean;
	/**
	 * Whether this specific model accepts audio inputs (`input_audio` content
	 * blocks) for this provider. Used by the `model: "auto"` router to avoid
	 * selecting providers that would fail upstream when the request contains
	 * audio content.
	 */
	audio?: boolean;
	/**
	 * Whether this specific model accepts document inputs (`file` content
	 * blocks carrying PDF or text-family MIME types) for this provider. Used by
	 * the `model: "auto"` router and capability validator to avoid selecting
	 * providers that would fail upstream when the request contains document
	 * content. Per-provider MIME allowlists live in the provider transform
	 * modules (e.g. transform-google-messages.ts).
	 */
	document?: boolean;
	/**
	 * Whether this model supports reasoning mode
	 */
	reasoning?: boolean;
	/**
	 * Whether the provider returns reasoning inside tagged content (e.g. &lt;think&gt;...&lt;/think&gt;)
	 * that needs to be split into separate reasoning and content fields
	 */
	splitTaggedReasoning?: boolean;
	/**
	 * Whether this provider mapping requires an explicit chat-template flag to
	 * produce reasoning. Hybrid models like DeepSeek V3.2 on Novita keep thinking
	 * off by default and ignore `reasoning_effort`, so the gateway sends
	 * `chat_template_kwargs: { thinking: true }` (the documented vLLM/Novita
	 * parameter) when the caller requests reasoning.
	 */
	requiresEnableThinking?: boolean;
	/**
	 * Whether this model supports the OpenAI responses API (defaults to true if reasoning is true)
	 */
	supportsResponsesApi?: boolean;
	/**
	 * Provider-specific request/endpoint format when a provider has multiple API
	 * surfaces for different models. Defaults to the provider's native format.
	 */
	apiFormat?: "openai-chat-completions";
	/**
	 * Provider service tier IDs supported by this specific model mapping.
	 * Provider definitions own the tier metadata and default multipliers;
	 * mappings opt in to the subset actually supported by the upstream model.
	 */
	serviceTiers?: string[];
	/**
	 * Optional per-tier multiplier overrides for provider/model combinations whose
	 * tier pricing differs from the provider default while still being expressed
	 * as a multiplier over this mapping's standard token prices.
	 */
	serviceTierMultipliers?: Partial<Record<string, number>>;
	/**
	 * Regions where the mapping supports service tiers. When omitted, the mapping
	 * supports its service tiers across all regions.
	 */
	serviceTierRegions?: string[];
	/**
	 * Whether this provider mapping accepts the OpenAI-style `n` parameter
	 * (multiple completion choices per request) natively. When true, the gateway
	 * forwards `n` to the upstream provider; when false/unset, requests with
	 * `n > 1` are rejected with a 400 error. Only set this for providers that
	 * actually accumulate input tokens once and bill output tokens across all
	 * choices upstream (e.g. OpenAI Chat Completions, Google `candidateCount`).
	 */
	supportsN?: boolean;
	/**
	 * Whether this mapping supports `n > 1` on streaming requests. Only
	 * meaningful when supportsN is true; unset means streaming is allowed.
	 * Google accepts candidateCount on generateContent but rejects it on
	 * streamGenerateContent, so Google mappings set this to false.
	 */
	supportsNStreaming?: boolean;
	/**
	 * Upper bound the upstream enforces for `n` (e.g. Google caps
	 * candidateCount at 8). When unset, only the request-schema cap applies.
	 */
	maxN?: number;
	/**
	 * Controls whether reasoning output is expected from the model.
	 * - undefined: Expect reasoning output if reasoning is true (default behavior)
	 * - "omit": Don't expect reasoning output even if reasoning is true (for models like o1 that
	 *   don't return reasoning content, or adaptive-thinking models that may skip thinking for
	 *   simpler prompts)
	 */
	reasoningOutput?: "omit";
	/**
	 * Whether this model supports explicit reasoning.max_tokens parameter.
	 * When true, users can specify the exact token budget for reasoning instead of using reasoning_effort levels.
	 * Supported by Anthropic and Google thinking models.
	 */
	reasoningMaxTokens?: boolean;
	/**
	 * Reasoning/thinking API variant for Anthropic models.
	 * - undefined / "enabled": legacy `thinking: { type: "enabled", budget_tokens }` format (default)
	 * - "adaptive": new `thinking: { type: "adaptive" }` + `output_config.effort` format (Opus 4.7+)
	 */
	reasoningMode?: "enabled" | "adaptive";
	/**
	 * Whether this specific model supports tool calling for this provider
	 */
	tools?: boolean;
	/**
	 * Whether this model supports parallel tool calls
	 */
	parallelToolCalls?: boolean;
	/**
	 * Whether this specific model supports JSON output mode for this provider
	 */
	jsonOutput?: boolean;
	/**
	 * Whether JSON-mode streaming output for this provider mapping should be
	 * buffered and healed before being sent downstream. Use this for providers
	 * that support JSON mode but may stream reasoning or explanatory text as
	 * content before the final JSON object.
	 */
	healStreamingJsonOutput?: boolean;
	/**
	 * Whether this provider supports JSON schema output mode (json_schema response format)
	 */
	jsonOutputSchema?: boolean;
	/**
	 * Whether this model supports web search/grounding capabilities
	 */
	webSearch?: boolean;
	/**
	 * Price per web search query in USD (charged when web search is used)
	 */
	webSearchPrice?: Price;
	/**
	 * Price per content filter violation in USD (charged additionally when the
	 * provider rejects a request for safety/usage-policy reasons, e.g. xAI's
	 * "Content violates usage guidelines" response).
	 */
	contentFilterPrice?: number;
	/**
	 * List of supported API parameters for this model/provider combination
	 */
	supportedParameters?: string[];
	/**
	 * Test skip/only functionality
	 */
	test?: "skip" | "only";
	/**
	 * Stability level of the model for this specific provider (defaults to model-level stability if not specified)
	 * - stable: Fully tested and production ready
	 * - beta: Generally stable but may have minor issues
	 * - unstable: May have significant issues or frequent changes
	 * - experimental: Early stage, use with caution
	 */
	stability?: StabilityLevel;
	/**
	 * Date when the model mapping will be deprecated (still usable but filtered from selection algorithms)
	 */
	deprecatedAt?: Date;
	/**
	 * Date when the model mapping will be deactivated (returns error when requested)
	 */
	deactivatedAt?: Date;
	/**
	 * Whether this model uses a dedicated image generation API.
	 * When true, requests are routed to a provider-specific image generation endpoint.
	 */
	imageGenerations?: boolean;
	/**
	 * Whether this model uses a dedicated embeddings API.
	 * When true, requests are routed to a provider-specific /v1/embeddings endpoint
	 * and pricing is computed against input tokens only (no completion tokens).
	 */
	embeddings?: boolean;
	/**
	 * Whether this model uses a dedicated speech generation API.
	 * When true, requests are routed to the gateway's /v1/audio/speech endpoint
	 * which returns binary audio rather than a chat completion.
	 */
	speechGenerations?: boolean;
	/**
	 * Prebuilt voices supported for speech generation models. The first entry is
	 * used as the default when the caller does not specify a `voice`.
	 */
	supportedVoices?: string[];
	/**
	 * Geographic region for this provider mapping.
	 * Set automatically when a mapping with `regions` is expanded into flat entries.
	 * When absent (undefined), the provider uses a single global endpoint.
	 */
	region?: string;
	/**
	 * Available regions for this provider mapping.
	 * Each region can optionally override pricing and other properties.
	 * Properties not specified in a region entry are inherited from the parent mapping.
	 * At sync/routing time, each region is expanded into a separate DB row / candidate.
	 */
	regions?: ProviderRegion[];
	/**
	 * Whether this model uses a dedicated video generation API.
	 * When true, requests are routed to a provider-specific video generation endpoint.
	 */
	videoGenerations?: boolean;
	/**
	 * Supported OpenAI-style video sizes in widthxheight format for this provider.
	 */
	supportedVideoSizes?: string[];
	/**
	 * Supported output durations in seconds for this provider.
	 */
	supportedVideoDurationsSeconds?: number[];
	/**
	 * Supported output durations in seconds when using image-to-video (frame inputs).
	 * Overrides supportedVideoDurationsSeconds for that input mode when set.
	 */
	supportedVideoDurationsSecondsImageToVideo?: number[];
	/**
	 * Whether this provider mapping supports generating video with audio.
	 */
	supportsVideoAudio?: boolean;
	/**
	 * Whether this provider mapping supports generating video without audio.
	 */
	supportsVideoWithoutAudio?: boolean;
}

export type StabilityLevel = "stable" | "beta" | "unstable" | "experimental";

export interface ModelDefinition {
	/**
	 * Unique identifier for the model
	 */
	id: string;
	/**
	 * Human-readable display name for the model
	 */
	name?: string;
	/**
	 * Alternative names or search terms for the model
	 */
	aliases?: string[];
	/**
	 * Model family (e.g., 'openai', 'deepseek', 'anthropic')
	 */
	family: string;
	/**
	 * Mappings to provider models
	 */
	providers: ProviderModelMapping[];
	/**
	 * Whether this model is free to use
	 */
	free?: boolean;
	/**
	 * Rate limit tier for free models (defaults to 'low' if not specified)
	 * - low: Standard rate limits for free models
	 * - high: More generous rate limits for free models
	 * Only applies when free is true
	 */
	rateLimitKind?: "low" | "high";
	/**
	 * Output formats supported by the model (defaults to ['text'] if not specified)
	 */
	output?: ("text" | "image" | "video" | "embedding" | "audio")[];
	/**
	 * Whether this model requires an image input to function (e.g. image editing models).
	 */
	imageInputRequired?: boolean;
	/**
	 * Maximum supported output duration in seconds for video generation models.
	 */
	maxVideoDurationSeconds?: number;
	/**
	 * Stability level of the model (defaults to 'stable' if not specified)
	 * - stable: Fully tested and production ready
	 * - beta: Generally stable but may have minor issues
	 * - unstable: May have significant issues or frequent changes
	 * - experimental: Early stage, use with caution
	 */
	stability?: StabilityLevel;
	/**
	 * Whether this model supports system role messages (defaults to true if not specified)
	 */
	supportsSystemRole?: boolean;
	/**
	 * Description of the model
	 */
	description?: string;
	/**
	 * Date when the model was released by the provider
	 */
	releasedAt?: Date;
}

export const models = [
	...llmgatewayModels,
	...openaiModels,
	...anthropicModels,
	...googleModels,
	...perplexityModels,
	...xaiModels,
	...xiaomiModels,
	...metaModels,
	...deepseekModels,
	...mistralModels,
	...microsoftModels,
	...minimaxModels,
	...moonshotModels,
	...alibabaModels,
	...atlascloudModels,
	...bytedanceModels,
	...nousresearchModels,
	...reveModels,
	...nvidiaModels,
	...zaiModels,
	...elevenlabsModels,
] as const satisfies ModelDefinition[];
