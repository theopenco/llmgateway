import {
	eq,
	inArray,
	or,
	type SQL,
	tables,
	UnifiedFinishReason,
} from "@llmgateway/db";

import type { LogErrorType } from "@llmgateway/shared";

const ERROR_FINISH_REASONS: string[] = [
	UnifiedFinishReason.CLIENT_ERROR,
	UnifiedFinishReason.GATEWAY_ERROR,
	UnifiedFinishReason.UPSTREAM_ERROR,
];

/**
 * `any` matches both the stored error flag and requests that ended in an error
 * finish reason without it (e.g. a 200 that aborted mid-stream).
 */
export function buildLogErrorFilter(
	errorType: LogErrorType | undefined,
): SQL | undefined {
	switch (errorType) {
		case "any":
			return or(
				eq(tables.log.hasError, true),
				inArray(tables.log.unifiedFinishReason, ERROR_FINISH_REASONS),
			);
		case "client_error":
		case "gateway_error":
		case "upstream_error":
			return eq(tables.log.unifiedFinishReason, errorType);
		default:
			return undefined;
	}
}
