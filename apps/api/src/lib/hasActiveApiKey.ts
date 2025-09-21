import { db, tables, eq, and } from "./db.js";

/**
 * Check if a user has at least one active (non-revoked) API key
 * @param userId - The user ID to check
 * @returns Promise<boolean> - true if user has unlimited access
 */
export async function hasActiveApiKey(userId: string): Promise<boolean> {
	// Use direct join query to efficiently check for active API keys
	const activeApiKeys = await db
		.select({
			apiKeyId: tables.apiKey.id,
		})
		.from(tables.userOrganization)
		.innerJoin(
			tables.organization,
			eq(tables.userOrganization.organizationId, tables.organization.id),
		)
		.innerJoin(
			tables.project,
			eq(tables.organization.id, tables.project.organizationId),
		)
		.innerJoin(tables.apiKey, eq(tables.project.id, tables.apiKey.projectId))
		.where(
			and(
				eq(tables.userOrganization.userId, userId),
				eq(tables.project.status, "active"),
				eq(tables.apiKey.status, "active"),
			),
		)
		.limit(1);

	return activeApiKeys.length > 0;
}
