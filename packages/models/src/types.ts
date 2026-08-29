/**
 * Comprehensive TypeScript types for provider API messages and tool definitions
 */

import type { ProviderId } from "./providers.js";

/**
 * OpenAI explicit prompt cache breakpoint marker (GPT-5.6 and later families).
 * Placed on a content part to end a cacheable prefix when the request uses
 * `prompt_cache_options.mode: "explicit"`.
 */
export interface PromptCacheBreakpoint {
	mode?: "explicit";
}

/**
 * Anthropic prompt-cache breakpoint. Ends a cacheable prefix; Anthropic allows
 * at most 4 of them per request across tools, system and messages.
 */
export interface CacheControl {
	type: "ephemeral";
	ttl?: "5m" | "1h";
}

/**
 * How a project wants provider-side prompt caching handled.
 *
 * - `auto`: forward caller-supplied cache markers and additionally inject our
 *   own on long prompts (Anthropic / Bedrock length heuristic).
 * - `passthrough`: forward caller-supplied markers verbatim and never inject.
 *   A request caches iff the client asked it to, which is what coding agents
 *   (Claude Code, Cursor, Cline) need when the same key also serves traffic
 *   that should not pay the cache-write premium.
 * - `off`: strip every marker so the project never writes to a provider cache.
 */
export type ProviderCacheControlMode = "auto" | "passthrough" | "off";

// Base content types
export interface TextContent {
	type: "text";
	text: string;
	cache_control?: CacheControl;
	prompt_cache_breakpoint?: PromptCacheBreakpoint;
}

export interface ImageUrlContent {
	type: "image_url";
	image_url: {
		url: string;
		detail?: "low" | "high" | "auto";
	};
	prompt_cache_breakpoint?: PromptCacheBreakpoint;
}

export interface ImageContent {
	type: "image";
	source: {
		type: "base64";
		media_type: string;
		data: string;
	};
}

export interface InputAudioContent {
	type: "input_audio";
	input_audio: {
		data: string;
		format:
			| "wav"
			| "mp3"
			| "aiff"
			| "aac"
			| "ogg"
			| "flac"
			| "m4a"
			| "mpeg"
			| "mpga"
			| "mp4"
			| "pcm"
			| "webm";
	};
	prompt_cache_breakpoint?: PromptCacheBreakpoint;
}

export interface FileContent {
	type: "file";
	file: {
		filename?: string;
		file_data?: string;
		file_id?: string;
	};
	prompt_cache_breakpoint?: PromptCacheBreakpoint;
}

export interface ToolUseContent {
	type: "tool_use";
	id: string;
	name: string;
	input: Record<string, unknown>;
}

export interface ToolResultContent {
	type: "tool_result";
	tool_use_id: string;
	// Anthropic accepts a block array here as well as a plain string; the array
	// form is what carries `tool_reference` blocks for a client-side tool search.
	content: string | AnthropicNativeBlock[];
	// Anthropic accepts a cache breakpoint on a tool_result block ("Tool use and
	// tool results: content blocks in the messages.content array, in both user
	// and assistant turns" —
	// platform.claude.com/docs/en/build-with-claude/prompt-caching), which is
	// where the stable prefix of an agentic loop usually ends.
	cache_control?: CacheControl;
}

/**
 * Anthropic content block with no OpenAI-format equivalent — currently the
 * server-side tool search pair (`server_tool_use` + `tool_search_tool_result`)
 * and the `tool_reference` blocks a client-side tool search returns. Carried
 * verbatim between the caller and the Anthropic Messages API and dropped for
 * every other upstream.
 */
export interface AnthropicNativeBlock {
	type: string;
	[key: string]: unknown;
}

export type MessageContent =
	| TextContent
	| ImageUrlContent
	| ImageContent
	| InputAudioContent
	| FileContent
	| ToolUseContent
	| ToolResultContent;

// OpenAI-style tool call structure
export interface ToolCall {
	id: string;
	type: "function";
	function: {
		name: string;
		arguments: string;
	};
}

export interface ReasoningDetail {
	text?: string;
	type?: string;
	[key: string]: unknown;
}

