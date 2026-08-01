import { isKeyScoped, type ApiKeyScope } from "@/utils/authorization.js";

import { and, inArray, or, type AnyColumn, type SQL } from "@llmgateway/db";

/**
 * Build the row filter for a table that carries both `projectId` and `apiKeyId`
 * (the log table and the api-key hourly rollups).
 *
 * Rows in projects where the caller is owner/admin pass unrestricted; rows in
 * projects where they are a developer only pass for keys they created.
 *
 * Returns `undefined` when the caller is privileged everywhere, so callers can
 * skip adding a redundant condition.
 */
export function apiKeyScopeFilter(
	scope: ApiKeyScope,
	projectIdColumn: AnyColumn,
	apiKeyIdColumn: AnyColumn,
): SQL | undefined {
	if (!isKeyScoped(scope)) {
		return undefined;
	}

	const restricted = scope.ownApiKeyIds.length
		? and(
				inArray(projectIdColumn, scope.restrictedProjectIds),
				inArray(apiKeyIdColumn, scope.ownApiKeyIds),
			)
		: undefined;

	if (!scope.privilegedProjectIds.length) {
		// Developer everywhere in scope. With no keys of their own, match nothing
		// rather than falling through to an unfiltered query.
		return restricted ?? inArray(apiKeyIdColumn, [""]);
	}

	const privileged = inArray(projectIdColumn, scope.privilegedProjectIds);
	return restricted ? or(privileged, restricted) : privileged;
}
