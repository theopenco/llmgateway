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
	desc,
	eq,
	getTableName,
	gte,
	inArray,
	isNull,
	ne,
	or,
	sql,
	cdb as db,
	apiKey as apiKeyTable,
	apiKeyHourlyStats as apiKeyHourlyStatsTable,
	apiKeyIamRule as apiKeyIamRuleTable,
	customModel as customModelTable,
	endCustomer as endCustomerTable,
	endUserSession as endUserSessionTable,
	getEffectiveDiscount,
	getEffectiveRateLimit,
	addApiKeyPeriodDuration,
	organizationCacheTag,
	providerKeyAllowsModel,
	organization as organizationTable,
	project as projectTable,
	computeAirsideAdjustment,
	providerClaim as providerClaimTable,
	providerDraftModel as providerDraftModelTable,
	providerRoutingSettings as providerRoutingSettingsTable,
	providerPriceFiling as providerPriceFilingTable,
	providerKey as providerKeyTable,
	routingScoreMultiplier as routingScoreMultiplierTable,
	user as userTable,
	userIamRule as userIamRuleTable,
	userOrganization as userOrganizationTable,
	wallet as walletTable,
} from "@llmgateway/db";
import {
	getRegionScopedDefaultRegion,
	staticCatalogueMapsModel,
} from "@llmgateway/models";

import {
	getApiKeyFingerprint,
	getApiKeyFingerprints,
} from "./api-key-fingerprint.js";
import {
	calculateUptimePenalty,
	getTrackedKeyMetrics,
	isTrackedKeyHealthy,
} from "./api-key-health.js";

import type { ApiKeyPeriodDurationUnit } from "@llmgateway/db";
import type { EffectiveRateLimit } from "@llmgateway/db";
import type { EffectiveDiscount } from "@llmgateway/db";
import type { InferSelectModel } from "@llmgateway/db";
import type {
	apiKey,
	apiKeyIamRule,
	customModel,
	endUserSession,
	organization,
	project,
	providerKey,
	user,
	userIamRule,
	userOrganization,
	wallet,
} from "@llmgateway/db";
import type { EnvVarVariant } from "@llmgateway/models";

// Type aliases for cleaner function signatures
type ApiKey = InferSelectModel<typeof apiKey>;
type EndUserSession = InferSelectModel<typeof endUserSession>;
type ApiKeyIamRule = InferSelectModel<typeof apiKeyIamRule>;
type UserIamRule = InferSelectModel<typeof userIamRule>;
export type CustomModel = InferSelectModel<typeof customModel>;
type Organization = InferSelectModel<typeof organization>;
type Project = InferSelectModel<typeof project>;
type ProviderKey = InferSelectModel<typeof providerKey>;
export interface AirsideListedModel {
	model: InferSelectModel<typeof providerDraftModelTable>;
	pricing: InferSelectModel<typeof providerPriceFilingTable>;
}
type User = InferSelectModel<typeof user>;
type UserOrganization = InferSelectModel<typeof userOrganization>;
type Wallet = InferSelectModel<typeof wallet>;

