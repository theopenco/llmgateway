import { shortid } from "@llmgateway/db";

import {
	normalizeAnnotationsToResponses,
	normalizeEchoedTools,
	resolveReasoningContext,
	stripEncryptedReasoningContent,
} from "./convert-chat-to-responses.js";
import { toResponsesToolCallItem } from "./tool-registry.js";

import type { ResponsesEchoRequest } from "./convert-chat-to-responses.js";
import type { ToolRegistry } from "./tool-registry.js";

// One assistant message output item in the stream. Providers may emit several
// per turn (e.g. a commentary message before tool calls and a final_answer
// message after); each keeps its own id, phase, text, and the output index it
// reserved when announced, so indices stay stable and no item is collapsed.
interface MessageItemState {
	id: string;
	outputIndex: number;
	phase?: string;
	parts: string[];
	contentPartStarted: boolean;
	annotations: Record<string, unknown>[];
}

interface StreamingState {
	responseId: string;
	model: string;
	createdAt: number;
	outputItemIndex: number;
	// Assistant message items in stream order; the last entry is the one
	// currently receiving content deltas.
	messageItems: MessageItemState[];
	// Set when a new message item was announced (via the translator's
	// message_start boundary marker or a phase change) but has not started
	// streaming content yet; the item is created on its first content delta.
	pendingNewMessage?: boolean;
	// Phase announced (via a delta) for a message item that has not started
	// streaming content yet.
	pendingMessagePhase?: string;
	messageId: string;
	reasoningId: string;
	fullReasoning: string[];
	// Reasoning output items announced via response.output_item.added. Each
	// entry's id/outputIndex are reused verbatim by the matching
	// response.output_item.done event and the final output array, so the
	// streaming lifecycle stays consistent per item.
	reasoningItems: Array<{
		id: string;
		outputIndex: number;
		encryptedData?: string;
	}>;
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
	toolRegistry?: ToolRegistry;
	servedServiceTier?: string;
	// Effective reasoning context the provider applied, surfaced by the
	// streaming translator on the terminal chunk.
	usedReasoningContext?: string;
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
	toolRegistry?: ToolRegistry,
): StreamingState {
	return {
		responseId: responseId ?? `resp_${shortid(24)}`,
		model,
		createdAt: Math.floor(Date.now() / 1000),
		outputItemIndex: 0,
		messageItems: [],
		messageId: `msg_${shortid(24)}`,
		reasoningId: `rs_${shortid(24)}`,
		fullReasoning: [],
		reasoningItems: [],
		reasoningStarted: false,
		finishReason: null,
		sequenceNumber: 0,
		toolCalls: new Map(),
		request,
		toolRegistry,
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
			status === "incomplete"
				? {
						reason:
							state.finishReason === "content_filter"
								? "content_filter"
								: "max_output_tokens",
					}
				: null,
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
			...(resolveReasoningContext(state.usedReasoningContext) ?? {}),
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
	// Capture the effective reasoning context the provider applied (surfaced by
	// the streaming translator on the terminal chunk).
	if (typeof chunk.reasoning_context === "string") {
		state.usedReasoningContext = chunk.reasoning_context;
	}

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
					reasoning_details?: Array<Record<string, unknown>>;
					phase?: string;
					message_start?: boolean;
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
				Record<string, unknown> | undefined;
			if (ptd?.cached_tokens !== undefined) {
				state.usage.input_tokens_details = {
					cached_tokens: ptd.cached_tokens as number,
				};
			}
			const ctd = usage.completion_tokens_details as
				Record<string, unknown> | undefined;
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

	// The translator marks the start of each upstream message output item with
	// a message_start boundary. A boundary after content has streamed means a
	// NEW message item begins (created lazily on its first content delta) —
	// this preserves exact item boundaries even when consecutive messages
	// share the same phase (e.g. two commentary items split by a tool call).
	if (delta.message_start === true) {
		const current = state.messageItems[state.messageItems.length - 1];
		if (current && current.parts.length > 0) {
			state.pendingNewMessage = true;
			state.pendingMessagePhase = undefined;
		}
	}

	// Capture the assistant-message phase (surfaced by the streaming translator
	// from each upstream message output item). As a fallback for streams
	// without boundary markers, a phase that differs from the current message
	// item's phase after content has streamed also starts a new item.
	if (typeof delta.phase === "string" && delta.phase) {
		const current = state.messageItems[state.messageItems.length - 1];
		if (!current || state.pendingNewMessage) {
			state.pendingMessagePhase = delta.phase;
		} else if (current.phase === undefined) {
			// Late phase for the item already streaming (or announced).
			current.phase = delta.phase;
		} else if (current.phase !== delta.phase) {
			state.pendingNewMessage = true;
			state.pendingMessagePhase = delta.phase;
		}
	}

	// Handle reasoning delta. The output_item.added event is deferred until the
	// item's real id is known (it arrives with the encrypted payload) or until
	// the next output item starts — see flushPendingReasoningItem. Emitting it
	// eagerly with a generated id would make the later done event (which must
	// carry the upstream id for stateless replay) disagree with it.
	if (delta.reasoning) {
		state.reasoningStarted = true;
		state.fullReasoning.push(delta.reasoning);
	}

	// Capture encrypted reasoning payloads ("reasoning.encrypted" entries) so
	// the completed reasoning output items can carry encrypted_content for
	// stateless replay. They arrive as a single delta when the provider's
	// reasoning item completes, possibly before any summary text was streamed.
	// Each payload is its own output item with its own id and output_index.
	// Foreign formats are dropped: encrypted_content is replayed upstream as
	// OpenAI encrypted reasoning, so only openai-responses-v1 payloads qualify.
	if (delta.reasoning_details?.length) {
		for (const detail of delta.reasoning_details) {
			if (
				detail.type === "reasoning.encrypted" &&
				typeof detail.data === "string" &&
				detail.data.length > 0 &&
				detail.format === "openai-responses-v1"
			) {
				state.reasoningStarted = true;
				const id =
					typeof detail.id === "string" && detail.id
						? detail.id
						: state.reasoningItems.length === 0
							? state.reasoningId
							: `rs_${shortid(24)}`;
				const outputIndex = state.outputItemIndex++;
				state.reasoningItems.push({
					id,
					outputIndex,
					encryptedData: detail.data,
				});
				events.push(
					emitEvent(state, "response.output_item.added", {
						type: "response.output_item.added",
						output_index: outputIndex,
						item: {
							type: "reasoning",
							id,
							summary: [],
						},
					}),
				);
			}
		}
	}

	// Handle tool_calls delta
	if (delta.tool_calls) {
		// If reasoning was streamed without an encrypted payload, announce and
		// close its item before tool-call items claim the next output indexes.
		flushPendingReasoningItem(state, events);

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
						item: toResponsesToolCallItem(state.toolRegistry, {
							id: fcId,
							callId,
							name,
							arguments: "",
							status: "in_progress",
						}),
					}),
				);
			} else {
				if (tc.function?.arguments) {
					existing.arguments += tc.function.arguments;
					// A freeform tool's payload is the `input` field inside these JSON
					// arguments, so it cannot be unwrapped incrementally; the whole
					// payload is emitted as one delta when the call closes.
					if (!state.toolRegistry?.customNames.has(existing.name)) {
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
	}

	// Handle content delta
	if (delta.content) {
		let current = state.messageItems[state.messageItems.length - 1];
		// Start a new message item on first content, or when a boundary marker
		// (or differing phase) announced that a new message item begins.
		if (!current || state.pendingNewMessage) {
			// If reasoning was streamed, announce and close its item first
			flushPendingReasoningItem(state, events);

			current = {
				// Keep the pre-generated id for the first message item so it is
				// stable from response.created onward.
				id:
					state.messageItems.length === 0
						? state.messageId
						: `msg_${shortid(24)}`,
				// Reserve this item's output index so later items (e.g. tool calls
				// following pre-tool commentary) don't claim the same index.
				outputIndex: state.outputItemIndex++,
				...(state.pendingMessagePhase
					? { phase: state.pendingMessagePhase }
					: {}),
				parts: [],
				contentPartStarted: false,
				annotations: [],
			};
			state.messageItems.push(current);
			state.pendingNewMessage = false;
			state.pendingMessagePhase = undefined;
			events.push(
				emitEvent(state, "response.output_item.added", {
					type: "response.output_item.added",
					output_index: current.outputIndex,
					item: {
						type: "message",
						id: current.id,
						role: "assistant",
						content: [],
						...(current.phase ? { phase: current.phase } : {}),
						status: "in_progress",
					},
				}),
			);
		}

		if (!current.contentPartStarted) {
			current.contentPartStarted = true;
			events.push(
				emitEvent(state, "response.content_part.added", {
					type: "response.content_part.added",
					item_id: current.id,
					output_index: current.outputIndex,
					content_index: 0,
					part: { type: "output_text", text: "", annotations: [] },
				}),
			);
		}

		current.parts.push(delta.content);
		events.push(
			emitEvent(state, "response.output_text.delta", {
				type: "response.output_text.delta",
				item_id: current.id,
				output_index: current.outputIndex,
				content_index: 0,
				delta: delta.content,
			}),
		);
	}

	// Handle annotations delta (url citations from native web search); they
	// attach to the message item currently receiving content.
	if (delta.annotations?.length) {
		const current = state.messageItems[state.messageItems.length - 1];
		if (current) {
			for (const annotation of normalizeAnnotationsToResponses(
				delta.annotations,
			)) {
				const annotationIndex = current.annotations.length;
				current.annotations.push(annotation);
				if (current.contentPartStarted) {
					events.push(
						emitEvent(state, "response.output_text.annotation.added", {
							type: "response.output_text.annotation.added",
							item_id: current.id,
							output_index: current.outputIndex,
							content_index: 0,
							annotation_index: annotationIndex,
							annotation,
						}),
					);
				}
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
			Record<string, unknown> | undefined;
		if (ptd?.cached_tokens !== undefined) {
			state.usage.input_tokens_details = {
				cached_tokens: ptd.cached_tokens as number,
			};
		}
		const ctd = usage.completion_tokens_details as
			Record<string, unknown> | undefined;
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
 * Announce the summary-only reasoning item when reasoning text was streamed
 * but no encrypted payload (which would have carried the item's real id and
 * claimed an output index) ever arrived. Called before the next output item
 * starts and again at completion, so every reasoning item gets exactly one
 * response.output_item.added with the same id/output_index its done event and
 * the final output array will use. No-op once any reasoning item exists.
 */
function flushPendingReasoningItem(
	state: StreamingState,
	events: SSEEvent[],
): void {
	if (!state.reasoningStarted || state.reasoningItems.length > 0) {
		return;
	}
	const outputIndex = state.outputItemIndex++;
	state.reasoningItems.push({ id: state.reasoningId, outputIndex });
	events.push(
		emitEvent(state, "response.output_item.added", {
			type: "response.output_item.added",
			output_index: outputIndex,
			item: {
				type: "reasoning",
				id: state.reasoningId,
				summary: [],
			},
		}),
	);
}

/**
 * Build the reasoning output items for the final output array, mirroring
 * state.reasoningItems (one item per captured encrypted payload, with their
 * original ids when known); the aggregated summary text rides on the first
 * item. Without encrypted payloads a single summary-only item is produced.
 */
function buildReasoningOutputItems(
	state: StreamingState,
): Record<string, unknown>[] {
	if (!state.reasoningStarted) {
		return [];
	}
	const summary = [
		{
			type: "summary_text",
			text: state.fullReasoning.join(""),
		},
	];
	if (state.reasoningItems.length === 0) {
		// Pending summary-only item not yet flushed; mirror what
		// flushPendingReasoningItem will announce.
		return [{ type: "reasoning", id: state.reasoningId, summary }];
	}
	return state.reasoningItems.map((entry, index) => ({
		type: "reasoning",
		id: entry.id,
		summary: index === 0 ? summary : [],
		...(entry.encryptedData !== undefined && {
			encrypted_content: entry.encryptedData,
		}),
	}));
}

/**
 * Build the complete final output array (reasoning, function calls, message)
 * including encrypted reasoning payloads. Used for response storage; wire
 * events strip encrypted_content unless the request opted in via
 * include:["reasoning.encrypted_content"].
 */
export function buildFinalOutputItems(
	state: StreamingState,
): Record<string, unknown>[] {
	// Order items by the output index each claimed when it was announced, so
	// the final array preserves the stream order (e.g. pre-tool commentary
	// messages stay before the function calls that followed them).
	const indexed: Array<{ index: number; item: Record<string, unknown> }> = [];

	buildReasoningOutputItems(state).forEach((item, i) => {
		indexed.push({
			index: state.reasoningItems[i]?.outputIndex ?? i,
			item,
		});
	});

	for (const tc of state.toolCalls.values()) {
		indexed.push({
			index: tc.outputIndex,
			item: toResponsesToolCallItem(state.toolRegistry, {
				id: tc.id,
				callId: tc.callId,
				name: tc.name,
				arguments: tc.arguments,
				status: "completed",
			}),
		});
	}

	for (const message of state.messageItems) {
		if (message.parts.length === 0) {
			continue;
		}
		indexed.push({
			index: message.outputIndex,
			item: {
				type: "message",
				id: message.id,
				role: "assistant",
				content: [
					{
						type: "output_text",
						text: message.parts.join(""),
						annotations: message.annotations,
					},
				],
				...(message.phase ? { phase: message.phase } : {}),
				status: "completed",
			},
		});
	}

	return indexed.sort((a, b) => a.index - b.index).map((entry) => entry.item);
}

/**
 * Generate the completion events when the stream ends.
 */
export function createCompletionEvents(
	state: StreamingState,
	includeEncryptedReasoning = false,
): SSEEvent[] {
	const events: SSEEvent[] = [];

	// A reasoning-only stream (summary text, no encrypted payload, no
	// content/tool items) never triggered a flush; announce the item now so
	// its done event below has a matching added.
	flushPendingReasoningItem(state, events);

	// Close the reasoning item(s) if started, reusing each item's own
	// output_index from its added event. Encrypted payloads are only put on
	// the wire when the request asked for them.
	const reasoningItems = includeEncryptedReasoning
		? buildReasoningOutputItems(state)
		: stripEncryptedReasoningContent(buildReasoningOutputItems(state));
	reasoningItems.forEach((item, index) => {
		events.push(
			emitEvent(state, "response.output_item.done", {
				type: "response.output_item.done",
				output_index: state.reasoningItems[index]?.outputIndex ?? index,
				item,
			}),
		);
	});

	// Close each message item that streamed (text done, part done, item done),
	// reusing the id/output_index from its added event.
	for (const message of state.messageItems) {
		const text = message.parts.join("");
		if (message.contentPartStarted) {
			events.push(
				emitEvent(state, "response.output_text.done", {
					type: "response.output_text.done",
					item_id: message.id,
					output_index: message.outputIndex,
					content_index: 0,
					text,
				}),
			);
			events.push(
				emitEvent(state, "response.content_part.done", {
					type: "response.content_part.done",
					item_id: message.id,
					output_index: message.outputIndex,
					content_index: 0,
					part: {
						type: "output_text",
						text,
						annotations: message.annotations,
					},
				}),
			);
		}
		events.push(
			emitEvent(state, "response.output_item.done", {
				type: "response.output_item.done",
				output_index: message.outputIndex,
				item: {
					type: "message",
					id: message.id,
					role: "assistant",
					content: [
						{
							type: "output_text",
							text,
							annotations: message.annotations,
						},
					],
					...(message.phase ? { phase: message.phase } : {}),
					status: "completed",
				},
			}),
		);
	}

	// Emit output_item.done for each tool call
	for (const tc of state.toolCalls.values()) {
		const item = toResponsesToolCallItem(state.toolRegistry, {
			id: tc.id,
			callId: tc.callId,
			name: tc.name,
			arguments: tc.arguments,
			status: "completed",
		});
		if (item.type === "custom_tool_call") {
			const input = item.input as string;
			events.push(
				emitEvent(state, "response.custom_tool_call_input.delta", {
					type: "response.custom_tool_call_input.delta",
					item_id: tc.id,
					output_index: tc.outputIndex,
					delta: input,
				}),
			);
			events.push(
				emitEvent(state, "response.custom_tool_call_input.done", {
					type: "response.custom_tool_call_input.done",
					item_id: tc.id,
					output_index: tc.outputIndex,
					input,
				}),
			);
		}
		events.push(
			emitEvent(state, "response.output_item.done", {
				type: "response.output_item.done",
				output_index: tc.outputIndex,
				item,
			}),
		);
	}

	// Map finish_reason to status. Providers served via the OpenAI Responses
	// API surface truncation as finish_reason "incomplete" (from the upstream
	// response status) rather than "length".
	let status: "completed" | "incomplete" | "failed" = "completed";
	if (
		state.finishReason === "length" ||
		state.finishReason === "incomplete" ||
		state.finishReason === "content_filter"
	) {
		status = "incomplete";
	}

	// Build final output array (encrypted reasoning gated by the include opt-in)
	const fullOutput = buildFinalOutputItems(state);
	const output = includeEncryptedReasoning
		? fullOutput
		: stripEncryptedReasoningContent(fullOutput);

	// A truncated response must terminate with response.incomplete, not
	// response.completed (the payload status alone is not enough per the spec).
	const terminalEvent =
		status === "incomplete" ? "response.incomplete" : "response.completed";
	events.push(
		emitEvent(state, terminalEvent, {
			type: terminalEvent,
			response: buildResponsePayload(state, { status, output }),
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
