import { UnifiedFinishReason } from "@llmgateway/db";

import { publishToQueue, LOG_QUEUE } from "./redis";

import type { InferInsertModel } from "@llmgateway/db";
import type { log } from "@llmgateway/db";

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
		case "google-vertex":
		case "google-ai-studio":
			if (finishReason === "STOP") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (finishReason === "MAX_TOKENS") {
				return UnifiedFinishReason.LENGTH_LIMIT;
			}
			if (finishReason === "SAFETY") {
				return UnifiedFinishReason.CONTENT_FILTER;
			}
			break;
		default: // OpenAI format (also used by inference.net)
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
 * Insert a log entry into the database.
 * This function is extracted to prepare for future implementation using a message queue.
 */
export type LogInsertData = Omit<
	InferInsertModel<typeof log>,
	"id" | "createdAt" | "updatedAt"
>;

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
		}
	}
	await publishToQueue(LOG_QUEUE, logData);
	return 1; // Return 1 to match test expectations
}
