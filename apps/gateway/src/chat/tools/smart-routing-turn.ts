import type { BaseMessage } from "@llmgateway/models";

/** Unified finish reasons that end a turn with an answer for the user. */
const FINAL_ANSWER_FINISH_REASONS = new Set([
	"completed",
	"length_limit",
	"content_filter",
]);

function hasText(message: BaseMessage): boolean {
	if (typeof message.content === "string") {
		return message.content.trim().length > 0;
	}
	return (
		Array.isArray(message.content) &&
		message.content.some(
			(part) =>
				part &&
				typeof part === "object" &&
				"text" in part &&
				typeof part.text === "string" &&
				part.text.trim().length > 0,
		)
	);
}

/**
 * Whether this request opens a new user turn, the only point where a smart
 * routing session may change its model or effort. The request must end with a
 * user message, and the session's previous response must have been a final
 * answer: a user message after a tool call is steering sent while the agent
 * was still working, which informs the next decision but never swaps the
 * model mid-turn.
 */
export function isSmartRoutingTurnBoundary(
	messages: BaseMessage[],
	lastFinishReason: string | undefined,
): boolean {
	let last: BaseMessage | undefined;
	for (let index = messages.length - 1; index >= 0; index--) {
		const role: string = messages[index].role;
		if (role !== "system" && role !== "developer") {
			last = messages[index];
			break;
		}
	}
	if (!last || last.role !== "user" || !hasText(last)) {
		return false;
	}
	return (
		lastFinishReason === undefined ||
		FINAL_ANSWER_FINISH_REASONS.has(lastFinishReason)
	);
}
