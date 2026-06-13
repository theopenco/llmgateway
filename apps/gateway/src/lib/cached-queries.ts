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
	isNull,
	ne,
	or,
	cdb as db,
	apiKey as apiKeyTable,
	apiKeyIamRule as apiKeyIamRuleTable,
	discount as discountTable,
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
import type { EffectiveDiscount } from "@llmgateway/db";
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
const discountTableName = getTableName(discountTable);
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

// TTL for the "fresh" credit/balance refetch below. A zero-credit org or
// zero-balance wallet otherwise refetches on EVERY request; under high
// throughput that is one Postgres SELECT per request (and the DB pool, max 20,
// saturates). A short TTL still reflects topups/debits within FRESH_TTL_SECONDS
// while collapsing per-request DB load to at most one query per window per row.
const FRESH_TTL_SECONDS = 2;

/**
 * Find an organization by ID with a short-TTL fresh read (for near-fresh credit
 * checks when the org shows <= 0 credits). Uses a distinct Drizzle cache tag AND
 * a distinct SWR mirror key (`org:fresh:${id}`) so it does not collide with the
 * longer-lived `findOrganizationById` entry. The distinct mirror key matters:
 * sharing it would let the (possibly stale-zero) regular read claim the mirror
 * write-throttle slot and suppress this fresh value's mirror write, so a DB
 * outage right after a topup could keep serving the stale-zero fallback.
 */
export async function findOrganizationByIdFresh(
	id: string,
): Promise<Organization | undefined> {
	return await swrWrap(`org:fresh:${id}`, [organizationTableName], async () => {
		const results = await db
			.select()
			.from(organizationTable)
			.where(eq(organizationTable.id, id))
			.limit(1)
			.$withCache({
				tag: `org-fresh:${id}`,
				autoInvalidate: false,
				config: { ex: FRESH_TTL_SECONDS },
			});
		return results[0];
	});
}

/**
 * Find an organization by ID (cacheable)
 * When the organization has 0 credits, refetch via a short-TTL fresh read so
 * topups and usage updates are reflected within FRESH_TTL_SECONDS without
 * hitting Postgres on every request.
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

	// If org has 0 or negative credits, refetch via the short-TTL fresh read
	// so topups are reflected promptly without a per-request Postgres hit
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
			return await findOrganizationByIdFresh(id);
		}
	}

	return org;
}

/**
 * Find an end-user wallet by ID with a short-TTL fresh read (for near-fresh
 * balance checks when the wallet shows <= 0 balance). Uses a distinct Drizzle
 * cache tag AND a distinct SWR mirror key (`wallet:fresh:${id}`) so it does not
 * collide with the longer-lived `findWalletById` entry — see
 * `findOrganizationByIdFresh` for why the distinct mirror key matters.
 */
export async function findWalletByIdFresh(
	id: string,
): Promise<Wallet | undefined> {
	return await swrWrap(`wallet:fresh:${id}`, [walletTableName], async () => {
		const results = await db
			.select()
			.from(walletTable)
			.where(eq(walletTable.id, id))
			.limit(1)
			.$withCache({
				tag: `wallet-fresh:${id}`,
				autoInvalidate: false,
				config: { ex: FRESH_TTL_SECONDS },
			});
		return results[0];
	});
}

/**
 * Find an end-user wallet by ID (cacheable). Mirrors findOrganizationById: when
 * the wallet balance is 0 or negative, refetch via a short-TTL fresh read so
 * top-ups and usage debits are reflected promptly without a per-request DB hit.
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
		return await findWalletByIdFresh(id);
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
 * Get the effective discount for an org/provider/model combination (SWR-cached).
 * Falls back to the last known Redis value when Postgres is unreachable.
 */
export async function findEffectiveDiscount(
	organizationId: string | null,
	provider: string,
	model: string,
): Promise<EffectiveDiscount> {
	const orgPart = organizationId ?? "global";
	return await swrWrap(
		`discount:${orgPart}:${provider}:${model}`,
		[discountTableName],
		async () => {
			// The expiry filter is applied in JS below, NOT in SQL: a `now` Date in
			// the WHERE clause becomes a query parameter, and the cached client keys
			// its cache on hashQuery(sql, params). A per-request millisecond `now`
			// would make that key unique every call, so the cache would never hit and
			// this (hot, per-provider-candidate) lookup would query Postgres on every
			// request. Keeping the SQL time-independent lets the cache key stay stable
			// while expiry is still evaluated fresh on each call.
			const rows = await db
				.select({
					id: discountTable.id,
					organizationId: discountTable.organizationId,
					provider: discountTable.provider,
					model: discountTable.model,
					discountPercent: discountTable.discountPercent,
					expiresAt: discountTable.expiresAt,
				})
				.from(discountTable)
				.where(
					and(
						or(
							isNull(discountTable.organizationId),
							organizationId
								? eq(discountTable.organizationId, organizationId)
								: isNull(discountTable.organizationId),
						),
						or(
							eq(discountTable.provider, provider),
							isNull(discountTable.provider),
						),
						or(eq(discountTable.model, model), isNull(discountTable.model)),
					),
				);

			const now = Date.now();
			const discounts = rows.filter(
				// expiresAt is a Date on both a fresh query and a Drizzle cache hit
				// (the cache stores the raw pg result and re-applies the timestamp
				// parser on restore). Wrap in new Date() defensively so the compare
				// is robust even if a serialized value ever reaches here.
				(row) =>
					row.expiresAt === null || new Date(row.expiresAt).getTime() >= now,
			);

			const modelMatches = (discountModel: string | null): boolean =>
				discountModel !== null && discountModel === model;

			if (organizationId) {
				const orgProviderModel = discounts.find(
					(discount) =>
						discount.organizationId === organizationId &&
						discount.provider === provider &&
						modelMatches(discount.model),
				);
				if (orgProviderModel) {
					return {
						discount: orgProviderModel.discountPercent,
						source: "org_provider_model",
						discountId: orgProviderModel.id,
					};
				}

				const orgProvider = discounts.find(
					(discount) =>
						discount.organizationId === organizationId &&
						discount.provider === provider &&
						discount.model === null,
				);
				if (orgProvider) {
					return {
						discount: orgProvider.discountPercent,
						source: "org_provider",
						discountId: orgProvider.id,
					};
				}

				const orgModel = discounts.find(
					(discount) =>
						discount.organizationId === organizationId &&
						discount.provider === null &&
						modelMatches(discount.model),
				);
				if (orgModel) {
					return {
						discount: orgModel.discountPercent,
						source: "org_model",
						discountId: orgModel.id,
					};
				}
			}

			const globalProviderModel = discounts.find(
				(discount) =>
					discount.organizationId === null &&
					discount.provider === provider &&
					modelMatches(discount.model),
			);
			if (globalProviderModel) {
				return {
					discount: globalProviderModel.discountPercent,
					source: "global_provider_model",
					discountId: globalProviderModel.id,
				};
			}

			const globalProvider = discounts.find(
				(discount) =>
					discount.organizationId === null &&
					discount.provider === provider &&
					discount.model === null,
			);
			if (globalProvider) {
				return {
					discount: globalProvider.discountPercent,
					source: "global_provider",
					discountId: globalProvider.id,
				};
			}

			const globalModel = discounts.find(
				(discount) =>
					discount.organizationId === null &&
					discount.provider === null &&
					modelMatches(discount.model),
			);
			if (globalModel) {
				return {
					discount: globalModel.discountPercent,
					source: "global_model",
					discountId: globalModel.id,
				};
			}

			return {
				discount: "0",
				source: "none",
			};
		},
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
