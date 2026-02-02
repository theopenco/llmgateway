/**
 * Cached database queries for the gateway
 *
 * IMPORTANT: This module uses the select builder pattern (db.select().from())
 * instead of the relational query API (db.query.table.findFirst()) because
 * only the select builder pattern goes through Drizzle's cache layer.
 *
 * The relational query API does NOT use the cache, meaning those queries
 * will ALWAYS hit Postgres even with a configured cache.
 *
 * See: packages/db/src/cdb-resilience.spec.ts for documentation of this behavior.
 */
import {
	and,
	eq,
	inArray,
	cdb as db,
	apiKey as apiKeyTable,
	apiKeyIamRule as apiKeyIamRuleTable,
	organization as organizationTable,
	project as projectTable,
	providerKey as providerKeyTable,
	user as userTable,
	userOrganization as userOrganizationTable,
} from "@llmgateway/db";

import type { InferSelectModel } from "@llmgateway/db";
import type {
	apiKey,
	apiKeyIamRule,
	organization,
	project,
	providerKey,
	user,
	userOrganization,
} from "@llmgateway/db";

// Type aliases for cleaner function signatures
type ApiKey = InferSelectModel<typeof apiKey>;
type ApiKeyIamRule = InferSelectModel<typeof apiKeyIamRule>;
type Organization = InferSelectModel<typeof organization>;
type Project = InferSelectModel<typeof project>;
type ProviderKey = InferSelectModel<typeof providerKey>;
type User = InferSelectModel<typeof user>;
type UserOrganization = InferSelectModel<typeof userOrganization>;

/**
 * Find an API key by token (cacheable)
 */
export async function findApiKeyByToken(
	token: string,
): Promise<ApiKey | undefined> {
	const results = await db
		.select()
		.from(apiKeyTable)
		.where(eq(apiKeyTable.token, token))
		.limit(1);
	return results[0];
}

/**
 * Find a project by ID (cacheable)
 */
export async function findProjectById(
	id: string,
): Promise<Project | undefined> {
	const results = await db
		.select()
		.from(projectTable)
		.where(eq(projectTable.id, id))
		.limit(1);
	return results[0];
}

/**
 * Find an organization by ID (cacheable)
 */
export async function findOrganizationById(
	id: string,
): Promise<Organization | undefined> {
	const results = await db
		.select()
		.from(organizationTable)
		.where(eq(organizationTable.id, id))
		.limit(1);
	return results[0];
}

/**
 * Find a custom provider key by organization, provider, and name (cacheable)
 */
export async function findCustomProviderKey(
	organizationId: string,
	customProviderName: string,
): Promise<ProviderKey | undefined> {
	const results = await db
		.select()
		.from(providerKeyTable)
		.where(
			and(
				eq(providerKeyTable.status, "active"),
				eq(providerKeyTable.organizationId, organizationId),
				eq(providerKeyTable.provider, "custom"),
				eq(providerKeyTable.name, customProviderName),
			),
		)
		.limit(1);
	return results[0];
}

/**
 * Find a provider key by organization and provider (cacheable)
 */
export async function findProviderKey(
	organizationId: string,
	provider: string,
): Promise<ProviderKey | undefined> {
	const results = await db
		.select()
		.from(providerKeyTable)
		.where(
			and(
				eq(providerKeyTable.status, "active"),
				eq(providerKeyTable.organizationId, organizationId),
				eq(providerKeyTable.provider, provider),
			),
		)
		.limit(1);
	return results[0];
}

/**
 * Find all active provider keys for an organization (cacheable)
 */
export async function findActiveProviderKeys(
	organizationId: string,
): Promise<ProviderKey[]> {
	return await db
		.select()
		.from(providerKeyTable)
		.where(
			and(
				eq(providerKeyTable.status, "active"),
				eq(providerKeyTable.organizationId, organizationId),
			),
		);
}

/**
 * Find active provider keys for specific providers in an organization (cacheable)
 */
export async function findProviderKeysByProviders(
	organizationId: string,
	providers: string[],
): Promise<ProviderKey[]> {
	if (providers.length === 0) {
		return [];
	}
	return await db
		.select()
		.from(providerKeyTable)
		.where(
			and(
				eq(providerKeyTable.status, "active"),
				eq(providerKeyTable.organizationId, organizationId),
				inArray(providerKeyTable.provider, providers),
			),
		);
}

/**
 * Find all active IAM rules for an API key (cacheable)
 */
export async function findActiveIamRules(
	apiKeyId: string,
): Promise<ApiKeyIamRule[]> {
	return await db
		.select()
		.from(apiKeyIamRuleTable)
		.where(
			and(
				eq(apiKeyIamRuleTable.apiKeyId, apiKeyId),
				eq(apiKeyIamRuleTable.status, "active"),
			),
		);
}

/**
 * Find the first user organization entry for an organization (cacheable)
 * Returns user organization with user data via a join
 */
export async function findUserFromOrganization(
	organizationId: string,
): Promise<{ userOrganization: UserOrganization; user: User } | undefined> {
	const results = await db
		.select({
			userOrganization: userOrganizationTable,
			user: userTable,
		})
		.from(userOrganizationTable)
		.innerJoin(userTable, eq(userOrganizationTable.userId, userTable.id))
		.where(eq(userOrganizationTable.organizationId, organizationId))
		.limit(1);

	return results[0];
}
