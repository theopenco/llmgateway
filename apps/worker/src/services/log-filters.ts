import { log, sql } from "@llmgateway/db";

const usedModelWithRegionSql = sql<string>`split_part(${log.usedModel}, '/', 2)`;
const usedRegionSql = sql<
	string | null
>`nullif(split_part(${usedModelWithRegionSql}, ':', 2), '')`;

/**
 * Drop the failed attempt of a request that was retried and recovered on the
 * same provider and region.
 *
 * One logical request can write several `log` rows — one per attempt. Counting
 * every row would report a request twice for the same mapping when the retry
 * landed back where it started, which is exactly the case where the second row
 * carries no new information. Retries that moved to a different provider or
 * region are kept: those really are two distinct mappings serving one request.
 *
 * Every per-mapping rollup has to apply this identically, otherwise the same
 * requests are counted once in one table and twice in another.
 */
export function excludeRecoveredSameProviderRegionRetry() {
	return sql<boolean>`not (
		coalesce(${log.hasError}, false) = true
		and coalesce(${log.retried}, false) = true
		and exists (
			select 1
			from "log" as final_retry_log
			where final_retry_log.id = ${log.retriedByLogId}
				and final_retry_log.used_provider = ${log.usedProvider}
				and coalesce(final_retry_log.has_error, false) = false
				and nullif(
					split_part(split_part(final_retry_log.used_model, '/', 2), ':', 2),
					''
				) is not distinct from ${usedRegionSql}
		)
	)`;
}
