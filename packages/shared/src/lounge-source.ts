/**
 * The `x-source` header value every Lounge-originated gateway request carries.
 * It is written to `log.source` and drives two things: the source breakdown in
 * analytics, and the worker's credit deduction order (chat-plan credits are
 * preferred for Lounge traffic).
 */
export const LOUNGE_SOURCE = "lounge.llmgateway.io";

/**
 * The host Lounge used before the move to lounge.llmgateway.io. Logs written
 * before the cutover — and any request that arrives while a stale client or a
 * cached page still posts from the old origin — carry this value, so anything
 * that classifies a request as Lounge traffic has to keep accepting it.
 * Historical rows are never rewritten, so this cannot be dropped later.
 */
export const LEGACY_LOUNGE_SOURCE = "chat.llmgateway.io";

export function isLoungeSource(source: string | null | undefined): boolean {
	return source === LOUNGE_SOURCE || source === LEGACY_LOUNGE_SOURCE;
}
