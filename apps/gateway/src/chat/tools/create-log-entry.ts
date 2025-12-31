import { trace } from "@opentelemetry/api";

import type { ApiKey, Project } from "@llmgateway/db";
import type { OpenAIToolInput, RoutingMetadata } from "@llmgateway/models";

/**
 * Creates a partial log entry with common fields to reduce duplication
 * When retentionLevel is "none", sensitive data (messages, tools, etc.) is excluded
 */
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
	reasoningEffort: "minimal" | "low" | "medium" | "high" | undefined,
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
	retentionLevel?: "retain" | "none" | null,
) {
	// When retention level is "none", exclude sensitive data (request payloads, messages, tools)
	const excludeData = retentionLevel === "none";
	const activeSpan = trace.getActiveSpan();
	const traceId = activeSpan?.spanContext().traceId || null;

	return {
		requestId,
		organizationId: project.organizationId,
		projectId: apiKey.projectId,
		apiKeyId: apiKey.id,
		usedMode: providerKeyId ? "api-keys" : "credits",
		usedModel,
		usedModelMapping,
		usedProvider,
		requestedModel,
		requestedProvider,
		// Exclude request payload when retention level is "none"
		messages: excludeData ? null : messages,
		temperature: temperature || null,
		maxTokens: max_tokens || null,
		topP: top_p || null,
		frequencyPenalty: frequency_penalty || null,
		presencePenalty: presence_penalty || null,
		reasoningEffort: reasoningEffort || null,
		effort: effort || null,
		responseFormat: responseFormat || null,
		// Exclude tools when retention level is "none"
		tools: excludeData ? null : tools || null,
		toolChoice: excludeData ? null : toolChoice || null,
		mode: project.mode,
		source: source || null,
		customHeaders: excludeData
			? null
			: Object.keys(customHeaders).length > 0
				? customHeaders
				: null,
		params:
			imageConfig?.aspect_ratio || imageConfig?.image_size
				? { image_config: imageConfig }
				: null,
		routingMetadata: routingMetadata || null,
		traceId,
		userAgent: excludeData ? null : userAgent || null,
		// Only include raw payloads if x-debug header is set to true AND retention level allows
		rawRequest: debugMode && !excludeData ? rawRequest || null : null,
		rawResponse: debugMode && !excludeData ? rawResponse || null : null,
		upstreamRequest: debugMode && !excludeData ? upstreamRequest || null : null,
		upstreamResponse:
			debugMode && !excludeData ? upstreamResponse || null : null,
	} as const;
}
