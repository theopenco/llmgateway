import { UNREPLAYABLE_ITEM_TYPES } from "@/responses/schemas.js";

import { isGoogleReasoningDetail } from "@llmgateway/actions";

import { flattenToolName } from "./tool-registry.js";

import type { ResponsesRequest } from "@/responses/schemas.js";
import type { GoogleExtraContent } from "@llmgateway/models";

// Unreplayable items, plus tool declarations already lifted into `tools`. They
// have no chat completions equivalent, so they are skipped rather than turned
// into stray messages.
const SKIPPED_ITEM_TYPES = new Set<string>([
	...UNREPLAYABLE_ITEM_TYPES,
	"additional_tools",
]);

function isToolCallItem(item: unknown): item is {
	type: "function_call" | "custom_tool_call";
	call_id: string;
	name: string;
	namespace?: string;
	extra_content?: GoogleExtraContent;
	arguments?: string;
	input?: string;
} {
	const type = (item as { type?: unknown } | null)?.type;
	return type === "function_call" || type === "custom_tool_call";
}

interface ChatMessage {
	role: "system" | "user" | "assistant" | "tool";
	content: string | Array<Record<string, unknown>> | null;
	name?: string;
	tool_calls?: Array<{
		id: string;
		type: "function";
		extra_content?: GoogleExtraContent;
		function: {
			name: string;
			arguments: string;
		};
	}>;
	tool_call_id?: string;
	reasoning?: string;
	reasoning_details?: Array<Record<string, unknown>>;
	phase?: "commentary" | "final_answer";
}

interface PendingReasoning {
	texts: string[];
	details: Array<Record<string, unknown>>;
}

/**
 * Collect a Responses API `reasoning` input item into the pending-reasoning
 * buffer. Encrypted payloads become "reasoning.encrypted" reasoning_details
 * entries (replayed to the provider to preserve reasoning across calls);
 * summary/content text is folded into the assistant `reasoning` field.
 */
function collectReasoningItem(
	item: Record<string, unknown>,
	pending: PendingReasoning,
): void {
	if (
		typeof item.encrypted_content === "string" &&
		item.encrypted_content.length > 0
	) {
		pending.details.push({
			type: "reasoning.encrypted",
			data: item.encrypted_content,
			...(typeof item.id === "string" && { id: item.id }),
			format: "openai-responses-v1",
			index: pending.details.length,
		});
	}
	for (const parts of [item.summary, item.content]) {
		if (!Array.isArray(parts)) {
			continue;
		}
		const text = parts
			.map((part) =>
				part && typeof part === "object" && typeof part.text === "string"
					? part.text
					: "",
			)
			.filter(Boolean)
			.join("\n\n");
		if (text) {
			pending.texts.push(text);
		}
	}
}

/**
 * Drain the pending-reasoning buffer into fields to spread onto the next
 * assistant chat message.
 */
