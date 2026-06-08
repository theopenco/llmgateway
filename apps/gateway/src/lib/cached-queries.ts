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
import { swrWrap } from "@llmgateway/cache";
import {
	and,
	asc,
	eq,
	getTableName,
	inArray,
	ne,
	cdb as db,
	db as uncachedDb,
	apiKey as apiKeyTable,
	apiKeyIamRule as apiKeyIamRuleTable,
	endCustomer as endCustomerTable,
	endUserSession as endUserSessionTable,
	getEffectiveRateLimit,
	organization as organizationTable,
	project as projectTable,
	providerKey as providerKeyTable,
	rateLimit as rateLimitTable,
	user as userTable,
	userOrganization as userOrganizationTable,
	wallet as walletTable,
} from "@llmgateway/db";

import { getApiKeyFingerprint } from "./api-key-fingerprint.js";
import {
	calculateUptimePenalty,
	getTrackedKeyMetrics,
	isTrackedKeyHealthy,
} from "./api-key-health.js";

import type { EffectiveRateLimit } from "@llmgateway/db";
import type { InferSelectModel } from "@llmgateway/db";
import type {
	apiKey,
	apiKeyIamRule,
	endUserSession,
	organization,
	project,
	providerKey,
	user,
	userOrganization,
	wallet,
} from "@llmgateway/db";

// Type aliases for cleaner function signatures
type ApiKey = InferSelectModel<typeof apiKey>;
type EndUserSession = InferSelectModel<typeof endUserSession>;
type ApiKeyIamRule = InferSelectModel<typeof apiKeyIamRule>;
type Organization = InferSelectModel<typeof organization>;
type Project = InferSelectModel<typeof project>;
type ProviderKey = InferSelectModel<typeof providerKey>;
type User = InferSelectModel<typeof user>;
type UserOrganization = InferSelectModel<typeof userOrganization>;
type Wallet = InferSelectModel<typeof wallet>;

const apiKeyTableName = getTableName(apiKeyTable);
const apiKeyIamRuleTableName = getTableName(apiKeyIamRuleTable);
const endCustomerTableName = getTableName(endCustomerTable);
const endUserSessionTableName = getTableName(endUserSessionTable);
const organizationTableName = getTableName(organizationTable);
const projectTableName = getTableName(projectTable);
const providerKeyTableName = getTableName(providerKeyTable);
const rateLimitTableName = getTableName(rateLimitTable);
const userTableName = getTableName(userTable);
const userOrganizationTableName = getTableName(userOrganizationTable);
const walletTableName = getTableName(walletTable);

function selectProviderKeyWithFailover<T extends { id: string }>(
	items: T[],
	selectionScope?: string,
	excludedKeyIds: ReadonlySet<string> = new Set(),
): T | undefined {
	const availableItems = items.filter((item) => !excludedKeyIds.has(item.id));

	if (availableItems.length === 0) {
		return undefined;
	}

	if (availableItems.length === 1) {
		return availableItems[0];
	}

	const healthyItems = availableItems
		.map((item, index) => ({
			item,
			index,
			metrics: getTrackedKeyMetrics(item.id, selectionScope),
		}))
		.filter(({ item }) => isTrackedKeyHealthy(item.id, selectionScope));

	if (healthyItems.length === 0) {
		return availableItems[0];
	}

	const primaryItem = healthyItems.find(({ index }) => index === 0);
	const bestScore = Math.min(
		...healthyItems.map(({ metrics }) =>
			calculateUptimePenalty(metrics.uptime),
		),
	);
	const SCORE_EPSILON = 0.01;

	if (
		primaryItem &&
		calculateUptimePenalty(primaryItem.metrics.uptime) <=
			bestScore + SCORE_EPSILON
	) {
		return primaryItem.item;
	}

	const selectedItem = [...healthyItems].sort(
		(a, b) =>
			calculateUptimePenalty(a.metrics.uptime) -
				calculateUptimePenalty(b.metrics.uptime) || a.index - b.index,
	)[0];

	return selectedItem?.item;
}

/**
 * Find an API key by token (cacheable)
 */
export type GatewayApiKey = ApiKey & {
	endUserSession?: {
		id: string;
		walletId: string;
		endCustomerId: string;
		expiresAt: Date;
		scope: EndUserSession["scope"];
		walletStatus: Wallet["status"];
		endCustomerStatus: string;
		projectStatus: Project["status"];
	};
};

