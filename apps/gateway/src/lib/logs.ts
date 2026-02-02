import { publishToQueue, LOG_QUEUE, LOG_UPDATE_QUEUE } from "@llmgateway/cache";
import {
	UnifiedFinishReason,
	type LogInsertData,
	cdb as db,
	log,
	shortid,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { InferInsertModel } from "@llmgateway/db";

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
	await publishToQueue(LOG_QUEUE, logData);
	return 1; // Return 1 to match test expectations
}

/**
 * Data required for creating a pending log entry.
 * Only includes the minimal fields needed at request start.
 */
export interface PendingLogData {
	requestId: string;
	organizationId: string;
	projectId: string;
	apiKeyId: string;
	requestedModel: string;
	requestedProvider: string | null;
	mode: "api-keys" | "credits" | "hybrid";
	usedMode: "api-keys" | "credits";
	messages: unknown;
	streamed: boolean;
	source: string | null;
	userAgent: string | null;
}

/**
 * Insert a pending log entry synchronously to the database.
 * This is called at the start of a request to track requests that may timeout or be cancelled.
 * Returns the log ID that should be used in the subsequent updateLog() call.
 */
export async function insertPendingLog(data: PendingLogData): Promise<string> {
	const logId = shortid();

	try {
		await db.insert(log).values({
			id: logId,
			requestId: data.requestId,
			organizationId: data.organizationId,
			projectId: data.projectId,
			apiKeyId: data.apiKeyId,
			requestedModel: data.requestedModel,
			requestedProvider: data.requestedProvider,
			// Set placeholder values for required fields - these will be updated later
			usedModel: data.requestedModel,
			usedProvider: data.requestedProvider || "unknown",
			duration: 0,
			responseSize: 0,
			mode: data.mode,
			usedMode: data.usedMode,
			// Set pending status
			unifiedFinishReason: UnifiedFinishReason.PENDING,
			// Include available data
			messages: data.messages,
			streamed: data.streamed,
			source: data.source,
			userAgent: data.userAgent,
			// Initialize other fields
			hasError: false,
			canceled: false,
			cached: false,
			dataStorageCost: "0",
		});

		return logId;
	} catch (error) {
		logger.error("Failed to insert pending log", {
			requestId: data.requestId,
			error: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

/**
 * Data for updating an existing log entry.
 * Includes the log ID and all the fields to update.
 */
export interface LogUpdateData extends Omit<LogInsertData, "id"> {
	logId: string;
}

/**
 * Update an existing log entry via the message queue.
 * This is called at the end of a request to update the pending log with final data.
 */
export async function updateLog(logData: LogUpdateData): Promise<unknown> {
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
	await publishToQueue(LOG_UPDATE_QUEUE, logData);
	return 1;
}