function takePendingReasoning(pending: PendingReasoning): {
	reasoning?: string;
	reasoning_details?: Array<Record<string, unknown>>;
} {
	const result = {
		...(pending.texts.length > 0 && { reasoning: pending.texts.join("\n\n") }),
		...(pending.details.length > 0 && { reasoning_details: pending.details }),
	};
	pending.texts = [];
	pending.details = [];
	return result;
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

	// Reasoning items precede the assistant items they belong to; buffer them
	// and attach to the next assistant message so the provider layer can replay
	// the reasoning (encrypted payloads and/or text) on this turn.
	const pendingReasoning: PendingReasoning = { texts: [], details: [] };
	const pendingGeneratedImages: Array<Record<string, unknown>> = [];

	let i = 0;
	while (i < input.length) {
		const item = input[i]!;

		// function_call items -> collect consecutive ones into assistant tool_calls.
		// Also fold any immediately-following assistant `message` items into the
		// same assistant message: in the Responses API the tool_calls and the
		// assistant text are emitted as separate output items, but in chat
		// completions they belong on a single assistant message. Splitting them
		// inserts a stray assistant message between the tool_calls and the tool
		// result, which strict providers (deepseek family, bytedance, etc.)
		// reject with "assistant message with tool_calls must be followed by
		// tool messages".
		if (isToolCallItem(item)) {
			const toolCalls: ChatMessage["tool_calls"] = [];

			while (i < input.length) {
				const current = input[i]!;
				if (!isToolCallItem(current)) {
					break;
				}
				toolCalls.push({
					id: current.call_id,
					...(current.extra_content
						? { extra_content: current.extra_content }
						: {}),
					type: "function",
					function: {
						name: flattenToolName(current.name, current.namespace),
						// A freeform call carries its raw payload in `input`; the
						// provider was offered the tool as a function taking that
						// payload as a single string argument.
						arguments:
							current.type === "custom_tool_call"
								? JSON.stringify({ input: current.input ?? "" })
								: (current.arguments ?? ""),
					},
				});
				i++;
			}

			// Fold trailing assistant message content (if any) into this same
			// assistant message rather than emitting it as a separate message.
			let foldedContent: string | null = null;
			let foldedPhase: ChatMessage["phase"];
			while (i < input.length) {
				const next = input[i] as Record<string, unknown> | undefined;
				if (
					next &&
					next.type === "message" &&
					(next.role === "assistant" || next.role === undefined)
				) {
					if (Array.isArray(next.reasoning_details)) {
						pendingReasoning.details.push(
							...next.reasoning_details.filter(isGoogleReasoningDetail),
						);
					}
					const text = extractTextFromContent(next.content);
					if (text) {
						foldedContent = (foldedContent ?? "") + text;
					}
					if (next.phase === "commentary" || next.phase === "final_answer") {
						foldedPhase = next.phase;
					}
					i++;
					continue;
				}
				break;
			}

			messages.push({
				role: "assistant",
				content: foldedContent,
				tool_calls: toolCalls,
				...(foldedPhase ? { phase: foldedPhase } : {}),
				...takePendingReasoning(pendingReasoning),
			});
			continue;
		}

		// Reasoning items (from stored output when chaining via
		// previous_response_id, or replayed by stateless clients) are buffered
		// and attached to the assistant message that follows them.
		if (
			"type" in item &&
			(item as Record<string, unknown>).type === "reasoning"
		) {
			collectReasoningItem(item as Record<string, unknown>, pendingReasoning);
			i++;
			continue;
		}

		// function_call_output / custom_tool_call_output items -> tool messages
		if (
			"type" in item &&
			(item.type === "function_call_output" ||
				item.type === "custom_tool_call_output")
		) {
			messages.push({
				role: "tool",
				content: serializeFunctionCallOutput(item.output),
				tool_call_id: item.call_id,
			});
			i++;
			continue;
		}

		if (
			"type" in item &&
			item.type === "image_generation_call" &&
			typeof item.result === "string" &&
			item.result.length > 0
		) {
			pendingGeneratedImages.push({
				type: "image_url",
				image_url: {
					url: `data:image/webp;base64,${item.result}`,
				},
			});
			i++;
			continue;
		}

		if ("type" in item && SKIPPED_ITEM_TYPES.has(item.type as string)) {
			i++;
			continue;
		}

		// Regular message items
		const msg = item as {
			role: string;
			reasoning_details?: Array<Record<string, unknown>>;
			phase?: "commentary" | "final_answer";
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

		// Reasoning belongs to the assistant items directly following it. A
		// non-assistant message means the prior turn ended with reasoning only
		// (e.g. it hit max_output_tokens before emitting a message). Emit an
		// assistant carrier message so encrypted payloads are still replayed
		// upstream; reasoning text alone has no replayable value and is dropped.
		if (role !== "assistant") {
			if (pendingReasoning.details.length > 0) {
				messages.push({
					role: "assistant",
					content: null,
					...takePendingReasoning(pendingReasoning),
				});
			} else {
				takePendingReasoning(pendingReasoning);
			}
		}

		const convertedContent = convertContent(msg.content);
		const content =
			role === "user" && pendingGeneratedImages.length > 0
				? [
						...pendingGeneratedImages.splice(0),
						...(typeof convertedContent === "string"
							? [{ type: "text", text: convertedContent }]
							: (convertedContent ?? [])),
					]
				: convertedContent;
		if (role === "assistant" && msg.reasoning_details) {
			const googleDetails = msg.reasoning_details.filter(
				isGoogleReasoningDetail,
			);
			pendingReasoning.details.push(...googleDetails);
			// A streamed signature may precede the tool call in its own empty
			// output item. Keep both on the same assistant turn when replaying.
			if (
				googleDetails.length > 0 &&
				!extractTextFromContent(content) &&
				isToolCallItem(input[i + 1])
			) {
				i++;
				continue;
			}
		}
		const chatMsg: ChatMessage = {
			role,
			content,
			...(role === "assistant" ? takePendingReasoning(pendingReasoning) : {}),
			...(role === "assistant" && msg.phase ? { phase: msg.phase } : {}),
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

	if (pendingGeneratedImages.length > 0) {
		messages.push({ role: "user", content: pendingGeneratedImages });
	}

	return messages;
}

function serializeFunctionCallOutput(
	output: string | Array<Record<string, unknown>>,
): string {
	if (typeof output === "string") {
		return output;
	}

	return JSON.stringify(output);
}

/**
 * Extract concatenated plain text from a Responses API message content field
 * (which can be a string, an array of content parts, null, or undefined).
 * Used when folding a trailing assistant text message into a tool_calls
 * assistant message.
 */
function extractTextFromContent(content: unknown): string {
	if (content === null || content === undefined) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const parts: string[] = [];
	for (const part of content) {
		if (
			part &&
			typeof part === "object" &&
			typeof (part as { text?: unknown }).text === "string"
		) {
			parts.push((part as { text: string }).text);
		}
	}
	return parts.join("");
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
		// Carry OpenAI explicit prompt cache breakpoints (GPT-5.6+) through the
		// content-type rewrite; the chat pipeline strips them for unsupported
		// provider/model pairs.
		const breakpoint =
			item.prompt_cache_breakpoint !== undefined
				? { prompt_cache_breakpoint: item.prompt_cache_breakpoint }
				: undefined;
		if (
			item.type === "input_text" ||
			item.type === "output_text" ||
			item.type === "text"
		) {
			return { type: "text", text: item.text, ...breakpoint };
		}
		if (item.type === "input_image") {
			return {
				type: "image_url",
				image_url: {
					url: item.image_url ?? item.url,
					...(item.detail ? { detail: item.detail } : {}),
				},
				...breakpoint,
			};
		}
		// Pass through unknown types
		return item;
	});
}
