import { trace } from "@opentelemetry/api";

import type { ApiKey, Project } from "@llmgateway/db";
import type { OpenAIToolInput } from "@llmgateway/models";

/**
 * Creates a partial log entry with common fields to reduce duplication
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
	responseFormat: any | undefined,
	tools: OpenAIToolInput[] | undefined,
	toolChoice: any | undefined,
	source: string | undefined,
	customHeaders: Record<string, string>,
	debugMode: boolean,
	rawRequest?: unknown,
	rawResponse?: unknown,
	upstreamRequest?: unknown,
	upstreamResponse?: unknown,
) {
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
		messages,
		temperature: temperature || null,
		maxTokens: max_tokens || null,
		topP: top_p || null,
		frequencyPenalty: frequency_penalty || null,
		presencePenalty: presence_penalty || null,
		reasoningEffort: reasoningEffort || null,
		responseFormat: responseFormat || null,
		tools: tools || null,
		toolChoice: toolChoice || null,
		mode: project.mode,
		source: source || null,
		customHeaders: Object.keys(customHeaders).length > 0 ? customHeaders : null,
		traceId,
		// Only include raw payloads if x-debug header is set to true
		rawRequest: debugMode ? rawRequest || null : null,
		rawResponse: debugMode ? rawResponse || null : null,
		upstreamRequest: debugMode ? upstreamRequest || null : null,
		upstreamResponse: debugMode ? upstreamResponse || null : null,
	} as const;
}
