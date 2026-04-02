import { shortid } from "@llmgateway/db";

interface StreamingState {
	responseId: string;
	model: string;
	createdAt: number;
	outputItemIndex: number;
	contentPartStarted: boolean;
	outputItemStarted: boolean;
	messageId: string;
	reasoningId: string;
	fullContent: string[];
	fullReasoning: string[];
	reasoningStarted: boolean;
	finishReason: string | null;
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
	usage: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
		input_tokens_details?: { cached_tokens: number };
		cost_usd_total?: number;
		cost_usd_input?: number;
		cost_usd_output?: number;
		cost_usd_cached_input?: number;
	};
}

export function createStreamingState(
	model: string,
	responseId?: string,
): StreamingState {
	return {
		responseId: responseId ?? `resp_${shortid(24)}`,
		model,
		createdAt: Math.floor(Date.now() / 1000),
		outputItemIndex: 0,
		contentPartStarted: false,
		outputItemStarted: false,
		messageId: `msg_${shortid(24)}`,
		reasoningId: `rs_${shortid(24)}`,
		fullContent: [],
		fullReasoning: [],
		reasoningStarted: false,
		finishReason: null,
		toolCalls: new Map(),
		usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
	};
}

interface SSEEvent {
	event: string;
	data: string;
}

/**
 * Generate the initial response.created event.
 */
export function createResponseCreatedEvent(state: StreamingState): SSEEvent {
	return {
		event: "response.created",
		data: JSON.stringify({
			type: "response.created",
			response: {
				id: state.responseId,
				object: "response",
				created_at: state.createdAt,
				model: state.model,
				status: "in_progress",
				output: [],
			},
		}),
	};
}

/**
 * Process a chat completion chunk and convert to Responses API streaming events.
 */
