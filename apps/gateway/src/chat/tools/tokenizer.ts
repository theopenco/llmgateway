/**
 * Converts a message content value (string, array of content parts, null, or
 * undefined) to a plain string suitable for length-based token estimation.
 */
export function messageContentToString(
	content: string | unknown[] | null | undefined,
): string {
	if (content === null || content === undefined) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	return JSON.stringify(content);
}

const CHARS_PER_TOKEN = 4;

/**
 * Rough length-based token estimate. Avoids running a tokenizer on the
 * gateway hot path — accuracy is intentionally traded for throughput.
 */
export function estimateTokensFromLength(length: number): number {
	if (length <= 0) {
		return 0;
	}
	return Math.max(1, Math.round(length / CHARS_PER_TOKEN));
}

/**
 * Estimates the prompt token count for an array of chat messages using a
 * cheap length-based heuristic (chars/4). Used in the gateway hot path
 * where the cost of running gpt-tokenizer is not justified.
 */
export function encodeChatMessages(messages: any[]): number {
	if (!messages || messages.length === 0) {
		return 0;
	}
	const totalLength = messages.reduce(
		(acc: number, m: any) => acc + messageContentToString(m.content).length,
		0,
	);
	return estimateTokensFromLength(totalLength);
}