const apiKeyTableName = getTableName(apiKeyTable);
const apiKeyHourlyStatsTableName = getTableName(apiKeyHourlyStatsTable);
const apiKeyIamRuleTableName = getTableName(apiKeyIamRuleTable);
const endCustomerTableName = getTableName(endCustomerTable);
const endUserSessionTableName = getTableName(endUserSessionTable);
const organizationTableName = getTableName(organizationTable);
const projectTableName = getTableName(projectTable);
const providerKeyTableName = getTableName(providerKeyTable);
const customModelTableName = getTableName(customModelTable);
const providerClaimTableName = getTableName(providerClaimTable);
const providerRoutingSettingsTableName = getTableName(
	providerRoutingSettingsTable,
);
const providerDraftModelTableName = getTableName(providerDraftModelTable);
const providerPriceFilingTableName = getTableName(providerPriceFilingTable);
const routingScoreMultiplierTableName = getTableName(
	routingScoreMultiplierTable,
);
const userTableName = getTableName(userTable);
const userIamRuleTableName = getTableName(userIamRuleTable);
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
	const tokenHashes = getApiKeyFingerprints(token);
	const key = await swrWrap(
		`apiKey:token:${tokenHashes.join(":")}`,
		[apiKeyTableName],
		async () => {
			const results = await db
				.select()
				.from(apiKeyTable)
				.where(
					and(
						or(
							eq(apiKeyTable.token, token),
							inArray(apiKeyTable.tokenHash, tokenHashes),
						),
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
				.where(
					or(
						eq(endUserSessionTable.token, token),
						inArray(endUserSessionTable.tokenHash, tokenHashes),
					),
				)
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
 * Find an organization by ID using only the cached path (no 0-credit bypass).
 *
 * Use this when a slightly stale view is acceptable and a guaranteed cache hit
 * matters more than fresh credits (e.g. checking the org `plan` for rate
 * limiting). For credit/billing decisions use {@link findOrganizationById},
 * which refetches via a short-TTL fresh read when credits are exhausted.
 */
export async function findOrganizationCachedById(
	id: string,
): Promise<Organization | undefined> {
	return await swrWrap(`org:${id}`, [organizationTableName], async () => {
		// Tagged per org so the worker can evict exactly this entry right after
		// debiting credits (it writes via the uncached client, so table-level
		// auto-invalidation never fires for those debits). This is what keeps
		// the credit gates near-fresh without shortening the cache TTL.
		const results = await db
			.select()
			.from(organizationTable)
			.where(eq(organizationTable.id, id))
			.limit(1)
			.$withCache({ tag: organizationCacheTag(id), autoInvalidate: true });
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
	const org = await findOrganizationCachedById(id);

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
				.orderBy(
					// Explicit position first (Postgres sorts ASC as NULLS LAST, so
					// unpositioned keys keep the age order they always had), then the
					// original createdAt/id tiebreak. Index 0 of this array is what
					// selectProviderKeyWithFailover treats as the primary key.
					asc(providerKeyTable.sortOrder),
					asc(providerKeyTable.createdAt),
					asc(providerKeyTable.id),
				),
	);
	return selectProviderKeyWithFailover(results, selectionScope, excludedKeyIds);
}

/**
 * Find a single active custom model catalog entry for a provider key (cacheable).
 *
 * Custom models are matched by exact `modelName` (the id used after the provider
 * prefix). Returns undefined when no catalog entry exists for that model.
 */
export async function findCustomModel(
	providerKeyId: string,
	modelName: string,
): Promise<CustomModel | undefined> {
	const results = await swrWrap(
		`customModel:${providerKeyId}:${modelName}`,
		[customModelTableName],
		async () =>
			await db
				.select()
				.from(customModelTable)
				.where(
					and(
						eq(customModelTable.status, "active"),
						eq(customModelTable.providerKeyId, providerKeyId),
						eq(customModelTable.modelName, modelName),
					),
				)
				.limit(1),
	);
	return results[0];
}

/**
 * Find an active Airside-listed model for a catalogue provider, together with
 * its latest approved price filing. This is what makes approved carrier
 * listings routable: a "provider/model" request that misses the static
 * catalogue is resolved here instead.
 */
export async function findAirsideModel(
	providerId: string,
	modelName: string,
): Promise<AirsideListedModel | undefined> {
	const results = await swrWrap(
		`airsideModel:${providerId}:${modelName}`,
		[providerDraftModelTableName, providerPriceFilingTableName],
		async () =>
			await db
				.select({
					model: providerDraftModelTable,
					pricing: providerPriceFilingTable,
				})
				.from(providerDraftModelTable)
				.innerJoin(
					providerPriceFilingTable,
					and(
						eq(
							providerPriceFilingTable.draftModelId,
							providerDraftModelTable.id,
						),
						eq(providerPriceFilingTable.status, "approved"),
					),
				)
				.where(
					and(
						eq(providerDraftModelTable.status, "active"),
						eq(providerDraftModelTable.providerId, providerId),
						eq(providerDraftModelTable.modelName, modelName),
					),
				)
				.orderBy(desc(providerPriceFilingTable.createdAt))
				.limit(1),
	);
	return results[0];
}

export interface AirsideCustomCarrier {
	providerId: string;
	name: string;
	baseUrl: string;
}

/**
 * The active custom-carrier registration behind a non-catalogue provider
 * prefix, if any. Custom carriers exist only in the DB: their listings route
 * to the OpenAI-compatible endpoint registered on the approved claim.
 */
export async function findAirsideCustomProvider(
	providerId: string,
): Promise<AirsideCustomCarrier | undefined> {
	const rows = await swrWrap(
		`airsideCustomProvider:${providerId}`,
		[providerClaimTableName],
		async () =>
			await db
				.select({
					providerId: providerClaimTable.providerId,
					customName: providerClaimTable.customName,
					customBaseUrl: providerClaimTable.customBaseUrl,
				})
				.from(providerClaimTable)
				.where(
					and(
						eq(providerClaimTable.providerId, providerId),
						eq(providerClaimTable.kind, "custom"),
						eq(providerClaimTable.status, "active"),
					),
				)
				.limit(1),
	);
	const row = rows[0];
	if (!row?.customBaseUrl) {
		return undefined;
	}
	return {
		providerId: row.providerId,
		name: row.customName ?? row.providerId,
		baseUrl: row.customBaseUrl,
	};
}

/**
 * Active Airside listings for a bare model name across all carriers, newest
 * filing first per listing. /v1/models advertises listings under their bare
 * id, so a prefix-less request must resolve when it is unambiguous.
 */
export async function findAirsideModelsByBareName(
	modelName: string,
): Promise<AirsideListedModel[]> {
	const rows = await swrWrap(
		`airsideModelByName:${modelName}`,
		[providerDraftModelTableName, providerPriceFilingTableName],
		async () =>
			await db
				.select({
					model: providerDraftModelTable,
					pricing: providerPriceFilingTable,
				})
				.from(providerDraftModelTable)
				.innerJoin(
					providerPriceFilingTable,
					and(
						eq(
							providerPriceFilingTable.draftModelId,
							providerDraftModelTable.id,
						),
						eq(providerPriceFilingTable.status, "approved"),
					),
				)
				.where(
					and(
						eq(providerDraftModelTable.status, "active"),
						eq(providerDraftModelTable.modelName, modelName),
					),
				)
				.orderBy(desc(providerPriceFilingTable.createdAt)),
	);
	// One row per listing: the newest approved filing wins.
	const byListing = new Map<string, AirsideListedModel>();
	for (const row of rows) {
		if (!byListing.has(row.model.id)) {
			byListing.set(row.model.id, row);
		}
	}
	return Array.from(byListing.values());
}

/** Every active Airside listing with its latest approved filing, for the
 *  /v1/models catalogue. Deduped to one row per listing. */
export async function listAirsideModels(): Promise<AirsideListedModel[]> {
	const rows = await swrWrap(
		"airsideModels:all",
		[providerDraftModelTableName, providerPriceFilingTableName],
		async () =>
			await db
				.select({
					model: providerDraftModelTable,
					pricing: providerPriceFilingTable,
				})
				.from(providerDraftModelTable)
				.innerJoin(
					providerPriceFilingTable,
					and(
						eq(
							providerPriceFilingTable.draftModelId,
							providerDraftModelTable.id,
						),
						eq(providerPriceFilingTable.status, "approved"),
					),
				)
				.where(eq(providerDraftModelTable.status, "active"))
				.orderBy(desc(providerPriceFilingTable.createdAt)),
	);
	const seen = new Set<string>();
	const deduped: AirsideListedModel[] = [];
	for (const row of rows) {
		if (!seen.has(row.model.id)) {
			seen.add(row.model.id);
			deduped.push(row);
		}
	}
	return deduped;
}

/** Find every active custom model catalog entry for an organization. */
export async function findActiveCustomModels(
	organizationId: string,
): Promise<CustomModel[]> {
	return await swrWrap(
		`customModel:active:${organizationId}`,
		[customModelTableName],
		async () =>
			await db
				.select()
				.from(customModelTable)
				.where(
					and(
						eq(customModelTable.status, "active"),
						eq(customModelTable.organizationId, organizationId),
					),
				),
	);
}

/**
 * The organization's own keys for a provider that can serve this request, in
 * selection order (index 0 is the primary). This is exactly the candidate set
 * findProviderKey picks from, before health failover and per-attempt
 * exclusions narrow it — the "which of my keys could have been used" answer
 * surfaced in routing metadata.
 */
export async function listEligibleProviderKeys(
	organizationId: string,
	provider: string,
	filter?: (key: ProviderKey) => boolean,
): Promise<ProviderKey[]> {
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
				.orderBy(
					// Explicit position first (Postgres sorts ASC as NULLS LAST, so
					// unpositioned keys keep the age order they always had), then the
					// original createdAt/id tiebreak. Index 0 of this array is what
					// selectProviderKeyWithFailover treats as the primary key.
					asc(providerKeyTable.sortOrder),
					asc(providerKeyTable.createdAt),
					asc(providerKeyTable.id),
				),
	);
	return filter ? results.filter(filter) : results;
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
	const eligible = await listEligibleProviderKeys(
		organizationId,
		provider,
		filter,
	);
	return selectProviderKeyWithFailover(
		eligible,
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
				.orderBy(
					// Explicit position first (Postgres sorts ASC as NULLS LAST, so
					// unpositioned keys keep the age order they always had), then the
					// original createdAt/id tiebreak. Index 0 of this array is what
					// selectProviderKeyWithFailover treats as the primary key.
					asc(providerKeyTable.sortOrder),
					asc(providerKeyTable.createdAt),
					asc(providerKeyTable.id),
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
				.orderBy(
					// Explicit position first (Postgres sorts ASC as NULLS LAST, so
					// unpositioned keys keep the age order they always had), then the
					// original createdAt/id tiebreak. Index 0 of this array is what
					// selectProviderKeyWithFailover treats as the primary key.
					asc(providerKeyTable.sortOrder),
					asc(providerKeyTable.createdAt),
					asc(providerKeyTable.id),
				),
	);
}

export interface FindManagedProviderKeyOptions {
	/**
	 * Env-var variant the organization maps to. A credential configured for the
	 * variant wins; when none exists the shared `default` credentials serve the
	 * request, mirroring how `{ENV}__ENTERPRISE` falls back to `{ENV}`.
	 */
	variant?: EnvVarVariant;
	/**
	 * Region the request routes to. Region-scoped credentials win for their own
	 * region; region-agnostic ones (region IS NULL) serve everything else,
	 * mirroring `{ENV}__{REGION}` falling back to `{ENV}`.
	 */
	region?: string;
	selectionScope?: string;
	excludedKeyIds?: ReadonlySet<string>;
	filter?: (key: ProviderKey) => boolean;
}

/**
 * Every active platform-managed credential for a provider (cacheable). These
 * rows are the database-backed replacement for the `LLM_*` environment
 * variables: they are not owned by any organization and carry their own base
 * URL, project, region and other provider settings.
 */
export async function listManagedProviderKeys(
	provider: string,
): Promise<ProviderKey[]> {
	return await swrWrap(
		`providerKey:managed:${provider}`,
		[providerKeyTableName],
		async () =>
			await db
				.select()
				.from(providerKeyTable)
				.where(
					and(
						eq(providerKeyTable.status, "active"),
						eq(providerKeyTable.managed, true),
						eq(providerKeyTable.provider, provider),
					),
				)
				.orderBy(
					// Explicit position first (Postgres sorts ASC as NULLS LAST, so
					// unpositioned keys keep the age order they always had), then the
					// original createdAt/id tiebreak. Index 0 of this array is what
					// selectProviderKeyWithFailover treats as the primary key.
					asc(providerKeyTable.sortOrder),
					asc(providerKeyTable.createdAt),
					asc(providerKeyTable.id),
				),
	);
}

/**
 * Whether the provider has any active managed credential at all — regardless of
 * variant, region or model restrictions.
 *
 * Managed credentials do not sit alongside the provider's `LLM_*` environment
 * variables, they replace them: once a single one exists, the environment is
 * ignored for that provider everywhere — routing, credential selection and
 * every fallback. A request no managed credential can serve therefore fails
 * instead of quietly spending an env key the operator has already superseded.
 */
export async function hasManagedProviderCredential(
	provider: string,
): Promise<boolean> {
	return (await listManagedProviderKeys(provider)).length > 0;
}

/**
 * Narrow a provider's managed credentials to the ones that can serve this
 * region.
 *
 * With a region in hand, a credential pinned to it wins and a region-agnostic
 * one is the fallback — the same precedence `{ENV}__{REGION}` has over `{ENV}`.
 *
 * Without one, the request is sent to the provider's default region. A
 * region-agnostic credential still serves it, and so does one pinned to that
 * default region — which is all a provider with no global region can offer,
 * since every one of its credentials is necessarily region-scoped (Alibaba).
 * Providers whose credential works across regions (AWS Bedrock) are excluded
 * from that last step by `getRegionScopedDefaultRegion`: a region on their
 * credential is the operator scoping it deliberately, so the request fails
 * rather than borrowing a credential meant for another region.
 */
function narrowManagedKeysToRegion(
	keys: ProviderKey[],
	provider: string,
	region: string | undefined,
): ProviderKey[] {
	if (region) {
		const pinned = keys.filter((key) => key.region === region);
		return pinned.length > 0 ? pinned : keys.filter((key) => !key.region);
	}

	const regionAgnostic = keys.filter((key) => !key.region);
	if (regionAgnostic.length > 0) {
		return regionAgnostic;
	}

	const defaultRegion = getRegionScopedDefaultRegion(provider);
	return defaultRegion
		? keys.filter((key) => key.region === defaultRegion)
		: [];
}

/**
 * Find a platform-managed provider credential for credits-mode traffic
 * (cacheable).
 *
 * Returns undefined when no managed credential can serve the request. Callers
 * must not read the environment in that case unless
 * `hasManagedProviderCredential` is false — see its comment.
 */
export async function findManagedProviderKey(
	provider: string,
	options: FindManagedProviderKeyOptions = {},
): Promise<ProviderKey | undefined> {
	const results = await listManagedProviderKeys(provider);

	const candidates = options.filter ? results.filter(options.filter) : results;
	if (candidates.length === 0) {
		return undefined;
	}

	const variant = options.variant ?? "default";
	const variantMatches = candidates.filter((key) => key.variant === variant);
	const byVariant =
		variantMatches.length > 0
			? variantMatches
			: candidates.filter((key) => key.variant === "default");

	const byRegion = narrowManagedKeysToRegion(
		byVariant,
		provider,
		options.region,
	);

	return selectProviderKeyWithFailover(
		byRegion,
		options.selectionScope,
		options.excludedKeyIds,
	);
}

/**
 * What the platform-managed credential fleet can serve, as routing needs it
 * (cacheable).
 *
 * `configured` is the authority on whether a provider still reads its `LLM_*`
 * environment variables at all: any active managed credential supersedes them
 * entirely, so routing must decide that provider purely from `usable` /
 * `pinnedRegions` and never consult the environment for it.
 *
 * `usable` mirrors how `findManagedProviderKey` selects, on both axes, because
 * a provider advertised there that then has no selectable credential fails the
 * request outright: `resolvePlatformCredential` has no environment to fall back
 * to for a configured provider, and credential resolution happens outside the
 * provider-fallback loop so nothing recovers.
 *
 * - Variant: an `enterprise`/`plans` request may fall back to a `default`
 *   credential, but a `default` request can never use a variant-scoped one,
 *   and a variant that has its own credentials never falls back.
 * - Region: routing picks a provider before a region is known, so a request
 *   that resolves no region is served from the provider's default region. Both
 *   a region-agnostic credential (`usable`) and one pinned to that default
 *   region (`defaultRegionUsable`) can therefore serve it; a credential pinned
 *   to any other region cannot, exactly like `{ENV}__{REGION}`, which
 *   `hasProviderEnvironmentToken` ignores in favour of the base variable. Which
 *   regions those credentials do cover is reported separately in
 *   `pinnedRegions`, for the region filter that runs before a provider is
 *   chosen.
 * - Model: a credential restricted via `allowedModels` cannot serve any other
 *   model, so when the caller knows the model it is routing, credentials that
 *   exclude it are ignored — a provider whose every credential excludes the
 *   model is not advertised for it.
 */
export interface ManagedProviderAvailability {
	/**
	 * Providers with at least one active managed credential, whatever its
	 * variant, region or model restriction. Their `LLM_*` variables are ignored.
	 */
	configured: ReadonlySet<string>;
	/** Providers a region-agnostic managed credential can serve for this request. */
	usable: ReadonlySet<string>;
	/**
	 * Providers whose credential for this request is pinned to their own default
	 * region. They serve every request that resolves no region — which is what a
	 * provider with no global region, such as Alibaba, can only ever offer — but,
	 * unlike `usable`, they cover no other region.
	 */
	defaultRegionUsable: ReadonlySet<string>;
	/**
	 * Regions each provider has a region-pinned managed credential for. Variant-
	 * and model-agnostic, matching how `hasRegionSpecificEnvKey` reads the
	 * environment: the region filter runs before either is known.
	 */
	pinnedRegions: ReadonlyMap<string, ReadonlySet<string>>;
}

export async function findManagedProviderAvailability(
	variant?: EnvVarVariant,
	modelId?: string,
): Promise<ManagedProviderAvailability> {
	// Fetched whole and narrowed in memory so the request's variant stays out
	// of the cache key, the same way findManagedProviderKey keeps variant,
	// region and exclusions out of its own.
	const rows = await swrWrap(
		`providerKey:managedProviderScopes`,
		[providerKeyTableName],
		async () =>
			await db
				.select({
					provider: providerKeyTable.provider,
					variant: providerKeyTable.variant,
					region: providerKeyTable.region,
					allowedModels: providerKeyTable.allowedModels,
				})
				.from(providerKeyTable)
				.where(
					and(
						eq(providerKeyTable.status, "active"),
						eq(providerKeyTable.managed, true),
					),
				),
	);

	const configured = new Set<string>();
	const pinnedRegions = new Map<string, Set<string>>();
	const byProvider = new Map<string, typeof rows>();
	for (const row of rows) {
		configured.add(row.provider);
		if (row.region) {
			const regions = pinnedRegions.get(row.provider);
			if (regions) {
				regions.add(row.region);
			} else {
				pinnedRegions.set(row.provider, new Set([row.region]));
			}
		}
		if (modelId && !providerKeyAllowsModel(row.allowedModels, modelId)) {
			continue;
		}
		const existing = byProvider.get(row.provider);
		if (existing) {
			existing.push(row);
		} else {
			byProvider.set(row.provider, [row]);
		}
	}

	const effectiveVariant = variant ?? "default";
	const usable = new Set<string>();
	const defaultRegionUsable = new Set<string>();
	for (const [provider, candidates] of byProvider) {
		const variantMatches = candidates.filter(
			(key) => key.variant === effectiveVariant,
		);
		const byVariant =
			variantMatches.length > 0
				? variantMatches
				: candidates.filter((key) => key.variant === "default");

		if (byVariant.some((key) => !key.region)) {
			usable.add(provider);
		}
		const defaultRegion = getRegionScopedDefaultRegion(provider);
		if (
			defaultRegion &&
			byVariant.some((key) => key.region === defaultRegion)
		) {
			defaultRegionUsable.add(provider);
		}
	}
	return { configured, usable, defaultRegionUsable, pinnedRegions };
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
 * Find all active member-level IAM rules for a user in an organization
 * (cacheable). These are the ceiling set by org owners/admins; API-key rules
 * can only further restrict within them.
 */
export async function findActiveUserIamRules(
	userId: string,
	organizationId: string,
): Promise<UserIamRule[]> {
	return await swrWrap(
		`userIamRules:${organizationId}:${userId}`,
		// Depend on user_organization too so membership changes (which cascade
		// rule deletion in Postgres without touching the rule table via cdb)
		// still invalidate this entry.
		[userIamRuleTableName, userOrganizationTableName],
		async () => {
			const rows = await db
				.select({ rule: userIamRuleTable })
				.from(userIamRuleTable)
				.innerJoin(
					userOrganizationTable,
					eq(userOrganizationTable.id, userIamRuleTable.userOrganizationId),
				)
				.where(
					and(
						eq(userOrganizationTable.userId, userId),
						eq(userOrganizationTable.organizationId, organizationId),
						eq(userIamRuleTable.status, "active"),
					),
				);
			return rows.map((row) => row.rule);
		},
	);
}

/**
 * Get the effective rate limits for an org/provider/model combination.
 *
 * Thin alias for {@link getEffectiveRateLimit}, which carries both cache
 * layers itself (cdb + an internal swrWrap on the same `rateLimit:*` key) so
 * every caller shares one cached implementation. Do NOT re-wrap this in
 * swrWrap: nesting the same key would deadlock the in-flight coalescer.
 */
export async function findEffectiveRateLimit(
	organizationId: string | null,
	provider: string,
	model: string,
): Promise<EffectiveRateLimit> {
	return await getEffectiveRateLimit(organizationId, provider, model, {
		// Carrier caps only apply when the Airside listing actually serves the
		// pair — an actively-mapped static model must stay unthrottled by them.
		includeCarrierCaps: !staticCatalogueMapsModel(provider, model, {
			activeOnly: true,
		}),
	});
}

/**
 * Get the effective discount for an org/provider/model combination.
 *
 * Thin alias for {@link getEffectiveDiscount}, which carries both cache layers
 * itself (cdb + an internal swrWrap on the same `discount:*` key) so every
 * caller — routing, billing, realtime — shares one cached implementation. Do
 * NOT re-wrap this in swrWrap: nesting the same key would deadlock the
 * in-flight coalescer.
 */
export async function findEffectiveDiscount(
	organizationId: string | null,
	provider: string,
	model: string,
): Promise<EffectiveDiscount> {
	return await getEffectiveDiscount(organizationId, provider, model);
}

export interface EffectiveRoutingScoreMultiplier {
	scoreMultiplier: string;
	source: "provider_model" | "provider" | "model" | "none";
	multiplierId?: string;
}

/**
 * Get the internal routing score adjustment for a provider/model combination.
 * The stable SQL shape is cached by Drizzle and the result is mirrored in SWR.
 */
/**
 * The routing-price adjustment produced by a carrier's own Airside settings
 * (accepted gateway margin + traffic discount). Deliberately separate from
 * routing_score_multiplier, which stays an admin-only prioritization knob —
 * the two combine additively at the scoring seam.
 */
export async function findAirsideRoutingAdjustment(
	provider: string,
): Promise<number> {
	const rows = await swrWrap(
		`airsideRouting:${provider}`,
		[providerRoutingSettingsTableName],
		async () =>
			await db
				.select({
					discountPercent: providerRoutingSettingsTable.discountPercent,
					marginPercent: providerRoutingSettingsTable.marginPercent,
				})
				.from(providerRoutingSettingsTable)
				.where(eq(providerRoutingSettingsTable.providerId, provider))
				.limit(1),
	);
	const row = rows[0];
	if (!row) {
		return 0;
	}
	return computeAirsideAdjustment(
		Number(row.discountPercent),
		Number(row.marginPercent),
	);
}

export async function findEffectiveRoutingScoreMultiplier(
	provider: string,
	model: string,
): Promise<EffectiveRoutingScoreMultiplier> {
	return await swrWrap(
		`routingScoreMultiplier:${provider}:${model}`,
		[routingScoreMultiplierTableName],
		async () => {
			const rows = await db
				.select({
					id: routingScoreMultiplierTable.id,
					provider: routingScoreMultiplierTable.provider,
					model: routingScoreMultiplierTable.model,
					scoreMultiplier: routingScoreMultiplierTable.scoreMultiplier,
					expiresAt: routingScoreMultiplierTable.expiresAt,
				})
				.from(routingScoreMultiplierTable)
				.where(
					and(
						or(
							eq(routingScoreMultiplierTable.provider, provider),
							isNull(routingScoreMultiplierTable.provider),
						),
						or(
							eq(routingScoreMultiplierTable.model, model),
							isNull(routingScoreMultiplierTable.model),
						),
					),
				);

			const now = Date.now();
			const multipliers = rows.filter(
				(row) =>
					row.expiresAt === null || new Date(row.expiresAt).getTime() >= now,
			);
			const providerModel = multipliers.find(
				(row) => row.provider === provider && row.model === model,
			);
			if (providerModel) {
				return {
					scoreMultiplier: providerModel.scoreMultiplier,
					source: "provider_model" as const,
					multiplierId: providerModel.id,
				};
			}

			const providerOnly = multipliers.find(
				(row) => row.provider === provider && row.model === null,
			);
			if (providerOnly) {
				return {
					scoreMultiplier: providerOnly.scoreMultiplier,
					source: "provider" as const,
					multiplierId: providerOnly.id,
				};
			}

			const modelOnly = multipliers.find(
				(row) => row.provider === null && row.model === model,
			);
			if (modelOnly) {
				return {
					scoreMultiplier: modelOnly.scoreMultiplier,
					source: "model" as const,
					multiplierId: modelOnly.id,
				};
			}

			return { scoreMultiplier: "0", source: "none" as const };
		},
	);
}

/**
 * Find a member's budget config on their user_organization row (cacheable).
 * Returns just the budget-limit columns; spend is read separately from the
 * durable per-key sources (never stored on this row).
 */
export type MemberBudget = Pick<
	UserOrganization,
	| "role"
	| "maxApiKeys"
	| "usageLimit"
	| "periodUsageLimit"
	| "periodUsageDurationValue"
	| "periodUsageDurationUnit"
>;

export async function findUserOrganizationBudget(
	userId: string,
	organizationId: string,
): Promise<MemberBudget | undefined> {
	return await swrWrap(
		`uoBudget:${organizationId}:${userId}`,
		[userOrganizationTableName],
		async () => {
			const results = await db
				.select({
					role: userOrganizationTable.role,
					maxApiKeys: userOrganizationTable.maxApiKeys,
					usageLimit: userOrganizationTable.usageLimit,
					periodUsageLimit: userOrganizationTable.periodUsageLimit,
					periodUsageDurationValue:
						userOrganizationTable.periodUsageDurationValue,
					periodUsageDurationUnit:
						userOrganizationTable.periodUsageDurationUnit,
				})
				.from(userOrganizationTable)
				.where(
					and(
						eq(userOrganizationTable.userId, userId),
						eq(userOrganizationTable.organizationId, organizationId),
					),
				)
				.limit(1);
			return results[0];
		},
	);
}

/**
 * Get the member's API keys and lifetime spend within an org (cacheable).
 * Lifetime spend is SUM(apiKey.usage) over ALL statuses so deleting a key can't
 * reset a member's cumulative spend.
 */
export async function getMemberKeyUsage(
	userId: string,
	organizationId: string,
): Promise<{ keyIds: string[]; lifetimeUsage: number }> {
	const rows = await swrWrap(
		`memberKeys:${organizationId}:${userId}`,
		[apiKeyTableName, projectTableName],
		async () =>
			await db
				.select({
					id: apiKeyTable.id,
					usage: apiKeyTable.usage,
				})
				.from(apiKeyTable)
				.innerJoin(projectTable, eq(projectTable.id, apiKeyTable.projectId))
				.where(
					and(
						eq(apiKeyTable.createdBy, userId),
						eq(projectTable.organizationId, organizationId),
					),
				),
	);

	return {
		keyIds: rows.map((row) => row.id),
		lifetimeUsage: rows.reduce((acc, row) => acc + Number(row.usage ?? 0), 0),
	};
}

/**
 * Get a member's period spend (cacheable). SUMs apiKeyHourlyStats.cost across the
 * member's keys over the current period.
 *
 * apiKeyHourlyStats is bucketed by hour, so the window is aligned to whole hourly
 * buckets. The current hour is floored (setMinutes(0,0,0)) for two reasons:
 *  - it rotates the SQL bind and swrWrap key at most once per hour — a live
 *    millisecond `now` would give a 0% cache hit rate (see findEffectiveDiscount);
 *  - it makes the window span exactly `value` units' worth of buckets. Subtracting
 *    the duration from the floored hour and then advancing one bucket yields
 *    [floor(now) - value + 1h, now]: the current partial bucket plus the preceding
 *    full ones. Without the +1h a 1h window at 10:59 would start at 09:00 and keep
 *    counting the whole 09:00 bucket (e.g. 09:05 spend) until 11:00 — an almost-2h
 *    effective window. This matches the fixed-window reset semantics of the per-key
 *    period limits rather than a sub-hour rolling window (unavailable at this
 *    granularity).
 */
export async function getMemberPeriodSpend(
	organizationId: string,
	userId: string,
	keyIds: string[],
	unit: ApiKeyPeriodDurationUnit,
	value: number,
	now: Date = new Date(),
): Promise<number> {
	if (keyIds.length === 0) {
		return 0;
	}

	const flooredHour = new Date(now);
	flooredHour.setMinutes(0, 0, 0);
	const windowStart = addApiKeyPeriodDuration(flooredHour, -value, unit);
	windowStart.setHours(windowStart.getHours() + 1);
	const flooredHourEpoch = flooredHour.getTime();

	// Fold the member's key set into the cache key: the SUM depends on which keys
	// belong to the member, so if that set changes the swr mirror must not serve a
	// stale value keyed only on org/user/hour. Compact djb2 hash keeps the key
	// bounded regardless of key count.
	let keyHash = 5381;
	for (const id of [...keyIds].sort()) {
		for (let i = 0; i < id.length; i++) {
			keyHash = (Math.imul(keyHash, 33) + id.charCodeAt(i)) | 0;
		}
	}

	const results = await swrWrap(
		`memberPeriod:${organizationId}:${userId}:${unit}:${value}:${flooredHourEpoch}:${keyHash}`,
		[apiKeyHourlyStatsTableName, apiKeyTableName, projectTableName],
		async () =>
			await db
				// cost is float4; SUM(real) accumulates in float4 too, so cast first.
				.select({
					total: sql<string>`coalesce(sum(cast(${apiKeyHourlyStatsTable.cost} as double precision)), 0)`,
				})
				.from(apiKeyHourlyStatsTable)
				.where(
					and(
						inArray(apiKeyHourlyStatsTable.apiKeyId, keyIds),
						gte(apiKeyHourlyStatsTable.hourTimestamp, windowStart),
					),
				),
	);

	return Number(results[0]?.total ?? 0);
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
