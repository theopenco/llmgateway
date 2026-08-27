import { publishToQueue, LOG_QUEUE } from "@llmgateway/cache";
import {
	stripRetentionSensitiveLogFields,
	UnifiedFinishReason,
	type LogInsertData,
} from "@llmgateway/db";
import { recordChatCompletionMetrics } from "@llmgateway/instrumentation";
import { logger } from "@llmgateway/logger";

import { recordSpend } from "./spend-limit.js";
import {
	redactErrorDetails,
	shouldRedactProviderError,
} from "./stealth-provider-errors.js";

import type { InferInsertModel, log } from "@llmgateway/db";

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
	// Google's "OTHER", "IMAGE_OTHER", "NO_IMAGE" and "MALFORMED_RESPONSE" finish
	// reasons are expected and map to UNKNOWN
	if (
		(provider === "google-ai-studio" ||
			provider === "glacier" ||
			provider === "iceberg" ||
			provider === "google-vertex" ||
			provider === "quartz") &&
		(finishReason === "OTHER" ||
			finishReason === "IMAGE_OTHER" ||
			finishReason === "NO_IMAGE" ||
			finishReason === "MALFORMED_RESPONSE")
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
	// Some OpenAI-compatible providers (e.g. MiniMax) emit "abort" when they
	// interrupt generation on their side. CANCELED is reserved for requests
	// canceled by the gateway's own client, so an upstream-initiated abort is
	// an upstream error. The streaming log path records the provider's raw
	// finish reason, so classify the raw value here as well.
	if (finishReason === "abort") {
		return UnifiedFinishReason.UPSTREAM_ERROR;
	}
	if (finishReason === "gateway_error") {
		return UnifiedFinishReason.GATEWAY_ERROR;
	}
	if (finishReason === "upstream_error") {
		return UnifiedFinishReason.UPSTREAM_ERROR;
	}
	if (finishReason === "network_error") {
		return UnifiedFinishReason.UPSTREAM_ERROR;
	}
	if (finishReason === "client_error") {
		return UnifiedFinishReason.CLIENT_ERROR;
	}
	if (finishReason === "llmgateway_content_filter") {
		return UnifiedFinishReason.CONTENT_FILTER;
	}
	// Anthropic-family safety-classifier refusals surface as `stop_reason:
	// "refusal"` across the direct API, Vertex, and Bedrock. Map it uniformly
	// here so providers handled by the default branch below (e.g. aws-bedrock)
	// classify refusals as content filtering rather than UNKNOWN.
	if (finishReason === "refusal") {
		return UnifiedFinishReason.CONTENT_FILTER;
	}
	// Anthropic models stop with `model_context_window_exceeded` when generation
	// hits the model's context window before `max_tokens`. Like `refusal`, it
	// surfaces across the direct API, Vertex, and Bedrock, so map it uniformly
	// here as a length limit.
	if (finishReason === "model_context_window_exceeded") {
		return UnifiedFinishReason.LENGTH_LIMIT;
	}

	switch (provider) {
		case "anthropic":
		case "vertex-anthropic":
		case "azure-anthropic":
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
			if (finishReason === "refusal") {
				return UnifiedFinishReason.CONTENT_FILTER;
			}
			break;
		case "google-ai-studio":
		case "glacier":
		case "iceberg":
		case "google-vertex":
		case "quartz":
			// Google finish reasons (original format, not mapped to OpenAI)
			if (finishReason === "STOP" || finishReason === "stop") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (finishReason === "MAX_TOKENS" || finishReason === "length") {
				return UnifiedFinishReason.LENGTH_LIMIT;
			}
			if (
				finishReason === "MALFORMED_FUNCTION_CALL" ||
				finishReason === "UNEXPECTED_TOOL_CALL" ||
				finishReason === "tool_calls"
			) {
				return UnifiedFinishReason.TOOL_CALLS;
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
				finishReason === "content_filter" // OpenAI format sometimes returned by Google
			) {
				return UnifiedFinishReason.CONTENT_FILTER;
			}
			// NO_IMAGE and IMAGE_OTHER are not policy blocks, so they belong with
			// OTHER rather than inflating the content_filter counts.
			if (
				finishReason === "OTHER" ||
				finishReason === "IMAGE_OTHER" ||
				finishReason === "NO_IMAGE" ||
				finishReason === "MALFORMED_RESPONSE"
			) {
				return UnifiedFinishReason.UNKNOWN;
			}
			break;
		case "mistral":
			if (finishReason === "stop") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (
				finishReason === "length" ||
				finishReason === "model_length" ||
				finishReason === "incomplete"
			) {
				return UnifiedFinishReason.LENGTH_LIMIT;
			}
			if (finishReason === "content_filter") {
				return UnifiedFinishReason.CONTENT_FILTER;
			}
			if (finishReason === "tool_calls") {
				return UnifiedFinishReason.TOOL_CALLS;
			}
			if (finishReason === "error") {
				return UnifiedFinishReason.UPSTREAM_ERROR;
			}
			break;
		case "zai":
		case "novita":
			if (finishReason === "stop") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (finishReason === "length" || finishReason === "incomplete") {
				return UnifiedFinishReason.LENGTH_LIMIT;
			}
			if (finishReason === "tool_calls") {
				return UnifiedFinishReason.TOOL_CALLS;
			}
			if (finishReason === "sensitive" || finishReason === "content_filter") {
				return UnifiedFinishReason.CONTENT_FILTER;
			}
			break;
		default: // OpenAI format (also used by inference.net and other providers)
			if (finishReason === "stop") {
				return UnifiedFinishReason.COMPLETED;
			}
			if (finishReason === "length" || finishReason === "incomplete") {
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

export function isContentFilterFinishReason(
	finishReason: string | null | undefined,
	provider: string | null | undefined,
): boolean {
	return (
		getUnifiedFinishReason(finishReason, provider) ===
		UnifiedFinishReason.CONTENT_FILTER
	);
}

/**
 * Whether the finish reason indicates the model stopped because it reached the
 * token limit (e.g. a small `max_tokens`). With a tiny limit (such as
 * `max_tokens: 1`) providers like Google can legitimately return no content at
 * all, so an empty response with this finish reason is expected behavior, not an
 * upstream error.
 */
export function isLengthLimitFinishReason(
	finishReason: string | null | undefined,
	provider: string | null | undefined,
): boolean {
	return (
		getUnifiedFinishReason(finishReason, provider) ===
		UnifiedFinishReason.LENGTH_LIMIT
	);
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
 * $0.01 per 1M tokens (total tokens = input + output)
 * promptTokens is the canonical total input count and already includes cached
 * input tokens for providers that report them separately. completionTokens is
 * the canonical total output count and already includes reasoning tokens.
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
	const completion = Number(completionTokens) || 0;

	const totalTokens = prompt + completion;

	// $0.01 per 1M tokens
	const cost = (totalTokens / 1_000_000) * 0.01;
	return cost.toString();
}

/**
 * Insert a log entry into the database.
 * This function is extracted to prepare for future implementation using a message queue.
 */

export type LogData = InferInsertModel<typeof log>;

/**
 * The portion of a log's cost that actually drains `organization.credits`, which
 * is what the per-org spend caps are meant to bound. Mirrors the worker's debit
 * rules in `batchProcessLogs` exactly — blended `log.cost` would overstate it:
 *
 * - end-user wallet rows debit `wallet.balance` for inference, so only their
 *   data-storage cost hits the org;
 * - BYOK (`usedMode: "api-keys"`) rows pay the provider directly, so again only
 *   data storage hits the org;
 * - cached rows are not charged for inference;
 * - credits rows are charged `billingCost ?? cost`, plus data storage.
 *
 * Keeping this aligned with the worker is what stops BYOK or wallet traffic from
 * filling a cap it can never be blocked by.
 */
export function organizationBilledCost(logData: LogInsertData): number {
	const storage = Number(logData.dataStorageCost ?? 0) || 0;

	const chargesOrgForInference =
		!logData.endCustomerWalletId &&
		logData.usedMode === "credits" &&
		!logData.cached;

	if (!chargesOrgForInference) {
		return storage;
	}

	const inference = Number(logData.billingCost ?? logData.cost ?? 0) || 0;
	return inference + storage;
}

export async function insertLog(
	logData: LogInsertData,
	options?: { retentionLevel?: "retain" | "none" | null },
): Promise<unknown> {
	// Fail closed on retention: unless the organization is explicitly known to
	// retain data, strip the request/response payload fields here — before the
	// row is ever published to the log queue — so large prompts, completions, and
	// tool payloads never travel through Redis. Any omitted, null, or unresolved
	// retention level is treated as non-retaining, since the worker no longer
	// performs a fallback strip and this is the last chance to withhold payloads.
	if (options?.retentionLevel !== "retain") {
		logData = stripRetentionSensitiveLogFields(logData);
	}

	// Stealth providers: the raw upstream error may reveal the underlying
	// platform, so it survives only in internalErrorDetails — a column excluded
	// from public API routes and the UI — while the public errorDetails keeps
	// just the upstream status code.
	if (logData.errorDetails && shouldRedactProviderError(logData.usedProvider)) {
		logData.internalErrorDetails = logData.errorDetails;
		logData.errorDetails = redactErrorDetails(logData.errorDetails);
	}

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
		finishReason: logData.finishReason ?? null,
		streaming: logData.streamed ?? false,
		durationMs: logData.duration || 0,
		// Reasoning models stream thinking before any content, so the first
		// reasoning token is the real first-token latency when present.
		ttftMs:
			logData.timeToFirstReasoningToken ??
			logData.timeToFirstToken ??
			undefined,
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

	// Maintain per-org daily/monthly spend-cap counters. Single DRY chokepoint
	// for every request path; swallows its own Redis errors so logging is never
	// blocked.
	await recordSpend(logData.organizationId, organizationBilledCost(logData));

	await publishToQueue(LOG_QUEUE, logData);
	return 1; // Return 1 to match test expectations
}
