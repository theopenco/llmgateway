import type { LogInsertData } from "./types.js";

/**
 * Log columns that hold request/response payload data (the actual prompt,
 * completion, reasoning, tool definitions/results and Responses API payload),
 * plus the debug payloads captured under `x-debug`, which hold the full
 * request/response bodies exchanged with the provider. Organizations with
 * `retentionLevel` "none" do not retain any of this, so it is cleared before
 * the row is persisted.
 */
export const RETENTION_SENSITIVE_LOG_FIELDS = [
	"messages",
	"content",
	"reasoningContent",
	"tools",
	"toolChoice",
	"toolResults",
	"responsesApiData",
	"rawRequest",
	"rawResponse",
	"upstreamRequest",
	"upstreamResponse",
] as const;

/**
 * Return a copy of the log data with every retention-sensitive payload field
 * cleared. Used by the gateway so payloads for non-retaining orgs never travel
 * through Redis (or reach the database) in the first place — the gateway is the
 * sole decider of what gets persisted, so the worker inserts queued rows as-is.
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
		rawRequest: null,
		rawResponse: null,
		upstreamRequest: null,
		upstreamResponse: null,
	};
}