export async function findApiKeyByToken(
	token: string,
): Promise<GatewayApiKey | undefined> {
	const key = await swrWrap(
		`apiKey:token:${getApiKeyFingerprint(token)}`,
		[apiKeyTableName],
		async () => {
			const results = await db
				.select()
				.from(apiKeyTable)
				.where(
					and(
						eq(apiKeyTable.token, token),
						ne(apiKeyTable.keyType, "end_user_customer"),
						ne(apiKeyTable.keyType, "platform_secret"),
					),
				)
				.limit(1);
			return results[0];
		},
	);

	if (key) {
		return key;
	}

	if (!token.startsWith("es_")) {
		return undefined;
	}

	return await swrWrap(
		`endUserSession:token:${getApiKeyFingerprint(token)}`,
		[
			endUserSessionTableName,
			apiKeyTableName,
			walletTableName,
			endCustomerTableName,
			projectTableName,
		],
		async () => {
			const rows = await db
				.select({
					session: endUserSessionTable,
					aggregateKey: apiKeyTable,
					wallet: walletTable,
					endCustomer: endCustomerTable,
					project: projectTable,
				})
				.from(endUserSessionTable)
				.innerJoin(
					walletTable,
					eq(walletTable.id, endUserSessionTable.walletId),
				)
				.innerJoin(
					endCustomerTable,
					eq(endCustomerTable.id, endUserSessionTable.endCustomerId),
				)
				.innerJoin(
					projectTable,
					eq(projectTable.id, endUserSessionTable.projectId),
				)
				.innerJoin(
					apiKeyTable,
					and(
						eq(apiKeyTable.projectId, endUserSessionTable.projectId),
						eq(apiKeyTable.keyType, "end_user_customer"),
						eq(apiKeyTable.endCustomerWalletId, endUserSessionTable.walletId),
						eq(apiKeyTable.status, "active"),
					),
				)
				.where(eq(endUserSessionTable.token, token))
				.limit(1);
			const row = rows[0];
			if (!row || row.session.status !== "active") {
				return undefined;
			}

			return {
				...row.aggregateKey,
				endCustomerWalletId: row.session.walletId,
				expiresAt: row.session.expiresAt,
				usageLimit: row.session.usageLimit,
				usage: row.session.usage,
				periodUsageLimit: row.session.periodUsageLimit,
				periodUsageDurationValue: row.session.periodUsageDurationValue,
				periodUsageDurationUnit: row.session.periodUsageDurationUnit,
				currentPeriodUsage: row.session.currentPeriodUsage,
				currentPeriodStartedAt: row.session.currentPeriodStartedAt,
				endUserSession: {
					id: row.session.id,
					walletId: row.session.walletId,
					endCustomerId: row.session.endCustomerId,
					expiresAt: row.session.expiresAt,
					scope: row.session.scope,
					walletStatus: row.wallet.status,
					endCustomerStatus: row.endCustomer.status,
					projectStatus: row.project.status,
				},
			};
		},
	);
}

/**
 * Find a project by ID (cacheable)
 */
export async function findProjectById(
	id: string,
): Promise<Project | undefined> {
	return await swrWrap(`project:${id}`, [projectTableName], async () => {
		const results = await db
			.select()
			.from(projectTable)
			.where(eq(projectTable.id, id))
			.limit(1);
		return results[0];
	});
}

/**
 * Find an organization by ID without cache (for fresh credit checks)
 */
export async function findOrganizationByIdUncached(
	id: string,
): Promise<Organization | undefined> {
	return await swrWrap(`org:${id}`, [organizationTableName], async () => {
		const results = await uncachedDb
			.select()
			.from(organizationTable)
			.where(eq(organizationTable.id, id))
			.limit(1);
		return results[0];
	});
}

/**
 * Find an organization by ID (cacheable)
 * When the organization has 0 credits, refetch without cache to ensure
 * no delay in reflecting topups and usage updates.
 */
export async function findOrganizationById(
	id: string,
): Promise<Organization | undefined> {
	const org = await swrWrap(`org:${id}`, [organizationTableName], async () => {
		const results = await db
			.select()
			.from(organizationTable)
			.where(eq(organizationTable.id, id))
			.limit(1);
		return results[0];
	});

	// If org has 0 or negative credits, refetch without cache
	// to ensure topups are reflected immediately
	if (org) {
		const regularCredits = parseFloat(org.credits || "0");
		const devPlanCreditsUsed = parseFloat(org.devPlanCreditsUsed || "0");
		const devPlanCreditsLimit = parseFloat(org.devPlanCreditsLimit || "0");
		const devPlanCreditsRemaining =
			org.devPlan !== "none" ? devPlanCreditsLimit - devPlanCreditsUsed : 0;
		const chatPlanCreditsUsed = parseFloat(org.chatPlanCreditsUsed || "0");
		const chatPlanCreditsLimit = parseFloat(org.chatPlanCreditsLimit || "0");
		const chatPlanCreditsRemaining =
			org.chatPlan !== "none" ? chatPlanCreditsLimit - chatPlanCreditsUsed : 0;
		const totalCredits =
			regularCredits + devPlanCreditsRemaining + chatPlanCreditsRemaining;

		if (totalCredits <= 0) {
			return await findOrganizationByIdUncached(id);
		}
	}

	return org;
}

/**
 * Find an end-user wallet by ID without cache (for fresh balance checks)
 */
export async function findWalletByIdUncached(
	id: string,
): Promise<Wallet | undefined> {
	return await swrWrap(`wallet:${id}`, [walletTableName], async () => {
		const results = await uncachedDb
			.select()
			.from(walletTable)
			.where(eq(walletTable.id, id))
			.limit(1);
		return results[0];
	});
}