export function processStreamChunk(
	chunk: Record<string, unknown>,
	state: StreamingState,
): SSEEvent[] {
	const events: SSEEvent[] = [];
	const choices = chunk.choices as
		| Array<{
				delta?: {
					content?: string | null;
					reasoning?: string | null;
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
			if (usage.cost_usd_total !== undefined) {
				state.usage.cost_usd_total = usage.cost_usd_total as number;
			}
			if (usage.cost_usd_input !== undefined) {
				state.usage.cost_usd_input = usage.cost_usd_input as number;
			}
			if (usage.cost_usd_output !== undefined) {
				state.usage.cost_usd_output = usage.cost_usd_output as number;
			}
			if (usage.cost_usd_cached_input !== undefined) {
				state.usage.cost_usd_cached_input =
					usage.cost_usd_cached_input as number;
			}
		}
		return events;
	}

	// Handle reasoning delta
	if (delta.reasoning) {
		if (!state.reasoningStarted) {
			state.reasoningStarted = true;
			events.push({
				event: "response.output_item.added",
				data: JSON.stringify({
					type: "response.output_item.added",
					output_index: state.outputItemIndex,
					item: {
						type: "reasoning",
						id: state.reasoningId,
						summary: [],
					},
				}),
			});
		}
		state.fullReasoning.push(delta.reasoning);
	}

	// Handle tool_calls delta
	if (delta.tool_calls) {
		// If reasoning was streamed but tool calls arrive (no content), close reasoning index
		if (state.reasoningStarted && !state.outputItemStarted) {
			state.outputItemIndex++;
		}

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
				events.push({
					event: "response.output_item.added",
					data: JSON.stringify({
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
				});
			} else {
				if (tc.function?.arguments) {
					existing.arguments += tc.function.arguments;
					events.push({
						event: "response.function_call_arguments.delta",
						data: JSON.stringify({
							type: "response.function_call_arguments.delta",
							item_id: existing.id,
							output_index: existing.outputIndex,
							delta: tc.function.arguments,
						}),
					});
				}
			}
		}
	}

	// Handle content delta
	if (delta.content) {
		if (!state.outputItemStarted) {
			state.outputItemStarted = true;
			// If reasoning was streamed, close it first
			if (state.reasoningStarted) {
				state.outputItemIndex++;
			}

			events.push({
				event: "response.output_item.added",
				data: JSON.stringify({
					type: "response.output_item.added",
					output_index: state.outputItemIndex,
					item: {
						type: "message",
						id: state.messageId,
						role: "assistant",
						content: [],
						status: "in_progress",
					},
				}),
			});
		}

		if (!state.contentPartStarted) {
			state.contentPartStarted = true;
			events.push({
				event: "response.content_part.added",
				data: JSON.stringify({
					type: "response.content_part.added",
					output_index: state.outputItemIndex,
					content_index: 0,
					part: { type: "output_text", text: "" },
				}),
			});
		}

		state.fullContent.push(delta.content);
		events.push({
			event: "response.output_text.delta",
			data: JSON.stringify({
				type: "response.output_text.delta",
				item_id: state.messageId,
				output_index: state.outputItemIndex,
				content_index: 0,
				delta: delta.content,
			}),
		});
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
		if (usage.cost_usd_total !== undefined) {
			state.usage.cost_usd_total = usage.cost_usd_total as number;
		}
		if (usage.cost_usd_input !== undefined) {
			state.usage.cost_usd_input = usage.cost_usd_input as number;
		}
		if (usage.cost_usd_output !== undefined) {
			state.usage.cost_usd_output = usage.cost_usd_output as number;
		}
		if (usage.cost_usd_cached_input !== undefined) {
			state.usage.cost_usd_cached_input = usage.cost_usd_cached_input as number;
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
		events.push({
			event: "response.output_text.done",
			data: JSON.stringify({
				type: "response.output_text.done",
				output_index: state.outputItemIndex,
				content_index: 0,
				text: state.fullContent.join(""),
			}),
		});
		events.push({
			event: "response.content_part.done",
			data: JSON.stringify({
				type: "response.content_part.done",
				output_index: state.outputItemIndex,
				content_index: 0,
				part: {
					type: "output_text",
					text: state.fullContent.join(""),
				},
			}),
		});
	}

	// Close output item if started
	if (state.outputItemStarted) {
		events.push({
			event: "response.output_item.done",
			data: JSON.stringify({
				type: "response.output_item.done",
				output_index: state.outputItemIndex,
				item: {
					type: "message",
					id: state.messageId,
					role: "assistant",
					content: [
						{
							type: "output_text",
							text: state.fullContent.join(""),
						},
					],
					status: "completed",
				},
			}),
		});
	}

	// Emit output_item.done for each function_call
	for (const tc of state.toolCalls.values()) {
		events.push({
			event: "response.output_item.done",
			data: JSON.stringify({
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
		});
	}

	// Map finish_reason to status
	let status: "completed" | "incomplete" | "failed" = "completed";
	if (state.finishReason === "length") {
		status = "incomplete";
	}

	// Build final output array
	const output: Record<string, unknown>[] = [];

	if (state.reasoningStarted) {
		output.push({
			type: "reasoning",
			id: state.reasoningId,
			summary: [
				{
					type: "summary_text",
					text: state.fullReasoning.join(""),
				},
			],
		});
	}

	for (const tc of state.toolCalls.values()) {
		output.push({
			type: "function_call",
			id: tc.id,
			call_id: tc.callId,
			name: tc.name,
			arguments: tc.arguments,
			status: "completed",
		});
	}

	if (state.fullContent.length > 0) {
		output.push({
			type: "message",
			id: state.messageId,
			role: "assistant",
			content: [
				{
					type: "output_text",
					text: state.fullContent.join(""),
				},
			],
			status: "completed",
		});
	}

	events.push({
		event: "response.completed",
		data: JSON.stringify({
			type: "response.completed",
			response: {
				id: state.responseId,
				object: "response",
				created_at: state.createdAt,
				model: state.model,
				output,
				usage: state.usage,
				status,
			},
		}),
	});

	return events;
}

/**
 * Generate a response.failed event for streaming errors.
 */
export function createFailedEvent(state: StreamingState): SSEEvent {
	return {
		event: "response.failed",
		data: JSON.stringify({
			type: "response.failed",
			response: {
				id: state.responseId,
				object: "response",
				created_at: state.createdAt,
				model: state.model,
				output: [],
				usage: state.usage,
				status: "failed",
			},
		}),
	};
}
