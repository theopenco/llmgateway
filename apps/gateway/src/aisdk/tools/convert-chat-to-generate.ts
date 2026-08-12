import { shortid } from "@llmgateway/db";

import {
	annotationsToSources,
	buildProviderMetadata,
	buildWebSearchToolCall,
	buildWebSearchToolResult,
	mapFinishReason,
	usageFromChat,
	type ChatUsage,
} from "./shared.js";

import type { SpecVersion, SpecWarning } from "@/aisdk/spec.js";
import type { Annotation } from "@/chat/tools/types.js";

export interface ChatCompletionResponse {
	id?: string;
	model?: string;
	created?: number;
	choices?: {
		message?: {
			content?: string | null;
			reasoning?: string | null;
			reasoning_content?: string | null;
			annotations?: Annotation[];
			tool_calls?: {
				id: string;
				type: string;
				function: { name: string; arguments: string };
			}[];
		};
		finish_reason?: string | null;
	}[];
	usage?: ChatUsage & {
		cost?: number;
	};
	cached?: boolean;
	metadata?: {
		used_model?: string;
		used_provider?: string;
		request_id?: string;
	};
}

/**
 * Converts a non-streaming chat completion into a `LanguageModelV*GenerateResult`.
 */
export function convertChatToGenerateResult({
	response,
	specVersion,
	warnings,
	webSearchToolName,
}: {
	response: ChatCompletionResponse;
	specVersion: SpecVersion;
	warnings: SpecWarning[];
	webSearchToolName?: string;
}): Record<string, unknown> {
	const choice = response.choices?.[0];
	const message = choice?.message;
	const content: object[] = [];

	const reasoning = message?.reasoning ?? message?.reasoning_content;
	if (reasoning) {
		content.push({ type: "reasoning", text: reasoning });
	}

	const sources = annotationsToSources(
		message?.annotations,
		new Set<string>(),
		() => shortid(16),
	);

	// Order matters: the provider-executed search happens before the text that
	// cites it, and the AI SDK renders parts in the order they arrive.
	if (webSearchToolName && sources.length > 0) {
		const toolCallId = shortid(24);
		content.push(buildWebSearchToolCall(webSearchToolName, toolCallId));
		content.push(
			buildWebSearchToolResult(webSearchToolName, toolCallId, sources),
		);
	}
	content.push(...sources);

	if (message?.content) {
		content.push({ type: "text", text: message.content });
	}

	for (const toolCall of message?.tool_calls ?? []) {
		content.push({
			type: "tool-call",
			toolCallId: toolCall.id,
			toolName: toolCall.function.name,
			input: toolCall.function.arguments || "{}",
		});
	}

	const providerMetadata = buildProviderMetadata({
		cost: response.usage?.cost,
		usedModel: response.metadata?.used_model,
		usedProvider: response.metadata?.used_provider,
		cached: response.cached,
		requestId: response.metadata?.request_id,
	});

	return {
		content,
		finishReason: mapFinishReason(choice?.finish_reason),
		usage: usageFromChat(specVersion, response.usage),
		...(providerMetadata && { providerMetadata }),
		warnings,
	};
}
