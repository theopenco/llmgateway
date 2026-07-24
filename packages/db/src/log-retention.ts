import type { LogInsertData } from "./types.js";

/**
 * Log columns that hold request/response payload data (the actual prompt,
 * completion, reasoning, tool definitions/results and Responses API payload).
 * Organizations with `retentionLevel` "none" do not retain any of this, so it
 * is cleared before the row is persisted.
 */
export const RETENTION_SENSITIVE_LOG_FIELDS = [
	"messages",
	"content",
	"reasoningContent",
	"tools",
	"toolChoice",
	"toolResults",
	"responsesApiData",
] as const;

/**
 * Return a copy of the log data with every retention-sensitive payload field
 * cleared. Used both in the gateway — so payloads for non-retaining orgs never
 * travel through Redis in the first place — and in the worker as a safety net
 * for any log whose retention level wasn't resolved at publish time.
 */
export function stripRetentionSensitiveLogFields<T extends LogInsertData>(
	logData: T,
): T {
	return {
		...logData,
		messages: null,
		content: null,
		reasoningContent: null,
		tools: null,
		toolChoice: null,
		toolResults: null,
		responsesApiData: null,
	};
}
