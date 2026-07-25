import { shortid } from "@llmgateway/db";

import {
	normalizeAnnotationsToResponses,
	normalizeEchoedTools,
} from "./convert-chat-to-responses.js";

import type { ResponsesEchoRequest } from "./convert-chat-to-responses.js";

interface StreamingState {
	responseId: string;
	model: string;
	createdAt: number;
	outputItemIndex: number;
	messageOutputIndex: number;
	reasoningOutputIndex: number;
	contentPartStarted: boolean;
	outputItemStarted: boolean;
	messageId: string;
	reasoningId: string;
	fullContent: string[];
	fullReasoning: string[];
	annotations: Record<string, unknown>[];
	reasoningStarted: boolean;
	finishReason: string | null;
	sequenceNumber: number;
	toolCalls: Map<
		number,
		{
			id: string;
			callId: string;
			name: string;
			arguments: string;
			outputIndex: number;
		}
	>;
	request?: ResponsesEchoRequest;
	servedServiceTier?: string;
	usage: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
		input_tokens_details?: { cached_tokens: number };
		output_tokens_details?: { reasoning_tokens: number };
		cost?: number;
		cost_details?: {
			upstream_inference_cost: number;
			upstream_inference_prompt_cost: number;
			upstream_inference_completions_cost: number;
			total_cost?: number | null;
			input_cost?: number | null;
			output_cost?: number | null;
			cached_input_cost?: number | null;
			cache_write_input_cost?: number | null;
			request_cost?: number | null;
			web_search_cost?: number | null;
			image_input_cost?: number | null;
			image_output_cost?: number | null;
			audio_input_cost?: number | null;
			data_storage_cost?: number | null;
		};
	};
}

export function createStreamingState(
	model: string,
	responseId?: string,
	request?: ResponsesEchoRequest,
): StreamingState {
	return {
		responseId: responseId ?? `resp_${shortid(24)}`,
		model,
		createdAt: Math.floor(Date.now() / 1000),
		outputItemIndex: 0,
		messageOutputIndex: 0,
		reasoningOutputIndex: 0,
		contentPartStarted: false,
		outputItemStarted: false,
		messageId: `msg_${shortid(24)}`,
		reasoningId: `rs_${shortid(24)}`,
		fullContent: [],
		fullReasoning: [],
		annotations: [],
		reasoningStarted: false,
		finishReason: null,
		sequenceNumber: 0,
		toolCalls: new Map(),
		request,
		usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
	};
}

/**
 * Build a fully-padded ResponseResource payload from streaming state.
 * Used by response.created and response.completed events so the streaming
 * shape matches the non-streaming shape and the Open Responses spec.
 */
function buildResponsePayload(
	state: StreamingState,
	overrides: {
		status: "in_progress" | "completed" | "incomplete" | "failed";
		output?: Record<string, unknown>[];
	},
): Record<string, unknown> {
	const req = state.request;
	const status = overrides.status;
	const output = overrides.output ?? [];

	const usage = {
		input_tokens: state.usage.input_tokens,
		output_tokens: state.usage.output_tokens,
		total_tokens: state.usage.total_tokens,
		input_tokens_details: {
			cached_tokens: state.usage.input_tokens_details?.cached_tokens ?? 0,
		},
		output_tokens_details: {
			reasoning_tokens:
				state.usage.output_tokens_details?.reasoning_tokens ?? 0,
		},
		...(state.usage.cost !== undefined ? { cost: state.usage.cost } : {}),
		...(state.usage.cost_details !== undefined
			? { cost_details: state.usage.cost_details }
			: {}),
	};

	return {
		id: state.responseId,
		object: "response",
		created_at: state.createdAt,
		completed_at: status === "completed" ? state.createdAt : null,
		status,
		incomplete_details:
			status === "incomplete" ? { reason: "max_output_tokens" } : null,
		model: state.model,
		previous_response_id: req?.previous_response_id ?? null,
		instructions: req?.instructions ?? null,
		output,
		error: null,
		tools: normalizeEchoedTools(req?.tools),
		tool_choice: req?.tool_choice ?? "auto",
		truncation: req?.truncation ?? "disabled",
		parallel_tool_calls: req?.parallel_tool_calls ?? true,
		text: { format: req?.text?.format ?? { type: "text" } },
		top_p: req?.top_p ?? 1,
		presence_penalty: req?.presence_penalty ?? 0,
		frequency_penalty: req?.frequency_penalty ?? 0,
		top_logprobs: req?.top_logprobs ?? 0,
		temperature: req?.temperature ?? 1,
		reasoning: {
			effort: req?.reasoning?.effort ?? null,
			summary: req?.reasoning?.summary ?? null,
		},
		usage,
		max_output_tokens: req?.max_output_tokens ?? null,
		max_tool_calls: req?.max_tool_calls ?? null,
		store: req?.store ?? true,
		background: req?.background ?? false,
		service_tier: state.servedServiceTier ?? req?.service_tier ?? "default",
		metadata: req?.metadata ?? {},
		safety_identifier: req?.safety_identifier ?? null,
		prompt_cache_key: req?.prompt_cache_key ?? null,
	};
}

