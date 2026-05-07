import { shortid } from "@llmgateway/db";

interface ChatCompletionsResponse {
	id?: string;
	object?: string;
	created?: number;
	model?: string;
	choices?: Array<{
		index?: number;
		message?: {
			role?: string;
			content?: string | null;
			tool_calls?: Array<{
				id: string;
				type: string;
				function: {
					name: string;
					arguments: string;
				};
			}>;
			reasoning?: string | null;
			refusal?: string | null;
			annotations?: Array<Record<string, unknown>>;
		};
		finish_reason?: string | null;
	}>;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
		prompt_tokens_details?: {
			cached_tokens?: number;
			cache_write_tokens?: number;
			cache_creation_tokens?: number;
			audio_tokens?: number;
			video_tokens?: number;
		};
		completion_tokens_details?: {
			reasoning_tokens?: number;
			image_tokens?: number;
			audio_tokens?: number;
		};
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
			data_storage_cost?: number | null;
		};
	};
	metadata?: Record<string, unknown>;
}

export interface ResponsesApiOutput {
	type: string;
	id: string;
	[key: string]: unknown;
}

export interface ResponsesApiUsage {
	input_tokens: number;
	output_tokens: number;
	total_tokens: number;
	output_tokens_details: {
		reasoning_tokens: number;
	};
	input_tokens_details: {
		cached_tokens: number;
	};
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
		data_storage_cost?: number | null;
	};
}

export interface ResponsesApiResponse {
	id: string;
	object: "response";
	created_at: number;
	completed_at: number | null;
	status: "completed" | "incomplete" | "failed" | "in_progress";
	incomplete_details: { reason: string } | null;
	model: string;
	previous_response_id: string | null;
	instructions: string | null;
	output: ResponsesApiOutput[];
	error: { code: string; message: string } | null;
	tools: unknown[];
	tool_choice: unknown;
	truncation: "auto" | "disabled";
	parallel_tool_calls: boolean;
	text: { format: Record<string, unknown> };
	top_p: number;
	presence_penalty: number;
	frequency_penalty: number;
	top_logprobs: number;
	temperature: number;
	reasoning: { effort: string | null; summary: string | null } | null;
	usage: ResponsesApiUsage | null;
	max_output_tokens: number | null;
	max_tool_calls: number | null;
	store: boolean;
	background: boolean;
	service_tier: string;
	metadata: Record<string, unknown>;
	safety_identifier: string | null;
	prompt_cache_key: string | null;
}

/**
 * Subset of the original /v1/responses request needed to echo fields
 * back on the response (per the Open Responses spec, which requires
 * many fields to be present even when they were not user-supplied).
 */
export interface ResponsesEchoRequest {
	previous_response_id?: string;
	instructions?: string;
	tools?: unknown[];
	tool_choice?: unknown;
	truncation?: "auto" | "disabled";
	parallel_tool_calls?: boolean;
	text?: { format?: Record<string, unknown> } & Record<string, unknown>;
	top_p?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	top_logprobs?: number;
	temperature?: number;
	reasoning?: { effort?: string | null; summary?: string | null } | null;
	max_output_tokens?: number;
	max_tool_calls?: number;
	store?: boolean;
	background?: boolean;
	service_tier?: string;
	metadata?: Record<string, unknown>;
	safety_identifier?: string;
	prompt_cache_key?: string;
	prompt_cache_retention?: "in_memory" | "24h";
}

/**
 * Converts a chat completions response to Responses API format.
 */
