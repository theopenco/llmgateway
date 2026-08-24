import { shortid } from "@llmgateway/db";

import {
	annotationsToSources,
	buildProviderMetadata,
	buildWebSearchToolCall,
	buildWebSearchToolResult,
	mapFinishReason,
	usageFromChat,
	type ChatUsage,
	type SourcePart,
} from "./shared.js";

import type { SpecVersion } from "@/aisdk/spec.js";
import type { Annotation } from "@/chat/tools/types.js";

interface ChatStreamChunk {
	id?: string;
	model?: string;
	created?: number;
	choices?: {
		delta?: {
			content?: string | null;
			reasoning?: string | null;
			reasoning_content?: string | null;
			annotations?: Annotation[];
			tool_calls?: {
				index?: number;
				id?: string;
				type?: string;
				function?: { name?: string; arguments?: string };
			}[];
		};
		finish_reason?: string | null;
	}[];
	usage?: ChatUsage & { cost?: number };
	cached?: boolean;
	metadata?: {
		used_model?: string;
		used_provider?: string;
		request_id?: string;
	};
}

interface ToolCallState {
	id: string;
	name: string;
	args: string;
	started: boolean;
}

export interface StreamingPartsState {
	specVersion: SpecVersion;
	webSearchToolName?: string;
	includeRawChunks: boolean;
	responseMetadataSent: boolean;
	textBlockId: string | null;
	reasoningBlockId: string | null;
	toolCalls: Map<number, ToolCallState>;
	seenSourceUrls: Set<string>;
	collectedSources: SourcePart[];
	webSearchToolCallId: string | null;
	finishReason: string;
	usage: ChatUsage | undefined;
	cost: number | undefined;
	cached: boolean | undefined;
	usedModel: string | undefined;
	usedProvider: string | undefined;
	requestId: string | undefined;
	finished: boolean;
}

export function createStreamingPartsState({
	specVersion,
	webSearchToolName,
	includeRawChunks,
}: {
	specVersion: SpecVersion;
	webSearchToolName?: string;
	includeRawChunks?: boolean;
}): StreamingPartsState {
	return {
		specVersion,
		webSearchToolName,
		includeRawChunks: includeRawChunks ?? false,
		responseMetadataSent: false,
		textBlockId: null,
		reasoningBlockId: null,
		toolCalls: new Map(),
		seenSourceUrls: new Set(),
		collectedSources: [],
		webSearchToolCallId: null,
		finishReason: "unknown",
		usage: undefined,
		cost: undefined,
		cached: undefined,
		usedModel: undefined,
		usedProvider: undefined,
		requestId: undefined,
		finished: false,
	};
}

type Part = object;

function closeReasoning(state: StreamingPartsState, parts: Part[]) {
	if (state.reasoningBlockId !== null) {
		parts.push({ type: "reasoning-end", id: state.reasoningBlockId });
		state.reasoningBlockId = null;
	}
}

function closeText(state: StreamingPartsState, parts: Part[]) {
	if (state.textBlockId !== null) {
		parts.push({ type: "text-end", id: state.textBlockId });
		state.textBlockId = null;
	}
}

/**
 * Converts one chat-completions SSE chunk into zero or more
 * `LanguageModelV*StreamPart`s.
 *
 * The AI SDK parses every part with `z.any()` — an unrecognised `type` is
 * enqueued into the consumer's stream verbatim rather than rejected — so this
 * only ever emits part types from the spec.
 */
