import type { ResponsesRequest } from "@/responses/schemas.js";

interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | Array<Record<string, unknown>> | null;
	name?: string;
	tool_calls?: Array<{
		id: string;
		type: "function";
		function: {
			name: string;
			arguments: string;
		};
	}>;
	tool_call_id?: string;
}

/**
 * Converts Responses API input items to chat completions messages.
 * This is the inverse of transformMessagesForResponsesApi in prepare-request-body.ts
 */
export function convertResponsesInputToMessages(
	input: ResponsesRequest["input"],
	instructions?: string,
): ChatMessage[] {
	const messages: ChatMessage[] = [];

	if (instructions) {
		messages.push({ role: "system", content: instructions });
	}

	if (typeof input === "string") {
		messages.push({ role: "user", content: input });
		return messages;
	}

	let i = 0;
	while (i < input.length) {
		const item = input[i]!;

		// function_call items -> collect consecutive ones into assistant tool_calls
		if ("type" in item && item.type === "function_call") {
			const toolCalls: ChatMessage["tool_calls"] = [];

			while (i < input.length) {
				const current = input[i]!;
				if (!("type" in current) || current.type !== "function_call") {
					break;
				}
				toolCalls.push({
					id: current.call_id,
					type: "function",
					function: {
						name: current.name,
						arguments: current.arguments,
					},
				});
				i++;
			}

			messages.push({
				role: "assistant",
				content: null,
				tool_calls: toolCalls,
			});
			continue;
		}

		// Skip reasoning items — they cannot be converted to chat messages.
		// These appear in stored output when chaining via previous_response_id.
		if (
			"type" in item &&
			(item as Record<string, unknown>).type === "reasoning"
		) {
			i++;
			continue;
		}

		// function_call_output items -> tool messages
		if ("type" in item && item.type === "function_call_output") {
			messages.push({
				role: "tool",
				content: item.output,
				tool_call_id: item.call_id,
			});
			i++;
			continue;
		}

		// Regular message items
		const msg = item as {
			role: string;
			content?: string | Array<Record<string, unknown>> | null;
			name?: string;
			tool_calls?: Array<{
				id: string;
				type: "function";
				function: { name: string; arguments: string };
			}>;
			tool_call_id?: string;
		};

		// Map "developer" role to "system" for chat completions compatibility
		const role =
			msg.role === "developer"
				? ("system" as const)
				: (msg.role as ChatMessage["role"]);

		const chatMsg: ChatMessage = {
			role,
			content: convertContent(msg.content),
		};

		if (msg.name) {
			chatMsg.name = msg.name;
		}

		if (msg.tool_calls && msg.tool_calls.length > 0) {
			chatMsg.tool_calls = msg.tool_calls;
		}

		if (msg.tool_call_id) {
			chatMsg.tool_call_id = msg.tool_call_id;
		}

		messages.push(chatMsg);
		i++;
	}

	return messages;
}

/**
 * Convert Responses API content types to chat completions content types.
 * input_text/output_text -> text, input_image -> image_url
 */
function convertContent(
	content: string | Array<Record<string, unknown>> | null | undefined,
): string | Array<Record<string, unknown>> | null {
	if (content === null || content === undefined) {
		return null;
	}

	if (typeof content === "string") {
		return content;
	}

	return content.map((item) => {
		if (
			item.type === "input_text" ||
			item.type === "output_text" ||
			item.type === "text"
		) {
			return { type: "text", text: item.text };
		}
		if (item.type === "input_image") {
			return {
				type: "image_url",
				image_url: {
					url: item.image_url ?? item.url,
					...(item.detail ? { detail: item.detail } : {}),
				},
			};
		}
		// Pass through unknown types
		return item;
	});
}