export function convertChatResponseToResponses(
	chatResponse: ChatCompletionsResponse,
	requestedModel: string,
	responseId?: string,
	request?: ResponsesEchoRequest,
): ResponsesApiResponse {
	const choice = chatResponse.choices?.[0];
	const message = choice?.message;
	const output: ResponsesApiOutput[] = [];

	// Add reasoning output if present
	if (message?.reasoning) {
		output.push({
			type: "reasoning",
			id: `rs_${shortid(24)}`,
			summary: [{ type: "summary_text", text: message.reasoning }],
		});
	}

	// Add function calls if present
	if (message?.tool_calls && message.tool_calls.length > 0) {
		for (const toolCall of message.tool_calls) {
			output.push({
				type: "function_call",
				id: `fc_${shortid(24)}`,
				call_id: toolCall.id,
				name: toolCall.function.name,
				arguments: toolCall.function.arguments,
				status: "completed",
			});
		}
	}

	// Add message output. Skip if content is empty/whitespace-only — many
	// providers return content: "" alongside tool_calls, and emitting an empty
	// message item pollutes stored conversations: on replay via
	// previous_response_id it becomes a stray assistant message that separates
	// the tool_calls assistant from its tool result, causing strict providers
	// (deepseek, bytedance, aws-bedrock, kimi, etc.) to reject the request.
	if (
		message?.content !== null &&
		message?.content !== undefined &&
		message.content.trim() !== ""
	) {
		const contentParts: Array<Record<string, unknown>> = [
			{
				type: "output_text",
				text: message.content,
				annotations: message.annotations ?? [],
			},
		];

		output.push({
			type: "message",
			id: `msg_${shortid(24)}`,
			role: "assistant",
			content: contentParts,
			status: "completed",
		});
	}

	// Map finish_reason to status
	let status: "completed" | "incomplete" | "failed" = "completed";
	if (choice?.finish_reason === "length") {
		status = "incomplete";
	}

	const usage: ResponsesApiUsage = {
		input_tokens: chatResponse.usage?.prompt_tokens ?? 0,
		output_tokens: chatResponse.usage?.completion_tokens ?? 0,
		total_tokens: chatResponse.usage?.total_tokens ?? 0,
		input_tokens_details: {
			cached_tokens:
				chatResponse.usage?.prompt_tokens_details?.cached_tokens ?? 0,
		},
		output_tokens_details: {
			reasoning_tokens:
				chatResponse.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
		},
	};

	if (chatResponse.usage?.cost !== undefined) {
		usage.cost = chatResponse.usage.cost;
	}
	if (chatResponse.usage?.cost_details !== undefined) {
		usage.cost_details = chatResponse.usage.cost_details;
	}

	const created = chatResponse.created ?? Math.floor(Date.now() / 1000);

	return {
		id: responseId ?? `resp_${shortid(24)}`,
		object: "response",
		created_at: created,
		completed_at: status === "completed" ? created : null,
		status,
		incomplete_details:
			status === "incomplete" ? { reason: "max_output_tokens" } : null,
		model: chatResponse.model ?? requestedModel,
		previous_response_id: request?.previous_response_id ?? null,
		instructions: request?.instructions ?? null,
		output,
		error: null,
		tools: request?.tools ?? [],
		tool_choice: request?.tool_choice ?? "auto",
		truncation: request?.truncation ?? "disabled",
		parallel_tool_calls: request?.parallel_tool_calls ?? true,
		text: {
			format: request?.text?.format ?? { type: "text" },
		},
		top_p: request?.top_p ?? 1,
		presence_penalty: request?.presence_penalty ?? 0,
		frequency_penalty: request?.frequency_penalty ?? 0,
		top_logprobs: request?.top_logprobs ?? 0,
		temperature: request?.temperature ?? 1,
		reasoning: {
			effort: request?.reasoning?.effort ?? null,
			summary: request?.reasoning?.summary ?? null,
		},
		usage,
		max_output_tokens: request?.max_output_tokens ?? null,
		max_tool_calls: request?.max_tool_calls ?? null,
		store: request?.store ?? true,
		background: request?.background ?? false,
		service_tier: request?.service_tier ?? "default",
		metadata: {
			...(request?.metadata ?? {}),
			...(chatResponse.metadata ?? {}),
		},
		safety_identifier: request?.safety_identifier ?? null,
		prompt_cache_key: request?.prompt_cache_key ?? null,
	};
}