export function processChatChunk(
	state: StreamingPartsState,
	chunk: ChatStreamChunk,
): Part[] {
	const parts: Part[] = [];

	if (state.includeRawChunks) {
		parts.push({ type: "raw", rawValue: chunk });
	}

	if (!state.responseMetadataSent && (chunk.id || chunk.model)) {
		state.responseMetadataSent = true;
		parts.push({
			type: "response-metadata",
			...(chunk.id && { id: chunk.id }),
			...(chunk.model && { modelId: chunk.model }),
			...(chunk.created && {
				timestamp: new Date(chunk.created * 1000).toISOString(),
			}),
		});
	}

	if (chunk.usage) {
		state.usage = chunk.usage;
		if (chunk.usage.cost !== undefined) {
			state.cost = chunk.usage.cost;
		}
	}
	if (chunk.cached !== undefined) {
		state.cached = chunk.cached;
	}
	if (chunk.metadata) {
		state.usedModel = chunk.metadata.used_model ?? state.usedModel;
		state.usedProvider = chunk.metadata.used_provider ?? state.usedProvider;
		state.requestId = chunk.metadata.request_id ?? state.requestId;
	}

	const choice = chunk.choices?.[0];
	if (choice?.finish_reason) {
		state.finishReason = mapFinishReason(choice.finish_reason);
	}

	const delta = choice?.delta;
	if (!delta) {
		return parts;
	}

	const reasoning = delta.reasoning ?? delta.reasoning_content;
	if (reasoning) {
		if (state.reasoningBlockId === null) {
			state.reasoningBlockId = `reasoning-${shortid(8)}`;
			parts.push({ type: "reasoning-start", id: state.reasoningBlockId });
		}
		parts.push({
			type: "reasoning-delta",
			id: state.reasoningBlockId,
			delta: reasoning,
		});
	}

	if (delta.annotations?.length) {
		const sources = annotationsToSources(
			delta.annotations,
			state.seenSourceUrls,
			() => shortid(16),
		);
		if (sources.length > 0) {
			// The provider-executed search precedes the text citing it, so open the
			// synthetic tool call on the first citation rather than at the end.
			if (state.webSearchToolName && state.webSearchToolCallId === null) {
				state.webSearchToolCallId = shortid(24);
				parts.push({
					type: "tool-input-start",
					id: state.webSearchToolCallId,
					toolName: state.webSearchToolName,
					providerExecuted: true,
				});
				parts.push({
					type: "tool-input-end",
					id: state.webSearchToolCallId,
				});
				parts.push(
					buildWebSearchToolCall(
						state.webSearchToolName,
						state.webSearchToolCallId,
					),
				);
			}
			state.collectedSources.push(...sources);
			parts.push(...sources);
		}
	}

	if (delta.content) {
		// Reasoning always precedes the answer; closing it here keeps the two
		// blocks from interleaving in clients that render them separately.
		closeReasoning(state, parts);
		if (state.textBlockId === null) {
			state.textBlockId = `text-${shortid(8)}`;
			parts.push({ type: "text-start", id: state.textBlockId });
		}
		parts.push({
			type: "text-delta",
			id: state.textBlockId,
			delta: delta.content,
		});
	}

	for (const [position, toolCall] of (delta.tool_calls ?? []).entries()) {
		const index = toolCall.index ?? position;
		let existing = state.toolCalls.get(index);

		if (!existing) {
			existing = {
				id: toolCall.id ?? shortid(24),
				name: toolCall.function?.name ?? "",
				args: "",
				started: false,
			};
			state.toolCalls.set(index, existing);
		}
		if (toolCall.id) {
			existing.id = toolCall.id;
		}
		if (toolCall.function?.name) {
			existing.name = toolCall.function.name;
		}

		// The name can arrive in a later chunk than the id, and `tool-input-start`
		// must carry it, so the start part is deferred until the name is known.
		if (!existing.started && existing.name) {
			existing.started = true;
			closeReasoning(state, parts);
			parts.push({
				type: "tool-input-start",
				id: existing.id,
				toolName: existing.name,
			});
		}

		const argsDelta = toolCall.function?.arguments;
		if (argsDelta) {
			existing.args += argsDelta;
			if (existing.started) {
				parts.push({
					type: "tool-input-delta",
					id: existing.id,
					delta: argsDelta,
				});
			}
		}
	}

	return parts;
}

/**
 * Flushes every open block and emits the terminal `finish` part. Safe to call
 * more than once — the stream teardown path and the normal end-of-stream path
 * both go through it.
 */
export function finalizeStream(state: StreamingPartsState): Part[] {
	if (state.finished) {
		return [];
	}
	state.finished = true;

	const parts: Part[] = [];

	closeReasoning(state, parts);
	closeText(state, parts);

	for (const toolCall of state.toolCalls.values()) {
		if (!toolCall.started) {
			// Name never arrived (truncated stream); there is nothing the client
			// could execute, so the call is dropped rather than emitted nameless.
			continue;
		}
		parts.push({ type: "tool-input-end", id: toolCall.id });
		parts.push({
			type: "tool-call",
			toolCallId: toolCall.id,
			toolName: toolCall.name,
			input: toolCall.args || "{}",
		});
	}

	if (state.webSearchToolName && state.webSearchToolCallId !== null) {
		parts.push(
			buildWebSearchToolResult(
				state.webSearchToolName,
				state.webSearchToolCallId,
				state.collectedSources,
			),
		);
	}

	const providerMetadata = buildProviderMetadata({
		cost: state.cost,
		usedModel: state.usedModel,
		usedProvider: state.usedProvider,
		cached: state.cached,
		requestId: state.requestId,
	});

	parts.push({
		type: "finish",
		finishReason: state.finishReason,
		usage: usageFromChat(state.specVersion, state.usage),
		...(providerMetadata && { providerMetadata }),
	});

	return parts;
}