/**
 * Find an end-user wallet by ID (cacheable). Mirrors findOrganizationById: when
 * the wallet balance is 0 or negative, refetch without cache so top-ups and
 * usage debits are reflected immediately.
 */
export async function findWalletById(id: string): Promise<Wallet | undefined> {
	const w = await swrWrap(`wallet:${id}`, [walletTableName], async () => {
		const results = await db
			.select()
			.from(walletTable)
			.where(eq(walletTable.id, id))
			.limit(1);
		return results[0];
	});

	if (w && parseFloat(w.balance || "0") <= 0) {
		return await findWalletByIdUncached(id);
	}

	return w;
}

/**
 * Find a custom provider key by organization, provider, and name (cacheable)
 */
export async function findCustomProviderKey(
	organizationId: string,
	customProviderName: string,
	selectionScope?: string,
	excludedKeyIds?: ReadonlySet<string>,
): Promise<ProviderKey | undefined> {
	const results = await swrWrap(
		`providerKey:custom:${organizationId}:${customProviderName}`,
		[providerKeyTableName],
		async () =>
			await db
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
				.orderBy(asc(providerKeyTable.createdAt), asc(providerKeyTable.id)),
	);
	return selectProviderKeyWithFailover(results, selectionScope, excludedKeyIds);
}

/**
 * Find a provider key by organization and provider (cacheable)
 */
export async function findProviderKey(
	organizationId: string,
	provider: string,
	selectionScope?: string,
	excludedKeyIds?: ReadonlySet<string>,
	filter?: (key: ProviderKey) => boolean,
): Promise<ProviderKey | undefined> {
	const results = await swrWrap(
		`providerKey:${organizationId}:${provider}`,
		[providerKeyTableName],
		async () =>
			await db
				.select()
				.from(providerKeyTable)
				.where(
					and(
						eq(providerKeyTable.status, "active"),
						eq(providerKeyTable.organizationId, organizationId),
						eq(providerKeyTable.provider, provider),
					),
				)
				.orderBy(asc(providerKeyTable.createdAt), asc(providerKeyTable.id)),
	);
	const filtered = filter ? results.filter(filter) : results;
	return selectProviderKeyWithFailover(
		filtered,
		selectionScope,
		excludedKeyIds,
	);
}

/**
 * Find all active provider keys for an organization (cacheable)
 */
export async function findActiveProviderKeys(
	organizationId: string,
): Promise<ProviderKey[]> {
	return await swrWrap(
		`providerKey:active:${organizationId}`,
		[providerKeyTableName],
		async () =>
			await db
				.select()
				.from(providerKeyTable)
				.where(
					and(
						eq(providerKeyTable.status, "active"),
						eq(providerKeyTable.organizationId, organizationId),
					),
				)
				.orderBy(asc(providerKeyTable.createdAt), asc(providerKeyTable.id)),
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
	const providersKey = providers.slice().sort().join(",");
	return await swrWrap(
		`providerKey:byProviders:${organizationId}:${providersKey}`,
		[providerKeyTableName],
		async () =>
			await db
				.select()
				.from(providerKeyTable)
				.where(
					and(
						eq(providerKeyTable.status, "active"),
						eq(providerKeyTable.organizationId, organizationId),
						inArray(providerKeyTable.provider, providers),
					),
				)
				.orderBy(asc(providerKeyTable.createdAt), asc(providerKeyTable.id)),
	);
}

/**
 * Find all active IAM rules for an API key (cacheable)
 */
export async function findActiveIamRules(
	apiKeyId: string,
): Promise<ApiKeyIamRule[]> {
	return await swrWrap(
		`iamRules:${apiKeyId}`,
		[apiKeyIamRuleTableName],
		async () =>
			await db
				.select()
				.from(apiKeyIamRuleTable)
				.where(
					and(
						eq(apiKeyIamRuleTable.apiKeyId, apiKeyId),
						eq(apiKeyIamRuleTable.status, "active"),
					),
				),
	);
}

/**
 * Get the effective rate limits for an org/provider/model combination (SWR-cached).
 * Falls back to the last known Redis value when Postgres is unreachable.
 */
export async function findEffectiveRateLimit(
	organizationId: string | null,
	provider: string,
	model: string,
): Promise<EffectiveRateLimit> {
	const orgPart = organizationId ?? "global";
	return await swrWrap(
		`rateLimit:${orgPart}:${provider}:${model}`,
		[rateLimitTableName],
		() => getEffectiveRateLimit(organizationId, provider, model),
	);
}

/**
 * Find the first user organization entry for an organization (cacheable)
 * Returns user organization with user data via a join
 */
export async function findUserFromOrganization(
	organizationId: string,
): Promise<{ userOrganization: UserOrganization; user: User } | undefined> {
	return await swrWrap(
		`userFromOrg:${organizationId}`,
		[userOrganizationTableName, userTableName],
		async () => {
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
		},
	);
}
