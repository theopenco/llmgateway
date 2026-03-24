import { trace } from "@opentelemetry/api";

import type { RoutingMetadata } from "@llmgateway/actions";
import type { ApiKey, Project } from "@llmgateway/db";
import type { OpenAIToolInput } from "@llmgateway/models";

export interface PluginResults {
	responseHealing?: {
		healed: boolean;
		healingMethod?: string;
	};
}

export interface CreateLogEntryOptions {
	requestId: string;
	project: Project;
	apiKey: ApiKey;
	providerKeyId?: string;
	usedModel: string;
	usedModelMapping?: string;
	usedProvider: string;
	requestedModel: string;
	requestedProvider?: string;
	messages: any[];
	temperature?: number;
	max_tokens?: number;
	top_p?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningMaxTokens?: number;
	effort?: "low" | "medium" | "high";
	responseFormat?: any;
	tools?: OpenAIToolInput[];
	toolChoice?: any;
	source?: string;
	customHeaders: Record<string, string>;
	debugMode: boolean;
	userAgent?: string;
	imageConfig?:
		| {
				aspect_ratio?: string;
				image_size?: string;
		  }
		| undefined;
	routingMetadata?: RoutingMetadata;
	rawRequest?: unknown;
	rawResponse?: unknown;
	upstreamRequest?: unknown;
	upstreamResponse?: unknown;
	plugins?: string[];
	pluginResults?: PluginResults;
}

/**
 * Creates a partial log entry with common fields to reduce duplication
 */
function buildLogEntry(options: CreateLogEntryOptions) {
	const activeSpan = trace.getActiveSpan();
	const traceId = activeSpan?.spanContext().traceId ?? null;

	return {
		requestId: options.requestId,
		organizationId: options.project.organizationId,
		projectId: options.apiKey.projectId,
		apiKeyId: options.apiKey.id,
		usedMode: options.providerKeyId ? "api-keys" : "credits",
		usedModel: options.usedModel,
		usedModelMapping: options.usedModelMapping,
		usedProvider: options.usedProvider,
		requestedModel: options.requestedModel,
		requestedProvider: options.requestedProvider,
		messages: options.messages,
		temperature: options.temperature ?? null,
		maxTokens: options.max_tokens ?? null,
		topP: options.top_p ?? null,
		frequencyPenalty: options.frequency_penalty ?? null,
		presencePenalty: options.presence_penalty ?? null,
		reasoningEffort: options.reasoningEffort ?? null,
		reasoningMaxTokens: options.reasoningMaxTokens ?? null,
		effort: options.effort ?? null,
		responseFormat: options.responseFormat ?? null,
		tools: options.tools ?? null,
		toolChoice: options.toolChoice ?? null,
		mode: options.project.mode,
		source: options.source ?? null,
		customHeaders:
			Object.keys(options.customHeaders).length > 0
				? options.customHeaders
				: null,
		params:
			options.imageConfig?.aspect_ratio || options.imageConfig?.image_size
				? { image_config: options.imageConfig }
				: null,
		routingMetadata: options.routingMetadata ?? null,
		traceId,
		userAgent: options.userAgent ?? null,
		// Only include raw payloads if x-debug header is set to true
		rawRequest: options.debugMode ? (options.rawRequest ?? null) : null,
		rawResponse: options.debugMode ? (options.rawResponse ?? null) : null,
		upstreamRequest: options.debugMode
			? (options.upstreamRequest ?? null)
			: null,
		upstreamResponse: options.debugMode
			? (options.upstreamResponse ?? null)
			: null,
		plugins:
			options.plugins && options.plugins.length > 0 ? options.plugins : null,
		pluginResults: options.pluginResults ?? null,
	} as const;
}

function requireDefined<T>(value: T | undefined, name: string): T {
	if (value === undefined) {
		throw new Error(`Missing createLogEntry legacy argument: ${name}`);
	}

	return value;
}

export function createLogEntry(
	options: CreateLogEntryOptions,
): ReturnType<typeof buildLogEntry>;
export function createLogEntry(
	requestId: string,
	project: Project,
	apiKey: ApiKey,
	providerKeyId: string | undefined,
	usedModel: string,
	usedModelMapping: string | undefined,
	usedProvider: string,
	requestedModel: string,
	requestedProvider: string | undefined,
	messages: any[],
	temperature: number | undefined,
	max_tokens: number | undefined,
	top_p: number | undefined,
	frequency_penalty: number | undefined,
	presence_penalty: number | undefined,
	reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" | undefined,
	reasoningMaxTokens: number | undefined,
	effort: "low" | "medium" | "high" | undefined,
	responseFormat: any | undefined,
	tools: OpenAIToolInput[] | undefined,
	toolChoice: any | undefined,
	source: string | undefined,
	customHeaders: Record<string, string>,
	debugMode: boolean,
	userAgent: string | undefined,
	imageConfig?:
		| {
				aspect_ratio?: string;
				image_size?: string;
		  }
		| undefined,
	routingMetadata?: RoutingMetadata,
	rawRequest?: unknown,
	rawResponse?: unknown,
	upstreamRequest?: unknown,
	upstreamResponse?: unknown,
	plugins?: string[],
	pluginResults?: PluginResults,
): ReturnType<typeof buildLogEntry>;
export function createLogEntry(
	requestIdOrOptions: string | CreateLogEntryOptions,
	project?: Project,
	apiKey?: ApiKey,
	providerKeyId?: string,
	usedModel?: string,
	usedModelMapping?: string,
	usedProvider?: string,
	requestedModel?: string,
	requestedProvider?: string,
	messages?: any[],
	temperature?: number,
	max_tokens?: number,
	top_p?: number,
	frequency_penalty?: number,
	presence_penalty?: number,
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh",
	reasoningMaxTokens?: number,
	effort?: "low" | "medium" | "high",
	responseFormat?: any,
	tools?: OpenAIToolInput[],
	toolChoice?: any,
	source?: string,
	customHeaders?: Record<string, string>,
	debugMode?: boolean,
	userAgent?: string,
	imageConfig?:
		| {
				aspect_ratio?: string;
				image_size?: string;
		  }
		| undefined,
	routingMetadata?: RoutingMetadata,
	rawRequest?: unknown,
	rawResponse?: unknown,
	upstreamRequest?: unknown,
	upstreamResponse?: unknown,
	plugins?: string[],
	pluginResults?: PluginResults,
): ReturnType<typeof buildLogEntry> {
	if (typeof requestIdOrOptions !== "string") {
		return buildLogEntry(requestIdOrOptions);
	}

	return buildLogEntry({
		requestId: requestIdOrOptions,
		project: requireDefined(project, "project"),
		apiKey: requireDefined(apiKey, "apiKey"),
		providerKeyId,
		usedModel: requireDefined(usedModel, "usedModel"),
		usedModelMapping,
		usedProvider: requireDefined(usedProvider, "usedProvider"),
		requestedModel: requireDefined(requestedModel, "requestedModel"),
		requestedProvider,
		messages: requireDefined(messages, "messages"),
		temperature,
		max_tokens,
		top_p,
		frequency_penalty,
		presence_penalty,
		reasoningEffort,
		reasoningMaxTokens,
		effort,
		responseFormat,
		tools,
		toolChoice,
		source,
		customHeaders: requireDefined(customHeaders, "customHeaders"),
		debugMode: requireDefined(debugMode, "debugMode"),
		userAgent,
		imageConfig,
		routingMetadata,
		rawRequest,
		rawResponse,
		upstreamRequest,
		upstreamResponse,
		plugins,
		pluginResults,
	});
}
