import { alibabaModels } from "./models/alibaba.js";
import { anthropicModels } from "./models/anthropic.js";
import { deepseekModels } from "./models/deepseek.js";
import { googleModels } from "./models/google.js";
import { llmgatewayModels } from "./models/llmgateway.js";
import { metaModels } from "./models/meta.js";
import { microsoftModels } from "./models/microsoft.js";
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
	 * Price per cached input token in USD
	 */
	cachedInputPrice?: number;
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
	 * Whether this provider supports JSON schema output mode (json_schema response format)
	 */
	jsonOutputSchema?: boolean;
	/**
	 * Explicitly disable JSON schema output mode for this specific provider mapping
	 * (overrides jsonOutputSchema at the provider level)
	 */
	disableJsonOutputSchema?: boolean;
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
	 * Whether the model supports JSON output mode
	 */
	jsonOutput?: boolean;
	/**
	 * Whether this model is free to use
	 */
	free?: boolean;
	/**
	 * Date when the model will be deprecated (still usable but filtered from selection algorithms)
	 */
	deprecatedAt?: Date;
	/**
	 * Date when the model will be deactivated (returns error when requested)
	 */
	deactivatedAt?: Date;
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
	...moonshotModels,
	...alibabaModels,
	...nousresearchModels,
	...routewayModels,
	...zaiModels,
] as const satisfies ModelDefinition[];
