import type { UIMessage } from "ai";

const MAX_SENT_MESSAGES = 40;

/** Keep the request small, and never open it on a dangling assistant turn. */
export function recentMessages(messages: UIMessage[]): UIMessage[] {
	const tail = messages.slice(-MAX_SENT_MESSAGES);
	const firstUser = tail.findIndex((message) => message.role === "user");
	return firstUser > 0 ? tail.slice(firstUser) : tail;
}

/**
 * Close every tool call that never got a result (the user stopped, or the
 * page went away), so the conversation stays valid for the next request.
 * Returns the same array when nothing was open.
 */
export function settleToolCalls(
	messages: UIMessage[],
	reason: string,
): UIMessage[] {
	let changed = false;
	const settled = messages.map((message) => {
		if (message.role !== "assistant") {
			return message;
		}
		let touched = false;
		const parts = message.parts.map((part) => {
			if (
				part.type !== "dynamic-tool" ||
				part.state === "output-available" ||
				part.state === "output-error" ||
				part.state === "output-denied"
			) {
				return part;
			}
			touched = true;
			return {
				type: "dynamic-tool" as const,
				toolName: part.toolName,
				toolCallId: part.toolCallId,
				state: "output-error" as const,
				input: part.input ?? {},
				errorText: reason,
			};
		});
		if (!touched) {
			return message;
		}
		changed = true;
		return { ...message, parts };
	});
	return changed ? settled : messages;
}
