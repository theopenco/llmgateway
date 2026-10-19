import { logErrorSql, sql, type SQL, tables } from "@llmgateway/db";

import type { LogErrorType } from "@llmgateway/shared";

// Inlined rather than bound so the partial
// `log_error_project_id_created_at_idx` stays provably usable.
const SINGLE_REASON_SQL: Record<Exclude<LogErrorType, "all" | "any">, SQL> = {
	client_error: sql`${tables.log.unifiedFinishReason} = 'client_error'`,
	gateway_error: sql`${tables.log.unifiedFinishReason} = 'gateway_error'`,
	upstream_error: sql`${tables.log.unifiedFinishReason} = 'upstream_error'`,
};

/**
 * `any` matches both the stored error flag and requests that ended in an error
 * finish reason without it (e.g. a 200 that aborted mid-stream).
 */
export function buildLogErrorFilter(
	errorType: LogErrorType | undefined,
): SQL | undefined {
	switch (errorType) {
		case "any":
			return logErrorSql(tables.log);
		case "client_error":
		case "gateway_error":
		case "upstream_error":
			return SINGLE_REASON_SQL[errorType];
		default:
			return undefined;
	}
}