interface SSEEvent {
	event: string;
	data: string;
}

/**
 * Build an SSE event with an auto-incrementing sequence_number, which the
 * Open Responses streaming-event schemas require on every event.
 */
function emitEvent(
	state: StreamingState,
	event: string,
	data: Record<string, unknown>,
): SSEEvent {
	return {
		event,
		data: JSON.stringify({ ...data, sequence_number: state.sequenceNumber++ }),
	};
}

/**
 * Generate the initial response.created event.
 */
export function createResponseCreatedEvent(state: StreamingState): SSEEvent {
	return emitEvent(state, "response.created", {
		type: "response.created",
		response: buildResponsePayload(state, { status: "in_progress" }),
	});
}

/**
 * Process a chat completion chunk and convert to Responses API streaming events.
 */
export function processStreamChunk(
	chunk: Record<string, unknown>,
	state: StreamingState,
): SSEEvent[] {
	const events: SSEEvent[] = [];

	// Capture the served processing tier so the completion events echo the tier
	// the provider actually applied (e.g. a flex request downgraded to default)
	// rather than the requested one. OpenAI chunks carry a top-level
	// service_tier; other providers surface it via the gateway's final usage
	// chunk metadata (used_service_tier null there means downgraded to standard).
	if (typeof chunk.service_tier === "string") {
		state.servedServiceTier = chunk.service_tier;
	} else {
		const metadata = chunk.metadata as Record<string, unknown> | undefined;
		if (metadata && typeof metadata.requested_service_tier === "string") {
			state.servedServiceTier =
				typeof metadata.used_service_tier === "string"
					? metadata.used_service_tier
					: "default";
		}
	}

	const choices = chunk.choices as
		| Array<{
				delta?: {
					content?: string | null;
					reasoning?: string | null;
					annotations?: Array<Record<string, unknown>>;
					tool_calls?: Array<{
						index: number;
						id?: string;
						function?: {
							name?: string;
							arguments?: string;
						};
					}>;
				};
		  }>
		| undefined;
	const delta = choices?.[0]?.delta;

	// Capture finish_reason
	const finishReason = (choices?.[0] as Record<string, unknown> | undefined)
		?.finish_reason as string | null | undefined;
	if (finishReason) {
		state.finishReason = finishReason;
	}

	if (!delta) {
		// Check for usage in the final chunk
		if (chunk.usage) {
			const usage = chunk.usage as Record<string, unknown>;
			state.usage.input_tokens =
				(usage.prompt_tokens as number) ?? state.usage.input_tokens;
			state.usage.output_tokens =
				(usage.completion_tokens as number) ?? state.usage.output_tokens;
			state.usage.total_tokens =
				(usage.total_tokens as number) ?? state.usage.total_tokens;
			const ptd = usage.prompt_tokens_details as
				| Record<string, unknown>
				| undefined;
			if (ptd?.cached_tokens !== undefined) {
				state.usage.input_tokens_details = {
					cached_tokens: ptd.cached_tokens as number,
				};
			}
			const ctd = usage.completion_tokens_details as
				| Record<string, unknown>
				| undefined;
			if (ctd?.reasoning_tokens !== undefined) {
				state.usage.output_tokens_details = {
					reasoning_tokens: ctd.reasoning_tokens as number,
				};
			}
			if (usage.cost !== undefined) {
				state.usage.cost = usage.cost as number;
			}
			if (usage.cost_details !== undefined) {
				state.usage.cost_details =
					usage.cost_details as StreamingState["usage"]["cost_details"];
			}
		}
		return events;
	}

	// Handle reasoning delta
	if (delta.reasoning) {
		if (!state.reasoningStarted) {
			state.reasoningStarted = true;
			// Claim the reasoning slot immediately so later tool calls and the
			// message get their own indices instead of reusing this one.
			state.reasoningOutputIndex = state.outputItemIndex++;
			events.push(
				emitEvent(state, "response.output_item.added", {
					type: "response.output_item.added",
					output_index: state.reasoningOutputIndex,
					item: {
						type: "reasoning",
						id: state.reasoningId,
						summary: [],
					},
				}),
			);
		}
		state.fullReasoning.push(delta.reasoning);
	}

	// Handle tool_calls delta
	if (delta.tool_calls) {
		for (const tc of delta.tool_calls) {
			const existing = state.toolCalls.get(tc.index);
			if (!existing) {
				const callId = tc.id ?? `call_${shortid(24)}`;
				const name = tc.function?.name ?? "";
				const fcId = `fc_${shortid(24)}`;
				const tcOutputIndex = state.outputItemIndex++;
				state.toolCalls.set(tc.index, {
					id: fcId,
					callId,
					name,
					arguments: tc.function?.arguments ?? "",
					outputIndex: tcOutputIndex,
				});
				events.push(
					emitEvent(state, "response.output_item.added", {
						type: "response.output_item.added",
						output_index: tcOutputIndex,
						item: {
							type: "function_call",
							id: fcId,
							call_id: callId,
							name,
							arguments: "",
							status: "in_progress",
						},
					}),
				);
			} else {
				if (tc.function?.arguments) {
					existing.arguments += tc.function.arguments;
					events.push(
						emitEvent(state, "response.function_call_arguments.delta", {
							type: "response.function_call_arguments.delta",
							item_id: existing.id,
							output_index: existing.outputIndex,
							delta: tc.function.arguments,
						}),
					);
				}
			}
		}
	}

	// Handle content delta
	if (delta.content) {
		if (!state.outputItemStarted) {
			state.outputItemStarted = true;
			// Claim this slot and advance so a later tool call gets its own
			// output_index instead of reusing the message's.
			state.messageOutputIndex = state.outputItemIndex++;

			events.push(
				emitEvent(state, "response.output_item.added", {
					type: "response.output_item.added",
					output_index: state.messageOutputIndex,
					item: {
						type: "message",
						id: state.messageId,
						role: "assistant",
						content: [],
						status: "in_progress",
					},
				}),
			);
		}

		if (!state.contentPartStarted) {
			state.contentPartStarted = true;
			events.push(
				emitEvent(state, "response.content_part.added", {
					type: "response.content_part.added",
					item_id: state.messageId,
					output_index: state.messageOutputIndex,
					content_index: 0,
					part: { type: "output_text", text: "", annotations: [] },
				}),
			);
		}

		state.fullContent.push(delta.content);
		events.push(
			emitEvent(state, "response.output_text.delta", {
				type: "response.output_text.delta",
				item_id: state.messageId,
				output_index: state.messageOutputIndex,
				content_index: 0,
				delta: delta.content,
			}),
		);
	}

	// Handle annotations delta (url citations from native web search)
	if (delta.annotations?.length) {
		for (const annotation of normalizeAnnotationsToResponses(
			delta.annotations,
		)) {
			const annotationIndex = state.annotations.length;
			state.annotations.push(annotation);
			if (state.contentPartStarted) {
				events.push(
					emitEvent(state, "response.output_text.annotation.added", {
						type: "response.output_text.annotation.added",
						item_id: state.messageId,
						output_index: state.messageOutputIndex,
						content_index: 0,
						annotation_index: annotationIndex,
						annotation,
					}),
				);
			}
		}
	}

	// Check for usage in the chunk
	if (chunk.usage) {
		const usage = chunk.usage as Record<string, unknown>;
		state.usage.input_tokens =
			(usage.prompt_tokens as number) ?? state.usage.input_tokens;
		state.usage.output_tokens =
			(usage.completion_tokens as number) ?? state.usage.output_tokens;
		state.usage.total_tokens =
			(usage.total_tokens as number) ?? state.usage.total_tokens;
		const ptd = usage.prompt_tokens_details as
			| Record<string, unknown>
			| undefined;
		if (ptd?.cached_tokens !== undefined) {
			state.usage.input_tokens_details = {
				cached_tokens: ptd.cached_tokens as number,
			};
		}
		const ctd = usage.completion_tokens_details as
			| Record<string, unknown>
			| undefined;
		if (ctd?.reasoning_tokens !== undefined) {
			state.usage.output_tokens_details = {
				reasoning_tokens: ctd.reasoning_tokens as number,
			};
		}
		if (usage.cost !== undefined) {
			state.usage.cost = usage.cost as number;
		}
		if (usage.cost_details !== undefined) {
			state.usage.cost_details =
				usage.cost_details as StreamingState["usage"]["cost_details"];
		}
	}

	return events;
}

