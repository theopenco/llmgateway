import { RequestError } from "./request-error.js";

import type { ToolCall } from "@llmgateway/models";

/**
 * Parse the client-supplied `tool_calls[].function.arguments` string into the
 * structured object required by providers with native tool_use blocks
 * (Anthropic, Bedrock Converse). The string is opaque to request validation,
 * so malformed JSON (e.g. a tool call truncated by max_tokens that the client
 * echoed back into history) must be rejected as a client error, not crash the
 * transform with an unhandled SyntaxError.
 */
export function parseToolCallArguments(
	toolCall: ToolCall,
): Record<string, unknown> {
	const args = toolCall.function.arguments;
	if (!args || !args.trim()) {
		return {};
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(args);
	} catch (e) {
		throw new RequestError(
			`Invalid JSON in tool_calls[].function.arguments for tool "${toolCall.function.name}" (id: ${toolCall.id}): ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new RequestError(
			`tool_calls[].function.arguments for tool "${toolCall.function.name}" (id: ${toolCall.id}) must be a JSON object`,
		);
	}
	return parsed as Record<string, unknown>;
}