// Base message structure
export interface BaseMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | MessageContent[];
	name?: string;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
	reasoning?: string;
	reasoning_content?: string;
	reasoning_details?: ReasoningDetail[];
	// OpenAI Responses assistant-message phase, replayed upstream on the
	// Responses API path and stripped for chat-completions upstreams.
	phase?: "commentary" | "final_answer";
	// Marks assistant content that preceded the message's tool calls (pre-tool
	// commentary), so Responses API replay preserves the original item order.
	// Stripped for chat-completions upstreams.
	content_before_tool_calls?: boolean;
	// Separate phased assistant message items (e.g. commentary + final_answer)
	// emitted by OpenAI Responses API models in one turn. `preceding_tool_calls`
	// is how many of the message's tool calls came before the item, so the
	// exact interleaving can be reconstructed. Replayed upstream as individual
	// message items; stripped for chat-completions upstreams (the concatenated
	// `content` carries the text there).
	message_items?: Array<{
		text: string;
		phase?: "commentary" | "final_answer";
		preceding_tool_calls?: number;
	}>;
	// Anthropic content blocks that survive a round trip verbatim because the
	// OpenAI format has no equivalent. On an assistant message these are the
	// server-side tool search blocks, spliced back in ahead of the tool_use
	// blocks; on a tool message they are the `tool_result` content array, which
	// is how a client-side tool search returns `tool_reference` blocks. Replayed
	// on the Anthropic Messages API only and stripped for every other upstream.
	anthropic_native_blocks?: AnthropicNativeBlock[];
	// Caller-supplied cache breakpoint on the `tool_result` block this tool
	// message came from. The OpenAI-format tool message lowers that block to a
	// plain string and has nowhere to put the marker, so it rides here and is
	// re-attached to the tool_result block on the Anthropic Messages API path.
	// Stripped for every other upstream, which would reject the unknown field.
	tool_result_cache_control?: CacheControl;
}

// Provider-specific message formats
export interface OpenAIMessage extends BaseMessage {
	role: "system" | "user" | "assistant" | "tool";
}

export interface AnthropicMessage {
	role: "user" | "assistant";
	content: (MessageContent | AnthropicNativeBlock)[];
}

export interface GoogleMessage {
	role: "user" | "model";
	parts: Array<{
		text?: string;
		inline_data?: {
			mime_type: string;
			data: string;
		};
	}>;
}

// Tool definition structures
export interface FunctionParameter {
	type: string;
	description?: string;
	enum?: string[];
	items?: FunctionParameter;
	properties?: Record<string, FunctionParameter>;
	required?: string[];
}

export interface FunctionDefinition {
	name: string;
	description?: string;
	parameters: FunctionParameter;
}

export interface OpenAITool {
	type: "function";
	function: FunctionDefinition;
}

// Function tool input type for API requests where parameters can be optional
export interface OpenAIFunctionToolInput {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: FunctionParameter | Record<string, any>;
	};
	/**
	 * Anthropic-only: keep this tool out of the rendered tools section so it
	 * never enters the cached prompt prefix, and load it on demand when the
	 * tool search tool discovers it. Stripped for every other upstream.
	 */
	defer_loading?: boolean;
	/**
	 * Anthropic-only: cache breakpoint ending the tool-definitions prefix, which
	 * Anthropic renders before system and messages. Placed on the last tool it
	 * caches every tool up to and including that one. Stripped for every other
	 * upstream, which would reject the unknown property.
	 */
	cache_control?: CacheControl;
}

// Web search tool input type
export interface OpenAIWebSearchToolInput {
	type: "web_search";
	user_location?: {
		city?: string;
		region?: string;
		country?: string;
		timezone?: string;
	};
	search_context_size?: "low" | "medium" | "high";
	max_uses?: number;
}

/**
 * Anthropic's server-side tool search tool. It has no OpenAI equivalent, so it
 * travels through the gateway under its own `type` and is emitted verbatim on
 * the Anthropic Messages API and dropped everywhere else.
 */
export interface OpenAIToolSearchToolInput {
	type: "tool_search";
	/** Anthropic tool type, e.g. `tool_search_tool_regex_20251119`. */
	tool_search_type: string;
	name?: string;
}

// Compatible type for API requests - accepts function, web_search and
// tool_search tools
export type OpenAIToolInput =
	| OpenAIFunctionToolInput
	| OpenAIWebSearchToolInput
	| OpenAIToolSearchToolInput;

export interface AnthropicTool {
	name: string;
	description?: string;
	input_schema: FunctionParameter;
	cache_control?: CacheControl;
}

export interface GoogleTool {
	functionDeclarations: Array<{
		name: string;
		description?: string;
		parameters: FunctionParameter;
	}>;
}

