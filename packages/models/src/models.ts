import { alibabaModels } from "./models/alibaba.js";
import { anthropicModels } from "./models/anthropic.js";
import { deepseekModels } from "./models/deepseek.js";
import { googleModels } from "./models/google.js";
import { llmgatewayModels } from "./models/llmgateway.js";
import { metaModels } from "./models/meta.js";
import { microsoftModels } from "./models/microsoft.js";
import { minimaxModels } from "./models/minimax.js";
import { mistralModels } from "./models/mistral.js";
import { moonshotModels } from "./models/moonshot.js";
import { nousresearchModels } from "./models/nousresearch.js";
import { openaiModels } from "./models/openai.js";
import { perplexityModels } from "./models/perplexity.js";
import { routewayModels } from "./models/routeway.js";
import { xaiModels } from "./models/xai.js";
import { zaiModels } from "./models/zai.js";

import type { providers } from "./providers.js";

export type Provider = (typeof providers)[number]["id"];

export type Model = (typeof models)[number]["providers"][number]["modelName"];

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
	inputPrice: number;
	/**
	 * Price per output token in USD for this tier
	 */
	outputPrice: number;
	/**
	 * Price per cached input token in USD for this tier
	 */
	cachedInputPrice?: number;
}

export interface ProviderModelMapping {
	providerId: (typeof providers)[number]["id"];
	modelName: string;
	/**
	 * Price per input token in USD
	 */
	inputPrice?: number;
	/**
	 * Price per output token in USD
	 */
	outputPrice?: number;
	/**
	 * Price per image output token in USD (for models with separate text/image output pricing)
	 */
	imageOutputPrice?: number;
	/**
	 * Price per cached input token in USD
	 */
	cachedInputPrice?: number;
	/**
	 * Minimum number of tokens required for a segment to be cacheable.
	 * Prompts smaller than this threshold won't be cached even with cache_control set.
	 * Model-specific: Claude 3 Haiku requires 2048, Claude Opus 4.5 requires 4096, most others require 1024.
	 */
	minCacheableTokens?: number;
	/**
	 * Price per image input in USD
	 */
	imageInputPrice?: number;
	/**
	 * Price per request in USD
	 */
	requestPrice?: number;
	/**
	 * Discount multiplier (0-1), where 0.5 = 50% off
	 */
	discount?: number;
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
	 * Whether this specific model supports streaming for this provider
	 */
	streaming: boolean;
	/**
	 * Whether this specific model supports vision (image inputs) for this provider
	 */
	vision?: boolean;
	/**
	 * Whether this model supports reasoning mode
	 */
	reasoning?: boolean;
	/**
	 * Whether this model supports the OpenAI responses API (defaults to true if reasoning is true)
	 */
	supportsResponsesApi?: boolean;
	/**
	 * Controls whether reasoning output is expected from the model.
	 * - undefined: Expect reasoning output if reasoning is true (default behavior)
	 * - "omit": Don't expect reasoning output even if reasoning is true (for models like o1 that don't return reasoning content)
	 */
	reasoningOutput?: "omit";
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
	webSearchPrice?: number;
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
	output?: ("text" | "image")[];
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
	/**
	 * Date when the model was published on LLM Gateway
	 */
	publishedAt?: Date;
}

export const models = [
	...llmgatewayModels,
	...openaiModels,
	...anthropicModels,
	...googleModels,
	...perplexityModels,
	...xaiModels,
	...metaModels,
	...deepseekModels,
	...mistralModels,
	...microsoftModels,
	...minimaxModels,
	...moonshotModels,
	...alibabaModels,
	...nousresearchModels,
	...routewayModels,
	...zaiModels,
] as const satisfies ModelDefinition[];