/**
 * Generate the completion events when the stream ends.
 */
export function createCompletionEvents(state: StreamingState): SSEEvent[] {
	const events: SSEEvent[] = [];

	// Close content part if started
	if (state.contentPartStarted) {
		events.push(
			emitEvent(state, "response.output_text.done", {
				type: "response.output_text.done",
				item_id: state.messageId,
				output_index: state.messageOutputIndex,
				content_index: 0,
				text: state.fullContent.join(""),
			}),
		);
		events.push(
			emitEvent(state, "response.content_part.done", {
				type: "response.content_part.done",
				item_id: state.messageId,
				output_index: state.messageOutputIndex,
				content_index: 0,
				part: {
					type: "output_text",
					text: state.fullContent.join(""),
					annotations: state.annotations,
				},
			}),
		);
	}

	// Close output item if started
	if (state.outputItemStarted) {
		events.push(
			emitEvent(state, "response.output_item.done", {
				type: "response.output_item.done",
				output_index: state.messageOutputIndex,
				item: {
					type: "message",
					id: state.messageId,
					role: "assistant",
					content: [
						{
							type: "output_text",
							text: state.fullContent.join(""),
							annotations: state.annotations,
						},
					],
					status: "completed",
				},
			}),
		);
	}

	// Emit output_item.done for each function_call
	for (const tc of state.toolCalls.values()) {
		events.push(
			emitEvent(state, "response.output_item.done", {
				type: "response.output_item.done",
				output_index: tc.outputIndex,
				item: {
					type: "function_call",
					id: tc.id,
					call_id: tc.callId,
					name: tc.name,
					arguments: tc.arguments,
					status: "completed",
				},
			}),
		);
	}

	// Map finish_reason to status
	let status: "completed" | "incomplete" | "failed" = "completed";
	if (state.finishReason === "length") {
		status = "incomplete";
	}

	// Build final output array in output_index order so it matches the
	// streaming events — a message streamed before a tool call keeps its
	// lower index instead of always being listed last.
	const output: { index: number; item: Record<string, unknown> }[] = [];

	if (state.reasoningStarted) {
		output.push({
			index: state.reasoningOutputIndex,
			item: {
				type: "reasoning",
				id: state.reasoningId,
				summary: [
					{
						type: "summary_text",
						text: state.fullReasoning.join(""),
					},
				],
			},
		});
	}

	for (const tc of state.toolCalls.values()) {
		output.push({
			index: tc.outputIndex,
			item: {
				type: "function_call",
				id: tc.id,
				call_id: tc.callId,
				name: tc.name,
				arguments: tc.arguments,
				status: "completed",
			},
		});
	}

	if (state.fullContent.length > 0) {
		output.push({
			index: state.messageOutputIndex,
			item: {
				type: "message",
				id: state.messageId,
				role: "assistant",
				content: [
					{
						type: "output_text",
						text: state.fullContent.join(""),
						annotations: state.annotations,
					},
				],
				status: "completed",
			},
		});
	}

	output.sort((a, b) => a.index - b.index);

	events.push(
		emitEvent(state, "response.completed", {
			type: "response.completed",
			response: buildResponsePayload(state, {
				status,
				output: output.map((o) => o.item),
			}),
		}),
	);

	return events;
}

/**
 * Generate a response.failed event for streaming errors.
 */
export function createFailedEvent(state: StreamingState): SSEEvent {
	return emitEvent(state, "response.failed", {
		type: "response.failed",
		response: buildResponsePayload(state, { status: "failed" }),
	});
}
