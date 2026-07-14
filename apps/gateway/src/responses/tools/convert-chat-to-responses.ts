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
			reasoning_details?: Array<Record<string, unknown>>;
			phase?: string | null;
			content_before_tool_calls?: boolean;
			refusal?: string | null;
			annotations?: Array<Record<string, unknown>>;
		};
		finish_reason?: string | null;
	}>;
	service_tier?: string | null;
	// Effective reasoning context the provider applied (current_turn/all_turns),
	// surfaced by the gateway's chat layer for Responses-API upstreams.
	reasoning_context?: string;
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
			audio_input_cost?: number | null;
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
		audio_input_cost?: number | null;
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
	reasoning: {
		effort: string | null;
		summary: string | null;
		context?: string;
	} | null;
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
	reasoning?: {
		effort?: string | null;
		summary?: string | null;
		context?: string | null;
	} | null;
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
 * Normalize echoed tools so each function tool has all fields the Open Responses
 * spec marks as required-nullable (description, parameters, strict). The spec's
 * functionToolSchema rejects responses where these are missing even though many
 * callers omit them on the request side.
 */
export function normalizeEchoedTools(tools: unknown[] | undefined): unknown[] {
	if (!tools) {
		return [];
	}
	return tools.map((tool) => {
		if (
			typeof tool !== "object" ||
			tool === null ||
			(tool as Record<string, unknown>).type !== "function"
		) {
			return tool;
		}
		const t = tool as Record<string, unknown>;
		return {
			...t,
			description: t.description ?? null,
			parameters: t.parameters ?? null,
			strict: t.strict ?? null,
		};
	});
}

/**
 * Remove `encrypted_content` from reasoning output items. Encrypted reasoning
 * is always kept in stored responses (so previous_response_id chaining
 * preserves reasoning server-side, like OpenAI), but is only returned on the
 * wire when the request asked for it via include:["reasoning.encrypted_content"].
 */
export function stripEncryptedReasoningContent<
	T extends Record<string, unknown>,
>(output: T[]): T[] {
	return output.map((item) => {
		if (item.type !== "reasoning" || item.encrypted_content === undefined) {
			return item;
		}
		const { encrypted_content: _ignored, ...rest } = item;
		return rest as unknown as T;
	});
}

/**
 * Resolve the processing tier the provider actually served from a chat
 * completions response. OpenAI echoes it as a top-level `service_tier`;
 * other providers (e.g. Google flex/priority) surface it via the gateway's
 * `metadata.used_service_tier` (null there means downgraded to standard).
 * Returns undefined when the chat response carries no tier information.
 */
function resolveServedServiceTier(
	chatResponse: ChatCompletionsResponse,
): string | undefined {
	if (typeof chatResponse.service_tier === "string") {
		return chatResponse.service_tier;
	}
	const metadata = chatResponse.metadata;
	if (metadata && typeof metadata.requested_service_tier === "string") {
		return typeof metadata.used_service_tier === "string"
			? metadata.used_service_tier
			: "default";
	}
	return undefined;
}

/**
 * Resolve the reasoning context to report on a response: the effective mode
 * the provider applied when known, otherwise the requested value ("auto"
 * resolves upstream to current_turn/all_turns, so it is never reported).
 * Returns a spreadable `{ context }` fragment or undefined to omit the field.
 */
export function resolveReasoningContext(
	effectiveContext: string | undefined,
	requestedContext: string | null | undefined,
): { context: string } | undefined {
	const context =
		effectiveContext ??
		(requestedContext && requestedContext !== "auto"
			? requestedContext
			: undefined);
	return context ? { context } : undefined;
}

/**
 * Normalize chat-completions-style annotations to the Responses API shape:
 * chat nests citation fields under `url_citation`, the Responses API flattens
 * them onto the annotation object.
 */
