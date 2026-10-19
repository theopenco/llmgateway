import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

/**
 * Catalogue model id of a `used_model` value (`provider/model[:region]`; model
 * ids may contain slashes). Keys `log_error_project_id_created_at_idx`, so
 * filters must use this exact expression to stay indexable.
 */
export function rootModelIdSql(usedModel: SQLWrapper): SQL<string> {
	return sql<string>`split_part(regexp_replace(${usedModel}, '^[^/]*/', ''), ':', 1)`;
}

/**
 * Rows flagged as errors or ending in an error finish reason. The predicate of
 * `log_error_project_id_created_at_idx`; values are inlined, not bound, so the
 * planner can prove a query uses that partial index under a generic plan.
 */
export function logErrorSql(log: {
	hasError: SQLWrapper;
	unifiedFinishReason: SQLWrapper;
}): SQL {
	return sql`(${log.hasError} = true OR ${log.unifiedFinishReason} IN ('client_error', 'gateway_error', 'upstream_error'))`;
}
