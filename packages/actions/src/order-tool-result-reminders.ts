import type { BaseMessage } from "@llmgateway/models";

/** Keep system reminders after all results of a complete Claude tool turn. */
export function orderToolResultReminders(
	messages: readonly BaseMessage[],
): BaseMessage[] {
	const ordered: BaseMessage[] = [];
	for (let index = 0; index < messages.length; index++) {
		const message = messages[index]!;
		ordered.push(message);
		if (message.role !== "assistant" || !message.tool_calls?.length) {
			continue;
		}

		const pending = new Set(message.tool_calls.map((call) => call.id));
		const results: BaseMessage[] = [];
		const reminders: BaseMessage[] = [];
		let end = index + 1;
		for (; end < messages.length && pending.size > 0; end++) {
			const next = messages[end]!;
			if (next.role === "system") {
				reminders.push(next);
			} else if (
				(next.role === "tool" || next.role === "user") &&
				next.tool_call_id &&
				pending.delete(next.tool_call_id)
			) {
				results.push(next);
			} else {
				break;
			}
		}
		// Do not repair incomplete turns or cross unrelated conversation messages.
		if (pending.size === 0) {
			ordered.push(...results, ...reminders);
			index = end - 1;
		}
	}
	return ordered;
}