export function normalizeAnnotationsToResponses(
	annotations: Array<Record<string, unknown>> | undefined,
): Array<Record<string, unknown>> {
	if (!annotations?.length) {
		return [];
	}
	return annotations.map((annotation) => {
		if (
			annotation.type === "url_citation" &&
			annotation.url_citation &&
			typeof annotation.url_citation === "object"
		) {
			return {
				type: "url_citation",
				...(annotation.url_citation as Record<string, unknown>),
			};
		}
		return annotation;
	});
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

	// Add reasoning output if present. Encrypted reasoning payloads captured
	// from the provider ("reasoning.encrypted" reasoning_details entries) are
	// attached as `encrypted_content` so the reasoning can be replayed on later
	// turns; the caller strips them from the wire response unless the request
	// asked for them via include:["reasoning.encrypted_content"].
	// Only OpenAI-Responses-shaped payloads qualify: `encrypted_content` items
	// are replayed upstream as OpenAI encrypted reasoning, so a foreign format
	// (e.g. "anthropic-claude-v1") must not be relabeled by ending up here.
	const encryptedDetails = (message?.reasoning_details ?? []).filter(
		(detail) =>
			detail.type === "reasoning.encrypted" &&
			typeof detail.data === "string" &&
			(detail.data as string).length > 0 &&
			detail.format === "openai-responses-v1",
	);
	if (encryptedDetails.length > 0) {
		encryptedDetails.forEach((detail, index) => {
			output.push({
				type: "reasoning",
				id:
					typeof detail.id === "string" && detail.id
						? detail.id
						: `rs_${shortid(24)}`,
				summary:
					index === 0 && message?.reasoning
						? [{ type: "summary_text", text: message.reasoning }]
						: [],
				encrypted_content: detail.data,
			});
		});
	} else if (message?.reasoning) {
		output.push({
			type: "reasoning",
			id: `rs_${shortid(24)}`,
			summary: [{ type: "summary_text", text: message.reasoning }],
		});
	}

	// Build message output. Skip if content is empty/whitespace-only — many
	// providers return content: "" alongside tool_calls, and emitting an empty
	// message item pollutes stored conversations: on replay via
	// previous_response_id it becomes a stray assistant message that separates
	// the tool_calls assistant from its tool result, causing strict providers
	// (deepseek, bytedance, aws-bedrock, kimi, etc.) to reject the request.
	let messageItem: ResponsesApiOutput | null = null;
	if (
		message?.content !== null &&
		message?.content !== undefined &&
		message.content.trim() !== ""
	) {
		messageItem = {
			type: "message",
			id: `msg_${shortid(24)}`,
			role: "assistant",
			content: [
				{
					type: "output_text",
					text: message.content,
					annotations: normalizeAnnotationsToResponses(message.annotations),
				},
			],
			...(message.phase ? { phase: message.phase } : {}),
			status: "completed",
		};
	}

	// Pre-tool commentary (a message item the provider emitted before the
	// first function_call) keeps its original position; otherwise the message
	// follows the function calls, matching the provider's emission order.
	if (messageItem && message?.content_before_tool_calls) {
		output.push(messageItem);
		messageItem = null;
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

	if (messageItem) {
		output.push(messageItem);
	}

	// Map finish_reason to status. Providers served via the OpenAI Responses
	// API surface truncation as finish_reason "incomplete" (from the upstream
	// response status) rather than "length".
	let status: "completed" | "incomplete" | "failed" = "completed";
	let incompleteReason: string | null = null;
	if (
		choice?.finish_reason === "length" ||
		choice?.finish_reason === "incomplete"
	) {
		status = "incomplete";
		incompleteReason = "max_output_tokens";
	} else if (choice?.finish_reason === "content_filter") {
		status = "incomplete";
		incompleteReason = "content_filter";
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
			status === "incomplete" && incompleteReason
				? { reason: incompleteReason }
				: null,
		model: chatResponse.model ?? requestedModel,
		previous_response_id: request?.previous_response_id ?? null,
		instructions: request?.instructions ?? null,
		output,
		error: null,
		tools: normalizeEchoedTools(request?.tools),
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
			// Report the effective mode the provider applied; fall back to the
			// requested value ("auto" resolves upstream, so it is never echoed).
			...(resolveReasoningContext(
				chatResponse.reasoning_context,
				request?.reasoning?.context,
			) ?? {}),
		},
		usage,
		max_output_tokens: request?.max_output_tokens ?? null,
		max_tool_calls: request?.max_tool_calls ?? null,
		store: request?.store ?? true,
		background: request?.background ?? false,
		service_tier:
			resolveServedServiceTier(chatResponse) ??
			request?.service_tier ??
			"default",
		metadata: {
			...(request?.metadata ?? {}),
			...(chatResponse.metadata ?? {}),
		},
		safety_identifier: request?.safety_identifier ?? null,
		prompt_cache_key: request?.prompt_cache_key ?? null,
	};
}