// Tool choice types
export type ToolChoiceType =
	| "auto"
	| "none"
	| "required"
	| {
			type: "function";
			function: {
				name: string;
			};
	  }
	| {
			/**
			 * Demands a web search rather than offering one. Consumed by the
			 * gateway (as `WebSearchTool.forced`) rather than forwarded upstream,
			 * since no provider accepts it under this name in a chat body.
			 */
			type: "web_search";
	  };

/**
 * `tool_choice` as the OpenAI Responses API expects it. A named function
 * choice is flat here, while Chat Completions nests the name under
 * `function` — sending the nested form to a Responses upstream is rejected
 * (Bedrock Mantle answers `Invalid 'tool_choice': value did not match any
 * expected variant`).
 */
export type ResponsesToolChoice =
	| "auto"
	| "none"
	| "required"
	| {
			type: "function";
			name: string;
	  }
	| {
			/**
			 * Forces the native web search tool. Accepted by the Responses API
			 * only — OpenAI's chat completions endpoint rejects a `web_search`
			 * tool outright ("Supported values are: 'function' and 'custom'").
			 */
			type: "web_search";
	  };

export type PromptCacheRetention = "in_memory" | "24h";

/**
 * OpenAI explicit prompt caching controls (GPT-5.6 and later families).
 * `mode: "explicit"` disables the automatic breakpoint on the latest message
 * and caches only content parts carrying a `prompt_cache_breakpoint` marker.
 * `ttl` currently only supports "30m" upstream.
 */
export interface PromptCacheOptions {
	mode?: "implicit" | "explicit";
	ttl?: "30m";
}

export type AnthropicToolChoice =
	| "auto"
	| "any"
	| "none"
	| {
			type: "tool";
			name: string;
	  };

// Request body structures
export interface BaseRequestBody {
	model: string;
	temperature?: number;
	max_tokens?: number;
	top_p?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	stream?: boolean;
	service_tier?: "auto" | "default" | "flex" | "priority";
}

export interface OpenAIRequestBody extends BaseRequestBody {
	messages: OpenAIMessage[];
	tools?: OpenAITool[];
	tool_choice?: ToolChoiceType;
	prompt_cache_key?: string;
	prompt_cache_retention?: PromptCacheRetention;
	prompt_cache_options?: PromptCacheOptions;
	safety_identifier?: string;
	response_format?: {
		type: "text" | "json_object" | "json_schema";
		json_schema?: {
			name: string;
			description?: string;
			schema: Record<string, unknown>;
			strict?: boolean;
		};
	};
	stream_options?: {
		include_usage: boolean;
	};
	reasoning_effort?:
		"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	verbosity?: "low" | "medium" | "high";
	n?: number;
	extra_body?: Record<string, unknown>;
}

export interface OpenAIResponsesFunctionCall {
	type: "function_call";
	call_id: string;
	name: string;
	arguments: string;
}

export interface OpenAIResponsesFunctionCallOutput {
	type: "function_call_output";
	call_id: string;
	output: string;
}

export interface OpenAIResponsesReasoningItem {
	type: "reasoning";
	id?: string;
	summary: unknown[];
	encrypted_content: string;
}

export type OpenAIResponsesInputItem =
	| OpenAIMessage
	| OpenAIResponsesFunctionCall
	| OpenAIResponsesFunctionCallOutput
	| OpenAIResponsesReasoningItem;

export interface OpenAIResponsesRequestBody {
	model: string;
	input: OpenAIResponsesInputItem[];
	service_tier?: "auto" | "default" | "flex" | "priority";
	prompt_cache_key?: string;
	prompt_cache_retention?: PromptCacheRetention;
	prompt_cache_options?: PromptCacheOptions;
	safety_identifier?: string;
	reasoning: {
		effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
		summary: "detailed";
		context?: "auto" | "current_turn" | "all_turns";
	};
	/**
	 * Provider-side response storage (Responses API statefulness). The gateway
	 * reconstructs conversations itself and never reads stored responses, so
	 * providers that retain stored responses by default (Bedrock Mantle:
	 * 30 days) get an explicit false.
	 */
	store?: boolean;
	/**
	 * Extra output data to request. `reasoning.encrypted_content` returns
	 * encrypted reasoning payloads, which the gateway replays on later turns to
	 * preserve reasoning without stored responses.
	 */
	include?: string[];
	tools?: Array<
		| {
				type: "function";
				name: string;
				description?: string;
				parameters: FunctionParameter;
		  }
		| {
				type: "web_search";
				user_location?: unknown;
				search_context_size?: string;
		  }
		| {
				type: "image_generation";
				size?: "1024x1024" | "1024x1536" | "1536x1024";
		  }
	>;
	tool_choice?: ResponsesToolChoice;
	stream?: boolean;
	temperature?: number;
	max_output_tokens?: number;
	text?: {
		format?:
			| { type: "text" }
			| { type: "json_object" }
			| {
					type: "json_schema";
					name: string;
					schema: Record<string, unknown>;
					strict?: boolean;
			  };
		verbosity?: "low" | "medium" | "high";
	};
}

