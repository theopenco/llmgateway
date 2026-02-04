import { publishToQueue, LOG_QUEUE } from "@llmgateway/cache";
import { UnifiedFinishReason, type LogInsertData } from "@llmgateway/db";
import { recordChatCompletionMetrics } from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";

import type { InferInsertModel } from "@llmgateway/db";
import type { log } from "@llmgateway/db";

/**
 * Check if a finish reason is expected to map to UNKNOWN
 * (i.e., it's a known finish reason that intentionally maps to unknown)
 */
export function isExpectedUnknownFinishReason(
	finishReason: string | null | undefined,
	provider: string | null | undefined,
): boolean {
	if (!finishReason) {
		return false;
	}
	// Google's "OTHER" finish reason is expected and maps to UNKNOWN
	if (
		(provider === "google-ai-studio" || provider === "google-vertex") &&
		finishReason === "OTHER"
	) {
		return true;
	}
	return false;
}

/**
 * Maps provider-specific finish reasons to unified finish reasons
 */
export function getUnifiedFinishReason(
	finishReason: string | null | undefined,
	provider: string | null | undefined,
): UnifiedFinishReason {
	if (!finishReason) {
		return UnifiedFinishReason.UNKNOWN;
	}

	if (finishReason === "canceled") {
		return UnifiedFinishReason.CANCELED;
	}
	if (finishReason === "gateway_error") {
		return UnifiedFinishReason.GATEWAY_ERROR;
	}
	if (finishReason === "upstream_error") {
		return UnifiedFinishReason.UPSTREAM_ERROR;
	}
	if (finishReason === "client_error") {
		return UnifiedFinishReason.CLIENT_ERROR;
	}

	switch (provider) {
		case "anthropic":
			if (finishReason === "stop_sequence") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (finishReason === "max_tokens") {
				return UnifiedFinishReason.LENGTH_LIMIT;
			}
			if (finishReason === "end_turn") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (finishReason === "tool_use") {
				return UnifiedFinishReason.TOOL_CALLS;
			}
			break;
		case "google-ai-studio":
		case "google-vertex":
			// Google finish reasons (original format, not mapped to OpenAI)
			if (finishReason === "STOP") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (finishReason === "MAX_TOKENS") {
				return UnifiedFinishReason.LENGTH_LIMIT;
			}
			if (
				finishReason === "SAFETY" ||
				finishReason === "PROHIBITED_CONTENT" ||
				finishReason === "RECITATION" ||
				finishReason === "BLOCKLIST" ||
				finishReason === "SPII" ||
				finishReason === "LANGUAGE" ||
				finishReason === "IMAGE_SAFETY" ||
				finishReason === "IMAGE_PROHIBITED_CONTENT" ||
				finishReason === "IMAGE_RECITATION" ||
				finishReason === "IMAGE_OTHER" ||
				finishReason === "NO_IMAGE"
			) {
				return UnifiedFinishReason.CONTENT_FILTER;
			}
			if (finishReason === "OTHER") {
				return UnifiedFinishReason.UNKNOWN;
			}
			break;
		default: // OpenAI format (also used by inference.net and other providers)
			if (finishReason === "stop") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (finishReason === "length") {
				return UnifiedFinishReason.LENGTH_LIMIT;
			}
			if (finishReason === "content_filter") {
				return UnifiedFinishReason.CONTENT_FILTER;
			}
			if (finishReason === "tool_calls") {
				return UnifiedFinishReason.TOOL_CALLS;
			}
			break;
	}

	return UnifiedFinishReason.UNKNOWN;
}

/**
 * Map unified finish reason to an error type for metrics (if applicable)
 */
function getErrorTypeFromUnifiedFinishReason(
	unifiedReason: string | null | undefined,
): string | undefined {
	switch (unifiedReason) {
		case UnifiedFinishReason.CLIENT_ERROR:
			return "client_error";
		case UnifiedFinishReason.GATEWAY_ERROR:
			return "gateway_error";
		case UnifiedFinishReason.UPSTREAM_ERROR:
			return "upstream_error";
		case UnifiedFinishReason.CONTENT_FILTER:
			return "content_filter";
		case UnifiedFinishReason.CANCELED:
			return "canceled";
		default:
			return undefined;
	}
}

/**
 * Calculate data storage cost based on token usage
 * $0.01 per 1M tokens (total tokens = input + cached + output + reasoning)
 * Returns "0" if retention level is "none" since no data is stored
 */
export function calculateDataStorageCost(
	promptTokens: number | string | null | undefined,
	cachedTokens: number | string | null | undefined,
	completionTokens: number | string | null | undefined,
	reasoningTokens: number | string | null | undefined,
	retentionLevel?: "retain" | "none" | null,
): string {
	// No storage cost when data retention is disabled
	if (retentionLevel === "none") {
		return "0";
	}

	const prompt = Number(promptTokens) || 0;
	const cached = Number(cachedTokens) || 0;
	const completion = Number(completionTokens) || 0;
	const reasoning = Number(reasoningTokens) || 0;

	const totalTokens = prompt + cached + completion + reasoning;

	// $0.01 per 1M tokens
	const cost = (totalTokens / 1_000_000) * 0.01;
	return cost.toString();
}

/**
 * Insert a log entry into the database.
 * This function is extracted to prepare for future implementation using a message queue.
 */

export type LogData = InferInsertModel<typeof log>;

export async function insertLog(logData: LogInsertData): Promise<unknown> {
	if (logData.unifiedFinishReason === undefined) {
		if (logData.canceled) {
			logData.unifiedFinishReason = UnifiedFinishReason.CANCELED;
		} else {
			logData.unifiedFinishReason = getUnifiedFinishReason(
				logData.finishReason,
				logData.usedProvider,
			);

			if (
				logData.unifiedFinishReason === UnifiedFinishReason.UNKNOWN &&
				logData.finishReason &&
				!isExpectedUnknownFinishReason(
					logData.finishReason,
					logData.usedProvider,
				)
			) {
				logger.error("Unknown finish reason encountered", {
					requestId: logData.requestId,
					finishReason: logData.finishReason,
					provider: logData.usedProvider,
					model: logData.usedModel,
				});
			}
		}
	}

	// Record Prometheus metrics for chat completion requests
	const errorType = getErrorTypeFromUnifiedFinishReason(
		logData.unifiedFinishReason,
	);

	recordChatCompletionMetrics({
		model: logData.usedModel || "unknown",
		provider: logData.usedProvider || "unknown",
		finishReason: logData.finishReason || null,
		streaming: logData.streamed || false,
		durationMs: logData.duration || 0,
		ttftMs: logData.timeToFirstToken || undefined,
		inputTokens: logData.promptTokens
			? Number(logData.promptTokens)
			: undefined,
		outputTokens: logData.completionTokens
			? Number(logData.completionTokens)
			: undefined,
		reasoningTokens: logData.reasoningTokens
			? Number(logData.reasoningTokens)
			: undefined,
		cachedTokens: logData.cachedTokens
			? Number(logData.cachedTokens)
			: undefined,
		errorType,
	});

	await publishToQueue(LOG_QUEUE, logData);
	return 1; // Return 1 to match test expectations
}
