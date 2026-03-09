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
		};
		completion_tokens_details?: {
			reasoning_tokens?: number;
		};
		cost_usd_total?: number;
		cost_usd_input?: number;
		cost_usd_output?: number;
		cost_usd_cached_input?: number;
		cost_usd_request?: number;
		cost_usd_image_input?: number | null;
		cost_usd_image_output?: number | null;
	};
	metadata?: Record<string, unknown>;
}

export interface ResponsesApiOutput {
	type: string;
	id: string;
	[key: string]: unknown;
}

export interface ResponsesApiResponse {
	id: string;
	object: "response";
	created_at: number;
	model: string;
	output: ResponsesApiOutput[];
	usage: {
		input_tokens: number;
		output_tokens: number;
		total_tokens: number;
		output_tokens_details?: {
			reasoning_tokens: number;
		};
		input_tokens_details?: {
			cached_tokens: number;
		};
		cost_usd_total?: number;
		cost_usd_input?: number;
		cost_usd_output?: number;
		cost_usd_cached_input?: number;
		cost_usd_request?: number;
	};
	status: "completed" | "incomplete" | "failed";
	metadata?: Record<string, unknown>;
}

/**
 * Converts a chat completions response to Responses API format.
 */
export function convertChatResponseToResponses(
	chatResponse: ChatCompletionsResponse,
	requestedModel: string,
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

	// Add message output
	if (message?.content !== null && message?.content !== undefined) {
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

	const usage: ResponsesApiResponse["usage"] = {
		input_tokens: chatResponse.usage?.prompt_tokens ?? 0,
		output_tokens: chatResponse.usage?.completion_tokens ?? 0,
		total_tokens: chatResponse.usage?.total_tokens ?? 0,
	};

	if (chatResponse.usage?.completion_tokens_details?.reasoning_tokens) {
		usage.output_tokens_details = {
			reasoning_tokens:
				chatResponse.usage.completion_tokens_details.reasoning_tokens,
		};
	}

	if (chatResponse.usage?.prompt_tokens_details?.cached_tokens) {
		usage.input_tokens_details = {
			cached_tokens: chatResponse.usage.prompt_tokens_details.cached_tokens,
		};
	}

	// Pass through cost fields
	if (chatResponse.usage?.cost_usd_total !== undefined) {
		usage.cost_usd_total = chatResponse.usage.cost_usd_total;
	}
	if (chatResponse.usage?.cost_usd_input !== undefined) {
		usage.cost_usd_input = chatResponse.usage.cost_usd_input;
	}
	if (chatResponse.usage?.cost_usd_output !== undefined) {
		usage.cost_usd_output = chatResponse.usage.cost_usd_output;
	}
	if (chatResponse.usage?.cost_usd_cached_input !== undefined) {
		usage.cost_usd_cached_input = chatResponse.usage.cost_usd_cached_input;
	}
	if (chatResponse.usage?.cost_usd_request !== undefined) {
		usage.cost_usd_request = chatResponse.usage.cost_usd_request;
	}

	return {
		id: `resp_${shortid(24)}`,
		object: "response",
		created_at: chatResponse.created ?? Math.floor(Date.now() / 1000),
		model: chatResponse.model ?? requestedModel,
		output,
		usage,
		status,
		...(chatResponse.metadata ? { metadata: chatResponse.metadata } : {}),
	};
}