export interface AnthropicSystemContent {
	type: "text";
	text: string;
	cache_control?: {
		type: "ephemeral";
		ttl?: "5m" | "1h";
	};
}

export interface AnthropicRequestBody extends BaseRequestBody {
	messages: AnthropicMessage[];
	system?: string | AnthropicSystemContent[];
	tools?: AnthropicTool[];
	tool_choice?: AnthropicToolChoice;
	thinking?:
		| {
				type: "enabled";
				budget_tokens: number;
				display?: "summarized" | "omitted";
		  }
		| {
				type: "adaptive";
				display?: "summarized" | "omitted";
		  };
	output_config?: {
		effort?: "low" | "medium" | "high" | "xhigh" | "max";
	};
	/**
	 * Abuse-attribution identifier. `user_id` must be opaque (uuid or hash) and
	 * free of PII; Anthropic uses it to tie abusive traffic back to one caller.
	 */
	metadata?: {
		user_id?: string;
	};
}

export interface GoogleRequestBody {
	contents: GoogleMessage[];
	tools?: GoogleTool[];
	/**
	 * Processing tier for the Gemini Developer API (google-ai-studio / glacier).
	 * "flex" / "priority" select Flex / Priority inference. The served tier is
	 * returned in the `x-gemini-service-tier` response header.
	 * Vertex AI uses the `X-Vertex-AI-LLM-Shared-Request-Type` header instead.
	 */
	service_tier?: "auto" | "default" | "flex" | "priority";
	generationConfig?: {
		temperature?: number;
		maxOutputTokens?: number;
		topP?: number;
		thinkingConfig?: {
			includeThoughts: boolean;
		};
		responseModalities?: string[];
		imageConfig?: {
			aspectRatio?: string;
			imageSize?: string;
		};
	};
}

// Generic request body type
export type ProviderRequestBody =
	| OpenAIRequestBody
	| OpenAIResponsesRequestBody
	| AnthropicRequestBody
	| GoogleRequestBody;

// Image processing result
export interface ProcessedImage {
	data: string;
	mimeType: string;
}

// Provider validation result
export interface ProviderValidationResult {
	valid: boolean;
	error?: string;
	statusCode?: number;
	model?: string;
	/**
	 * The probe never got an HTTP response (DNS, connection, TLS or timeout
	 * failure), so the credential itself was never judged. Callers should word
	 * this as "could not reach the provider" rather than "key rejected".
	 */
	unreachable?: boolean;
}

// Model with pricing information
export interface ModelWithPricing {
	providers: Array<{
		providerId: string;
		inputPrice?: string;
		outputPrice?: string;
		perSecondPrice?: Record<string, string>;
		perImagePrice?: Record<string, string>;
		supportedParameters?: string[];
		externalId: string;
		region?: string;
		stability?: string;
	}>;
}

// Available model provider structure
export interface AvailableModelProvider {
	providerId: string;
	externalId: string;
	region?: string;
}

// Function type definitions
export type MessageTransformer<T> = (
	messages: BaseMessage[],
	isProd?: boolean,
) => Promise<T[]>;
export type ToolTransformer<_T, U> = (tools: OpenAITool[]) => U;
export type RequestBodyPreparer = (
	usedProvider: ProviderId,
	usedModel: string,
	messages: BaseMessage[],
	stream: boolean,
	temperature?: number,
	max_tokens?: number,
	top_p?: number,
	frequency_penalty?: number,
	presence_penalty?: number,
	response_format?: OpenAIRequestBody["response_format"],
	tools?: OpenAIToolInput[],
	tool_choice?: ToolChoiceType,
	reasoning_effort?:
		"none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max",
	supportsReasoning?: boolean,
	isProd?: boolean,
	maxImageSizeMB?: number,
	userPlan?: "free" | "pro" | "enterprise" | null,
	sensitive_word_check?: { status: "DISABLE" | "ENABLE" },
	image_config?: {
		aspect_ratio?: string;
		image_size?: string;
		image_quality?: string;
		n?: number;
		seed?: number;
	},
	effort?: "low" | "medium" | "high",
	imageGenerations?: boolean,
	webSearchTool?: WebSearchTool,
	reasoning_max_tokens?: number,
	useResponsesApi?: boolean,
	prompt_cache_key?: string,
	prompt_cache_retention?: PromptCacheRetention,
	n?: number,
) => Promise<ProviderRequestBody | FormData>;

