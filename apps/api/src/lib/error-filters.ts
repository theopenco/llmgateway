import { z } from "zod";

import { escapeLikePattern } from "@/lib/like-pattern.js";
import { incidentErrorsClause } from "@/lib/mapping-error-shapes.js";

import { db, sql, tables } from "@llmgateway/db";

// Which error classes count against a mapping. `non_client` (default) drops
// client-error logs from the sample; `client` drops every other failure, so
// both rate against successes plus the selected errors.
export const errorScopeSchema = z.enum(["non_client", "all", "client"]);

export type ErrorScope = z.infer<typeof errorScopeSchema>;

export function buildUnstableErrorScopeClause(scope: ErrorScope) {
	switch (scope) {
		case "all":
			return sql``;
		case "client":
			return sql`AND (${tables.log.hasError} IS NOT TRUE OR ${tables.log.unifiedFinishReason} = 'client_error')`;
		default:
			return sql`AND ${tables.log.unifiedFinishReason} IS DISTINCT FROM 'client_error'`;
	}
}

// Incident views count upstream and gateway errors; `all` adds client errors
// and `client` counts only those.
export function buildIncidentErrorScopeClause(scope: ErrorScope) {
	switch (scope) {
		case "all":
			return sql`AND ${tables.log.unifiedFinishReason} IN ('upstream_error', 'gateway_error', 'client_error')`;
		case "client":
			return sql`AND ${tables.log.unifiedFinishReason} = 'client_error'`;
		default:
			return incidentErrorsClause;
	}
}

interface IgnoredErrorMatcherTarget {
	pattern: string | null;
	statusCode: number | null;
}

// Builds an OR chain across all stored matchers so expected upstream errors
// can be treated as non-errors. A substring pattern is matched
// case-insensitively against the serialized error details JSON (covering
// status text, response body, and cause); a status code is matched against the
// upstream `statusCode` field. When a matcher has both, both must match.
export function buildIgnoredErrorMatchExpr(
	matchers: IgnoredErrorMatcherTarget[],
) {
	return sql.join(
		matchers.map((matcher) => {
			const conditions = [];
			if (matcher.pattern !== null) {
				conditions.push(
					sql`${tables.log.errorDetails}::text ILIKE ${`%${escapeLikePattern(matcher.pattern)}%`}`,
				);
			}
			if (matcher.statusCode !== null) {
				conditions.push(
					sql`${tables.log.errorDetails}->>'statusCode' = ${String(matcher.statusCode)}`,
				);
			}
			return sql`(${sql.join(conditions, sql` AND `)})`;
		}),
		sql` OR `,
	);
}

/** Drops errors matching any stored expected-error matcher. */
export function buildIgnoredErrorsClause(
	matchers: IgnoredErrorMatcherTarget[],
) {
	return matchers.length > 0
		? sql`AND NOT COALESCE((${buildIgnoredErrorMatchExpr(matchers)}), false)`
		: sql``;
}

// Case-insensitive substring match against the serialized public and internal
// error details JSON, so stealth-provider errors are searchable too.
export function buildErrorMessageMatchExpr(message: string) {
	const pattern = `%${escapeLikePattern(message)}%`;
	return sql`COALESCE(${tables.log.errorDetails}::text ILIKE ${pattern} OR ${tables.log.internalErrorDetails}::text ILIKE ${pattern}, false)`;
}

export async function listIgnoredErrorMatchers() {
	return await db.query.ignoredErrorMatcher.findMany({
		orderBy: {
			createdAt: "desc",
		},
	});
}
