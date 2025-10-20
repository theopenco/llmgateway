/**
 * Comprehensive TypeScript types for provider API messages and tool definitions
 */

import type { ProviderId } from "./providers.js";

// Base content types
export interface TextContent {
	type: "text";
	text: string;
	cache_control?: {
		type: "ephemeral";
	};
}

export interface ImageUrlContent {
	type: "image_url";
	image_url: {
		url: string;
		detail?: "low" | "high" | "auto";
	};
}

export interface ImageContent {
	type: "image";
	source: {
		type: "base64";
		media_type: string;
		data: string;
	};
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
	content: string;
}

export type MessageContent =
	| TextContent
	| ImageUrlContent
	| ImageContent
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

// Base message structure
export interface BaseMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | MessageContent[];
	name?: string;
	tool_calls?: ToolCall[];
	tool_call_id?: string;
}

// Provider-specific message formats
export interface OpenAIMessage extends BaseMessage {
	role: "system" | "user" | "assistant" | "tool";
}

export interface AnthropicMessage {
	role: "user" | "assistant";
	content: MessageContent[];
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

// Compatible type for API requests where parameters can be optional
export interface OpenAIToolInput {
	type: "function";
	function: {
		name: string;
		description?: string;
		parameters?: FunctionParameter | Record<string, any>;
	};
}

export interface AnthropicTool {
	name: string;
	description?: string;
	input_schema: FunctionParameter;
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
	  };

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
}

export interface OpenAIRequestBody extends BaseRequestBody {
	messages: OpenAIMessage[];
	tools?: OpenAITool[];
	tool_choice?: ToolChoiceType;
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
	reasoning_effort?: "minimal" | "low" | "medium" | "high";
}

export interface OpenAIResponsesRequestBody {
	model: string;
	input: OpenAIMessage[];
	reasoning: {
		effort: "minimal" | "low" | "medium" | "high";
		summary: "detailed";
	};
	tools?: Array<{
		type: "function";
		name: string;
		description?: string;
		parameters: FunctionParameter;
	}>;
	tool_choice?: ToolChoiceType;
	stream?: boolean;
	temperature?: number;
	max_output_tokens?: number;
}

export interface AnthropicRequestBody extends BaseRequestBody {
	messages: AnthropicMessage[];
	tools?: AnthropicTool[];
	tool_choice?: AnthropicToolChoice;
	thinking?: {
		type: "enabled";
		budget_tokens: number;
	};
}

export interface GoogleRequestBody {
	contents: GoogleMessage[];
	tools?: GoogleTool[];
	generationConfig?: {
		temperature?: number;
		maxOutputTokens?: number;
		topP?: number;
		thinkingConfig?: {
			includeThoughts: boolean;
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
}

// Model with pricing information
export interface ModelWithPricing {
	providers: Array<{
		providerId: string;
		inputPrice?: number;
		outputPrice?: number;
		supportedParameters?: string[];
		modelName: string;
		discount?: number;
	}>;
}

// Available model provider structure
export interface AvailableModelProvider {
	providerId: string;
	modelName: string;
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
	tools?: OpenAITool[],
	tool_choice?: ToolChoiceType,
	reasoning_effort?: "minimal" | "low" | "medium" | "high",
	supportsReasoning?: boolean,
	isProd?: boolean,
) => Promise<ProviderRequestBody>;

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