// Type guards
export function isTextContent(content: MessageContent): content is TextContent {
	return content.type === "text";
}

export function isImageUrlContent(
	content: MessageContent,
): content is ImageUrlContent {
	return content.type === "image_url";
}

export function isImageContent(
	content: MessageContent,
): content is ImageContent {
	return content.type === "image";
}

export function isInputAudioContent(
	content: MessageContent,
): content is InputAudioContent {
	return content.type === "input_audio";
}

export function isFileContent(content: MessageContent): content is FileContent {
	return content.type === "file";
}

export function isToolUseContent(
	content: MessageContent,
): content is ToolUseContent {
	return content.type === "tool_use";
}

export function isToolResultContent(
	content: MessageContent,
): content is ToolResultContent {
	return content.type === "tool_result";
}

export function isOpenAITool(
	tool: OpenAITool | AnthropicTool | GoogleTool,
): tool is OpenAITool {
	return "type" in tool && tool.type === "function";
}

export function isAnthropicTool(
	tool: OpenAITool | AnthropicTool | GoogleTool,
): tool is AnthropicTool {
	return "name" in tool && "input_schema" in tool;
}

export function isGoogleTool(
	tool: OpenAITool | AnthropicTool | GoogleTool,
): tool is GoogleTool {
	return "functionDeclarations" in tool;
}

export function hasMaxTokens(
	requestBody: ProviderRequestBody,
): requestBody is OpenAIRequestBody | AnthropicRequestBody {
	return "max_tokens" in requestBody;
}

// Web search types

/**
 * Web search tool configuration (unified format accepted by the API)
 */
export interface WebSearchTool {
	type: "web_search";
	/**
	 * User location for localized search results (OpenAI and Anthropic)
	 */
	user_location?: {
		type: "approximate";
		city?: string;
		region?: string;
		country?: string;
		timezone?: string;
	};
	/**
	 * Controls how much context is retrieved from the web (OpenAI)
	 * - low: Faster, cheaper, less accurate
	 * - medium: Balanced (default)
	 * - high: Slower, more expensive, more accurate
	 */
	search_context_size?: "low" | "medium" | "high";
	/**
	 * Maximum number of web searches to perform (Anthropic)
	 */
	max_uses?: number;
	/**
	 * Restrict search results to these domains (Anthropic). Mutually exclusive
	 * with blocked_domains.
	 */
	allowed_domains?: string[];
	/**
	 * Exclude these domains from search results (Anthropic). Mutually exclusive
	 * with allowed_domains.
	 */
	blocked_domains?: string[];
	/**
	 * Whether the caller demanded a search rather than offering one, i.e. sent
	 * `tool_choice: {type: "web_search"}`. Not part of the tool the client
	 * sends: the gateway derives it from `tool_choice` and carries it here so
	 * every consumer of the extracted tool can see the caller's intent.
	 *
	 * Providers whose search is model-elected ignore this — the model already
	 * decides. It matters for mappings flagged `webSearchForcedOnly`, which are
	 * only routable when it is set.
	 */
	forced?: boolean;
}

/**
 * Web search citation returned in responses (unified format)
 */
export interface WebSearchCitation {
	/**
	 * URL of the source
	 */
	url: string;
	/**
	 * Title of the source page
	 */
	title?: string;
	/**
	 * Snippet or excerpt from the source
	 */
	snippet?: string;
	/**
	 * Start index in the response content where this citation applies
	 */
	start_index?: number;
	/**
	 * End index in the response content where this citation applies
	 */
	end_index?: number;
}

/**
 * OpenAI web search options for Chat Completions API (search models only)
 */
export interface OpenAIWebSearchOptions {
	user_location?: {
		type: "approximate";
		approximate?: {
			city?: string;
			region?: string;
			country?: string;
		};
	};
	search_context_size?: "low" | "medium" | "high";
}
