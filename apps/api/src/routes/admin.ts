import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { deleteResendContact } from "@/auth/config.js";
import {
	cancelOrganizationSubscriptions,
	getCancelledOrganizationPlanState,
	isTerminalSubscriptionError,
} from "@/lib/account-deletion.js";
import { approveHighRiskUser } from "@/lib/account-risk.js";
import {
	ADMIN_REFUND_REASONS,
	computeAdminRefundability,
	executeAdminRefund,
	sumRefundsByTransaction,
} from "@/lib/admin-refund.js";
import {
	CREDIT_PURCHASE_BLOCK_SETTING_ID,
	isCreditPurchaseBlockEnabled,
	isCreditPurchaseBlockForcedByEnv,
} from "@/lib/credit-purchase-guard.js";
import {
	EnterpriseSeatLimitError,
	withEnterpriseSeatsForActivation,
	withEnterpriseSeatsForPromotion,
} from "@/lib/enterprise-seats.js";
import { modeSplitFields } from "@/lib/mode-split.js";
import { parseReferralBonusPercent } from "@/lib/referral-bonus.js";
import {
	getBucketUnitForWindow,
	getTokenWindowStartDate,
	tokenWindowSchema,
} from "@/lib/stats-window.js";
import {
	getForcedThreeDSecureMode,
	getThreeDSecureEnvOverride,
	setForcedThreeDSecureMode,
} from "@/lib/three-d-secure.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { getStripe } from "@/routes/payments.js";
import {
	getBlockedSignupCountries,
	normalizeCountryCodes,
	setBlockedSignupCountries,
} from "@/utils/country-blocking.js";
import {
	CHAT_PLAN_TX_TYPES,
	DEV_PLAN_SUBSCRIPTION_TX_TYPES,
	DEV_PLAN_TX_TYPES,
	firstRowPerInvoiceFilter,
	LEGACY_DEV_PLAN_TX_TYPES,
	notEndUserNonRevenueFilter,
	notEndUserWalletFilter,
	notPlanFilter,
	notRefundFilter,
	paidTransactionFilter,
	refundsCountedTopupFilter,
} from "@/utils/devpass-filter.js";
import {
	HOURLY_BUCKET_THRESHOLD_MINUTES,
	floorToHourStart,
	isHourlyRange,
	pickMappingHistoryTable,
	pickModelHistoryTable,
} from "@/utils/history-window.js";

import { getOrgTierQualifyingSpendUsd } from "@llmgateway/actions";
import { logAuditEvent } from "@llmgateway/audit";
import {
	aliasedTable,
	and,
	type AnyColumn,
	asc,
	avgEffectiveTtftSql,
	cdb,
	db,
	desc,
	effectiveTtftTotals,
	eq,
	excludeRegionalMappingRows,
	gte,
	inArray,
	isNotNull,
	isNull,
	lt,
	lte,
	ne,
	notInArray,
	or,
	sql,
	type SQLWrapper,
	tables,
	projectHourlyStats,
	projectHourlyModelStats,
	projectHourlySourceStats,
	globalModelStats,
	globalSourceStats,
	modelProviderMappingHistory,
	modelHistory,
	modelProviderMappingHistoryHourly,
	modelHistoryHourly,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { models, providers } from "@llmgateway/models";
import {
	CHAT_PLAN_PRICES,
	DEV_PLAN_PRICES,
	type DevPlanTier,
	getDevPlanPremiumWeeklyLimit,
	getIncludedResetPassesRemaining,
	MAX_BULK_BLOCK_ORGANIZATIONS,
	MIN_BULK_BLOCK_SEARCH_LENGTH,
	getOrgSpendTier,
	getPlanClass,
	parseUsedModel,
	resolveTrustTierOverride,
} from "@llmgateway/shared";
import {
	getResendClient,
	fromEmail,
	replyToEmail,
} from "@llmgateway/shared/email";
import { maskToken } from "@llmgateway/shared/mask-token";

import type { ServerTypes } from "@/vars.js";

function escapeHtml(text: string): string {
	const htmlEscapeMap: Record<string, string> = {
		"&": "&amp;",
		"<": "&lt;",
		">": "&gt;",
		'"': "&quot;",
		"'": "&#x27;",
	};
	return text.replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
}

// Search terms and stored matchers are plain substrings, so LIKE
// metacharacters must be escaped before wrapping them in wildcards. For the
// organization search this is a safety guard, not just correctness: an
// unescaped "%" would silently become a match-everything filter, and the bulk
// block endpoint reuses that filter to decide which organizations get banned.
function escapeLikePattern(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Builds the organization search filter shared by the listing and the bulk
 * block endpoints. Returns `undefined` for an empty search so callers must
 * decide explicitly what "no filter" means — the listing shows everything, the
 * bulk block endpoints reject the request.
 */
function buildOrganizationSearchFilter(search: string | undefined) {
	const trimmed = search?.trim();
	if (!trimmed) {
		return undefined;
	}

	const textPattern = `%${escapeLikePattern(trimmed.toLowerCase())}%`;
	const idPattern = `%${escapeLikePattern(trimmed)}%`;

	return or(
		sql`LOWER(${tables.organization.name}) LIKE ${textPattern} ESCAPE '\\'`,
		sql`LOWER(${tables.organization.billingEmail}) LIKE ${textPattern} ESCAPE '\\'`,
		sql`${tables.organization.id} LIKE ${idPattern} ESCAPE '\\'`,
		// Provider abuse reports quote the safety identifier we send upstream;
		// searching on it is how such a report gets traced back to an org.
		sql`${tables.organization.safetyIdentifier} LIKE ${idPattern} ESCAPE '\\'`,
		sql`EXISTS (SELECT 1 FROM ${tables.userOrganization} uo JOIN ${tables.user} u ON uo.user_id = u.id WHERE uo.organization_id = ${tables.organization.id} AND LOWER(u.email) LIKE ${textPattern} ESCAPE '\\')`,
	);
}

/**
 * One owner row per organization, for joining onto organization listings.
 * An organization can have several members with the `owner` role, so joining
 * the membership rows directly would emit the organization once per owner.
 * Ranks by membership age so the founding owner wins, keyed by user id to stay
 * deterministic when two memberships share a timestamp.
 */
function buildOrganizationOwnerSubquery() {
	const ranked = db
		.select({
			organizationId: tables.userOrganization.organizationId,
			userId: tables.user.id,
			userName: tables.user.name,
			userEmail: tables.user.email,
			userUsername: tables.user.username,
			rowNumber:
				sql<number>`ROW_NUMBER() OVER (PARTITION BY ${tables.userOrganization.organizationId} ORDER BY ${tables.userOrganization.createdAt} ASC, ${tables.user.id} ASC)`.as(
					"owner_row_number",
				),
		})
		.from(tables.userOrganization)
		.innerJoin(tables.user, eq(tables.userOrganization.userId, tables.user.id))
		.where(eq(tables.userOrganization.role, "owner"))
		.as("owner_ranked");

	return db
		.select({
			organizationId: ranked.organizationId,
			userId: ranked.userId,
			userName: ranked.userName,
			userEmail: ranked.userEmail,
			userUsername: ranked.userUsername,
		})
		.from(ranked)
		.where(eq(ranked.rowNumber, 1))
		.as("owner_sub");
}

export const admin = new OpenAPIHono<ServerTypes>();

admin.use("/*", adminMiddleware);

// Token counts split by billed token type, plus the cost each type accounts for.
// Spliced into every admin stats payload so the dashboard can explain a cost
// figure rather than only showing the lump sum. The three costs are slices of
// the row's total cost and do not have to add up to it: per-request, image,
// audio, video and cache-write charges live outside this breakdown.
const tokenBreakdownShape = {
	inputTokens: z.number(),
	cachedTokens: z.number(),
	outputTokens: z.number(),
	inputCost: z.number(),
	cachedInputCost: z.number(),
	outputCost: z.number(),
};

interface TokenBreakdown {
	inputTokens: number;
	cachedTokens: number;
	outputTokens: number;
	inputCost: number;
	cachedInputCost: number;
	outputCost: number;
}

const EMPTY_TOKEN_BREAKDOWN: TokenBreakdown = {
	inputTokens: 0,
	cachedTokens: 0,
	outputTokens: 0,
	inputCost: 0,
	cachedInputCost: 0,
	outputCost: 0,
};

// The history tables all expose the same six breakdown columns, so both the
// per-row select list and the mapping back onto the API shape are shared.
function tokenBreakdownSums(table: {
	totalInputTokens: AnyColumn;
	totalCachedTokens: AnyColumn;
	totalOutputTokens: AnyColumn;
	totalInputCost: AnyColumn;
	totalCachedInputCost: AnyColumn;
	totalOutputCost: AnyColumn;
}) {
	return {
		inputTokens:
			sql<number>`COALESCE(SUM(CAST(${table.totalInputTokens} AS NUMERIC)), 0)`.as(
				"input_tokens",
			),
		cachedTokens:
			sql<number>`COALESCE(SUM(CAST(${table.totalCachedTokens} AS NUMERIC)), 0)`.as(
				"cached_tokens",
			),
		outputTokens:
			sql<number>`COALESCE(SUM(CAST(${table.totalOutputTokens} AS NUMERIC)), 0)`.as(
				"output_tokens",
			),
		inputCost:
			sql<number>`COALESCE(SUM(cast(${table.totalInputCost} as double precision)), 0)`.as(
				"input_cost",
			),
		cachedInputCost:
			sql<number>`COALESCE(SUM(cast(${table.totalCachedInputCost} as double precision)), 0)`.as(
				"cached_input_cost",
			),
		outputCost:
			sql<number>`COALESCE(SUM(cast(${table.totalOutputCost} as double precision)), 0)`.as(
				"output_cost",
			),
	};
}

// Re-select the breakdown out of a stats subquery that was left-joined onto a
// catalogue table, so mappings with no traffic in the window come back as zeroes
// instead of nulls.
function tokenBreakdownFromSub(sub: Record<keyof TokenBreakdown, SQLWrapper>) {
	return {
		inputTokens: sql<number>`COALESCE(${sub.inputTokens}, 0)`.as(
			"input_tokens",
		),
		cachedTokens: sql<number>`COALESCE(${sub.cachedTokens}, 0)`.as(
			"cached_tokens",
		),
		outputTokens: sql<number>`COALESCE(${sub.outputTokens}, 0)`.as(
			"output_tokens",
		),
		inputCost: sql<number>`COALESCE(${sub.inputCost}, 0)`.as("input_cost"),
		cachedInputCost: sql<number>`COALESCE(${sub.cachedInputCost}, 0)`.as(
			"cached_input_cost",
		),
		outputCost: sql<number>`COALESCE(${sub.outputCost}, 0)`.as("output_cost"),
	};
}

// Same subquery, but rolled up across every joined row for the page-level totals.
function tokenBreakdownSubTotals(
	sub: Record<keyof TokenBreakdown, SQLWrapper>,
) {
	return {
		inputTokens:
			sql<number>`COALESCE(SUM(COALESCE(${sub.inputTokens}, 0)), 0)`.as(
				"input_tokens",
			),
		cachedTokens:
			sql<number>`COALESCE(SUM(COALESCE(${sub.cachedTokens}, 0)), 0)`.as(
				"cached_tokens",
			),
		outputTokens:
			sql<number>`COALESCE(SUM(COALESCE(${sub.outputTokens}, 0)), 0)`.as(
				"output_tokens",
			),
		inputCost:
			sql<number>`COALESCE(SUM(COALESCE(cast(${sub.inputCost} as double precision), 0)), 0)`.as(
				"input_cost",
			),
		cachedInputCost:
			sql<number>`COALESCE(SUM(COALESCE(cast(${sub.cachedInputCost} as double precision), 0)), 0)`.as(
				"cached_input_cost",
			),
		outputCost:
			sql<number>`COALESCE(SUM(COALESCE(cast(${sub.outputCost} as double precision), 0)), 0)`.as(
				"output_cost",
			),
	};
}

function toTokenBreakdown(
	row: Partial<Record<keyof TokenBreakdown, unknown>> | undefined,
): TokenBreakdown {
	return {
		inputTokens: Number(row?.inputTokens ?? 0),
		cachedTokens: Number(row?.cachedTokens ?? 0),
		outputTokens: Number(row?.outputTokens ?? 0),
		inputCost: Number(row?.inputCost ?? 0),
		cachedInputCost: Number(row?.cachedInputCost ?? 0),
		outputCost: Number(row?.outputCost ?? 0),
	};
}

function addTokenBreakdown(
	target: TokenBreakdown,
	row: Partial<Record<keyof TokenBreakdown, unknown>>,
): void {
	const value = toTokenBreakdown(row);
	target.inputTokens += value.inputTokens;
	target.cachedTokens += value.cachedTokens;
	target.outputTokens += value.outputTokens;
	target.inputCost += value.inputCost;
	target.cachedInputCost += value.cachedInputCost;
	target.outputCost += value.outputCost;
}

const adminMetricsSchema = z.object({
	totalSignups: z.number(),
	verifiedUsers: z.number(),
	payingCustomers: z.number(),
	totalRevenue: z.number(),
	totalProcessed: z.number(),
	totalOrganizations: z.number(),
	totalToppedUp: z.number(),
	totalSpent: z.number(),
	// Credits-vs-BYOK split of totalSpent. totalSpent stays blended; BYOK
	// ("api-keys") usage is provider list price paid by the customer's own key,
	// not revenue-relevant spend.
	totalCreditsSpent: z.number(),
	totalApiKeysSpent: z.number(),
	unusedCredits: z.number(),
	overage: z.number(),
	totalGiftedCredits: z.number(),
	totalBonusCredits: z.number(),
	// Gross dollars refunded (platform fee included) and, separately, the credit
	// value clawed back. Net credit revenue is `totalRevenue -
	// totalRefundedCredits`; subtracting `totalRefunds` from it would mix a gross
	// figure into a post-fee one.
	totalRefunds: z.number(),
	totalRefundedCredits: z.number(),
	// Gross revenue across all products (Stripe `amount`, i.e. before Stripe
	// fees; refunds not netted out), split by product.
	grossRevenue: z.number(),
	grossCreditsRevenue: z.number(),
	grossDevpassRevenue: z.number(),
	// PAYG overflow top-ups purchased by DevPass orgs. Same `credit_topup`
	// transaction type as the Credits split, attributed separately so DevPass
	// overflow monetization is visible instead of blending into PAYG credits.
	grossDevpassTopupsRevenue: z.number(),
	grossResetPassRevenue: z.number(),
	grossChatPlansRevenue: z.number(),
	grossProSubscriptionsRevenue: z.number(),
	// Credits paid for outside Stripe (wire, crypto, …) and credited manually by
	// an administrator. Real revenue, just settled on another channel.
	grossManualPaymentsRevenue: z.number(),
	// Negotiated enterprise revenue recorded by an administrator. These rows do
	// not grant credits and are kept separate from manual credit payments.
	grossEnterpriseDealsRevenue: z.number(),
});

const timeseriesRangeSchema = z.enum(["7d", "30d", "90d", "365d", "all"]);

const timeseriesDataPointSchema = z.object({
	date: z.string(),
	signups: z.number(),
	paidCustomers: z.number(),
	revenue: z.number(),
	processed: z.number(),
	// Gross dollars refunded, and the credit value clawed back — `net` uses the
	// latter so it stays on the same post-fee basis as `revenue`.
	refunds: z.number(),
	refundedCredits: z.number(),
	net: z.number(),
	// DevPass plan revenue (gross Stripe amount, deduplicated per invoice) and
	// net (after refunds), cumulative like the credits series above.
	devpassRevenue: z.number(),
	devpassRefunds: z.number(),
	devpassNet: z.number(),
	// Enterprise deal revenue is recorded gross and has no credit amount attached.
	enterpriseRevenue: z.number(),
	// Per-day (non-cumulative) values. The cumulative series above start from a
	// pre-range baseline, so clients cannot derive day-one deltas themselves.
	dailySignups: z.number(),
	dailyPaidCustomers: z.number(),
	dailyNet: z.number(),
	dailyDevpassNet: z.number(),
	dailyEnterpriseRevenue: z.number(),
});

const adminTimeseriesSchema = z.object({
	range: timeseriesRangeSchema,
	data: z.array(timeseriesDataPointSchema),
	totals: z.object({
		signups: z.number(),
		paidCustomers: z.number(),
		revenue: z.number(),
		processed: z.number(),
		refunds: z.number(),
		refundedCredits: z.number(),
		net: z.number(),
		devpassRevenue: z.number(),
		devpassRefunds: z.number(),
		devpassNet: z.number(),
		enterpriseRevenue: z.number(),
	}),
});

const organizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	billingEmail: z.string(),
	kind: z.enum(["default", "chat", "devpass"]),
	plan: z.string(),
	devPlan: z.string(),
	// Plan term window. Enterprise contracts are booked by hand, so both dates
	// are admin-set; null = open-ended.
	planExpiresAt: z.string().nullable().optional(),
	planStartedAt: z.string().nullable().optional(),
	// Enterprise trial window; an active trial takes precedence over the plan
	// term when deciding which countdown to show.
	isTrialActive: z.boolean().optional(),
	trialStartDate: z.string().nullable().optional(),
	trialEndDate: z.string().nullable().optional(),
	// Manual seat-limit override; null = use the plan default.
	seats: z.number().int().nullable().optional(),
	// Manual API-key-limit override; null = use the plan default.
	apiKeyLimit: z.number().int().nullable().optional(),
	// Manual project-limit override; null = use the plan default.
	projectLimit: z.number().int().nullable().optional(),
	credits: z.string(),
	totalCreditsAllTime: z.string().optional(),
	totalSpent: z.string().optional(),
	totalCreditsSpent: z.string().optional(),
	totalApiKeysSpent: z.string().optional(),
	totalRequests: z.number().optional(),
	totalTokens: z.number().optional(),
	createdAt: z.string(),
	status: z.string().nullable(),
	// Flagged as high risk by the abuse-IP check at sign-up or email
	// verification: no credit purchases and no inference until an admin
	// activates the account under "Flagged Accounts".
	riskFlagged: z.boolean().optional(),
	referralBonusEnabled: z.boolean().optional(),
	referralBonusPercent: z.number().optional(),
	ownerUserId: z.string().nullable().optional(),
	ownerName: z.string().nullable().optional(),
	ownerEmail: z.string().nullable().optional(),
});

const organizationsListSchema = z.object({
	organizations: z.array(organizationSchema),
	total: z.number(),
	totalCredits: z.string(),
	limit: z.number(),
	offset: z.number(),
});

// The org's anti-abuse trust tier as the gateway resolves it (see
// packages/shared/src/spend-tier.ts). `exempt` says why the ladder does not
// apply: enterprise orgs have no limits at all; dev/chat plans use flat
// endpoint limits instead of the tier ladder.
const trustTierSchema = z.object({
	exempt: z.enum(["none", "enterprise", "dev", "chat"]),
	tier: z.number(),
	// True when an admin pinned the tier (trustTierOverride); the pin wins
	// over the computed age/spend ladder.
	overridden: z.boolean(),
	accountAgeDays: z.number(),
	qualifyingSpendUsd: z.number(),
	rpmMultiplier: z.number(),
	dailyCapUsd: z.number(),
	monthlyCapUsd: z.number(),
	topUpDailyCapUsd: z.number(),
});

const orgMetricsSchema = z.object({
	organization: organizationSchema,
	trustTier: trustTierSchema,
	window: tokenWindowSchema,
	startDate: z.string(),
	endDate: z.string(),
	totalRequests: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	creditsRequestCount: z.number(),
	apiKeysRequestCount: z.number(),
	creditsCost: z.number(),
	apiKeysCost: z.number(),
	inputTokens: z.number(),
	inputCost: z.number(),
	outputTokens: z.number(),
	outputCost: z.number(),
	cachedTokens: z.number(),
	cachedCost: z.number(),
	cacheWriteTokens: z.number(),
	cacheWriteCost: z.number(),
	dataStorageCost: z.number(),
	mostUsedModel: z.string().nullable(),
	mostUsedProvider: z.string().nullable(),
	mostUsedModelCost: z.number(),
	discountSavings: z.number(),
});

const transactionSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	type: z.string(),
	amount: z.string().nullable(),
	creditAmount: z.string().nullable(),
	currency: z.string(),
	status: z.string(),
	description: z.string().nullable(),
	// Off-Stripe payment channel and its reference, set on manually recorded
	// payments only.
	paymentMethod: z.string().nullable(),
	externalReference: z.string().nullable(),
	stripePaymentIntentId: z.string().nullable(),
	stripeInvoiceId: z.string().nullable(),
	stripeRefundId: z.string().nullable(),
});

const transactionsListSchema = z.object({
	organization: organizationSchema,
	transactions: z.array(transactionSchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
});

const projectSchema = z.object({
	id: z.string(),
	name: z.string(),
	mode: z.string(),
	status: z.string().nullable(),
	cachingEnabled: z.boolean(),
	createdAt: z.string(),
});

const projectsListSchema = z.object({
	projects: z.array(projectSchema),
	total: z.number(),
});

const iamRuleAdminSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	apiKeyId: z.string(),
	ruleType: z.enum([
		"allow_models",
		"deny_models",
		"allow_pricing",
		"deny_pricing",
		"allow_providers",
		"deny_providers",
		"allow_ip_cidrs",
		"deny_ip_cidrs",
	]),
	ruleValue: z.object({
		models: z.array(z.string()).optional(),
		providers: z.array(z.string()).optional(),
		pricingType: z.enum(["free", "paid"]).optional(),
		maxInputPrice: z.number().optional(),
		maxOutputPrice: z.number().optional(),
		ipCidrs: z.array(z.string()).optional(),
	}),
	status: z.enum(["active", "inactive"]),
});

const apiKeySchema = z.object({
	id: z.string(),
	token: z.string(),
	description: z.string(),
	status: z.string().nullable(),
	usage: z.string(),
	usageLimit: z.string().nullable(),
	projectId: z.string(),
	projectName: z.string(),
	createdAt: z.string(),
	iamRules: z.array(iamRuleAdminSchema),
});

const keyStatusFilterSchema = z.enum(["all", "active", "inactive", "deleted"]);

type KeyStatusFilter = z.infer<typeof keyStatusFilterSchema>;

/**
 * Per-status totals for a key list. Always computed over every key of the
 * organization, never over the filtered rows, so the dashboard can show
 * "active / total" next to a list that only renders one status.
 */
const keyStatusCountsSchema = z.object({
	all: z.number(),
	active: z.number(),
	inactive: z.number(),
	deleted: z.number(),
});

type KeyStatusCounts = z.infer<typeof keyStatusCountsSchema>;

function emptyKeyStatusCounts(): KeyStatusCounts {
	return { all: 0, active: 0, inactive: 0, deleted: 0 };
}

function toKeyStatusCounts(
	rows: { status: string; count: number }[],
): KeyStatusCounts {
	const counts = emptyKeyStatusCounts();
	for (const row of rows) {
		const count = Number(row.count);
		counts.all += count;
		if (
			row.status === "active" ||
			row.status === "inactive" ||
			row.status === "deleted"
		) {
			counts[row.status] += count;
		}
	}
	return counts;
}

/**
 * Both key tables declare `status` nullable with an `active` default, so legacy
 * NULL rows have to be folded into `active` — otherwise they vanish from every
 * filtered view and from the counts.
 */
function keyStatusCondition(column: AnyColumn, status: KeyStatusFilter) {
	if (status === "all") {
		return undefined;
	}
	if (status === "active") {
		return or(eq(column, "active"), isNull(column));
	}
	return eq(column, status);
}

const apiKeysListSchema = z.object({
	apiKeys: z.array(apiKeySchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
	counts: keyStatusCountsSchema,
});

const providerKeyAdminSchema = z.object({
	id: z.string(),
	/** Masked token. The plaintext is never returned. */
	token: z.string(),
	/** HMAC fingerprint, matching `log.usedApiKeyHash` on requests this key served. */
	tokenHash: z.string().nullable(),
	provider: z.string(),
	name: z.string().nullable(),
	description: z.string().nullable(),
	baseUrl: z.string().nullable(),
	status: z.string().nullable(),
	/** USD spend cap; the key auto-deactivates when usage reaches it. */
	usageLimit: z.string().nullable(),
	/** Cumulative upstream spend (USD) attributed by the billing worker. */
	usage: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const providerKeysListSchema = z.object({
	providerKeys: z.array(providerKeyAdminSchema),
	total: z.number(),
	counts: keyStatusCountsSchema,
});

const memberSchema = z.object({
	id: z.string(),
	userId: z.string(),
	role: z.string(),
	createdAt: z.string(),
	user: z.object({
		id: z.string(),
		email: z.string(),
		name: z.string().nullable(),
		emailVerified: z.boolean(),
	}),
});

const membersListSchema = z.object({
	members: z.array(memberSchema),
	total: z.number(),
});

const getMetrics = createRoute({
	method: "get",
	path: "/metrics",
	request: {
		query: z.object({
			range: timeseriesRangeSchema.default("all").optional(),
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: adminMetricsSchema.openapi({}),
				},
			},
			description: "Admin dashboard metrics.",
		},
	},
});

const sortBySchema = z.enum([
	"name",
	"billingEmail",
	"plan",
	"devPlan",
	"credits",
	"createdAt",
	"status",
	"totalCreditsAllTime",
	"totalSpent",
	"totalRequests",
	"totalTokens",
]);

const sortOrderSchema = z.enum(["asc", "desc"]);

const getOrganizations = createRoute({
	method: "get",
	path: "/organizations",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			search: z.string().optional(),
			sortBy: sortBySchema.default("createdAt").optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
			// Usage window (YYYY-MM-DD) for the spend/request/token columns.
			// Omitting both means all time.
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: organizationsListSchema.openapi({}),
				},
			},
			description: "List of organizations.",
		},
	},
});

const getOrganizationMetrics = createRoute({
	method: "get",
	path: "/organizations/{orgId}",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			window: tokenWindowSchema.default("1d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: orgMetricsSchema.openapi({}),
				},
			},
			description: "Organization metrics.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

const getOrganizationTransactions = createRoute({
	method: "get",
	path: "/organizations/{orgId}/transactions",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(25).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: transactionsListSchema.openapi({}),
				},
			},
			description: "Organization transactions.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

const getOrganizationProjects = createRoute({
	method: "get",
	path: "/organizations/{orgId}/projects",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: projectsListSchema.openapi({}),
				},
			},
			description: "Organization projects.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

const getOrganizationApiKeys = createRoute({
	method: "get",
	path: "/organizations/{orgId}/api-keys",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(25).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			status: keyStatusFilterSchema.default("active").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: apiKeysListSchema.openapi({}),
				},
			},
			description: "Organization API keys.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

const getOrganizationProviderKeys = createRoute({
	method: "get",
	path: "/organizations/{orgId}/provider-keys",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			status: keyStatusFilterSchema.default("active").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: providerKeysListSchema.openapi({}),
				},
			},
			description: "Organization provider keys.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

const getOrganizationMembers = createRoute({
	method: "get",
	path: "/organizations/{orgId}/members",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: membersListSchema.openapi({}),
				},
			},
			description: "Organization members.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

admin.openapi(getMetrics, async (c) => {
	const query = c.req.valid("query");
	const { from, to } = query;

	let startDate: Date | null = null;
	let endDate: Date | null = null;
	if (from && to) {
		startDate = new Date(from + "T00:00:00");
		startDate.setUTCHours(0, 0, 0, 0);
		endDate = new Date(to + "T23:59:59");
		endDate.setUTCHours(23, 59, 59, 999);
	} else {
		const range = query.range ?? "all";
		const rangeDays: Record<string, number | null> = {
			"7d": 7,
			"30d": 30,
			"90d": 90,
			"365d": 365,
			all: null,
		};
		const days = range in rangeDays ? rangeDays[range] : null;
		if (days !== null) {
			// eslint-disable-next-line no-mixed-operators
			startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
			startDate.setUTCHours(0, 0, 0, 0);
		}
	}

	const userDateFilter =
		startDate && endDate
			? and(
					gte(tables.user.createdAt, startDate),
					lte(tables.user.createdAt, endDate),
				)
			: startDate
				? gte(tables.user.createdAt, startDate)
				: undefined;
	const transactionDateFilter =
		startDate && endDate
			? and(
					gte(tables.transaction.createdAt, startDate),
					lte(tables.transaction.createdAt, endDate),
				)
			: startDate
				? gte(tables.transaction.createdAt, startDate)
				: undefined;
	const orgDateFilter =
		startDate && endDate
			? and(
					gte(tables.organization.createdAt, startDate),
					lte(tables.organization.createdAt, endDate),
				)
			: startDate
				? gte(tables.organization.createdAt, startDate)
				: undefined;
	const projectStatsDateFilter =
		startDate && endDate
			? and(
					gte(projectHourlyStats.hourTimestamp, startDate),
					lte(projectHourlyStats.hourTimestamp, endDate),
				)
			: startDate
				? gte(projectHourlyStats.hourTimestamp, startDate)
				: undefined;

	// Total signups
	const [signupsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.user)
		.where(userDateFilter);

	const totalSignups = Number(signupsRow?.count ?? 0);

	// Verified users (email verified)
	const [verifiedRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.user)
		.where(and(eq(tables.user.emailVerified, true), userDateFilter));

	const verifiedUsers = Number(verifiedRow?.count ?? 0);

	// Paying customers: organizations with at least one completed payment
	// transaction (credit purchase, dev/chat plan charge, or end-user top-up —
	// gifts and bookkeeping rows don't count)
	const [payingRow] = await db
		.select({
			count:
				sql<number>`COUNT(DISTINCT ${tables.transaction.organizationId})`.as(
					"count",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				paidTransactionFilter,
				transactionDateFilter,
			),
		);

	const payingCustomers = Number(payingRow?.count ?? 0);

	// Total credits revenue: completed credit-purchase rows use `creditAmount`,
	// which is the credit value granted and so excludes the platform fee charged
	// on top. Excludes enterprise deals, gifts, all plan rows (DevPass/legacy
	// subscription/Chat Plan), the non-revenue end-user rows (developer margin +
	// funded bonus), and refund reversals — refunds are netted out once, via
	// `totalRefundedCredits`.
	const [revenueRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				ne(tables.transaction.type, "credit_gift"),
				ne(tables.transaction.type, "enterprise_license_fee"),
				notPlanFilter,
				notEndUserNonRevenueFilter,
				notRefundFilter,
				transactionDateFilter,
			),
		);

	const totalRevenue = Number(revenueRow?.value ?? 0);

	// Total organizations
	const [orgsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.organization)
		.where(orgDateFilter);

	const totalOrganizations = Number(orgsRow?.count ?? 0);

	// Total topped up (credits from completed credit-purchase transactions).
	// Excludes DevPass and Chat Plan virtual credits — those are granted per
	// cycle and reset, so they would inflate the topped-up / unused-credits
	// numbers — and all end-user wallet rows, which live in their own balance
	// economy (their spend is not in `totalSpent`, so counting their top-ups
	// would inflate unused credits).
	const [toppedUpRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				notPlanFilter,
				notEndUserWalletFilter,
				transactionDateFilter,
			),
		);

	const totalToppedUp = Number(toppedUpRow?.value ?? 0);

	// Total spent (usage cost from hourly stats). Excludes spend from projects
	// belonging to orgs whose usage is/was on a DevPass or Chat Plan, so the
	// unusedCredits derivation (toppedUp - spent) only reflects the
	// credit-purchase economy.
	const [spentRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
					"value",
				),
			creditsValue:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
					"creditsValue",
				),
			apiKeysValue:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.apiKeysCost} AS NUMERIC)), 0)`.as(
					"apiKeysValue",
				),
			// What the worker actually debits from credit balances: credits-mode
			// rows at full cost plus BYOK rows' data-storage cost.
			debitedValue:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0) + COALESCE(SUM(CAST(${projectHourlyStats.apiKeysDataStorageCost} AS NUMERIC)), 0)`.as(
					"debitedValue",
				),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(
			and(
				projectStatsDateFilter,
				eq(tables.organization.devPlan, "none"),
				eq(tables.organization.chatPlan, "none"),
				sql`NOT EXISTS (
					SELECT 1 FROM ${tables.transaction} t
					WHERE t.organization_id = ${tables.organization.id}
					AND (
						t.type IN ('dev_plan_start', 'dev_plan_upgrade', 'dev_plan_downgrade', 'dev_plan_renewal')
						OR t.type IN ('chat_plan_start', 'chat_plan_upgrade', 'chat_plan_downgrade', 'chat_plan_renewal')
						OR (t.type IN ('subscription_start', 'subscription_cancel', 'subscription_end') AND ${tables.organization.kind} = 'devpass')
					)
				)`,
			),
		);

	const totalSpent = Number(spentRow?.value ?? 0);
	const totalCreditsSpent = Number(spentRow?.creditsValue ?? 0);
	const totalApiKeysSpent = Number(spentRow?.apiKeysValue ?? 0);
	const totalDebitedSpend = Number(spentRow?.debitedValue ?? 0);

	// Total processed credits (gross payment amounts from completed non-gift,
	// non-plan transactions — Stripe charges plus off-Stripe manual payments).
	// Enterprise deals are reported separately. Refund rows carry a POSITIVE
	// `amount` (the dollars sent back), so they are excluded here rather than
	// counted as another charge; `totalRefunds` reports them.
	const [processedRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				ne(tables.transaction.type, "credit_gift"),
				ne(tables.transaction.type, "enterprise_license_fee"),
				notPlanFilter,
				notEndUserNonRevenueFilter,
				notRefundFilter,
				transactionDateFilter,
			),
		);

	const totalProcessed = Number(processedRow?.value ?? 0);

	// Total gifted credits (sum of credit_gift transactions, using creditAmount)
	const [giftedRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "credit_gift"),
				transactionDateFilter,
			),
		);

	const totalGiftedCredits = Number(giftedRow?.value ?? 0);

	// Total developer-funded end-user top-up bonus credits granted (net of
	// refund claw-backs). end_user_bonus rows store creditAmount as the change to
	// the developer org's credit balance — negative when a bonus is granted,
	// positive when clawed back on refund — so negate the sum to report the net
	// credits actually gifted into end-user wallets. Excluded from revenue above
	// and surfaced here so it can be subtracted/considered in stats separately.
	const [bonusRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "end_user_bonus"),
				transactionDateFilter,
			),
		);

	const totalBonusCredits = -Number(bonusRow?.value ?? 0);

	// Refunds, on both bases: `amount` is the gross refunded to the customer
	// (platform fee included, since the whole charge is sent back) and
	// `creditAmount` is the negative clawback of the granted credits. Netting a
	// credit-basis figure like `totalRevenue` needs the credit-basis refund, so
	// report both rather than mixing them.
	const [refundsRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
			creditsValue:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"creditsValue",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "credit_refund"),
				transactionDateFilter,
			),
		);

	const totalRefunds = Number(refundsRow?.value ?? 0);
	const totalRefundedCredits = -Number(refundsRow?.creditsValue ?? 0);

	// Gross revenue splits: actual dollars charged via Stripe (`amount`, so
	// including Stripe fees), before netting refunds out.
	//
	// Credits: org credit top-ups + end-user wallet top-ups. Refund reversals
	// are negative same-type rows, so only positive amounts count as gross.
	// DevPass orgs buy `credit_topup` rows too (PAYG overflow), but those are
	// DevPass monetization, not PAYG-product revenue — they get their own
	// split below instead of inflating this one.
	const [grossCreditsRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.type, ["credit_topup", "end_user_topup"]),
				// Only devpass `credit_topup` rows move to the DevPass split
				// below. An `end_user_topup` on a devpass org shouldn't exist
				// (end-user wallets are backed by regular PAYG orgs), but that
				// invariant isn't DB-enforced — if a row ever appears it must
				// still count here exactly once, not vanish from gross revenue.
				or(
					ne(tables.organization.kind, "devpass"),
					ne(tables.transaction.type, "credit_topup"),
				),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
				transactionDateFilter,
			),
		);

	const grossCreditsRevenue = Number(grossCreditsRow?.value ?? 0);

	// DevPass PAYG overflow top-ups: `credit_topup` purchases on devpass orgs.
	const [grossDevpassTopupsRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "credit_topup"),
				eq(tables.organization.kind, "devpass"),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
				transactionDateFilter,
			),
		);

	const grossDevpassTopupsRevenue = Number(grossDevpassTopupsRow?.value ?? 0);

	// DevPass: dev plan subscription payments (+ legacy `subscription_*` rows on
	// devpass orgs), deduplicated per Stripe invoice. Mirrors
	// /admin/devpass/timeseries. One-time Reset Pass purchases are reported as
	// their own split below.
	const [grossDevpassRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "devpass"),
				inArray(tables.transaction.type, [
					...DEV_PLAN_SUBSCRIPTION_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				firstRowPerInvoiceFilter([
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				transactionDateFilter,
			),
		);

	const grossDevpassRevenue = Number(grossDevpassRow?.value ?? 0);

	// Reset Passes: one-time PaymentIntent purchases on devpass orgs — no
	// invoice, so no dedup needed. Gross like the other splits (refunds are
	// separate `credit_refund` rows and not netted out here).
	const [grossResetPassRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "devpass"),
				eq(tables.transaction.type, "dev_plan_reset_pass"),
				transactionDateFilter,
			),
		);

	const grossResetPassRevenue = Number(grossResetPassRow?.value ?? 0);

	// Chat Plans: plan payments on chat orgs, deduplicated per Stripe invoice.
	// Mirrors /admin/chat-plans/timeseries.
	const [grossChatPlansRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "chat"),
				inArray(tables.transaction.type, [...CHAT_PLAN_TX_TYPES]),
				firstRowPerInvoiceFilter(CHAT_PLAN_TX_TYPES),
				transactionDateFilter,
			),
		);

	const grossChatPlansRevenue = Number(grossChatPlansRow?.value ?? 0);

	// Org Pro subscriptions: `subscription_*` rows on non-devpass orgs (the same
	// legacy types double as DevPass rows on devpass orgs, counted above).
	const [grossProSubsRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				ne(tables.organization.kind, "devpass"),
				inArray(tables.transaction.type, [...LEGACY_DEV_PLAN_TX_TYPES]),
				firstRowPerInvoiceFilter([
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				transactionDateFilter,
			),
		);

	const grossProSubscriptionsRevenue = Number(grossProSubsRow?.value ?? 0);

	// Manual payments: credits an administrator granted against money received
	// outside Stripe (wire, crypto, …). `amount` is the real payment, so these
	// belong in gross revenue like any other purchase — kept as their own split
	// because they never appear in Stripe reporting.
	const [grossManualPaymentsRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "credit_manual_payment"),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
				transactionDateFilter,
			),
		);

	const grossManualPaymentsRevenue = Number(grossManualPaymentsRow?.value ?? 0);

	// Enterprise deals: negotiated contract revenue recorded outside the credits
	// economy. `creditAmount` is always null, so this split never changes credit
	// flow or balances.
	const [grossEnterpriseDealsRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "enterprise_license_fee"),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
				transactionDateFilter,
			),
		);

	const grossEnterpriseDealsRevenue = Number(
		grossEnterpriseDealsRow?.value ?? 0,
	);

	const grossRevenue =
		grossCreditsRevenue +
		grossDevpassRevenue +
		grossDevpassTopupsRevenue +
		grossResetPassRevenue +
		grossChatPlansRevenue +
		grossProSubscriptionsRevenue +
		grossManualPaymentsRevenue +
		grossEnterpriseDealsRevenue;

	// Balance derivation must use debited spend, not blended cost: BYOK usage
	// never drains purchased credits, so subtracting it would understate
	// unusedCredits (and overstate overage) for orgs with BYOK traffic.
	const rawBalance = totalToppedUp - totalDebitedSpend;
	const unusedCredits = Math.max(0, rawBalance);
	const overage = Math.max(0, -rawBalance);

	return c.json({
		totalSignups,
		verifiedUsers,
		payingCustomers,
		totalRevenue,
		totalProcessed,
		totalOrganizations,
		totalToppedUp,
		totalSpent,
		totalCreditsSpent,
		totalApiKeysSpent,
		unusedCredits,
		overage,
		totalGiftedCredits,
		totalBonusCredits,
		totalRefunds,
		totalRefundedCredits,
		grossRevenue,
		grossCreditsRevenue,
		grossDevpassRevenue,
		grossDevpassTopupsRevenue,
		grossResetPassRevenue,
		grossChatPlansRevenue,
		grossProSubscriptionsRevenue,
		grossManualPaymentsRevenue,
		grossEnterpriseDealsRevenue,
	});
});

const getTimeseries = createRoute({
	method: "get",
	path: "/metrics/timeseries",
	request: {
		query: z.object({
			range: timeseriesRangeSchema.default("all").optional(),
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: adminTimeseriesSchema.openapi({}),
				},
			},
			description: "Admin dashboard timeseries metrics.",
		},
	},
});

admin.openapi(getTimeseries, async (c) => {
	const query = c.req.valid("query");
	const { from, to } = query;

	const now = new Date();
	let startDate: Date;
	const endDate = new Date(now);
	endDate.setUTCHours(23, 59, 59, 999);

	if (from && to) {
		startDate = new Date(from + "T00:00:00");
		startDate.setUTCHours(0, 0, 0, 0);
		endDate.setTime(new Date(to + "T23:59:59").getTime());
		endDate.setUTCHours(23, 59, 59, 999);
	} else {
		const range = query.range ?? "all";
		const rangeDays: Record<string, number | null> = {
			"7d": 7,
			"30d": 30,
			"90d": 90,
			"365d": 365,
			all: null,
		};
		const days = range in rangeDays ? rangeDays[range] : 30;

		if (days === null) {
			const [oldest] = await db
				.select({
					minDate: sql<string>`MIN(${tables.user.createdAt})`.as("minDate"),
				})
				.from(tables.user);
			startDate = oldest?.minDate ? new Date(oldest.minDate) : now;
		} else {
			// eslint-disable-next-line no-mixed-operators
			startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
		}
		startDate.setUTCHours(0, 0, 0, 0);
	}

	// Signups per day
	const signupsPerDay = await db
		.select({
			date: sql<string>`DATE(${tables.user.createdAt})`.as("date"),
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.user)
		.where(gte(tables.user.createdAt, startDate))
		.groupBy(sql`DATE(${tables.user.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.user.createdAt})`));

	// Revenue per day (post-fee credit revenue; matches /admin/metrics
	// totalRevenue). Enterprise deals are a separate series below.
	const revenuePerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				ne(tables.transaction.type, "credit_gift"),
				ne(tables.transaction.type, "enterprise_license_fee"),
				notPlanFilter,
				notEndUserNonRevenueFilter,
				notRefundFilter,
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	const enterpriseRevenuePerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "enterprise_license_fee"),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Processed per day (gross Stripe amount; matches /admin/metrics totalProcessed)
	const processedPerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				ne(tables.transaction.type, "credit_gift"),
				ne(tables.transaction.type, "enterprise_license_fee"),
				notPlanFilter,
				notEndUserNonRevenueFilter,
				notRefundFilter,
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Refunds per day, gross (positive `amount`) and on a credit basis (the
	// negated `creditAmount` clawback), mirroring /admin/metrics.
	const refundsPerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
			credits:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"credits",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "credit_refund"),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// DevPass revenue per day: dev plan payments (+ legacy `subscription_*` rows
	// on devpass orgs), gross Stripe `amount` deduplicated per invoice. Mirrors
	// /admin/devpass/timeseries.
	const devpassRevenuePerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "devpass"),
				inArray(tables.transaction.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				firstRowPerInvoiceFilter([
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// DevPass refunds per day: `credit_refund` rows linked back to a dev plan
	// payment via `relatedTransactionId`. Mirrors /admin/devpass/timeseries.
	const devpassRefundOriginalTx = aliasedTable(
		tables.transaction,
		"devpass_refund_original_tx",
	);
	const devpassRefundsPerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			devpassRefundOriginalTx,
			eq(tables.transaction.relatedTransactionId, devpassRefundOriginalTx.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "devpass"),
				inArray(devpassRefundOriginalTx.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Pre-range totals for cumulative chart
	const [preRangeRevenueRow] = await db
		.select({
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				ne(tables.transaction.type, "credit_gift"),
				ne(tables.transaction.type, "enterprise_license_fee"),
				notPlanFilter,
				notEndUserNonRevenueFilter,
				notRefundFilter,
				sql`${tables.transaction.createdAt} < ${startDate}`,
			),
		);
	const preRangeRevenue = Number(preRangeRevenueRow?.total ?? 0);

	const [preRangeEnterpriseRevenueRow] = await db
		.select({
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "enterprise_license_fee"),
				sql`${tables.transaction.createdAt} < ${startDate}`,
			),
		);
	const preRangeEnterpriseRevenue = Number(
		preRangeEnterpriseRevenueRow?.total ?? 0,
	);

	const [preRangeProcessedRow] = await db
		.select({
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				ne(tables.transaction.type, "credit_gift"),
				ne(tables.transaction.type, "enterprise_license_fee"),
				notPlanFilter,
				notEndUserNonRevenueFilter,
				notRefundFilter,
				sql`${tables.transaction.createdAt} < ${startDate}`,
			),
		);
	const preRangeProcessed = Number(preRangeProcessedRow?.total ?? 0);

	const [preRangeRefundsRow] = await db
		.select({
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
			credits:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"credits",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "credit_refund"),
				sql`${tables.transaction.createdAt} < ${startDate}`,
			),
		);
	const preRangeRefunds = Number(preRangeRefundsRow?.total ?? 0);
	const preRangeRefundedCredits = -Number(preRangeRefundsRow?.credits ?? 0);

	const [preRangeDevpassRevenueRow] = await db
		.select({
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "devpass"),
				inArray(tables.transaction.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				firstRowPerInvoiceFilter([
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				sql`${tables.transaction.createdAt} < ${startDate}`,
			),
		);
	const preRangeDevpassRevenue = Number(preRangeDevpassRevenueRow?.total ?? 0);

	const [preRangeDevpassRefundsRow] = await db
		.select({
			total:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			devpassRefundOriginalTx,
			eq(tables.transaction.relatedTransactionId, devpassRefundOriginalTx.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "devpass"),
				inArray(devpassRefundOriginalTx.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				sql`${tables.transaction.createdAt} < ${startDate}`,
			),
		);
	const preRangeDevpassRefunds = Number(preRangeDevpassRefundsRow?.total ?? 0);

	// Count of orgs that became paying before the range (bounded SQL query)
	const [preRangeRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(
			db
				.select({
					organizationId: tables.transaction.organizationId,
				})
				.from(tables.transaction)
				.where(
					and(
						eq(tables.transaction.status, "completed"),
						paidTransactionFilter,
					),
				)
				.groupBy(tables.transaction.organizationId)
				.having(sql`MIN(${tables.transaction.createdAt}) < ${startDate}`)
				.as("pre_range_orgs"),
		);
	const preRangeCount = Number(preRangeRow?.count ?? 0);

	// New paid customers per day within the range (bounded SQL query)
	const firstTransactionPerOrg = await db
		.select({
			date: sql<string>`date`.as("date"),
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(
			db
				.select({
					date: sql<string>`DATE(MIN(${tables.transaction.createdAt}))`.as(
						"date",
					),
				})
				.from(tables.transaction)
				.where(
					and(
						eq(tables.transaction.status, "completed"),
						paidTransactionFilter,
					),
				)
				.groupBy(tables.transaction.organizationId)
				.having(
					and(
						sql`MIN(${tables.transaction.createdAt}) >= ${startDate}`,
						sql`MIN(${tables.transaction.createdAt}) <= ${endDate}`,
					),
				)
				.as("in_range_orgs"),
		)
		.groupBy(sql`date`)
		.orderBy(asc(sql`date`));

	// Build maps for quick lookup
	const signupsMap = new Map<string, number>();
	for (const row of signupsPerDay) {
		signupsMap.set(row.date, Number(row.count));
	}

	const revenueMap = new Map<string, number>();
	for (const row of revenuePerDay) {
		revenueMap.set(row.date, Number(row.total));
	}

	const processedMap = new Map<string, number>();
	for (const row of processedPerDay) {
		processedMap.set(row.date, Number(row.total));
	}

	const refundsMap = new Map<string, number>();
	const refundedCreditsMap = new Map<string, number>();
	for (const row of refundsPerDay) {
		refundsMap.set(row.date, Number(row.total));
		refundedCreditsMap.set(row.date, -Number(row.credits));
	}

	const devpassRevenueMap = new Map<string, number>();
	for (const row of devpassRevenuePerDay) {
		devpassRevenueMap.set(row.date, Number(row.total));
	}

	const devpassRefundsMap = new Map<string, number>();
	for (const row of devpassRefundsPerDay) {
		devpassRefundsMap.set(row.date, Number(row.total));
	}

	const enterpriseRevenueMap = new Map<string, number>();
	for (const row of enterpriseRevenuePerDay) {
		enterpriseRevenueMap.set(row.date, Number(row.total));
	}

	const newPaidMap = new Map<string, number>();
	for (const row of firstTransactionPerOrg) {
		newPaidMap.set(row.date, Number(row.count));
	}

	// Fill all dates in range
	const data: Array<{
		date: string;
		signups: number;
		paidCustomers: number;
		revenue: number;
		processed: number;
		refunds: number;
		refundedCredits: number;
		net: number;
		devpassRevenue: number;
		devpassRefunds: number;
		devpassNet: number;
		enterpriseRevenue: number;
		dailySignups: number;
		dailyPaidCustomers: number;
		dailyNet: number;
		dailyDevpassNet: number;
		dailyEnterpriseRevenue: number;
	}> = [];
	let cumulativePaid = preRangeCount;
	let totalSignups = 0;
	let totalRevenue = preRangeRevenue;
	let totalProcessed = preRangeProcessed;
	let totalRefunds = preRangeRefunds;
	let totalRefundedCredits = preRangeRefundedCredits;
	let totalDevpassRevenue = preRangeDevpassRevenue;
	let totalDevpassRefunds = preRangeDevpassRefunds;
	let totalEnterpriseRevenue = preRangeEnterpriseRevenue;

	const totalDays = Math.ceil(
		(endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
	);
	for (let i = 0; i < totalDays; i++) {
		// eslint-disable-next-line no-mixed-operators
		const current = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
		const dateStr = current.toISOString().split("T")[0];
		const dailySignups = signupsMap.get(dateStr) ?? 0;
		const dailyRevenue = revenueMap.get(dateStr) ?? 0;
		const dailyProcessed = processedMap.get(dateStr) ?? 0;
		const dailyRefunds = refundsMap.get(dateStr) ?? 0;
		const dailyRefundedCredits = refundedCreditsMap.get(dateStr) ?? 0;
		const dailyDevpassRevenue = devpassRevenueMap.get(dateStr) ?? 0;
		const dailyDevpassRefunds = devpassRefundsMap.get(dateStr) ?? 0;
		const dailyEnterpriseRevenue = enterpriseRevenueMap.get(dateStr) ?? 0;
		const dailyPaidCustomers = newPaidMap.get(dateStr) ?? 0;
		cumulativePaid += dailyPaidCustomers;

		totalSignups += dailySignups;
		totalRevenue += dailyRevenue;
		totalProcessed += dailyProcessed;
		totalRefunds += dailyRefunds;
		totalRefundedCredits += dailyRefundedCredits;
		totalDevpassRevenue += dailyDevpassRevenue;
		totalDevpassRefunds += dailyDevpassRefunds;
		totalEnterpriseRevenue += dailyEnterpriseRevenue;

		data.push({
			date: dateStr,
			signups: totalSignups,
			paidCustomers: cumulativePaid,
			revenue: totalRevenue,
			processed: totalProcessed,
			refunds: totalRefunds,
			refundedCredits: totalRefundedCredits,
			net: totalRevenue - totalRefundedCredits,
			devpassRevenue: totalDevpassRevenue,
			devpassRefunds: totalDevpassRefunds,
			devpassNet: totalDevpassRevenue - totalDevpassRefunds,
			enterpriseRevenue: totalEnterpriseRevenue,
			dailySignups,
			dailyPaidCustomers,
			dailyNet: dailyRevenue - dailyRefundedCredits,
			dailyDevpassNet: dailyDevpassRevenue - dailyDevpassRefunds,
			dailyEnterpriseRevenue,
		});
	}

	return c.json({
		range: query.range ?? "all",
		data,
		totals: {
			signups: totalSignups,
			paidCustomers: cumulativePaid,
			revenue: totalRevenue,
			processed: totalProcessed,
			refunds: totalRefunds,
			refundedCredits: totalRefundedCredits,
			net: totalRevenue - totalRefundedCredits,
			devpassRevenue: totalDevpassRevenue,
			devpassRefunds: totalDevpassRefunds,
			devpassNet: totalDevpassRevenue - totalDevpassRefunds,
			enterpriseRevenue: totalEnterpriseRevenue,
		},
	});
});

const globalStatsRangeSchema = z.enum(["7d", "30d", "90d", "365d", "all"]);
const globalStatsGroupBySchema = z.enum(["model", "source", "mode", "kind"]);
const globalStatsModelViewSchema = z.enum(["mapping", "canonical", "provider"]);
// Billing mode filter. "total" blends every mode, including the "unknown"
// rows that predate per-mode attribution.
const globalStatsModeSchema = z.enum([
	"total",
	"credits",
	"api-keys",
	"unknown",
]);
const globalStatsKindSchema = z.enum([
	"all",
	"default",
	"devpass",
	"chat",
	"unknown",
]);
const globalStatsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Every metric is scoped by the mode/kind filters, because both are part of
// the aggregation key rather than denormalized column pairs.
const globalStatsMetricsSchema = z.object({
	requestCount: z.number(),
	errorCount: z.number(),
	cacheCount: z.number(),
	inputTokens: z.number(),
	cachedTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	inputCost: z.number(),
	cachedInputCost: z.number(),
	outputCost: z.number(),
});

// How the selected range splits across the *other* dimension, so the blended
// view can show its composition without a second request. `byMode` honours the
// kind filter and vice versa, so both always reconcile with `totals`.
const globalStatsCompositionItemSchema = z
	.object({
		key: z.string(),
		label: z.string(),
		requestCount: z.number(),
		cost: z.number(),
		totalTokens: z.number(),
	})
	.openapi({});

const globalStatsTimeseriesPointSchema = globalStatsMetricsSchema
	.extend({
		date: z.string(),
	})
	.openapi({});

const globalStatsBreakdownItemSchema = globalStatsMetricsSchema
	.extend({
		key: z.string(),
		label: z.string(),
	})
	.openapi({});

// Per-day, per-dimension point. Only the three chartable metrics are returned
// to keep the payload small; the client picks the top dimensions per metric and
// collapses the rest into an "Other" bucket.
const globalStatsTimeseriesBreakdownPointSchema = z
	.object({
		date: z.string(),
		key: z.string(),
		label: z.string(),
		requestCount: z.number(),
		cost: z.number(),
		totalTokens: z.number(),
	})
	.openapi({});

const globalStatsResponseSchema = z.object({
	start: z.string(),
	end: z.string(),
	groupBy: globalStatsGroupBySchema,
	modelView: globalStatsModelViewSchema,
	mode: globalStatsModeSchema,
	kind: globalStatsKindSchema,
	totals: globalStatsMetricsSchema,
	composition: z.object({
		byMode: z.array(globalStatsCompositionItemSchema),
		byKind: z.array(globalStatsCompositionItemSchema),
	}),
	timeseries: z.array(globalStatsTimeseriesPointSchema),
	timeseriesBreakdown: z.array(globalStatsTimeseriesBreakdownPointSchema),
	breakdown: z.array(globalStatsBreakdownItemSchema),
});

// Cost columns on the stats tables are `real` (float4), and Postgres accumulates
// SUM(real) in float4 as well — only ~7 significant digits. Past a few hundred
// thousand dollars the running sum's ulp is larger than a cent, so the result
// depends on how the rows happened to be grouped: the blended total and the
// per-mode / per-kind slices of the *same* rows drift apart by double-digit
// dollars and the cards visibly stop adding up. NUMERIC accumulation is exact,
// so every grouping of a set of rows yields the identical sum.
//
// The double-precision hop is required, not decorative: `real::numeric` goes
// through float4's 6-digit display form (1234.5678 -> 1234.57), which throws
// away more than the float4 sum did. `real::float8` is the exact stored value.
function sumMoney(column: AnyColumn, alias: string) {
	return sql<number>`COALESCE(SUM(CAST(CAST(${column} AS DOUBLE PRECISION) AS NUMERIC)), 0)::float8`.as(
		alias,
	);
}

const getGlobalStats = createRoute({
	method: "get",
	path: "/global-stats",
	request: {
		query: z.object({
			range: globalStatsRangeSchema.default("30d").optional(),
			from: globalStatsDateSchema.optional(),
			to: globalStatsDateSchema.optional(),
			groupBy: globalStatsGroupBySchema.default("model").optional(),
			modelView: globalStatsModelViewSchema.default("mapping").optional(),
			mode: globalStatsModeSchema.default("total").optional(),
			kind: globalStatsKindSchema.default("all").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: globalStatsResponseSchema.openapi({}),
				},
			},
			description: "Global aggregated stats grouped by model or x-source.",
		},
	},
});

admin.openapi(getGlobalStats, async (c) => {
	const query = c.req.valid("query");
	const groupBy = query.groupBy ?? "model";
	const modelView = query.modelView ?? "mapping";
	const mode = query.mode ?? "total";
	const kind = query.kind ?? "all";

	const dayMs = 24 * 60 * 60 * 1000;
	const MAX_GLOBAL_STATS_DAYS = 731;

	// Only the model grouping needs the per-model table; source/mode/kind all
	// read the (much smaller) source table, which covers the same requests.
	const sourceTable =
		groupBy === "model" ? globalModelStats : globalSourceStats;

	// Narrowing happens in SQL, so every metric below — tokens, errors, cache,
	// per-part costs — reflects exactly the selected slice.
	const modeFilter = mode === "total" ? [] : [eq(sourceTable.usedMode, mode)];
	const kindFilter = kind === "all" ? [] : [eq(sourceTable.orgKind, kind)];
	const dimensionFilter = [...modeFilter, ...kindFilter];

	// `all` means "all time": derive the span from the first/last recorded day
	// so the card matches the dashboard's all-time totals instead of silently
	// truncating to a fixed window.
	const allTime = !query.from && !query.to && query.range === "all";

	let startDate: Date;
	let endDate: Date;
	if (query.from && query.to) {
		startDate = new Date(query.from + "T00:00:00Z");
		startDate.setUTCHours(0, 0, 0, 0);
		endDate = new Date(query.to + "T00:00:00Z");
		endDate.setUTCHours(0, 0, 0, 0);
		if (endDate.getTime() < startDate.getTime()) {
			const tmp = startDate;
			startDate = endDate;
			endDate = tmp;
		}
	} else if (allTime) {
		const bounds = await db
			.select({
				minDay: sql<
					string | null
				>`to_char(MIN(${sourceTable.dayTimestamp}), 'YYYY-MM-DD')`.as("minDay"),
				maxDay: sql<
					string | null
				>`to_char(MAX(${sourceTable.dayTimestamp}), 'YYYY-MM-DD')`.as("maxDay"),
			})
			.from(sourceTable)
			.where(dimensionFilter.length ? and(...dimensionFilter) : undefined);
		const minDay = bounds[0]?.minDay ?? null;
		const maxDay = bounds[0]?.maxDay ?? null;
		endDate = maxDay ? new Date(maxDay + "T00:00:00Z") : new Date();
		endDate.setUTCHours(0, 0, 0, 0);
		startDate = minDay ? new Date(minDay + "T00:00:00Z") : new Date(endDate);
		startDate.setUTCHours(0, 0, 0, 0);
	} else {
		const range = query.range && query.range !== "all" ? query.range : "30d";
		const rangeDays: Record<"7d" | "30d" | "90d" | "365d", number> = {
			"7d": 7,
			"30d": 30,
			"90d": 90,
			"365d": 365,
		};
		endDate = new Date();
		endDate.setUTCHours(0, 0, 0, 0);
		startDate = new Date(endDate.getTime() - (rangeDays[range] - 1) * dayMs); // eslint-disable-line no-mixed-operators
	}

	let days = Math.floor((endDate.getTime() - startDate.getTime()) / dayMs) + 1;
	if (days < 1) {
		days = 1;
	}
	// All-time spans the full recorded history; only bounded windows are capped.
	if (!allTime && days > MAX_GLOBAL_STATS_DAYS) {
		days = MAX_GLOBAL_STATS_DAYS;
		startDate = new Date(endDate.getTime() - (days - 1) * dayMs); // eslint-disable-line no-mixed-operators
	}

	const metricSums = {
		// Counts are exact (SUM(int) accumulates in bigint) but this endpoint sums
		// all of history, so the result is carried as float8 rather than narrowed
		// back to int4 — a cross-tenant all-time request count outgrows 2^31.
		requestCount:
			sql<number>`COALESCE(SUM(${sourceTable.requestCount}), 0)::float8`.as(
				"requestCount",
			),
		errorCount:
			sql<number>`COALESCE(SUM(GREATEST(${sourceTable.errorCount} - ${sourceTable.clientErrorCount}, 0)), 0)::float8`.as(
				"errorCount",
			),
		cacheCount:
			sql<number>`COALESCE(SUM(${sourceTable.cacheCount}), 0)::float8`.as(
				"cacheCount",
			),
		inputTokens:
			sql<number>`COALESCE(SUM(CAST(${sourceTable.inputTokens} AS NUMERIC)), 0)::float8`.as(
				"inputTokens",
			),
		cachedTokens:
			sql<number>`COALESCE(SUM(CAST(${sourceTable.cachedTokens} AS NUMERIC)), 0)::float8`.as(
				"cachedTokens",
			),
		outputTokens:
			sql<number>`COALESCE(SUM(CAST(${sourceTable.outputTokens} AS NUMERIC)), 0)::float8`.as(
				"outputTokens",
			),
		totalTokens:
			sql<number>`COALESCE(SUM(CAST(${sourceTable.totalTokens} AS NUMERIC)), 0)::float8`.as(
				"totalTokens",
			),
		cost: sumMoney(sourceTable.cost, "cost"),
		inputCost: sumMoney(sourceTable.inputCost, "inputCost"),
		cachedInputCost: sumMoney(sourceTable.cachedInputCost, "cachedInputCost"),
		outputCost: sumMoney(sourceTable.outputCost, "outputCost"),
	};

	const dateExpr =
		sql<string>`to_char(${sourceTable.dayTimestamp}, 'YYYY-MM-DD')`.as("date");

	const rangeFilter = and(
		gte(sourceTable.dayTimestamp, startDate),
		lte(sourceTable.dayTimestamp, endDate),
	);
	const scopeFilter = and(rangeFilter, ...dimensionFilter);

	const timeseriesRows = await db
		.select({
			date: dateExpr,
			...metricSums,
		})
		.from(sourceTable)
		.where(scopeFilter)
		.groupBy(sourceTable.dayTimestamp)
		.orderBy(asc(sourceTable.dayTimestamp));

	const timeseriesMap = new Map<
		string,
		z.infer<typeof globalStatsTimeseriesPointSchema>
	>();
	for (const row of timeseriesRows) {
		timeseriesMap.set(row.date, {
			date: row.date,
			requestCount: Number(row.requestCount),
			errorCount: Number(row.errorCount),
			cacheCount: Number(row.cacheCount),
			inputTokens: Number(row.inputTokens),
			cachedTokens: Number(row.cachedTokens),
			outputTokens: Number(row.outputTokens),
			totalTokens: Number(row.totalTokens),
			cost: Number(row.cost),
			inputCost: Number(row.inputCost),
			cachedInputCost: Number(row.cachedInputCost),
			outputCost: Number(row.outputCost),
		});
	}

	const totals: z.infer<typeof globalStatsMetricsSchema> = {
		requestCount: 0,
		errorCount: 0,
		cacheCount: 0,
		inputTokens: 0,
		cachedTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		cost: 0,
		inputCost: 0,
		cachedInputCost: 0,
		outputCost: 0,
	};

	const timeseries: z.infer<typeof globalStatsTimeseriesPointSchema>[] = [];
	for (let i = 0; i < days; i++) {
		const cur = new Date(startDate.getTime() + i * dayMs); // eslint-disable-line no-mixed-operators
		const dateStr = cur.toISOString().split("T")[0];
		const point = timeseriesMap.get(dateStr) ?? {
			date: dateStr,
			requestCount: 0,
			errorCount: 0,
			cacheCount: 0,
			inputTokens: 0,
			cachedTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			cost: 0,
			inputCost: 0,
			cachedInputCost: 0,
			outputCost: 0,
		};
		timeseries.push(point);
		totals.requestCount += point.requestCount;
		totals.errorCount += point.errorCount;
		totals.cacheCount += point.cacheCount;
		totals.inputTokens += point.inputTokens;
		totals.cachedTokens += point.cachedTokens;
		totals.outputTokens += point.outputTokens;
		totals.totalTokens += point.totalTokens;
		totals.cost += point.cost;
		totals.inputCost += point.inputCost;
		totals.cachedInputCost += point.cachedInputCost;
		totals.outputCost += point.outputCost;
	}

	// The dimension the breakdown groups on. `model` needs the per-model table
	// (and its mapping/canonical/provider views); the rest are single columns
	// on the source table.
	const breakdownColumn =
		groupBy === "mode"
			? globalSourceStats.usedMode
			: groupBy === "kind"
				? globalSourceStats.orgKind
				: globalSourceStats.source;

	const breakdownRows =
		groupBy === "model"
			? await db
					.select({
						usedModel: globalModelStats.usedModel,
						usedProvider: globalModelStats.usedProvider,
						...metricSums,
					})
					.from(globalModelStats)
					.where(scopeFilter)
					.groupBy(globalModelStats.usedModel, globalModelStats.usedProvider)
					.orderBy(desc(metricSums.requestCount))
			: await db
					.select({
						dimension: breakdownColumn,
						...metricSums,
					})
					.from(globalSourceStats)
					.where(scopeFilter)
					.groupBy(breakdownColumn)
					.orderBy(desc(metricSums.requestCount));

	const breakdown: z.infer<typeof globalStatsBreakdownItemSchema>[] =
		groupBy === "model" && modelView === "canonical"
			? aggregateBreakdownRows(
					breakdownRows as Array<
						(typeof breakdownRows)[number] & { usedModel: string }
					>,
					(row) => extractCanonicalModelId(row.usedModel),
				)
			: groupBy === "model" && modelView === "provider"
				? aggregateBreakdownRows(
						breakdownRows as Array<
							(typeof breakdownRows)[number] & { usedProvider: string }
						>,
						(row) => row.usedProvider || "unknown",
					)
				: breakdownRows.map((row) => {
						const key =
							"usedModel" in row ? row.usedModel : (row.dimension ?? "unknown");
						return {
							...toBreakdownMetrics(row),
							key,
							label: globalStatsDimensionLabel(groupBy, key),
						};
					});

	const timeseriesBreakdownRows =
		groupBy === "model"
			? await db
					.select({
						date: dateExpr,
						usedModel: globalModelStats.usedModel,
						usedProvider: globalModelStats.usedProvider,
						...metricSums,
					})
					.from(globalModelStats)
					.where(scopeFilter)
					.groupBy(
						globalModelStats.dayTimestamp,
						globalModelStats.usedModel,
						globalModelStats.usedProvider,
					)
			: await db
					.select({
						date: dateExpr,
						dimension: breakdownColumn,
						...metricSums,
					})
					.from(globalSourceStats)
					.where(scopeFilter)
					.groupBy(globalSourceStats.dayTimestamp, breakdownColumn);

	const timeseriesBreakdownMap = new Map<
		string,
		z.infer<typeof globalStatsTimeseriesBreakdownPointSchema>
	>();
	for (const row of timeseriesBreakdownRows) {
		let key: string;
		if (groupBy === "model") {
			const modelRow = row as (typeof timeseriesBreakdownRows)[number] & {
				usedModel: string;
				usedProvider: string;
			};
			key =
				modelView === "canonical"
					? extractCanonicalModelId(modelRow.usedModel)
					: modelView === "provider"
						? modelRow.usedProvider || "unknown"
						: modelRow.usedModel;
		} else {
			key =
				(
					row as (typeof timeseriesBreakdownRows)[number] & {
						dimension: string;
					}
				).dimension ?? "unknown";
		}
		const mapKey = `${row.date}:${key}`;
		const existing = timeseriesBreakdownMap.get(mapKey);
		if (existing) {
			existing.requestCount += Number(row.requestCount);
			existing.cost += Number(row.cost);
			existing.totalTokens += Number(row.totalTokens);
		} else {
			timeseriesBreakdownMap.set(mapKey, {
				date: row.date,
				key,
				label: globalStatsDimensionLabel(groupBy, key),
				requestCount: Number(row.requestCount),
				cost: Number(row.cost),
				totalTokens: Number(row.totalTokens),
			});
		}
	}
	const timeseriesBreakdown = Array.from(timeseriesBreakdownMap.values());

	// Composition of the range along each dimension, each honouring the *other*
	// filter so both always add up to `totals`.
	const compositionSums = {
		requestCount: metricSums.requestCount,
		cost: metricSums.cost,
		totalTokens: metricSums.totalTokens,
	};
	const [byModeRows, byKindRows] = await Promise.all([
		db
			.select({ dimension: sourceTable.usedMode, ...compositionSums })
			.from(sourceTable)
			.where(and(rangeFilter, ...kindFilter))
			.groupBy(sourceTable.usedMode)
			.orderBy(desc(compositionSums.requestCount)),
		db
			.select({ dimension: sourceTable.orgKind, ...compositionSums })
			.from(sourceTable)
			.where(and(rangeFilter, ...modeFilter))
			.groupBy(sourceTable.orgKind)
			.orderBy(desc(compositionSums.requestCount)),
	]);

	const toCompositionItem = (
		dimension: "mode" | "kind",
		row: {
			dimension: string | null;
			requestCount: number | string;
			cost: number | string;
			totalTokens: number | string;
		},
	) => ({
		key: row.dimension ?? "unknown",
		label: globalStatsDimensionLabel(dimension, row.dimension ?? "unknown"),
		requestCount: Number(row.requestCount),
		cost: Number(row.cost),
		totalTokens: Number(row.totalTokens),
	});

	return c.json({
		start: startDate.toISOString().split("T")[0],
		end: endDate.toISOString().split("T")[0],
		groupBy,
		modelView,
		mode,
		kind,
		totals,
		composition: {
			byMode: byModeRows.map((row) => toCompositionItem("mode", row)),
			byKind: byKindRows.map((row) => toCompositionItem("kind", row)),
		},
		timeseries,
		timeseriesBreakdown,
		breakdown,
	});
});

// `used_model` in global_model_stats is stored as `<provider>/<canonical-model>[:<region>]`
// (e.g. `google-ai-studio/gemini-embedding-2`, `alibaba/deepseek-v4-flash:singapore`).
// The canonical id is the segment between the first `/` and the optional `:`.
function extractCanonicalModelId(usedModel: string): string {
	const slashIdx = usedModel.indexOf("/");
	const withoutProvider =
		slashIdx === -1 ? usedModel : usedModel.slice(slashIdx + 1);
	const colonIdx = withoutProvider.indexOf(":");
	return colonIdx === -1 ? withoutProvider : withoutProvider.slice(0, colonIdx);
}

const GLOBAL_STATS_MODE_LABELS: Record<string, string> = {
	credits: "Credits",
	"api-keys": "BYOK",
	unknown: "Unattributed",
};

// "default" is the plain pay-as-you-go org kind; it reads as PAYG everywhere
// user-facing because "default" says nothing about how the traffic is paid for.
const GLOBAL_STATS_KIND_LABELS: Record<string, string> = {
	default: "PAYG",
	devpass: "DevPass",
	chat: "Chat",
	unknown: "Unattributed",
};

function globalStatsDimensionLabel(dimension: string, key: string): string {
	if (dimension === "mode") {
		return GLOBAL_STATS_MODE_LABELS[key] ?? key;
	}
	if (dimension === "kind") {
		return GLOBAL_STATS_KIND_LABELS[key] ?? key;
	}
	return key;
}

type GlobalStatsRowMetrics = z.infer<typeof globalStatsMetricsSchema>;

function toBreakdownMetrics(
	row: Record<keyof GlobalStatsRowMetrics, number | string>,
): GlobalStatsRowMetrics {
	return {
		requestCount: Number(row.requestCount),
		errorCount: Number(row.errorCount),
		cacheCount: Number(row.cacheCount),
		inputTokens: Number(row.inputTokens),
		cachedTokens: Number(row.cachedTokens),
		outputTokens: Number(row.outputTokens),
		totalTokens: Number(row.totalTokens),
		cost: Number(row.cost),
		inputCost: Number(row.inputCost),
		cachedInputCost: Number(row.cachedInputCost),
		outputCost: Number(row.outputCost),
	};
}

// Collapses per-mapping rows onto a coarser key (canonical model id, provider)
// by summing every metric.
function aggregateBreakdownRows<T extends GlobalStatsRowMetrics>(
	rows: T[],
	keyOf: (row: T) => string,
): z.infer<typeof globalStatsBreakdownItemSchema>[] {
	const aggregated = new Map<
		string,
		z.infer<typeof globalStatsBreakdownItemSchema>
	>();
	for (const row of rows) {
		const key = keyOf(row);
		const existing = aggregated.get(key);
		const metrics = toBreakdownMetrics(row);
		if (!existing) {
			aggregated.set(key, { ...metrics, key, label: key });
			continue;
		}
		for (const metric of Object.keys(
			metrics,
		) as (keyof GlobalStatsRowMetrics)[]) {
			existing[metric] += metrics[metric];
		}
	}
	return Array.from(aggregated.values()).sort(
		(a, b) => b.requestCount - a.requestCount,
	);
}

// `Date.parse` rolls impossible days over instead of rejecting them
// ("2026-02-30" becomes March 2), so round-trip the parsed date and refuse
// anything that did not survive unchanged.
function parseUsageWindowDay(value: string, boundary: "from" | "to"): Date {
	const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
		? new Date(value + "T00:00:00.000Z")
		: new Date(Number.NaN);
	if (
		Number.isNaN(parsed.getTime()) ||
		parsed.toISOString().slice(0, 10) !== value
	) {
		throw new HTTPException(400, {
			message: `Invalid ${boundary} date (expected YYYY-MM-DD)`,
		});
	}
	return parsed;
}

admin.openapi(getOrganizations, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	const offset = query.offset ?? 0;
	const search = query.search;
	const sortBy = query.sortBy ?? "createdAt";
	const sortOrder = query.sortOrder ?? "desc";

	// Usage window for the spend/request/token aggregates. Omitting both dates
	// means all time; supplying only one is rejected rather than silently
	// widening back to all time.
	let usageStartDate: Date | undefined;
	let usageEndDate: Date | undefined;
	if (Boolean(query.from) !== Boolean(query.to)) {
		throw new HTTPException(400, {
			message: "Both from and to are required to narrow the usage window",
		});
	}
	if (query.from && query.to) {
		usageStartDate = parseUsageWindowDay(query.from, "from");
		usageEndDate = parseUsageWindowDay(query.to, "to");
		usageEndDate.setUTCHours(23, 59, 59, 999);
	}

	const whereClause = buildOrganizationSearchFilter(search);

	const [countResult] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
			totalCredits:
				sql<string>`COALESCE(SUM(CAST(${tables.organization.credits} AS NUMERIC)), 0)`.as(
					"totalCredits",
				),
		})
		.from(tables.organization)
		.where(whereClause);

	const total = Number(countResult?.count ?? 0);
	const totalCredits = String(countResult?.totalCredits ?? "0");

	const orderFn = sortOrder === "asc" ? asc : desc;

	// Subquery for all-time credits per org
	const allTimeCredits = db
		.select({
			organizationId: tables.transaction.organizationId,
			total:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.where(eq(tables.transaction.status, "completed"))
		.groupBy(tables.transaction.organizationId)
		.as("all_time_credits");

	// Subquery for usage totals (cost, requests, tokens) per org, scoped to the
	// selected window.
	const totalSpentSub = db
		.select({
			organizationId: tables.project.organizationId,
			total:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
					"total_spent",
				),
			creditsTotal:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
					"credits_spent",
				),
			apiKeysTotal:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.apiKeysCost} AS NUMERIC)), 0)`.as(
					"api_keys_spent",
				),
			requestsTotal:
				sql<string>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
					"total_requests",
				),
			tokensTotal:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.where(
			and(
				usageStartDate
					? gte(projectHourlyStats.hourTimestamp, usageStartDate)
					: undefined,
				usageEndDate
					? lte(projectHourlyStats.hourTimestamp, usageEndDate)
					: undefined,
			),
		)
		.groupBy(tables.project.organizationId)
		.as("total_spent");

	// Subquery for owner user per org
	const ownerSub = buildOrganizationOwnerSubquery();

	const sortColumnMap = {
		name: tables.organization.name,
		billingEmail: tables.organization.billingEmail,
		plan: tables.organization.plan,
		devPlan: tables.organization.devPlan,
		credits: tables.organization.credits,
		createdAt: tables.organization.createdAt,
		status: tables.organization.status,
		totalCreditsAllTime: sql`COALESCE(CAST(${allTimeCredits.total} AS NUMERIC), 0)`,
		totalSpent: sql`COALESCE(CAST(${totalSpentSub.total} AS NUMERIC), 0)`,
		totalRequests: sql`COALESCE(CAST(${totalSpentSub.requestsTotal} AS NUMERIC), 0)`,
		totalTokens: sql`COALESCE(CAST(${totalSpentSub.tokensTotal} AS NUMERIC), 0)`,
	} as const;

	const sortColumn = sortColumnMap[sortBy];

	const organizations = await db
		.select({
			id: tables.organization.id,
			name: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
			kind: tables.organization.kind,
			plan: tables.organization.plan,
			devPlan: tables.organization.devPlan,
			planExpiresAt: tables.organization.planExpiresAt,
			planStartedAt: tables.organization.planStartedAt,
			isTrialActive: tables.organization.isTrialActive,
			trialStartDate: tables.organization.trialStartDate,
			trialEndDate: tables.organization.trialEndDate,
			credits: tables.organization.credits,
			createdAt: tables.organization.createdAt,
			status: tables.organization.status,
			riskFlagged: tables.organization.riskFlagged,
			totalCreditsAllTime:
				sql<string>`COALESCE(${allTimeCredits.total}, '0')`.as(
					"totalCreditsAllTime",
				),
			totalSpent: sql<string>`COALESCE(${totalSpentSub.total}, '0')`.as(
				"totalSpent",
			),
			totalCreditsSpent:
				sql<string>`COALESCE(${totalSpentSub.creditsTotal}, '0')`.as(
					"totalCreditsSpent",
				),
			totalApiKeysSpent:
				sql<string>`COALESCE(${totalSpentSub.apiKeysTotal}, '0')`.as(
					"totalApiKeysSpent",
				),
			totalRequests:
				sql<string>`COALESCE(${totalSpentSub.requestsTotal}, '0')`.as(
					"totalRequests",
				),
			totalTokens: sql<string>`COALESCE(${totalSpentSub.tokensTotal}, '0')`.as(
				"totalTokens",
			),
			ownerUserId: ownerSub.userId,
			ownerName: ownerSub.userName,
			ownerEmail: ownerSub.userEmail,
		})
		.from(tables.organization)
		.leftJoin(
			allTimeCredits,
			eq(tables.organization.id, allTimeCredits.organizationId),
		)
		.leftJoin(
			totalSpentSub,
			eq(tables.organization.id, totalSpentSub.organizationId),
		)
		.leftJoin(ownerSub, eq(tables.organization.id, ownerSub.organizationId))
		.where(whereClause)
		// Ties (every org with no usage shares 0 requests/tokens) would otherwise
		// come back in an arbitrary order that differs per LIMIT/OFFSET plan, so
		// paging repeats some rows and skips others.
		.orderBy(orderFn(sortColumn), asc(tables.organization.id))
		.limit(limit)
		.offset(offset);

	return c.json({
		organizations: organizations.map((org) => ({
			id: org.id,
			name: org.name,
			billingEmail: org.billingEmail,
			kind: org.kind,
			plan: org.plan,
			devPlan: org.devPlan,
			planExpiresAt: org.planExpiresAt?.toISOString() ?? null,
			planStartedAt: org.planStartedAt?.toISOString() ?? null,
			isTrialActive: org.isTrialActive,
			trialStartDate: org.trialStartDate?.toISOString() ?? null,
			trialEndDate: org.trialEndDate?.toISOString() ?? null,
			credits: String(org.credits),
			totalCreditsAllTime: String(org.totalCreditsAllTime ?? "0"),
			totalSpent: String(org.totalSpent ?? "0"),
			totalCreditsSpent: String(org.totalCreditsSpent ?? "0"),
			totalApiKeysSpent: String(org.totalApiKeysSpent ?? "0"),
			totalRequests: Number(org.totalRequests ?? 0),
			totalTokens: Number(org.totalTokens ?? 0),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
			riskFlagged: org.riskFlagged,
			ownerUserId: org.ownerUserId ?? null,
			ownerName: org.ownerName ?? null,
			ownerEmail: org.ownerEmail ?? null,
		})),
		total,
		totalCredits,
		limit,
		offset,
	});
});

admin.openapi(getOrganizationMetrics, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const windowParam = query.window ?? "1d";

	// Fetch organization
	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	// Get projects for this organization
	const projects = await db
		.select({ id: tables.project.id })
		.from(tables.project)
		.where(eq(tables.project.organizationId, orgId));

	const projectIds = projects.map((p) => p.id);

	const now = new Date();
	const windowHours: Record<string, number> = {
		"1h": 1,
		"4h": 4,
		"12h": 12,
		"1d": 24,
		"7d": 7 * 24,
		"30d": 30 * 24,
		"90d": 90 * 24,
		"365d": 365 * 24,
	};
	const hours = windowHours[windowParam] ?? 24;
	// eslint-disable-next-line no-mixed-operators
	const startDate = new Date(now.getTime() - hours * 60 * 60 * 1000);

	let totalRequests = 0;
	let totalTokens = 0;
	let totalCost = 0;
	let creditsRequestCount = 0;
	let apiKeysRequestCount = 0;
	let creditsCost = 0;
	let apiKeysCost = 0;
	let inputTokens = 0;
	let inputCost = 0;
	let outputTokens = 0;
	let outputCost = 0;
	let cachedTokens = 0;
	let cachedCost = 0;
	let cacheWriteTokens = 0;
	let cacheWriteCost = 0;
	let dataStorageCost = 0;
	let discountSavings = 0;
	let mostUsedModel: string | null = null;
	let mostUsedProvider: string | null = null;
	let mostUsedModelCost = 0;

	if (projectIds.length > 0) {
		// Query aggregated project stats for totals
		const [totals] = await db
			.select({
				totalRequests:
					sql<number>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
						"totalRequests",
					),
				...modeSplitFields(projectHourlyStats),
				inputTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.inputTokens} AS INTEGER)), 0)`.as(
						"inputTokens",
					),
				outputTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.outputTokens} AS INTEGER)), 0)`.as(
						"outputTokens",
					),
				cachedTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.cachedTokens} AS INTEGER)), 0)`.as(
						"cachedTokens",
					),
				cacheWriteTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.cacheWriteTokens} AS INTEGER)), 0)`.as(
						"cacheWriteTokens",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS INTEGER)), 0)`.as(
						"totalTokens",
					),
				totalCost:
					sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cost} as double precision)), 0)`.as(
						"totalCost",
					),
				inputCost:
					sql<number>`COALESCE(SUM(cast(${projectHourlyStats.inputCost} as double precision)), 0)`.as(
						"inputCost",
					),
				outputCost:
					sql<number>`COALESCE(SUM(cast(${projectHourlyStats.outputCost} as double precision)), 0)`.as(
						"outputCost",
					),
				discountSavings:
					sql<number>`COALESCE(SUM(cast(${projectHourlyStats.discountSavings} as double precision)), 0)`.as(
						"discountSavings",
					),
				cachedInputCost:
					sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cachedInputCost} as double precision)), 0)`.as(
						"cachedInputCost",
					),
				cacheWriteInputCost:
					sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cacheWriteInputCost} as double precision)), 0)`.as(
						"cacheWriteInputCost",
					),
				dataStorageCost:
					sql<number>`COALESCE(SUM(cast(${projectHourlyStats.dataStorageCost} as double precision)), 0)`.as(
						"dataStorageCost",
					),
			})
			.from(projectHourlyStats)
			.where(
				and(
					inArray(projectHourlyStats.projectId, projectIds),
					gte(projectHourlyStats.hourTimestamp, startDate),
					lt(projectHourlyStats.hourTimestamp, now),
				),
			);

		if (totals) {
			totalRequests = Number(totals.totalRequests) || 0;
			totalTokens = Number(totals.totalTokens) || 0;
			totalCost = Number(totals.totalCost) || 0;
			creditsRequestCount = Number(totals.creditsRequestCount) || 0;
			apiKeysRequestCount = Number(totals.apiKeysRequestCount) || 0;
			creditsCost = Number(totals.creditsCost) || 0;
			apiKeysCost = Number(totals.apiKeysCost) || 0;
			inputTokens = Number(totals.inputTokens) || 0;
			inputCost = Number(totals.inputCost) || 0;
			outputTokens = Number(totals.outputTokens) || 0;
			outputCost = Number(totals.outputCost) || 0;
			cachedTokens = Number(totals.cachedTokens) || 0;
			cachedCost = Number(totals.cachedInputCost) || 0;
			cacheWriteTokens = Number(totals.cacheWriteTokens) || 0;
			cacheWriteCost = Number(totals.cacheWriteInputCost) || 0;
			dataStorageCost = Number(totals.dataStorageCost) || 0;
			discountSavings = Number(totals.discountSavings) || 0;
		}

		// Query model stats for most used model (by cost)
		const modelRows = await db
			.select({
				usedModel: projectHourlyModelStats.usedModel,
				usedProvider: projectHourlyModelStats.usedProvider,
				totalCost:
					sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
						"totalCost",
					),
			})
			.from(projectHourlyModelStats)
			.where(
				and(
					inArray(projectHourlyModelStats.projectId, projectIds),
					gte(projectHourlyModelStats.hourTimestamp, startDate),
					lt(projectHourlyModelStats.hourTimestamp, now),
				),
			)
			.groupBy(
				projectHourlyModelStats.usedModel,
				projectHourlyModelStats.usedProvider,
			);

		for (const row of modelRows) {
			const rowCost = Number(row.totalCost) || 0;
			if (rowCost > mostUsedModelCost) {
				mostUsedModelCost = rowCost;
				mostUsedModel = row.usedModel;
				mostUsedProvider = row.usedProvider;
			}
		}
	}

	const qualifyingSpendUsd = await getOrgTierQualifyingSpendUsd(orgId);
	const trustTierResolved = getOrgSpendTier(org, qualifyingSpendUsd);
	const orgPlanClass = getPlanClass(org);
	const trustTier = {
		exempt:
			org.plan === "enterprise"
				? ("enterprise" as const)
				: orgPlanClass === "dev"
					? ("dev" as const)
					: orgPlanClass === "chat"
						? ("chat" as const)
						: ("none" as const),
		tier: trustTierResolved.tier,
		overridden: resolveTrustTierOverride(org) !== null,
		accountAgeDays: Math.floor(
			(Date.now() - org.createdAt.getTime()) / 86_400_000,
		),
		qualifyingSpendUsd: Math.round(qualifyingSpendUsd * 100) / 100,
		rpmMultiplier: trustTierResolved.rpmMultiplier,
		dailyCapUsd: trustTierResolved.dailyCapUsd,
		monthlyCapUsd: trustTierResolved.monthlyCapUsd,
		topUpDailyCapUsd: trustTierResolved.topUpDailyCapUsd,
	};

	return c.json({
		organization: {
			id: org.id,
			name: org.name,
			billingEmail: org.billingEmail,
			kind: org.kind,
			plan: org.plan,
			devPlan: org.devPlan,
			planExpiresAt: org.planExpiresAt?.toISOString() ?? null,
			planStartedAt: org.planStartedAt?.toISOString() ?? null,
			isTrialActive: org.isTrialActive,
			trialStartDate: org.trialStartDate?.toISOString() ?? null,
			trialEndDate: org.trialEndDate?.toISOString() ?? null,
			seats: org.seats,
			apiKeyLimit: org.apiKeyLimit,
			projectLimit: org.projectLimit,
			credits: String(org.credits),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
			riskFlagged: org.riskFlagged,
		},
		trustTier,
		window: windowParam,
		startDate: startDate.toISOString(),
		endDate: now.toISOString(),
		totalRequests,
		totalTokens,
		totalCost,
		creditsRequestCount,
		apiKeysRequestCount,
		creditsCost,
		apiKeysCost,
		inputTokens,
		inputCost,
		outputTokens,
		outputCost,
		cachedTokens,
		cachedCost,
		cacheWriteTokens,
		cacheWriteCost,
		dataStorageCost,
		mostUsedModel,
		mostUsedProvider,
		mostUsedModelCost,
		discountSavings,
	});
});

admin.openapi(getOrganizationTransactions, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const limit = query.limit ?? 25;
	const offset = query.offset ?? 0;

	// Verify organization exists
	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	// Get total count
	const [countResult] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.transaction)
		.where(eq(tables.transaction.organizationId, orgId));

	const total = Number(countResult?.count ?? 0);

	// Fetch paginated transactions for this organization
	const transactions = await db
		.select({
			id: tables.transaction.id,
			createdAt: tables.transaction.createdAt,
			type: tables.transaction.type,
			amount: tables.transaction.amount,
			creditAmount: tables.transaction.creditAmount,
			currency: tables.transaction.currency,
			status: tables.transaction.status,
			description: tables.transaction.description,
			paymentMethod: tables.transaction.paymentMethod,
			externalReference: tables.transaction.externalReference,
			stripePaymentIntentId: tables.transaction.stripePaymentIntentId,
			stripeInvoiceId: tables.transaction.stripeInvoiceId,
			stripeRefundId: tables.transaction.stripeRefundId,
		})
		.from(tables.transaction)
		.where(eq(tables.transaction.organizationId, orgId))
		.orderBy(desc(tables.transaction.createdAt))
		.limit(limit)
		.offset(offset);

	return c.json({
		organization: {
			id: org.id,
			name: org.name,
			billingEmail: org.billingEmail,
			kind: org.kind,
			plan: org.plan,
			devPlan: org.devPlan,
			planExpiresAt: org.planExpiresAt?.toISOString() ?? null,
			planStartedAt: org.planStartedAt?.toISOString() ?? null,
			isTrialActive: org.isTrialActive,
			trialStartDate: org.trialStartDate?.toISOString() ?? null,
			trialEndDate: org.trialEndDate?.toISOString() ?? null,
			seats: org.seats,
			apiKeyLimit: org.apiKeyLimit,
			projectLimit: org.projectLimit,
			credits: String(org.credits),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
			riskFlagged: org.riskFlagged,
			referralBonusEnabled: org.referralBonusEnabled,
			referralBonusPercent: parseReferralBonusPercent(org.referralBonusPercent),
		},
		transactions: transactions.map((t) => ({
			id: t.id,
			createdAt: t.createdAt.toISOString(),
			type: t.type,
			amount: t.amount ? String(t.amount) : null,
			creditAmount: t.creditAmount ? String(t.creditAmount) : null,
			currency: t.currency,
			status: t.status,
			description: t.description,
			paymentMethod: t.paymentMethod,
			externalReference: t.externalReference,
			stripePaymentIntentId: t.stripePaymentIntentId,
			stripeInvoiceId: t.stripeInvoiceId,
			stripeRefundId: t.stripeRefundId,
		})),
		total,
		limit,
		offset,
	});
});

admin.openapi(getOrganizationProjects, async (c) => {
	const { orgId } = c.req.valid("param");

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const projects = await db
		.select({
			id: tables.project.id,
			name: tables.project.name,
			mode: tables.project.mode,
			status: tables.project.status,
			cachingEnabled: tables.project.cachingEnabled,
			createdAt: tables.project.createdAt,
		})
		.from(tables.project)
		.where(eq(tables.project.organizationId, orgId))
		.orderBy(desc(tables.project.createdAt));

	return c.json({
		projects: projects.map((p) => ({
			...p,
			createdAt: p.createdAt.toISOString(),
		})),
		total: projects.length,
	});
});

admin.openapi(getOrganizationApiKeys, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const limit = query.limit ?? 25;
	const offset = query.offset ?? 0;
	const status = query.status ?? "active";

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const projectIds = await db
		.select({ id: tables.project.id })
		.from(tables.project)
		.where(eq(tables.project.organizationId, orgId));

	const ids = projectIds.map((p) => p.id);

	if (ids.length === 0) {
		return c.json({
			apiKeys: [],
			total: 0,
			limit,
			offset,
			counts: emptyKeyStatusCounts(),
		});
	}

	const apiKeyStatusExpr = sql<string>`COALESCE(${tables.apiKey.status}, 'active')`;
	const countRows = await db
		.select({
			status: apiKeyStatusExpr,
			count: sql<number>`COUNT(*)`,
		})
		.from(tables.apiKey)
		.where(inArray(tables.apiKey.projectId, ids))
		.groupBy(apiKeyStatusExpr);

	const counts = toKeyStatusCounts(countRows);
	const total = status === "all" ? counts.all : counts[status];

	const apiKeys = await db
		.select({
			id: tables.apiKey.id,
			legacyToken: tables.apiKey.token,
			tokenMasked: tables.apiKey.tokenMasked,
			description: tables.apiKey.description,
			status: tables.apiKey.status,
			usage: tables.apiKey.usage,
			usageLimit: tables.apiKey.usageLimit,
			projectId: tables.apiKey.projectId,
			projectName: tables.project.name,
			createdAt: tables.apiKey.createdAt,
		})
		.from(tables.apiKey)
		.innerJoin(tables.project, eq(tables.apiKey.projectId, tables.project.id))
		.where(
			and(
				inArray(tables.apiKey.projectId, ids),
				keyStatusCondition(tables.apiKey.status, status),
			),
		)
		.orderBy(desc(tables.apiKey.createdAt))
		.limit(limit)
		.offset(offset);

	const apiKeyIds = apiKeys.map((k) => k.id);
	const iamRules = apiKeyIds.length
		? await db
				.select()
				.from(tables.apiKeyIamRule)
				.where(inArray(tables.apiKeyIamRule.apiKeyId, apiKeyIds))
				.orderBy(desc(tables.apiKeyIamRule.createdAt))
		: [];

	const rulesByKey = new Map<string, typeof iamRules>();
	for (const rule of iamRules) {
		const list = rulesByKey.get(rule.apiKeyId) ?? [];
		list.push(rule);
		rulesByKey.set(rule.apiKeyId, list);
	}

	return c.json({
		apiKeys: apiKeys.map((k) => ({
			...k,
			token: k.tokenMasked ?? maskToken(k.legacyToken ?? ""),
			legacyToken: undefined,
			tokenMasked: undefined,
			usage: String(k.usage),
			usageLimit: k.usageLimit ? String(k.usageLimit) : null,
			createdAt: k.createdAt.toISOString(),
			iamRules: (rulesByKey.get(k.id) ?? []).map((r) => ({
				id: r.id,
				createdAt: r.createdAt.toISOString(),
				updatedAt: r.updatedAt.toISOString(),
				apiKeyId: r.apiKeyId,
				ruleType: r.ruleType,
				ruleValue: r.ruleValue,
				status: r.status,
			})),
		})),
		total,
		limit,
		offset,
		counts,
	});
});

admin.openapi(getOrganizationProviderKeys, async (c) => {
	const { orgId } = c.req.valid("param");
	const status = c.req.valid("query").status ?? "active";

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const providerKeyStatusExpr = sql<string>`COALESCE(${tables.providerKey.status}, 'active')`;
	const providerKeyCountRows = await db
		.select({
			status: providerKeyStatusExpr,
			count: sql<number>`COUNT(*)`,
		})
		.from(tables.providerKey)
		.where(eq(tables.providerKey.organizationId, orgId))
		.groupBy(providerKeyStatusExpr);

	const counts = toKeyStatusCounts(providerKeyCountRows);

	const providerKeys = await db
		.select({
			id: tables.providerKey.id,
			// Legacy pre-encryption rows still carry plaintext here; it is selected
			// only to compute the mask below and must never reach the response.
			legacyToken: tables.providerKey.token,
			tokenMasked: tables.providerKey.tokenMasked,
			tokenHash: tables.providerKey.tokenHash,
			provider: tables.providerKey.provider,
			name: tables.providerKey.name,
			description: tables.providerKey.description,
			baseUrl: tables.providerKey.baseUrl,
			status: tables.providerKey.status,
			usageLimit: tables.providerKey.usageLimit,
			usage: tables.providerKey.usage,
			createdAt: tables.providerKey.createdAt,
			updatedAt: tables.providerKey.updatedAt,
		})
		.from(tables.providerKey)
		.where(
			and(
				eq(tables.providerKey.organizationId, orgId),
				keyStatusCondition(tables.providerKey.status, status),
			),
		)
		.orderBy(desc(tables.providerKey.createdAt));

	return c.json({
		// Explicit allowlist, never a spread of the row: a provider token is
		// write-only once stored, and an admin identifies a key by its mask and
		// its `tokenHash` (which matches `log.usedApiKeyHash`).
		providerKeys: providerKeys.map((k) => ({
			id: k.id,
			token: k.tokenMasked ?? maskToken(k.legacyToken ?? "", 6),
			tokenHash: k.tokenHash,
			provider: k.provider,
			name: k.name,
			description: k.description,
			baseUrl: k.baseUrl,
			status: k.status,
			usageLimit: k.usageLimit,
			usage: k.usage,
			createdAt: k.createdAt.toISOString(),
			updatedAt: k.updatedAt.toISOString(),
		})),
		total: providerKeys.length,
		counts,
	});
});

admin.openapi(getOrganizationMembers, async (c) => {
	const { orgId } = c.req.valid("param");

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const members = await db
		.select({
			id: tables.userOrganization.id,
			userId: tables.userOrganization.userId,
			role: tables.userOrganization.role,
			createdAt: tables.userOrganization.createdAt,
			userName: tables.user.name,
			userEmail: tables.user.email,
			userEmailVerified: tables.user.emailVerified,
		})
		.from(tables.userOrganization)
		.innerJoin(tables.user, eq(tables.userOrganization.userId, tables.user.id))
		.where(eq(tables.userOrganization.organizationId, orgId))
		.orderBy(desc(tables.userOrganization.createdAt));

	return c.json({
		members: members.map((m) => ({
			id: m.id,
			userId: m.userId,
			role: m.role,
			createdAt: m.createdAt.toISOString(),
			user: {
				id: m.userId,
				email: m.userEmail,
				name: m.userName,
				emailVerified: m.userEmailVerified,
			},
		})),
		total: members.length,
	});
});

// ==================== Project-Level Endpoints ====================

const projectMetricsSchema = z.object({
	project: projectSchema,
	window: tokenWindowSchema,
	startDate: z.string(),
	endDate: z.string(),
	totalRequests: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	creditsRequestCount: z.number(),
	apiKeysRequestCount: z.number(),
	creditsCost: z.number(),
	apiKeysCost: z.number(),
	inputTokens: z.number(),
	inputCost: z.number(),
	outputTokens: z.number(),
	outputCost: z.number(),
	cachedTokens: z.number(),
	cachedCost: z.number(),
	cacheWriteTokens: z.number(),
	cacheWriteCost: z.number(),
	dataStorageCost: z.number(),
	mostUsedModel: z.string().nullable(),
	mostUsedProvider: z.string().nullable(),
	mostUsedModelCost: z.number(),
	discountSavings: z.number(),
});

const getProjectMetrics = createRoute({
	method: "get",
	path: "/organizations/{orgId}/projects/{projectId}/metrics",
	request: {
		params: z.object({
			orgId: z.string(),
			projectId: z.string(),
		}),
		query: z.object({
			window: tokenWindowSchema.default("1d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: projectMetricsSchema.openapi({}),
				},
			},
			description: "Project metrics.",
		},
		404: {
			description: "Project not found.",
		},
	},
});

admin.openapi(getProjectMetrics, async (c) => {
	const { orgId, projectId } = c.req.valid("param");
	const query = c.req.valid("query");
	const windowParam = query.window ?? "1d";

	// Fetch project and verify it belongs to the organization
	const project = await db.query.project.findFirst({
		where: {
			id: { eq: projectId },
			organizationId: { eq: orgId },
		},
	});

	if (!project) {
		throw new HTTPException(404, {
			message: "Project not found",
		});
	}

	const now = new Date();
	const windowHours: Record<string, number> = {
		"1h": 1,
		"4h": 4,
		"12h": 12,
		"1d": 24,
		"7d": 7 * 24,
		"30d": 30 * 24,
		"90d": 90 * 24,
		"365d": 365 * 24,
	};
	const hours = windowHours[windowParam] ?? 24;
	// eslint-disable-next-line no-mixed-operators
	const startDate = new Date(now.getTime() - hours * 60 * 60 * 1000);

	let totalRequests = 0;
	let totalTokens = 0;
	let totalCost = 0;
	let creditsRequestCount = 0;
	let apiKeysRequestCount = 0;
	let creditsCost = 0;
	let apiKeysCost = 0;
	let inputTokens = 0;
	let inputCost = 0;
	let outputTokens = 0;
	let outputCost = 0;
	let cachedTokens = 0;
	let cachedCost = 0;
	let cacheWriteTokens = 0;
	let cacheWriteCost = 0;
	let dataStorageCost = 0;
	let discountSavings = 0;
	let mostUsedModel: string | null = null;
	let mostUsedProvider: string | null = null;
	let mostUsedModelCost = 0;

	const [totals] = await db
		.select({
			totalRequests:
				sql<number>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
					"totalRequests",
				),
			...modeSplitFields(projectHourlyStats),
			inputTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.inputTokens} AS INTEGER)), 0)`.as(
					"inputTokens",
				),
			outputTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.outputTokens} AS INTEGER)), 0)`.as(
					"outputTokens",
				),
			cachedTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.cachedTokens} AS INTEGER)), 0)`.as(
					"cachedTokens",
				),
			cacheWriteTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.cacheWriteTokens} AS INTEGER)), 0)`.as(
					"cacheWriteTokens",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS INTEGER)), 0)`.as(
					"totalTokens",
				),
			totalCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cost} as double precision)), 0)`.as(
					"totalCost",
				),
			inputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.inputCost} as double precision)), 0)`.as(
					"inputCost",
				),
			outputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.outputCost} as double precision)), 0)`.as(
					"outputCost",
				),
			discountSavings:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.discountSavings} as double precision)), 0)`.as(
					"discountSavings",
				),
			cachedInputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cachedInputCost} as double precision)), 0)`.as(
					"cachedInputCost",
				),
			cacheWriteInputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cacheWriteInputCost} as double precision)), 0)`.as(
					"cacheWriteInputCost",
				),
			dataStorageCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.dataStorageCost} as double precision)), 0)`.as(
					"dataStorageCost",
				),
		})
		.from(projectHourlyStats)
		.where(
			and(
				eq(projectHourlyStats.projectId, projectId),
				gte(projectHourlyStats.hourTimestamp, startDate),
				lt(projectHourlyStats.hourTimestamp, now),
			),
		);

	if (totals) {
		totalRequests = Number(totals.totalRequests) || 0;
		totalTokens = Number(totals.totalTokens) || 0;
		totalCost = Number(totals.totalCost) || 0;
		creditsRequestCount = Number(totals.creditsRequestCount) || 0;
		apiKeysRequestCount = Number(totals.apiKeysRequestCount) || 0;
		creditsCost = Number(totals.creditsCost) || 0;
		apiKeysCost = Number(totals.apiKeysCost) || 0;
		inputTokens = Number(totals.inputTokens) || 0;
		inputCost = Number(totals.inputCost) || 0;
		outputTokens = Number(totals.outputTokens) || 0;
		outputCost = Number(totals.outputCost) || 0;
		cachedTokens = Number(totals.cachedTokens) || 0;
		cachedCost = Number(totals.cachedInputCost) || 0;
		cacheWriteTokens = Number(totals.cacheWriteTokens) || 0;
		cacheWriteCost = Number(totals.cacheWriteInputCost) || 0;
		dataStorageCost = Number(totals.dataStorageCost) || 0;
		discountSavings = Number(totals.discountSavings) || 0;
	}

	// Query model stats for most used model (by cost)
	const modelRows = await db
		.select({
			usedModel: projectHourlyModelStats.usedModel,
			usedProvider: projectHourlyModelStats.usedProvider,
			totalCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
					"totalCost",
				),
		})
		.from(projectHourlyModelStats)
		.where(
			and(
				eq(projectHourlyModelStats.projectId, projectId),
				gte(projectHourlyModelStats.hourTimestamp, startDate),
				lt(projectHourlyModelStats.hourTimestamp, now),
			),
		)
		.groupBy(
			projectHourlyModelStats.usedModel,
			projectHourlyModelStats.usedProvider,
		);

	for (const row of modelRows) {
		const rowCost = Number(row.totalCost) || 0;
		if (rowCost > mostUsedModelCost) {
			mostUsedModelCost = rowCost;
			mostUsedModel = row.usedModel;
			mostUsedProvider = row.usedProvider;
		}
	}

	return c.json({
		project: {
			id: project.id,
			name: project.name,
			mode: project.mode,
			status: project.status,
			cachingEnabled: project.cachingEnabled,
			createdAt: project.createdAt.toISOString(),
		},
		window: windowParam,
		startDate: startDate.toISOString(),
		endDate: now.toISOString(),
		totalRequests,
		totalTokens,
		totalCost,
		creditsRequestCount,
		apiKeysRequestCount,
		creditsCost,
		apiKeysCost,
		inputTokens,
		inputCost,
		outputTokens,
		outputCost,
		cachedTokens,
		cachedCost,
		cacheWriteTokens,
		cacheWriteCost,
		dataStorageCost,
		mostUsedModel,
		mostUsedProvider,
		mostUsedModelCost,
		discountSavings,
	});
});

const logEntrySchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	duration: z.number(),
	requestedModel: z.string().nullable(),
	usedModel: z.string(),
	usedProvider: z.string(),
	usedModelMapping: z.string().nullable(),
	requestId: z.string().nullable(),
	traceId: z.string().nullable(),
	sessionId: z.string().nullable(),
	projectId: z.string(),
	organizationId: z.string(),
	apiKeyId: z.string(),
	promptTokens: z.string().nullable(),
	completionTokens: z.string().nullable(),
	totalTokens: z.string().nullable(),
	reasoningTokens: z.string().nullable(),
	cachedTokens: z.string().nullable(),
	cacheWriteTokens: z.string().nullable(),
	imageInputTokens: z.string().nullable(),
	imageOutputTokens: z.string().nullable(),
	cost: z.number().nullable(),
	inputCost: z.number().nullable(),
	outputCost: z.number().nullable(),
	cachedInputCost: z.number().nullable(),
	cacheWriteInputCost: z.number().nullable(),
	requestCost: z.number().nullable(),
	webSearchCost: z.number().nullable(),
	contentFilterCost: z.number().nullable(),
	imageInputCost: z.number().nullable(),
	imageOutputCost: z.number().nullable(),
	videoOutputCost: z.number().nullable(),
	dataStorageCost: z.number().nullable(),
	hasError: z.boolean().nullable(),
	errorDetails: z.any().nullable(),
	internalErrorDetails: z.any().nullable(),
	finishReason: z.string().nullable(),
	unifiedFinishReason: z.string().nullable(),
	cached: z.boolean().nullable(),
	streamed: z.boolean().nullable(),
	canceled: z.boolean().nullable(),
	retried: z.boolean().nullable(),
	retriedByLogId: z.string().nullable(),
	apiOrigin: z.string().nullable(),
	source: z.string().nullable(),
	content: z.string().nullable(),
	reasoningContent: z.string().nullable(),
	mode: z.string(),
	usedMode: z.string(),
	discount: z.number().nullable(),
	pricingTier: z.string().nullable(),
	timeToFirstToken: z.number().nullable(),
	timeToFirstReasoningToken: z.number().nullable(),
	responseSize: z.number().nullable(),
	temperature: z.number().nullable(),
	maxTokens: z.number().nullable(),
	topP: z.number().nullable(),
	frequencyPenalty: z.number().nullable(),
	reasoningEffort: z.string().nullable(),
	reasoningMaxTokens: z.number().nullable(),
	effort: z.string().nullable(),
	responseFormat: z.any().nullable(),
	tools: z.any().nullable(),
	toolChoice: z.any().nullable(),
	toolResults: z.any().nullable(),
	messages: z.any().nullable(),
	params: z.any().nullable(),
	plugins: z.array(z.string()).nullable(),
	pluginResults: z.any().nullable(),
	customHeaders: z.any().nullable(),
	routingMetadata: z.any().nullable(),
});

const projectLogsSchema = z.object({
	logs: z.array(logEntrySchema),
	pagination: z.object({
		nextCursor: z.string().nullable(),
		hasMore: z.boolean(),
		limit: z.number(),
	}),
});

const getProjectLogs = createRoute({
	method: "get",
	path: "/organizations/{orgId}/projects/{projectId}/logs",
	request: {
		params: z.object({
			orgId: z.string(),
			projectId: z.string(),
		}),
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			cursor: z.string().optional(),
			provider: z.string().optional(),
			model: z.string().optional(),
			source: z.string().optional(),
			unifiedFinishReason: z.string().optional(),
			hasError: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: projectLogsSchema.openapi({}),
				},
			},
			description: "Project logs.",
		},
		404: {
			description: "Project not found.",
		},
	},
});

admin.openapi(getProjectLogs, async (c) => {
	const { orgId, projectId } = c.req.valid("param");
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	const { cursor, provider, model, source, unifiedFinishReason, hasError } =
		query;

	// Verify project belongs to the organization
	const project = await db.query.project.findFirst({
		where: {
			id: { eq: projectId },
			organizationId: { eq: orgId },
		},
	});

	if (!project) {
		throw new HTTPException(404, {
			message: "Project not found",
		});
	}

	const whereConditions = [eq(tables.log.projectId, projectId)];

	// Add filter conditions
	if (provider) {
		const providerValues = provider.split(",").filter(Boolean);
		if (providerValues.length === 1) {
			whereConditions.push(eq(tables.log.usedProvider, providerValues[0]));
		} else if (providerValues.length > 1) {
			whereConditions.push(inArray(tables.log.usedProvider, providerValues));
		}
	}

	if (model) {
		whereConditions.push(
			sql`CASE WHEN ${tables.log.usedModel} LIKE '%/%'
				THEN SPLIT_PART(${tables.log.usedModel}, '/', 2)
				ELSE ${tables.log.usedModel}
			END = ${model}`,
		);
	}

	if (source) {
		whereConditions.push(eq(tables.log.source, source));
	}

	if (unifiedFinishReason) {
		whereConditions.push(
			eq(tables.log.unifiedFinishReason, unifiedFinishReason),
		);
	}

	if (hasError === "true") {
		whereConditions.push(eq(tables.log.hasError, true));
	}

	if (cursor) {
		const cursorLog = await db
			.select({ createdAt: tables.log.createdAt })
			.from(tables.log)
			.where(eq(tables.log.id, cursor))
			.limit(1);

		if (cursorLog.length === 0) {
			throw new HTTPException(400, {
				message: "Invalid or stale cursor",
			});
		}

		const cursorCreatedAt = cursorLog[0].createdAt;
		whereConditions.push(
			or(
				lt(tables.log.createdAt, cursorCreatedAt),
				and(
					eq(tables.log.createdAt, cursorCreatedAt),
					lt(tables.log.id, cursor),
				),
			)!,
		);
	}

	const logRows = await db
		.select({
			id: tables.log.id,
			createdAt: tables.log.createdAt,
			duration: tables.log.duration,
			requestedModel: tables.log.requestedModel,
			usedModel: tables.log.usedModel,
			usedProvider: tables.log.usedProvider,
			usedModelMapping: tables.log.usedModelMapping,
			requestId: tables.log.requestId,
			traceId: tables.log.traceId,
			sessionId: tables.log.sessionId,
			projectId: tables.log.projectId,
			organizationId: tables.log.organizationId,
			apiKeyId: tables.log.apiKeyId,
			promptTokens: tables.log.promptTokens,
			completionTokens: tables.log.completionTokens,
			totalTokens: tables.log.totalTokens,
			reasoningTokens: tables.log.reasoningTokens,
			cachedTokens: tables.log.cachedTokens,
			cacheWriteTokens: tables.log.cacheWriteTokens,
			imageInputTokens: tables.log.imageInputTokens,
			imageOutputTokens: tables.log.imageOutputTokens,
			cost: tables.log.cost,
			inputCost: tables.log.inputCost,
			outputCost: tables.log.outputCost,
			cachedInputCost: tables.log.cachedInputCost,
			cacheWriteInputCost: tables.log.cacheWriteInputCost,
			requestCost: tables.log.requestCost,
			webSearchCost: tables.log.webSearchCost,
			contentFilterCost: tables.log.contentFilterCost,
			imageInputCost: tables.log.imageInputCost,
			imageOutputCost: tables.log.imageOutputCost,
			videoOutputCost: tables.log.videoOutputCost,
			dataStorageCost: tables.log.dataStorageCost,
			hasError: tables.log.hasError,
			errorDetails: tables.log.errorDetails,
			internalErrorDetails: tables.log.internalErrorDetails,
			finishReason: tables.log.finishReason,
			unifiedFinishReason: tables.log.unifiedFinishReason,
			cached: tables.log.cached,
			streamed: tables.log.streamed,
			canceled: tables.log.canceled,
			retried: tables.log.retried,
			retriedByLogId: tables.log.retriedByLogId,
			apiOrigin: tables.log.apiOrigin,
			source: tables.log.source,
			content: tables.log.content,
			reasoningContent: tables.log.reasoningContent,
			mode: tables.log.mode,
			usedMode: tables.log.usedMode,
			discount: tables.log.discount,
			pricingTier: tables.log.pricingTier,
			timeToFirstToken: tables.log.timeToFirstToken,
			timeToFirstReasoningToken: tables.log.timeToFirstReasoningToken,
			responseSize: tables.log.responseSize,
			temperature: tables.log.temperature,
			maxTokens: tables.log.maxTokens,
			topP: tables.log.topP,
			frequencyPenalty: tables.log.frequencyPenalty,
			reasoningEffort: tables.log.reasoningEffort,
			reasoningMaxTokens: tables.log.reasoningMaxTokens,
			effort: tables.log.effort,
			responseFormat: tables.log.responseFormat,
			tools: tables.log.tools,
			toolChoice: tables.log.toolChoice,
			toolResults: tables.log.toolResults,
			messages: tables.log.messages,
			params: tables.log.params,
			plugins: tables.log.plugins,
			pluginResults: tables.log.pluginResults,
			customHeaders: tables.log.customHeaders,
			routingMetadata: tables.log.routingMetadata,
		})
		.from(tables.log)
		.where(and(...whereConditions))
		.orderBy(desc(tables.log.createdAt), desc(tables.log.id))
		.limit(limit + 1);

	const hasMore = logRows.length > limit;
	const paginatedLogs = hasMore ? logRows.slice(0, limit) : logRows;
	const nextCursor =
		hasMore && paginatedLogs.length > 0
			? paginatedLogs[paginatedLogs.length - 1].id
			: null;

	return c.json({
		logs: paginatedLogs.map((l) => ({
			...l,
			content:
				l.content && l.content.includes(";base64,")
					? "[image_generated]"
					: l.content,
			promptTokens: l.promptTokens ? String(l.promptTokens) : null,
			completionTokens: l.completionTokens ? String(l.completionTokens) : null,
			totalTokens: l.totalTokens ? String(l.totalTokens) : null,
			reasoningTokens: l.reasoningTokens ? String(l.reasoningTokens) : null,
			cachedTokens: l.cachedTokens ? String(l.cachedTokens) : null,
			cacheWriteTokens: l.cacheWriteTokens ? String(l.cacheWriteTokens) : null,
			imageInputTokens: l.imageInputTokens ? String(l.imageInputTokens) : null,
			imageOutputTokens: l.imageOutputTokens
				? String(l.imageOutputTokens)
				: null,
			dataStorageCost: l.dataStorageCost ? Number(l.dataStorageCost) : null,
			createdAt: l.createdAt.toISOString(),
		})),
		pagination: {
			nextCursor,
			hasMore,
			limit,
		},
	});
});

// ==================== Discount Management ====================

// Get valid provider IDs as a Set for O(1) lookup
const validProviderIds = new Set<string>(providers.map((p) => p.id));

// Build a map of provider -> Set of valid canonical model IDs served by that provider.
// Only canonical model IDs are accepted as discount/rate-limit targets — the
// provider-specific externalId is reserved for upstream requests only.
const providerModelMappings = new Map<string, Set<string>>();
for (const model of models) {
	for (const mapping of model.providers) {
		if (!providerModelMappings.has(mapping.providerId)) {
			providerModelMappings.set(mapping.providerId, new Set<string>());
		}
		providerModelMappings.get(mapping.providerId)!.add(model.id);
	}
}

// All valid canonical model IDs.
const validModelIds = new Set<string>(models.map((m) => m.id));

const discountSchema = z.object({
	id: z.string(),
	organizationId: z.string().nullable(),
	provider: z.string().nullable(),
	model: z.string().nullable(),
	discountPercent: z.string(),
	reason: z.string().nullable(),
	expiresAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const discountsListSchema = z.object({
	discounts: z.array(discountSchema),
	total: z.number(),
});

const createDiscountBodySchema = z.object({
	provider: z.string().nullable().optional(),
	model: z.string().nullable().optional(),
	discountPercent: z.coerce
		.number()
		.min(0, "Discount must be at least 0%")
		.max(100, "Discount cannot exceed 100%"),
	reason: z.string().nullable().optional(),
	expiresAt: z.string().nullable().optional(),
});

// --- Global Discounts ---

const getGlobalDiscounts = createRoute({
	method: "get",
	path: "/discounts",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: discountsListSchema.openapi({}),
				},
			},
			description: "List of global discounts.",
		},
	},
});

const createGlobalDiscount = createRoute({
	method: "post",
	path: "/discounts",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createDiscountBodySchema.openapi({}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: discountSchema.openapi({}),
				},
			},
			description: "Created global discount.",
		},
		400: {
			description: "Invalid discount data.",
		},
		409: {
			description:
				"Discount already exists for this provider/model combination.",
		},
	},
});

const deleteGlobalDiscount = createRoute({
	method: "delete",
	path: "/discounts/{discountId}",
	request: {
		params: z.object({
			discountId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Discount deleted.",
		},
		404: {
			description: "Discount not found.",
		},
	},
});

const routingScoreMultiplierSchema = z.object({
	id: z.string(),
	provider: z.string().nullable(),
	model: z.string().nullable(),
	scoreMultiplier: z.string(),
	reason: z.string().nullable(),
	expiresAt: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const routingScoreMultipliersListSchema = z.object({
	multipliers: z.array(routingScoreMultiplierSchema),
	total: z.number(),
});

const createRoutingScoreMultiplierBodySchema = z.object({
	provider: z.string().nullable().optional(),
	model: z.string().nullable().optional(),
	scoreMultiplier: z.coerce
		.number()
		.min(-100, "Score multiplier cannot reduce routing price below zero"),
	reason: z.string().nullable().optional(),
	expiresAt: z.string().nullable().optional(),
});

const getRoutingScoreMultipliers = createRoute({
	method: "get",
	path: "/routing-score-multipliers",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: routingScoreMultipliersListSchema.openapi({}),
				},
			},
			description: "List of internal routing score multipliers.",
		},
	},
});

const createRoutingScoreMultiplier = createRoute({
	method: "post",
	path: "/routing-score-multipliers",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createRoutingScoreMultiplierBodySchema.openapi({}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: routingScoreMultiplierSchema.openapi({}),
				},
			},
			description: "Created routing score multiplier.",
		},
		400: { description: "Invalid routing score multiplier." },
		409: {
			description: "Routing score multiplier already exists for this target.",
		},
	},
});

const deleteRoutingScoreMultiplier = createRoute({
	method: "delete",
	path: "/routing-score-multipliers/{multiplierId}",
	request: {
		params: z.object({ multiplierId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Routing score multiplier deleted.",
		},
		404: { description: "Routing score multiplier not found." },
	},
});

// --- All Organization Discounts (across all organizations) ---

const orgDiscountSchema = discountSchema.extend({
	organizationName: z.string().nullable(),
});

const orgDiscountsListSchema = z.object({
	discounts: z.array(orgDiscountSchema),
	total: z.number(),
});

const getAllOrganizationDiscounts = createRoute({
	method: "get",
	path: "/discounts/organizations",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: orgDiscountsListSchema.openapi({}),
				},
			},
			description: "List of all organization-specific discounts.",
		},
	},
});

// --- Organization Discounts ---

const getOrganizationDiscounts = createRoute({
	method: "get",
	path: "/organizations/{orgId}/discounts",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: discountsListSchema.openapi({}),
				},
			},
			description: "List of organization discounts.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

const createOrganizationDiscount = createRoute({
	method: "post",
	path: "/organizations/{orgId}/discounts",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createDiscountBodySchema.openapi({}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: discountSchema.openapi({}),
				},
			},
			description: "Created organization discount.",
		},
		400: {
			description: "Invalid discount data.",
		},
		404: {
			description: "Organization not found.",
		},
		409: {
			description:
				"Discount already exists for this provider/model combination.",
		},
	},
});

const deleteOrganizationDiscount = createRoute({
	method: "delete",
	path: "/organizations/{orgId}/discounts/{discountId}",
	request: {
		params: z.object({
			orgId: z.string(),
			discountId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Discount deleted.",
		},
		404: {
			description: "Discount not found.",
		},
	},
});

// --- Available Providers/Models for discount selection ---

const getAvailableProvidersAndModels = createRoute({
	method: "get",
	path: "/discounts/options",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							providers: z.array(
								z.object({
									id: z.string(),
									name: z.string(),
								}),
							),
							mappings: z.array(
								z.object({
									providerId: z.string(),
									providerName: z.string(),
									modelId: z.string(),
									modelName: z.string(),
									family: z.string(),
								}),
							),
						})
						.openapi({}),
				},
			},
			description:
				"Available providers and provider/model mappings for discount selection.",
		},
	},
});

// Helper to format discount for response
function formatDiscount(d: {
	id: string;
	organizationId: string | null;
	provider: string | null;
	model: string | null;
	discountPercent: string | null;
	reason: string | null;
	expiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		id: d.id,
		organizationId: d.organizationId,
		provider: d.provider,
		model: d.model,
		discountPercent: String(d.discountPercent),
		reason: d.reason,
		expiresAt: d.expiresAt?.toISOString() ?? null,
		createdAt: d.createdAt.toISOString(),
		updatedAt: d.updatedAt.toISOString(),
	};
}

function formatRoutingScoreMultiplier(multiplier: {
	id: string;
	provider: string | null;
	model: string | null;
	scoreMultiplier: string;
	reason: string | null;
	expiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}) {
	return {
		...multiplier,
		expiresAt: multiplier.expiresAt?.toISOString() ?? null,
		createdAt: multiplier.createdAt.toISOString(),
		updatedAt: multiplier.updatedAt.toISOString(),
	};
}

// Helper to validate provider/model
function validateProviderAndModel(
	provider: string | null | undefined,
	model: string | null | undefined,
): { error?: string } {
	// Must have at least one of provider or model
	if (!provider && !model) {
		return { error: "At least one of provider or model must be specified" };
	}

	// Validate provider if specified
	if (provider && !validProviderIds.has(provider)) {
		return { error: `Invalid provider: ${provider}` };
	}

	// Validate model if specified
	if (model) {
		// If provider is specified, check that the model is valid for that provider
		if (provider) {
			const providerModels = providerModelMappings.get(provider);
			if (!providerModels || !providerModels.has(model)) {
				return {
					error: `Invalid model "${model}" for provider "${provider}"`,
				};
			}
		} else {
			// No provider specified, just check model is valid globally
			if (!validModelIds.has(model)) {
				return { error: `Invalid model: ${model}` };
			}
		}
	}

	return {};
}

// --- Global Discount Handlers ---

admin.openapi(getGlobalDiscounts, async (c) => {
	const discounts = await db
		.select()
		.from(tables.discount)
		.where(isNull(tables.discount.organizationId))
		.orderBy(desc(tables.discount.createdAt));

	return c.json({
		discounts: discounts.map(formatDiscount),
		total: discounts.length,
	});
});

admin.openapi(createGlobalDiscount, async (c) => {
	const body = c.req.valid("json");
	const provider = body.provider ?? null;
	const model = body.model ?? null;

	// Validate provider/model
	const validation = validateProviderAndModel(provider, model);
	if (validation.error) {
		throw new HTTPException(400, { message: validation.error });
	}

	// Convert percentage to decimal (e.g., 30 -> 0.3)
	const discountDecimal = (body.discountPercent / 100).toFixed(4);

	// Check for existing discount
	const existing = await db
		.select({ id: tables.discount.id })
		.from(tables.discount)
		.where(
			and(
				isNull(tables.discount.organizationId),
				provider
					? eq(tables.discount.provider, provider)
					: isNull(tables.discount.provider),
				model
					? eq(tables.discount.model, model)
					: isNull(tables.discount.model),
			),
		)
		.limit(1);

	if (existing.length > 0) {
		throw new HTTPException(409, {
			message: "A discount already exists for this provider/model combination",
		});
	}

	const [created] = await db
		.insert(tables.discount)
		.values({
			organizationId: null,
			provider,
			model,
			discountPercent: discountDecimal,
			reason: body.reason ?? null,
			expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
		})
		.returning();

	return c.json(formatDiscount(created), 201);
});

admin.openapi(deleteGlobalDiscount, async (c) => {
	const { discountId } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.discount)
		.where(
			and(
				eq(tables.discount.id, discountId),
				isNull(tables.discount.organizationId),
			),
		)
		.returning({ id: tables.discount.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Discount not found" });
	}

	return c.json({ success: true });
});

admin.openapi(getRoutingScoreMultipliers, async (c) => {
	const multipliers = await db
		.select()
		.from(tables.routingScoreMultiplier)
		.orderBy(desc(tables.routingScoreMultiplier.createdAt));

	return c.json({
		multipliers: multipliers.map(formatRoutingScoreMultiplier),
		total: multipliers.length,
	});
});

admin.openapi(createRoutingScoreMultiplier, async (c) => {
	const body = c.req.valid("json");
	const provider = body.provider ?? null;
	const model = body.model ?? null;
	const validation = validateProviderAndModel(provider, model);
	if (validation.error) {
		throw new HTTPException(400, { message: validation.error });
	}

	const existing = await db
		.select({ id: tables.routingScoreMultiplier.id })
		.from(tables.routingScoreMultiplier)
		.where(
			and(
				provider
					? eq(tables.routingScoreMultiplier.provider, provider)
					: isNull(tables.routingScoreMultiplier.provider),
				model
					? eq(tables.routingScoreMultiplier.model, model)
					: isNull(tables.routingScoreMultiplier.model),
			),
		)
		.limit(1);
	if (existing.length > 0) {
		throw new HTTPException(409, {
			message:
				"A routing score multiplier already exists for this provider/model combination",
		});
	}

	const [created] = await cdb
		.insert(tables.routingScoreMultiplier)
		.values({
			provider,
			model,
			scoreMultiplier: (body.scoreMultiplier / 100).toFixed(4),
			reason: body.reason ?? null,
			expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
		})
		.returning();

	return c.json(formatRoutingScoreMultiplier(created), 201);
});

admin.openapi(deleteRoutingScoreMultiplier, async (c) => {
	const { multiplierId } = c.req.valid("param");
	const [deleted] = await cdb
		.delete(tables.routingScoreMultiplier)
		.where(eq(tables.routingScoreMultiplier.id, multiplierId))
		.returning({ id: tables.routingScoreMultiplier.id });

	if (!deleted) {
		throw new HTTPException(404, {
			message: "Routing score multiplier not found",
		});
	}

	return c.json({ success: true });
});

admin.openapi(getAllOrganizationDiscounts, async (c) => {
	const discounts = await db
		.select({
			id: tables.discount.id,
			organizationId: tables.discount.organizationId,
			organizationName: tables.organization.name,
			provider: tables.discount.provider,
			model: tables.discount.model,
			discountPercent: tables.discount.discountPercent,
			reason: tables.discount.reason,
			expiresAt: tables.discount.expiresAt,
			createdAt: tables.discount.createdAt,
			updatedAt: tables.discount.updatedAt,
		})
		.from(tables.discount)
		.leftJoin(
			tables.organization,
			eq(tables.discount.organizationId, tables.organization.id),
		)
		.where(isNotNull(tables.discount.organizationId))
		.orderBy(desc(tables.discount.createdAt));

	return c.json({
		discounts: discounts.map((d) => ({
			...formatDiscount(d),
			organizationName: d.organizationName,
		})),
		total: discounts.length,
	});
});

// --- Organization Discount Handlers ---

admin.openapi(getOrganizationDiscounts, async (c) => {
	const { orgId } = c.req.valid("param");

	// Verify organization exists
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const discounts = await db
		.select()
		.from(tables.discount)
		.where(eq(tables.discount.organizationId, orgId))
		.orderBy(desc(tables.discount.createdAt));

	return c.json({
		discounts: discounts.map(formatDiscount),
		total: discounts.length,
	});
});

admin.openapi(createOrganizationDiscount, async (c) => {
	const { orgId } = c.req.valid("param");
	const body = c.req.valid("json");
	const provider = body.provider ?? null;
	const model = body.model ?? null;

	// Verify organization exists
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	// Validate provider/model
	const validation = validateProviderAndModel(provider, model);
	if (validation.error) {
		throw new HTTPException(400, { message: validation.error });
	}

	// Convert percentage to decimal (e.g., 30 -> 0.3)
	const discountDecimal = (body.discountPercent / 100).toFixed(4);

	// Check for existing discount
	const existing = await db
		.select({ id: tables.discount.id })
		.from(tables.discount)
		.where(
			and(
				eq(tables.discount.organizationId, orgId),
				provider
					? eq(tables.discount.provider, provider)
					: isNull(tables.discount.provider),
				model
					? eq(tables.discount.model, model)
					: isNull(tables.discount.model),
			),
		)
		.limit(1);

	if (existing.length > 0) {
		throw new HTTPException(409, {
			message: "A discount already exists for this provider/model combination",
		});
	}

	const [created] = await db
		.insert(tables.discount)
		.values({
			organizationId: orgId,
			provider,
			model,
			discountPercent: discountDecimal,
			reason: body.reason ?? null,
			expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
		})
		.returning();

	return c.json(formatDiscount(created), 201);
});

admin.openapi(deleteOrganizationDiscount, async (c) => {
	const { orgId, discountId } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.discount)
		.where(
			and(
				eq(tables.discount.id, discountId),
				eq(tables.discount.organizationId, orgId),
			),
		)
		.returning({ id: tables.discount.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Discount not found" });
	}

	return c.json({ success: true });
});

// --- Available Options Handler ---

admin.openapi(getAvailableProvidersAndModels, async (c) => {
	// modelId is the canonical model id — the provider-specific upstream
	// externalId is never exposed here or stored as a discount target. modelName
	// in this response is the canonical model's human-readable display name.
	const mappings: Array<{
		providerId: string;
		providerName: string;
		modelId: string;
		modelName: string;
		family: string;
	}> = [];

	for (const model of models) {
		for (const mapping of model.providers) {
			const provider = providers.find((p) => p.id === mapping.providerId);
			if (provider) {
				mappings.push({
					providerId: mapping.providerId,
					providerName: provider.name,
					modelId: model.id,
					modelName: (model as { name?: string }).name ?? model.id,
					family: model.family,
				});
			}
		}
	}

	return c.json({
		providers: providers.map((p) => ({ id: p.id, name: p.name })),
		mappings,
	});
});

// ==================== Rate Limit Management ====================

const rateLimitSchema = z.object({
	id: z.string(),
	organizationId: z.string().nullable(),
	provider: z.string().nullable(),
	model: z.string().nullable(),
	limitType: z.enum(["rpm", "rpd"]),
	maxRequests: z.number(),
	enforcement: z.enum(["per_org", "global"]),
	reason: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const rateLimitsListSchema = z.object({
	rateLimits: z.array(rateLimitSchema),
	total: z.number(),
});

const createRateLimitBodySchema = z.object({
	provider: z.string().nullable().optional(),
	model: z.string().nullable().optional(),
	limitType: z.enum(["rpm", "rpd"]),
	maxRequests: z.coerce
		.number()
		.int("Limit must be a whole number")
		.min(1, "Limit must be at least 1"),
	enforcement: z.enum(["per_org", "global"]).optional().default("per_org"),
	reason: z.string().nullable().optional(),
});

// Org-specific limits are always enforced per-org, so they don't expose the
// enforcement choice.
const createOrganizationRateLimitBodySchema = createRateLimitBodySchema.omit({
	enforcement: true,
});

// --- Global Rate Limits ---

const getGlobalRateLimits = createRoute({
	method: "get",
	path: "/rate-limits",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: rateLimitsListSchema.openapi({}),
				},
			},
			description: "List of global rate limits.",
		},
	},
});

const createGlobalRateLimit = createRoute({
	method: "post",
	path: "/rate-limits",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createRateLimitBodySchema.openapi({}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: rateLimitSchema.openapi({}),
				},
			},
			description: "Created global rate limit.",
		},
		400: {
			description: "Invalid rate limit data.",
		},
		409: {
			description:
				"Rate limit already exists for this provider/model/limit type combination.",
		},
	},
});

const deleteGlobalRateLimit = createRoute({
	method: "delete",
	path: "/rate-limits/{rateLimitId}",
	request: {
		params: z.object({
			rateLimitId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Rate limit deleted.",
		},
		404: {
			description: "Rate limit not found.",
		},
	},
});

// --- Organization Rate Limits ---

const getOrganizationRateLimits = createRoute({
	method: "get",
	path: "/organizations/{orgId}/rate-limits",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: rateLimitsListSchema.openapi({}),
				},
			},
			description: "List of organization rate limits.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

const createOrganizationRateLimit = createRoute({
	method: "post",
	path: "/organizations/{orgId}/rate-limits",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createOrganizationRateLimitBodySchema.openapi({}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: rateLimitSchema.openapi({}),
				},
			},
			description: "Created organization rate limit.",
		},
		400: {
			description: "Invalid rate limit data.",
		},
		404: {
			description: "Organization not found.",
		},
		409: {
			description:
				"Rate limit already exists for this provider/model/limit type combination.",
		},
	},
});

const deleteOrganizationRateLimit = createRoute({
	method: "delete",
	path: "/organizations/{orgId}/rate-limits/{rateLimitId}",
	request: {
		params: z.object({
			orgId: z.string(),
			rateLimitId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Rate limit deleted.",
		},
		404: {
			description: "Rate limit not found.",
		},
	},
});

// Helper to format rate limit for response
function formatRateLimit(r: {
	id: string;
	organizationId: string | null;
	provider: string | null;
	model: string | null;
	maxRpm: number | null;
	maxRpd: number | null;
	enforcement: string;
	reason: string | null;
	createdAt: Date;
	updatedAt: Date;
}) {
	const limitType: "rpm" | "rpd" = r.maxRpd !== null ? "rpd" : "rpm";
	const maxRequests = r.maxRpd ?? r.maxRpm ?? 0;

	return {
		id: r.id,
		organizationId: r.organizationId,
		provider: r.provider,
		model: r.model,
		limitType,
		maxRequests,
		enforcement:
			r.enforcement === "global" ? ("global" as const) : ("per_org" as const),
		reason: r.reason,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
	};
}

// --- Global Rate Limit Handlers ---

admin.openapi(getGlobalRateLimits, async (c) => {
	const rateLimits = await db
		.select()
		.from(tables.rateLimit)
		.where(isNull(tables.rateLimit.organizationId))
		.orderBy(desc(tables.rateLimit.createdAt));

	return c.json({
		rateLimits: rateLimits.map(formatRateLimit),
		total: rateLimits.length,
	});
});

admin.openapi(createGlobalRateLimit, async (c) => {
	const body = c.req.valid("json");
	const provider = body.provider ?? null;
	const model = body.model ?? null;

	// Validate provider/model
	const validation = validateProviderAndModel(provider, model);
	if (validation.error) {
		throw new HTTPException(400, { message: validation.error });
	}

	const [created] = await db
		.insert(tables.rateLimit)
		.values({
			organizationId: null,
			provider,
			model,
			maxRpm: body.limitType === "rpm" ? body.maxRequests : null,
			maxRpd: body.limitType === "rpd" ? body.maxRequests : null,
			enforcement: body.enforcement,
			reason: body.reason ?? null,
		})
		.onConflictDoNothing()
		.returning();

	if (!created) {
		throw new HTTPException(409, {
			message:
				"A rate limit already exists for this provider/model/limit type combination",
		});
	}

	return c.json(formatRateLimit(created), 201);
});

admin.openapi(deleteGlobalRateLimit, async (c) => {
	const { rateLimitId } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.rateLimit)
		.where(
			and(
				eq(tables.rateLimit.id, rateLimitId),
				isNull(tables.rateLimit.organizationId),
			),
		)
		.returning({ id: tables.rateLimit.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Rate limit not found" });
	}

	return c.json({ success: true });
});

// --- Credit Purchase Kill Switch ---

const creditPurchaseBlockSchema = z
	.object({
		// Effective state (env override OR admin toggle).
		blocked: z.boolean(),
		// True when DISABLE_NEW_ORG_CREDIT_PURCHASES forces the block on, in
		// which case the admin toggle cannot turn it off.
		envForced: z.boolean(),
	})
	.openapi({});

const getCreditPurchaseBlock = createRoute({
	method: "get",
	path: "/settings/credit-purchase-block",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: creditPurchaseBlockSchema,
				},
			},
			description:
				"Whether credit purchases for new organizations are blocked.",
		},
	},
});

const updateCreditPurchaseBlock = createRoute({
	method: "put",
	path: "/settings/credit-purchase-block",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ blocked: z.boolean() }).openapi({}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: creditPurchaseBlockSchema,
				},
			},
			description: "Updated credit purchase block state.",
		},
	},
});

admin.openapi(getCreditPurchaseBlock, async (c) => {
	return c.json({
		blocked: await isCreditPurchaseBlockEnabled(),
		envForced: isCreditPurchaseBlockForcedByEnv(),
	});
});

admin.openapi(updateCreditPurchaseBlock, async (c) => {
	const { blocked } = c.req.valid("json");

	await db
		.insert(tables.systemSetting)
		.values({ id: CREDIT_PURCHASE_BLOCK_SETTING_ID, enabled: blocked })
		.onConflictDoUpdate({
			target: tables.systemSetting.id,
			set: { enabled: blocked, updatedAt: new Date() },
		});

	return c.json({
		blocked: await isCreditPurchaseBlockEnabled(),
		envForced: isCreditPurchaseBlockForcedByEnv(),
	});
});

// --- Signup Country Blocking ---

const blockedSignupCountriesSchema = z
	.object({
		countries: z.array(z.string()),
	})
	.openapi({});

const getBlockedSignupCountriesRoute = createRoute({
	method: "get",
	path: "/settings/blocked-signup-countries",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: blockedSignupCountriesSchema,
				},
			},
			description: "Countries whose sign-ups are blocked.",
		},
	},
});

const updateBlockedSignupCountries = createRoute({
	method: "put",
	path: "/settings/blocked-signup-countries",
	request: {
		body: {
			content: {
				"application/json": {
					schema: blockedSignupCountriesSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: blockedSignupCountriesSchema,
				},
			},
			description: "Updated blocked sign-up countries.",
		},
	},
});

admin.openapi(getBlockedSignupCountriesRoute, async (c) => {
	return c.json({ countries: await getBlockedSignupCountries() });
});

admin.openapi(updateBlockedSignupCountries, async (c) => {
	const { countries } = c.req.valid("json");

	const invalid = countries
		.map((country) => country.trim())
		.filter(
			(country) => country && normalizeCountryCodes([country]).length === 0,
		);
	if (invalid.length > 0) {
		throw new HTTPException(400, {
			message: `Invalid ISO 3166-1 alpha-2 country code(s): ${invalid.join(", ")}`,
		});
	}

	return c.json({ countries: await setBlockedSignupCountries(countries) });
});

// --- Forced 3D Secure ---

const forceThreeDSecureModeSchema = z.enum(["off", "any", "challenge"]);

const forceThreeDSecureSchema = z
	.object({
		// The stored admin setting.
		mode: forceThreeDSecureModeSchema,
		// Set when STRIPE_FORCE_3DS overrides the admin setting, in which case
		// `mode` is stored but not what customers actually get.
		envOverride: forceThreeDSecureModeSchema.nullable(),
		// What card flows actually request right now.
		effectiveMode: forceThreeDSecureModeSchema,
	})
	.openapi({});

async function forceThreeDSecureState() {
	const mode = await getForcedThreeDSecureMode();
	const envOverride = getThreeDSecureEnvOverride() ?? null;
	return {
		mode,
		envOverride,
		effectiveMode: envOverride ?? mode,
	};
}

const getForceThreeDSecure = createRoute({
	method: "get",
	path: "/settings/force-3ds",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: forceThreeDSecureSchema,
				},
			},
			description:
				"3D Secure level requested on customer-present card payments.",
		},
	},
});

const updateForceThreeDSecure = createRoute({
	method: "put",
	path: "/settings/force-3ds",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({ mode: forceThreeDSecureModeSchema }).openapi({}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: forceThreeDSecureSchema,
				},
			},
			description: "Updated 3D Secure setting.",
		},
	},
});

admin.openapi(getForceThreeDSecure, async (c) => {
	return c.json(await forceThreeDSecureState());
});

admin.openapi(updateForceThreeDSecure, async (c) => {
	const { mode } = c.req.valid("json");

	await setForcedThreeDSecureMode(mode);

	return c.json(await forceThreeDSecureState());
});

// --- Flagged (high-risk) Accounts ---

const flaggedAccountSchema = z
	.object({
		userId: z.string(),
		email: z.string(),
		name: z.string().nullable(),
		emailVerified: z.boolean(),
		createdAt: z.string(),
		riskStatus: z.enum(["flagged", "approved"]),
		flaggedAt: z.string().nullable(),
		source: z.enum(["signup", "email_verification"]).nullable(),
		ipAddress: z.string().nullable(),
		abuseConfidenceScore: z.number().nullable(),
		totalReports: z.number().nullable(),
		countryCode: z.string().nullable(),
		usageType: z.string().nullable(),
		isp: z.string().nullable(),
		isTor: z.boolean(),
		reviewedAt: z.string().nullable(),
		reviewedBy: z.string().nullable(),
		archivedAt: z.string().nullable(),
		organizations: z.array(
			z.object({
				id: z.string(),
				name: z.string(),
				kind: z.string(),
				plan: z.string(),
				status: z.string().nullable(),
				credits: z.string(),
				riskFlagged: z.boolean(),
			}),
		),
	})
	.openapi({});

const getFlaggedAccounts = createRoute({
	method: "get",
	path: "/flagged-accounts",
	request: {
		query: z.object({
			status: z.enum(["flagged", "approved", "all"]).optional(),
			search: z.string().optional(),
			limit: z.coerce.number().min(1).max(200).optional(),
			archived: z
				.enum(["true", "false"])
				.default("false")
				.transform((value) => value === "true")
				.optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							accounts: z.array(flaggedAccountSchema),
							flaggedCount: z.number(),
							approvedCount: z.number(),
							archivedCount: z.number(),
						})
						.openapi({}),
				},
			},
			description: "Accounts flagged as high risk by the abuse-IP check.",
		},
	},
});

const approveFlaggedAccount = createRoute({
	method: "post",
	path: "/flagged-accounts/{userId}/approve",
	request: {
		params: z.object({ userId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							success: z.boolean(),
							organizationIds: z.array(z.string()),
						})
						.openapi({}),
				},
			},
			description: "Account activated; its organizations are unblocked.",
		},
	},
});

const archiveFlaggedAccount = createRoute({
	method: "patch",
	path: "/flagged-accounts/{userId}/archive",
	request: {
		params: z.object({ userId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ archived: z.boolean() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Flagged account archived or restored.",
		},
		404: {
			description: "Flagged account not found.",
		},
	},
});

admin.openapi(getFlaggedAccounts, async (c) => {
	const {
		status = "flagged",
		search,
		limit = 100,
		archived = false,
	} = c.req.valid("query");

	const filters = [
		ne(tables.user.riskStatus, "none"),
		archived
			? isNotNull(tables.user.riskArchivedAt)
			: isNull(tables.user.riskArchivedAt),
	];
	if (status !== "all") {
		filters.push(eq(tables.user.riskStatus, status));
	}
	const term = search?.trim();
	if (term) {
		filters.push(
			or(
				sql`${tables.user.email} ILIKE ${`%${term}%`}`,
				sql`${tables.user.name} ILIKE ${`%${term}%`}`,
			)!,
		);
	}

	const users = await db
		.select({
			id: tables.user.id,
			email: tables.user.email,
			name: tables.user.name,
			emailVerified: tables.user.emailVerified,
			createdAt: tables.user.createdAt,
			riskStatus: tables.user.riskStatus,
			riskFlaggedAt: tables.user.riskFlaggedAt,
			riskFlagSource: tables.user.riskFlagSource,
			riskFlagIp: tables.user.riskFlagIp,
			riskFlagDetails: tables.user.riskFlagDetails,
			riskReviewedAt: tables.user.riskReviewedAt,
			riskReviewedBy: tables.user.riskReviewedBy,
			riskArchivedAt: tables.user.riskArchivedAt,
		})
		.from(tables.user)
		.where(and(...filters))
		.orderBy(desc(tables.user.riskFlaggedAt))
		.limit(limit);

	const userIds = users.map((user) => user.id);
	const memberships = userIds.length
		? await db
				.select({
					userId: tables.userOrganization.userId,
					id: tables.organization.id,
					name: tables.organization.name,
					kind: tables.organization.kind,
					plan: tables.organization.plan,
					status: tables.organization.status,
					credits: tables.organization.credits,
					riskFlagged: tables.organization.riskFlagged,
				})
				.from(tables.userOrganization)
				.innerJoin(
					tables.organization,
					eq(tables.organization.id, tables.userOrganization.organizationId),
				)
				.where(inArray(tables.userOrganization.userId, userIds))
		: [];

	const activeCounts = await db
		.select({
			riskStatus: tables.user.riskStatus,
			count: sql<number>`count(*)::int`,
		})
		.from(tables.user)
		.where(
			and(
				ne(tables.user.riskStatus, "none"),
				isNull(tables.user.riskArchivedAt),
			),
		)
		.groupBy(tables.user.riskStatus);
	const [archivedCount] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(tables.user)
		.where(
			and(
				ne(tables.user.riskStatus, "none"),
				isNotNull(tables.user.riskArchivedAt),
			),
		);

	return c.json({
		accounts: users.map((user) => {
			const details = user.riskFlagDetails;
			return {
				userId: user.id,
				email: user.email,
				name: user.name,
				emailVerified: user.emailVerified,
				createdAt: user.createdAt.toISOString(),
				riskStatus: user.riskStatus as "flagged" | "approved",
				flaggedAt: user.riskFlaggedAt?.toISOString() ?? null,
				source: user.riskFlagSource,
				ipAddress: user.riskFlagIp,
				abuseConfidenceScore: details?.abuseConfidenceScore ?? null,
				totalReports: details?.totalReports ?? null,
				countryCode: details?.countryCode ?? null,
				usageType: details?.usageType ?? null,
				isp: details?.isp ?? null,
				isTor: details?.isTor ?? false,
				reviewedAt: user.riskReviewedAt?.toISOString() ?? null,
				reviewedBy: user.riskReviewedBy,
				archivedAt: user.riskArchivedAt?.toISOString() ?? null,
				organizations: memberships
					.filter((membership) => membership.userId === user.id)
					.map(({ userId: _userId, ...organization }) => organization),
			};
		}),
		flaggedCount:
			activeCounts.find((row) => row.riskStatus === "flagged")?.count ?? 0,
		approvedCount:
			activeCounts.find((row) => row.riskStatus === "approved")?.count ?? 0,
		archivedCount: archivedCount?.count ?? 0,
	});
});

admin.openapi(approveFlaggedAccount, async (c) => {
	const { userId } = c.req.valid("param");
	const reviewer = c.get("user")!;

	const result = await approveHighRiskUser({
		userId,
		reviewerId: reviewer.id,
	});
	if (!result) {
		throw new HTTPException(404, { message: "User not found" });
	}

	return c.json({ success: true, organizationIds: result.organizationIds });
});

admin.openapi(archiveFlaggedAccount, async (c) => {
	const { userId } = c.req.valid("param");
	const { archived } = c.req.valid("json");

	const updated = await db
		.update(tables.user)
		.set({ riskArchivedAt: archived ? new Date() : null })
		.where(and(eq(tables.user.id, userId), ne(tables.user.riskStatus, "none")))
		.returning({ id: tables.user.id });

	if (updated.length === 0) {
		throw new HTTPException(404, { message: "Flagged account not found" });
	}

	return c.json({ success: true });
});

// --- Organization Rate Limit Handlers ---

admin.openapi(getOrganizationRateLimits, async (c) => {
	const { orgId } = c.req.valid("param");

	// Verify organization exists
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const rateLimits = await db
		.select()
		.from(tables.rateLimit)
		.where(eq(tables.rateLimit.organizationId, orgId))
		.orderBy(desc(tables.rateLimit.createdAt));

	return c.json({
		rateLimits: rateLimits.map(formatRateLimit),
		total: rateLimits.length,
	});
});

admin.openapi(createOrganizationRateLimit, async (c) => {
	const { orgId } = c.req.valid("param");
	const body = c.req.valid("json");
	const provider = body.provider ?? null;
	const model = body.model ?? null;

	// Verify organization exists
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	// Validate provider/model
	const validation = validateProviderAndModel(provider, model);
	if (validation.error) {
		throw new HTTPException(400, { message: validation.error });
	}

	const [created] = await db
		.insert(tables.rateLimit)
		.values({
			organizationId: orgId,
			provider,
			model,
			maxRpm: body.limitType === "rpm" ? body.maxRequests : null,
			maxRpd: body.limitType === "rpd" ? body.maxRequests : null,
			reason: body.reason ?? null,
		})
		.onConflictDoNothing()
		.returning();

	if (!created) {
		throw new HTTPException(409, {
			message:
				"A rate limit already exists for this provider/model/limit type combination",
		});
	}

	return c.json(formatRateLimit(created), 201);
});

admin.openapi(deleteOrganizationRateLimit, async (c) => {
	const { orgId, rateLimitId } = c.req.valid("param");

	const [deleted] = await db
		.delete(tables.rateLimit)
		.where(
			and(
				eq(tables.rateLimit.id, rateLimitId),
				eq(tables.rateLimit.organizationId, orgId),
			),
		)
		.returning({ id: tables.rateLimit.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Rate limit not found" });
	}

	return c.json({ success: true });
});

// --- Available Options for Rate Limit Selection ---

const getAvailableRateLimitOptions = createRoute({
	method: "get",
	path: "/rate-limits/options",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({
							providers: z.array(
								z.object({
									id: z.string(),
									name: z.string(),
								}),
							),
							mappings: z.array(
								z.object({
									providerId: z.string(),
									providerName: z.string(),
									modelId: z.string(),
									modelName: z.string(),
									family: z.string(),
								}),
							),
						})
						.openapi({}),
				},
			},
			description:
				"Available providers and provider/model mappings for rate limit selection.",
		},
	},
});

admin.openapi(getAvailableRateLimitOptions, async (c) => {
	// modelId is the canonical model id — the provider-specific upstream
	// externalId is never exposed here or stored as a rate-limit target.
	// modelName in this response is the canonical model's human-readable display
	// name.
	const mappings: Array<{
		providerId: string;
		providerName: string;
		modelId: string;
		modelName: string;
		family: string;
	}> = [];

	for (const model of models) {
		for (const mapping of model.providers) {
			const provider = providers.find((p) => p.id === mapping.providerId);
			if (provider) {
				mappings.push({
					providerId: mapping.providerId,
					providerName: provider.name,
					modelId: model.id,
					modelName: (model as { name?: string }).name ?? model.id,
					family: model.family,
				});
			}
		}
	}

	return c.json({
		providers: providers.map((p) => ({ id: p.id, name: p.name })),
		mappings,
	});
});

// ==================== Provider & Model Stats ====================

const providerSortBySchema = z.enum([
	"name",
	"status",
	"logsCount",
	"errorsCount",
	"clientErrorsCount",
	"cachedCount",
	"totalCost",
	"avgTimeToFirstToken",
	"modelCount",
	"updatedAt",
]);

const providerStatsSchema = z.object({
	id: z.string(),
	name: z.string(),
	color: z.string().nullable(),
	status: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	clientErrorsCount: z.number(),
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	modelCount: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	...tokenBreakdownShape,
	updatedAt: z.string(),
});

const providersListSchema = z.object({
	providers: z.array(providerStatsSchema),
	total: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	...tokenBreakdownShape,
});

const getProviderStats = createRoute({
	method: "get",
	path: "/providers",
	request: {
		query: z.object({
			sortBy: providerSortBySchema.default("logsCount").optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: providersListSchema.openapi({}),
				},
			},
			description: "List of providers with stats.",
		},
	},
});

admin.openapi(getProviderStats, async (c) => {
	const query = c.req.valid("query");
	const sortBy = query.sortBy ?? "logsCount";
	const sortOrder = query.sortOrder ?? "desc";
	const { from, to } = query;

	const modelCountSub = db
		.select({
			providerId: tables.modelProviderMapping.providerId,
			count: sql<number>`COUNT(*)`.as("model_count"),
		})
		.from(tables.modelProviderMapping)
		.groupBy(tables.modelProviderMapping.providerId)
		.as("model_count_sub");

	if (from && to) {
		let startDate: Date;
		let endDateExclusive: Date;
		if (from.includes("T") || from.includes("Z")) {
			startDate = new Date(from);
			endDateExclusive = new Date(to);
		} else {
			startDate = new Date(from + "T00:00:00");
			startDate.setUTCHours(0, 0, 0, 0);
			endDateExclusive = new Date(to + "T00:00:00");
			endDateExclusive.setUTCHours(0, 0, 0, 0);
			endDateExclusive.setDate(endDateExclusive.getDate() + 1);
		}

		// Ranges longer than 24h aggregate the hourly rollup so a full-window
		// scan across every provider doesn't read minute rows.
		const { table: mph, bucket: mphTs } = pickMappingHistoryTable(
			isHourlyRange(startDate, endDateExclusive),
		);
		const providerStatsSub = db
			.select({
				providerId: mph.providerId,
				logsCount: sql<number>`COALESCE(SUM(${mph.logsCount}), 0)`.as(
					"logsCount",
				),
				errorsCount: sql<number>`COALESCE(SUM(${mph.errorsCount}), 0)`.as(
					"errorsCount",
				),
				clientErrorsCount:
					sql<number>`COALESCE(SUM(${mph.clientErrorsCount}), 0)`.as(
						"clientErrorsCount",
					),
				cachedCount: sql<number>`COALESCE(SUM(${mph.cachedCount}), 0)`.as(
					"cachedCount",
				),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${mph.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				totalCost:
					sql<number>`COALESCE(SUM(cast(${mph.totalCost} as double precision)), 0)`.as(
						"totalCost",
					),
				// Only streamed requests record a time-to-first-token, so the
				// average divides by the sample count, not the request count.
				// Reasoning-token samples take precedence so thinking mappings
				// aren't measured on their (much later) first content token.
				avgTimeToFirstToken: avgEffectiveTtftSql(mph).as("avgTimeToFirstToken"),
				...tokenBreakdownSums(mph),
			})
			.from(mph)
			.where(
				and(
					gte(mphTs, startDate),
					lt(mphTs, endDateExclusive),
					excludeRegionalMappingRows(mph),
				),
			)
			.groupBy(mph.providerId)
			.as("provider_stats_sub");

		const orderFn = sortOrder === "asc" ? asc : desc;
		const sortColumnMap = {
			name: tables.provider.name,
			status: tables.provider.status,
			logsCount: sql`COALESCE(${providerStatsSub.logsCount}, 0)`,
			errorsCount: sql`GREATEST(COALESCE(${providerStatsSub.errorsCount}, 0) - COALESCE(${providerStatsSub.clientErrorsCount}, 0), 0)`,
			clientErrorsCount: sql`COALESCE(${providerStatsSub.clientErrorsCount}, 0)`,
			cachedCount: sql`COALESCE(${providerStatsSub.cachedCount}, 0)`,
			totalCost: sql`COALESCE(${providerStatsSub.totalCost}, 0)`,
			avgTimeToFirstToken: sql`COALESCE(${providerStatsSub.avgTimeToFirstToken}, ${tables.provider.avgTimeToFirstReasoningToken}, ${tables.provider.avgTimeToFirstToken})`,
			modelCount: sql`COALESCE(${modelCountSub.count}, 0)`,
			updatedAt: tables.provider.updatedAt,
		} as const;

		const sortColumn = sortColumnMap[sortBy];

		const [[totalsResult], rows] = await Promise.all([
			db
				.select({
					totalTokens:
						sql<number>`COALESCE(SUM(COALESCE(${providerStatsSub.totalTokens}, 0)), 0)`.as(
							"totalTokens",
						),
					totalCost:
						sql<number>`COALESCE(SUM(COALESCE(cast(${providerStatsSub.totalCost} as double precision), 0)), 0)`.as(
							"totalCost",
						),
					...tokenBreakdownSubTotals(providerStatsSub),
				})
				.from(tables.provider)
				.leftJoin(
					providerStatsSub,
					eq(tables.provider.id, providerStatsSub.providerId),
				),
			db
				.select({
					id: tables.provider.id,
					name: tables.provider.name,
					color: tables.provider.color,
					status: tables.provider.status,
					logsCount: sql<number>`COALESCE(${providerStatsSub.logsCount}, 0)`.as(
						"logsCount",
					),
					errorsCount:
						sql<number>`COALESCE(${providerStatsSub.errorsCount}, 0)`.as(
							"errorsCount",
						),
					clientErrorsCount:
						sql<number>`COALESCE(${providerStatsSub.clientErrorsCount}, 0)`.as(
							"clientErrorsCount",
						),
					cachedCount:
						sql<number>`COALESCE(${providerStatsSub.cachedCount}, 0)`.as(
							"cachedCount",
						),
					avgTimeToFirstToken: sql<
						number | null
					>`COALESCE(${providerStatsSub.avgTimeToFirstToken}, ${tables.provider.avgTimeToFirstReasoningToken}, ${tables.provider.avgTimeToFirstToken})`.as(
						"avgTimeToFirstToken",
					),
					modelCount: sql<number>`COALESCE(${modelCountSub.count}, 0)`.as(
						"modelCount",
					),
					totalTokens:
						sql<number>`COALESCE(${providerStatsSub.totalTokens}, 0)`.as(
							"totalTokens",
						),
					totalCost: sql<number>`COALESCE(${providerStatsSub.totalCost}, 0)`.as(
						"totalCost",
					),
					...tokenBreakdownFromSub(providerStatsSub),
					updatedAt: tables.provider.updatedAt,
				})
				.from(tables.provider)
				.leftJoin(
					providerStatsSub,
					eq(tables.provider.id, providerStatsSub.providerId),
				)
				.leftJoin(
					modelCountSub,
					eq(tables.provider.id, modelCountSub.providerId),
				)
				.orderBy(orderFn(sortColumn), asc(tables.provider.id)),
		]);

		const totalTokensAgg = Number(totalsResult?.totalTokens ?? 0);
		const totalCostAgg = Number(totalsResult?.totalCost ?? 0);

		return c.json({
			providers: rows.map((r) => ({
				id: r.id,
				name: r.name,
				color: r.color,
				status: r.status,
				logsCount: Number(r.logsCount ?? 0),
				errorsCount: Number(r.errorsCount ?? 0),
				clientErrorsCount: Number(r.clientErrorsCount ?? 0),
				cachedCount: Number(r.cachedCount ?? 0),
				avgTimeToFirstToken: r.avgTimeToFirstToken,
				modelCount: Number(r.modelCount ?? 0),
				totalTokens: Number(r.totalTokens ?? 0),
				totalCost: Number(r.totalCost ?? 0),
				...toTokenBreakdown(r),
				updatedAt: r.updatedAt.toISOString(),
			})),
			total: rows.length,
			totalTokens: totalTokensAgg,
			totalCost: totalCostAgg,
			...toTokenBreakdown(totalsResult),
		});
	}

	const orderFn = sortOrder === "asc" ? asc : desc;

	const sortColumnMap = {
		name: tables.provider.name,
		status: tables.provider.status,
		logsCount: tables.provider.logsCount,
		errorsCount: sql`GREATEST(${tables.provider.errorsCount} - ${tables.provider.clientErrorsCount}, 0)`,
		clientErrorsCount: tables.provider.clientErrorsCount,
		cachedCount: tables.provider.cachedCount,
		totalCost: sql`0`,
		avgTimeToFirstToken: sql`COALESCE(${tables.provider.avgTimeToFirstReasoningToken}, ${tables.provider.avgTimeToFirstToken})`,
		modelCount: sql`COALESCE(${modelCountSub.count}, 0)`,
		updatedAt: tables.provider.updatedAt,
	} as const;

	const sortColumn = sortColumnMap[sortBy];

	const rows = await db
		.select({
			id: tables.provider.id,
			name: tables.provider.name,
			color: tables.provider.color,
			status: tables.provider.status,
			logsCount: tables.provider.logsCount,
			errorsCount: tables.provider.errorsCount,
			clientErrorsCount: tables.provider.clientErrorsCount,
			cachedCount: tables.provider.cachedCount,
			avgTimeToFirstToken: sql<
				number | null
			>`COALESCE(${tables.provider.avgTimeToFirstReasoningToken}, ${tables.provider.avgTimeToFirstToken})`.as(
				"avgTimeToFirstToken",
			),
			modelCount: sql<number>`COALESCE(${modelCountSub.count}, 0)`.as(
				"modelCount",
			),
			updatedAt: tables.provider.updatedAt,
		})
		.from(tables.provider)
		.leftJoin(modelCountSub, eq(tables.provider.id, modelCountSub.providerId))
		.orderBy(orderFn(sortColumn), asc(tables.provider.id));

	return c.json({
		providers: rows.map((r) => ({
			id: r.id,
			name: r.name,
			color: r.color,
			status: r.status,
			logsCount: r.logsCount,
			errorsCount: r.errorsCount,
			clientErrorsCount: r.clientErrorsCount,
			cachedCount: r.cachedCount,
			avgTimeToFirstToken: r.avgTimeToFirstToken,
			modelCount: Number(r.modelCount),
			totalTokens: 0,
			totalCost: 0,
			...EMPTY_TOKEN_BREAKDOWN,
			updatedAt: r.updatedAt.toISOString(),
		})),
		total: rows.length,
		totalTokens: 0,
		totalCost: 0,
		...EMPTY_TOKEN_BREAKDOWN,
	});
});

const modelSortBySchema = z.enum([
	"name",
	"family",
	"status",
	"free",
	"logsCount",
	"totalCost",
	"errorsCount",
	"clientErrorsCount",
	"gatewayErrorsCount",
	"upstreamErrorsCount",
	"cachedCount",
	"avgTimeToFirstToken",
	"providerCount",
	"updatedAt",
]);

const modelStatsSchema = z.object({
	id: z.string(),
	name: z.string(),
	family: z.string(),
	free: z.boolean(),
	stability: z.string(),
	status: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	clientErrorsCount: z.number(),
	gatewayErrorsCount: z.number(),
	upstreamErrorsCount: z.number(),
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	providerCount: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	...tokenBreakdownShape,
	inputPrice: z.string().nullable(),
	outputPrice: z.string().nullable(),
	requestPrice: z.string().nullable(),
	updatedAt: z.string(),
});

const modelsListSchema = z.object({
	models: z.array(modelStatsSchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	...tokenBreakdownShape,
});

const getModelStats = createRoute({
	method: "get",
	path: "/models",
	request: {
		query: z.object({
			search: z.string().optional(),
			family: z.string().optional(),
			sortBy: modelSortBySchema.default("logsCount").optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: modelsListSchema.openapi({}),
				},
			},
			description: "List of models with stats.",
		},
	},
});

admin.openapi(getModelStats, async (c) => {
	const query = c.req.valid("query");
	const search = query.search;
	const family = query.family;
	const sortBy = query.sortBy ?? "logsCount";
	const sortOrderVal = query.sortOrder ?? "desc";
	const limit = query.limit ?? 50;
	const offset = query.offset ?? 0;
	const { from, to } = query;

	const conditions = [];
	if (search) {
		const searchLower = search.toLowerCase();
		conditions.push(
			or(
				sql`LOWER(${tables.model.id}) LIKE ${`%${searchLower}%`}`,
				sql`LOWER(${tables.model.name}) LIKE ${`%${searchLower}%`}`,
			),
		);
	}
	if (family) {
		conditions.push(eq(tables.model.family, family));
	}
	const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

	if (from && to) {
		let startDate: Date;
		let endDateExclusive: Date;
		if (from.includes("T") || from.includes("Z")) {
			startDate = new Date(from);
			endDateExclusive = new Date(to);
		} else {
			startDate = new Date(from + "T00:00:00");
			startDate.setUTCHours(0, 0, 0, 0);
			endDateExclusive = new Date(to + "T00:00:00");
			endDateExclusive.setUTCHours(0, 0, 0, 0);
			endDateExclusive.setDate(endDateExclusive.getDate() + 1);
		}

		// Ranges longer than 24h aggregate the hourly rollup so a full-window
		// scan across every model doesn't read minute rows.
		const { table: mh, bucket: mhTs } = pickModelHistoryTable(
			isHourlyRange(startDate, endDateExclusive),
		);
		const modelAggSub = db
			.select({
				modelId: mh.modelId,
				logsCount: sql<number>`COALESCE(SUM(${mh.logsCount}), 0)`.as(
					"logsCount",
				),
				errorsCount: sql<number>`COALESCE(SUM(${mh.errorsCount}), 0)`.as(
					"errorsCount",
				),
				clientErrorsCount:
					sql<number>`COALESCE(SUM(${mh.clientErrorsCount}), 0)`.as(
						"clientErrorsCount",
					),
				gatewayErrorsCount:
					sql<number>`COALESCE(SUM(${mh.gatewayErrorsCount}), 0)`.as(
						"gatewayErrorsCount",
					),
				upstreamErrorsCount:
					sql<number>`COALESCE(SUM(${mh.upstreamErrorsCount}), 0)`.as(
						"upstreamErrorsCount",
					),
				cachedCount: sql<number>`COALESCE(SUM(${mh.cachedCount}), 0)`.as(
					"cachedCount",
				),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${mh.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				totalCost:
					sql<number>`COALESCE(SUM(cast(${mh.totalCost} as double precision)), 0)`.as(
						"totalCost",
					),
				...tokenBreakdownSums(mh),
			})
			.from(mh)
			.where(and(gte(mhTs, startDate), lt(mhTs, endDateExclusive)))
			.groupBy(mh.modelId)
			.as("model_agg_sub");

		const providerCountSub = db
			.select({
				modelId: tables.modelProviderMapping.modelId,
				count: sql<number>`COUNT(*)`.as("providerCount"),
			})
			.from(tables.modelProviderMapping)
			.groupBy(tables.modelProviderMapping.modelId)
			.as("provider_count_sub");

		const pricingSub = db
			.select({
				modelId: tables.modelProviderMapping.modelId,
				inputPrice:
					sql<string>`MIN(${tables.modelProviderMapping.inputPrice})`.as(
						"input_price",
					),
				outputPrice:
					sql<string>`MIN(${tables.modelProviderMapping.outputPrice})`.as(
						"output_price",
					),
				requestPrice:
					sql<string>`MIN(${tables.modelProviderMapping.requestPrice})`.as(
						"request_price",
					),
			})
			.from(tables.modelProviderMapping)
			.where(eq(tables.modelProviderMapping.status, "active"))
			.groupBy(tables.modelProviderMapping.modelId)
			.as("pricing_sub");

		const orderFn = sortOrderVal === "asc" ? asc : desc;
		const sortColumnMap = {
			name: tables.model.name,
			family: tables.model.family,
			status: tables.model.status,
			free: tables.model.free,
			logsCount: sql`COALESCE(${modelAggSub.logsCount}, 0)`,
			totalCost: sql`COALESCE(${modelAggSub.totalCost}, 0)`,
			errorsCount: sql`GREATEST(COALESCE(${modelAggSub.errorsCount}, 0) - COALESCE(${modelAggSub.clientErrorsCount}, 0), 0)`,
			clientErrorsCount: sql`COALESCE(${modelAggSub.clientErrorsCount}, 0)`,
			gatewayErrorsCount: sql`COALESCE(${modelAggSub.gatewayErrorsCount}, 0)`,
			upstreamErrorsCount: sql`COALESCE(${modelAggSub.upstreamErrorsCount}, 0)`,
			cachedCount: sql`COALESCE(${modelAggSub.cachedCount}, 0)`,
			avgTimeToFirstToken: sql`COALESCE(${tables.model.avgTimeToFirstReasoningToken}, ${tables.model.avgTimeToFirstToken})`,
			providerCount: sql`COALESCE(${providerCountSub.count}, 0)`,
			updatedAt: tables.model.updatedAt,
		} as const;

		const sortColumn = sortColumnMap[sortBy];

		const countQuery = db
			.select({ count: sql<number>`COUNT(*)`.as("count") })
			.from(tables.model)
			.where(whereClause);

		const totalsQuery = db
			.select({
				totalTokens:
					sql<number>`COALESCE(SUM(COALESCE(${modelAggSub.totalTokens}, 0)), 0)`.as(
						"totalTokens",
					),
				totalCost:
					sql<number>`COALESCE(SUM(COALESCE(cast(${modelAggSub.totalCost} as double precision), 0)), 0)`.as(
						"totalCost",
					),
				...tokenBreakdownSubTotals(modelAggSub),
			})
			.from(tables.model)
			.leftJoin(modelAggSub, eq(tables.model.id, modelAggSub.modelId))
			.where(whereClause);

		const rowsBase = db
			.select({
				id: tables.model.id,
				name: tables.model.name,
				family: tables.model.family,
				free: tables.model.free,
				stability: tables.model.stability,
				status: tables.model.status,
				logsCount: sql<number>`COALESCE(${modelAggSub.logsCount}, 0)`.as(
					"logsCount",
				),
				errorsCount: sql<number>`COALESCE(${modelAggSub.errorsCount}, 0)`.as(
					"errorsCount",
				),
				clientErrorsCount:
					sql<number>`COALESCE(${modelAggSub.clientErrorsCount}, 0)`.as(
						"clientErrorsCount",
					),
				gatewayErrorsCount:
					sql<number>`COALESCE(${modelAggSub.gatewayErrorsCount}, 0)`.as(
						"gatewayErrorsCount",
					),
				upstreamErrorsCount:
					sql<number>`COALESCE(${modelAggSub.upstreamErrorsCount}, 0)`.as(
						"upstreamErrorsCount",
					),
				cachedCount: sql<number>`COALESCE(${modelAggSub.cachedCount}, 0)`.as(
					"cachedCount",
				),
				avgTimeToFirstToken: sql<
					number | null
				>`COALESCE(${tables.model.avgTimeToFirstReasoningToken}, ${tables.model.avgTimeToFirstToken})`.as(
					"avgTimeToFirstToken",
				),
				providerCount: sql<number>`COALESCE(${providerCountSub.count}, 0)`.as(
					"providerCount",
				),
				totalTokens: sql<number>`COALESCE(${modelAggSub.totalTokens}, 0)`.as(
					"totalTokens",
				),
				totalCost: sql<number>`COALESCE(${modelAggSub.totalCost}, 0)`.as(
					"totalCost",
				),
				...tokenBreakdownFromSub(modelAggSub),
				inputPrice: pricingSub.inputPrice,
				outputPrice: pricingSub.outputPrice,
				requestPrice: pricingSub.requestPrice,
				updatedAt: tables.model.updatedAt,
			})
			.from(tables.model);

		const rowsWithStatsJoin = rowsBase.leftJoin(
			modelAggSub,
			eq(tables.model.id, modelAggSub.modelId),
		);

		const [[countResult], [totalsResult], rows] = await Promise.all([
			countQuery,
			totalsQuery,
			rowsWithStatsJoin
				.leftJoin(
					providerCountSub,
					eq(tables.model.id, providerCountSub.modelId),
				)
				.leftJoin(pricingSub, eq(tables.model.id, pricingSub.modelId))
				.where(whereClause)
				.orderBy(orderFn(sortColumn), asc(tables.model.id))
				.limit(limit)
				.offset(offset),
		]);

		const total = Number(countResult?.count ?? 0);
		const totalTokensAgg = Number(totalsResult?.totalTokens ?? 0);
		const totalCostAgg = Number(totalsResult?.totalCost ?? 0);

		return c.json({
			models: rows.map((r) => ({
				id: r.id,
				name: r.name,
				family: r.family,
				free: r.free,
				stability: r.stability,
				status: r.status,
				logsCount: Number(r.logsCount ?? 0),
				errorsCount: Number(r.errorsCount ?? 0),
				clientErrorsCount: Number(r.clientErrorsCount ?? 0),
				gatewayErrorsCount: Number(r.gatewayErrorsCount ?? 0),
				upstreamErrorsCount: Number(r.upstreamErrorsCount ?? 0),
				cachedCount: Number(r.cachedCount ?? 0),
				avgTimeToFirstToken: r.avgTimeToFirstToken,
				providerCount: Number(r.providerCount ?? 0),
				totalTokens: Number(r.totalTokens ?? 0),
				totalCost: Number(r.totalCost ?? 0),
				...toTokenBreakdown(r),
				inputPrice: r.inputPrice ?? null,
				outputPrice: r.outputPrice ?? null,
				requestPrice: r.requestPrice ?? null,
				updatedAt: r.updatedAt.toISOString(),
			})),
			total,
			limit,
			offset,
			totalTokens: totalTokensAgg,
			totalCost: totalCostAgg,
			...toTokenBreakdown(totalsResult),
		});
	}

	const providerCountSub = db
		.select({
			modelId: tables.modelProviderMapping.modelId,
			count: sql<number>`COUNT(*)`.as("provider_count"),
		})
		.from(tables.modelProviderMapping)
		.groupBy(tables.modelProviderMapping.modelId)
		.as("provider_count_sub");

	const pricingSub = db
		.select({
			modelId: tables.modelProviderMapping.modelId,
			inputPrice:
				sql<string>`MIN(${tables.modelProviderMapping.inputPrice})`.as(
					"input_price",
				),
			outputPrice:
				sql<string>`MIN(${tables.modelProviderMapping.outputPrice})`.as(
					"output_price",
				),
			requestPrice:
				sql<string>`MIN(${tables.modelProviderMapping.requestPrice})`.as(
					"request_price",
				),
		})
		.from(tables.modelProviderMapping)
		.where(eq(tables.modelProviderMapping.status, "active"))
		.groupBy(tables.modelProviderMapping.modelId)
		.as("pricing_sub");

	const [countResult] = await db
		.select({ count: sql<number>`COUNT(*)`.as("count") })
		.from(tables.model)
		.where(whereClause);

	const total = Number(countResult?.count ?? 0);

	const orderFn = sortOrderVal === "asc" ? asc : desc;

	const sortColumnMap = {
		name: tables.model.name,
		family: tables.model.family,
		status: tables.model.status,
		free: tables.model.free,
		logsCount: tables.model.logsCount,
		totalCost: sql`0`,
		errorsCount: sql`GREATEST(${tables.model.errorsCount} - ${tables.model.clientErrorsCount}, 0)`,
		clientErrorsCount: tables.model.clientErrorsCount,
		gatewayErrorsCount: tables.model.gatewayErrorsCount,
		upstreamErrorsCount: tables.model.upstreamErrorsCount,
		cachedCount: tables.model.cachedCount,
		avgTimeToFirstToken: sql`COALESCE(${tables.model.avgTimeToFirstReasoningToken}, ${tables.model.avgTimeToFirstToken})`,
		providerCount: sql`COALESCE(${providerCountSub.count}, 0)`,
		updatedAt: tables.model.updatedAt,
	} as const;

	const sortColumn = sortColumnMap[sortBy];

	const rows = await db
		.select({
			id: tables.model.id,
			name: tables.model.name,
			family: tables.model.family,
			free: tables.model.free,
			stability: tables.model.stability,
			status: tables.model.status,
			logsCount: tables.model.logsCount,
			errorsCount: tables.model.errorsCount,
			clientErrorsCount: tables.model.clientErrorsCount,
			gatewayErrorsCount: tables.model.gatewayErrorsCount,
			upstreamErrorsCount: tables.model.upstreamErrorsCount,
			cachedCount: tables.model.cachedCount,
			avgTimeToFirstToken: sql<
				number | null
			>`COALESCE(${tables.model.avgTimeToFirstReasoningToken}, ${tables.model.avgTimeToFirstToken})`.as(
				"avgTimeToFirstToken",
			),
			providerCount: sql<number>`COALESCE(${providerCountSub.count}, 0)`.as(
				"providerCount",
			),
			inputPrice: pricingSub.inputPrice,
			outputPrice: pricingSub.outputPrice,
			requestPrice: pricingSub.requestPrice,
			updatedAt: tables.model.updatedAt,
		})
		.from(tables.model)
		.leftJoin(providerCountSub, eq(tables.model.id, providerCountSub.modelId))
		.leftJoin(pricingSub, eq(tables.model.id, pricingSub.modelId))
		.where(whereClause)
		.orderBy(orderFn(sortColumn), asc(tables.model.id))
		.limit(limit)
		.offset(offset);

	return c.json({
		models: rows.map((r) => ({
			id: r.id,
			name: r.name,
			family: r.family,
			free: r.free,
			stability: r.stability,
			status: r.status,
			logsCount: r.logsCount,
			errorsCount: r.errorsCount,
			clientErrorsCount: r.clientErrorsCount,
			gatewayErrorsCount: r.gatewayErrorsCount,
			upstreamErrorsCount: r.upstreamErrorsCount,
			cachedCount: r.cachedCount,
			avgTimeToFirstToken: r.avgTimeToFirstToken,
			providerCount: Number(r.providerCount),
			totalTokens: 0,
			totalCost: 0,
			...EMPTY_TOKEN_BREAKDOWN,
			inputPrice: r.inputPrice ?? null,
			outputPrice: r.outputPrice ?? null,
			requestPrice: r.requestPrice ?? null,
			updatedAt: r.updatedAt.toISOString(),
		})),
		total,
		limit,
		offset,
		totalTokens: 0,
		totalCost: 0,
		...EMPTY_TOKEN_BREAKDOWN,
	});
});

// --- Shared history helpers (used by model detail + history endpoints) ---

const historyWindowSchema = z.enum([
	"1m",
	"2m",
	"5m",
	"15m",
	"1h",
	"2h",
	"4h",
	"12h",
	"24h",
	"2d",
	"3d",
	"7d",
	"30d",
	"90d",
]);

const HISTORY_WINDOW_MINUTES: Record<string, number> = {
	"1m": 1,
	"2m": 2,
	"5m": 5,
	"15m": 15,
	"1h": 60,
	"2h": 120,
	"4h": 240,
	"12h": 720,
	"24h": 1440,
	"2d": 2880,
	"3d": 4320,
	"7d": 10080,
	"30d": 43200,
	"90d": 129600,
};

function getHistoryStartDate(window: string): Date {
	const minutes = HISTORY_WINDOW_MINUTES[window] ?? 240;
	const ms = minutes * 60 * 1000;
	return new Date(Date.now() - ms);
}

function isHourlyWindow(window: string): boolean {
	return (
		(HISTORY_WINDOW_MINUTES[window] ?? 240) > HOURLY_BUCKET_THRESHOLD_MINUTES
	);
}

// Model detail – lists providers that serve a given model (with stats)
const modelProviderStatsSchema = z.object({
	providerId: z.string(),
	providerName: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	...tokenBreakdownShape,
	updatedAt: z.string(),
});

const modelDetailSchema = z.object({
	model: z.object({
		id: z.string(),
		name: z.string(),
		family: z.string(),
		free: z.boolean(),
		stability: z.string(),
		status: z.string(),
		logsCount: z.number(),
		errorsCount: z.number(),
		clientErrorsCount: z.number(),
		gatewayErrorsCount: z.number(),
		upstreamErrorsCount: z.number(),
		completedCount: z.number(),
		lengthLimitCount: z.number(),
		contentFilterCount: z.number(),
		toolCallsCount: z.number(),
		canceledCount: z.number(),
		unknownFinishCount: z.number(),
		cachedCount: z.number(),
		avgTimeToFirstToken: z.number().nullable(),
		providerCount: z.number(),
		...tokenBreakdownShape,
		updatedAt: z.string(),
	}),
	providers: z.array(modelProviderStatsSchema),
});

const getModelDetail = createRoute({
	method: "get",
	path: "/models/{modelId}",
	request: {
		params: z.object({ modelId: z.string() }),
		query: z.object({
			window: historyWindowSchema.default("4h").optional(),
			projectId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: modelDetailSchema.openapi({}) },
			},
			description: "Model detail with per-provider stats.",
		},
	},
});

admin.openapi(getModelDetail, async (c) => {
	const { modelId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "4h";
	const projectId = query.projectId;
	const startDate = getHistoryStartDate(window);

	const model = await db.query.model.findFirst({
		where: { id: { eq: modelId } },
	});

	if (!model) {
		throw new HTTPException(404, { message: "Model not found" });
	}

	// Project-scoped: use projectHourlyModelStats for provider breakdown
	if (projectId) {
		const hourStartDate = new Date(startDate);
		hourStartDate.setMinutes(0, 0, 0);
		const statsRows = await db
			.select({
				usedProvider: projectHourlyModelStats.usedProvider,
				logsCount: sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"logs_count",
				),
				errorsCount: sql<number>`SUM(${projectHourlyModelStats.errorCount})`.as(
					"errors_count",
				),
				clientErrorsCount:
					sql<number>`SUM(${projectHourlyModelStats.clientErrorCount})`.as(
						"client_errors_count",
					),
				gatewayErrorsCount:
					sql<number>`SUM(${projectHourlyModelStats.gatewayErrorCount})`.as(
						"gateway_errors_count",
					),
				upstreamErrorsCount:
					sql<number>`SUM(${projectHourlyModelStats.upstreamErrorCount})`.as(
						"upstream_errors_count",
					),
				completedCount:
					sql<number>`SUM(${projectHourlyModelStats.completedCount})`.as(
						"completed_count",
					),
				lengthLimitCount:
					sql<number>`SUM(${projectHourlyModelStats.lengthLimitCount})`.as(
						"length_limit_count",
					),
				contentFilterCount:
					sql<number>`SUM(${projectHourlyModelStats.contentFilterCount})`.as(
						"content_filter_count",
					),
				toolCallsCount:
					sql<number>`SUM(${projectHourlyModelStats.toolCallsCount})`.as(
						"tool_calls_count",
					),
				canceledCount:
					sql<number>`SUM(${projectHourlyModelStats.canceledCount})`.as(
						"canceled_count",
					),
				unknownFinishCount:
					sql<number>`SUM(${projectHourlyModelStats.unknownFinishCount})`.as(
						"unknown_finish_count",
					),
				cachedCount: sql<number>`SUM(${projectHourlyModelStats.cacheCount})`.as(
					"cached_count",
				),
				inputTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.inputTokens} AS NUMERIC))`.as(
						"input_tokens",
					),
				cachedTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.cachedTokens} AS NUMERIC))`.as(
						"cached_tokens",
					),
				outputTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.outputTokens} AS NUMERIC))`.as(
						"output_tokens",
					),
				inputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.inputCost} as double precision))`.as(
						"input_cost",
					),
				cachedInputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.cachedInputCost} as double precision))`.as(
						"cached_input_cost",
					),
				outputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.outputCost} as double precision))`.as(
						"output_cost",
					),
			})
			.from(projectHourlyModelStats)
			.where(
				and(
					eq(projectHourlyModelStats.projectId, projectId),
					eq(projectHourlyModelStats.usedModel, modelId),
					gte(projectHourlyModelStats.hourTimestamp, hourStartDate),
				),
			)
			.groupBy(projectHourlyModelStats.usedProvider);

		const providerIds = statsRows.map((r) => r.usedProvider);
		const providerRows =
			providerIds.length > 0
				? await db.query.provider.findMany({
						where: { id: { in: providerIds } },
					})
				: [];
		const providerNameMap = new Map(providerRows.map((p) => [p.id, p.name]));

		const totalLogs = statsRows.reduce((s, r) => s + Number(r.logsCount), 0);
		const totalErrors = statsRows.reduce(
			(s, r) => s + Number(r.errorsCount),
			0,
		);
		const totalClientErrors = statsRows.reduce(
			(s, r) => s + Number(r.clientErrorsCount),
			0,
		);
		const totalGatewayErrors = statsRows.reduce(
			(s, r) => s + Number(r.gatewayErrorsCount),
			0,
		);
		const totalUpstreamErrors = statsRows.reduce(
			(s, r) => s + Number(r.upstreamErrorsCount),
			0,
		);
		const totalCompleted = statsRows.reduce(
			(s, r) => s + Number(r.completedCount),
			0,
		);
		const totalLengthLimit = statsRows.reduce(
			(s, r) => s + Number(r.lengthLimitCount),
			0,
		);
		const totalContentFilter = statsRows.reduce(
			(s, r) => s + Number(r.contentFilterCount),
			0,
		);
		const totalToolCalls = statsRows.reduce(
			(s, r) => s + Number(r.toolCallsCount),
			0,
		);
		const totalCanceled = statsRows.reduce(
			(s, r) => s + Number(r.canceledCount),
			0,
		);
		const totalUnknownFinish = statsRows.reduce(
			(s, r) => s + Number(r.unknownFinishCount),
			0,
		);
		const totalCached = statsRows.reduce(
			(s, r) => s + Number(r.cachedCount),
			0,
		);
		const totalBreakdown = { ...EMPTY_TOKEN_BREAKDOWN };
		for (const r of statsRows) {
			addTokenBreakdown(totalBreakdown, r);
		}

		return c.json({
			model: {
				id: model.id,
				name: model.name,
				family: model.family,
				free: model.free,
				stability: model.stability,
				status: model.status,
				logsCount: totalLogs,
				errorsCount: totalErrors,
				clientErrorsCount: totalClientErrors,
				gatewayErrorsCount: totalGatewayErrors,
				upstreamErrorsCount: totalUpstreamErrors,
				completedCount: totalCompleted,
				lengthLimitCount: totalLengthLimit,
				contentFilterCount: totalContentFilter,
				toolCallsCount: totalToolCalls,
				canceledCount: totalCanceled,
				unknownFinishCount: totalUnknownFinish,
				cachedCount: totalCached,
				avgTimeToFirstToken: null,
				providerCount: statsRows.length,
				...totalBreakdown,
				updatedAt: model.updatedAt.toISOString(),
			},
			providers: statsRows.map((r) => ({
				providerId: r.usedProvider,
				providerName: providerNameMap.get(r.usedProvider) ?? r.usedProvider,
				logsCount: Number(r.logsCount),
				errorsCount: Number(r.errorsCount),
				cachedCount: Number(r.cachedCount),
				avgTimeToFirstToken: null,
				...toTokenBreakdown(r),
				updatedAt: model.updatedAt.toISOString(),
			})),
		});
	}

	// Global view. For windows longer than 24h, aggregate the hourly rollup so
	// long ranges don't scan minute rows (sums are identical either way).
	const { table: mph, bucket: mphTs } = pickMappingHistoryTable(
		isHourlyWindow(window),
	);
	const [mappings, statsRows] = await Promise.all([
		db
			.select({
				providerId: tables.modelProviderMapping.providerId,
				avgTimeToFirstToken: sql<
					number | null
				>`COALESCE(${tables.modelProviderMapping.avgTimeToFirstReasoningToken}, ${tables.modelProviderMapping.avgTimeToFirstToken})`.as(
					"avgTimeToFirstToken",
				),
				updatedAt: tables.modelProviderMapping.updatedAt,
			})
			.from(tables.modelProviderMapping)
			.where(eq(tables.modelProviderMapping.modelId, modelId)),
		db
			.select({
				providerId: mph.providerId,
				logsCount: sql<number>`COALESCE(SUM(${mph.logsCount}), 0)`.as(
					"logs_count",
				),
				errorsCount: sql<number>`COALESCE(SUM(${mph.errorsCount}), 0)`.as(
					"errors_count",
				),
				clientErrorsCount:
					sql<number>`COALESCE(SUM(${mph.clientErrorsCount}), 0)`.as(
						"client_errors_count",
					),
				gatewayErrorsCount:
					sql<number>`COALESCE(SUM(${mph.gatewayErrorsCount}), 0)`.as(
						"gateway_errors_count",
					),
				upstreamErrorsCount:
					sql<number>`COALESCE(SUM(${mph.upstreamErrorsCount}), 0)`.as(
						"upstream_errors_count",
					),
				completedCount: sql<number>`COALESCE(SUM(${mph.completedCount}), 0)`.as(
					"completed_count",
				),
				lengthLimitCount:
					sql<number>`COALESCE(SUM(${mph.lengthLimitCount}), 0)`.as(
						"length_limit_count",
					),
				contentFilterCount:
					sql<number>`COALESCE(SUM(${mph.contentFilterCount}), 0)`.as(
						"content_filter_count",
					),
				toolCallsCount: sql<number>`COALESCE(SUM(${mph.toolCallsCount}), 0)`.as(
					"tool_calls_count",
				),
				canceledCount: sql<number>`COALESCE(SUM(${mph.canceledCount}), 0)`.as(
					"canceled_count",
				),
				unknownFinishCount:
					sql<number>`COALESCE(SUM(${mph.unknownFinishCount}), 0)`.as(
						"unknown_finish_count",
					),
				cachedCount: sql<number>`COALESCE(SUM(${mph.cachedCount}), 0)`.as(
					"cached_count",
				),
				totalTtft:
					sql<number>`COALESCE(SUM(${mph.totalTimeToFirstToken}), 0)`.as(
						"total_ttft",
					),
				ttftCount:
					sql<number>`COALESCE(SUM(${mph.timeToFirstTokenCount}), 0)`.as(
						"ttft_count",
					),
				totalTtfrt:
					sql<number>`COALESCE(SUM(${mph.totalTimeToFirstReasoningToken}), 0)`.as(
						"total_ttfrt",
					),
				ttfrtCount:
					sql<number>`COALESCE(SUM(${mph.timeToFirstReasoningTokenCount}), 0)`.as(
						"ttfrt_count",
					),
				...tokenBreakdownSums(mph),
			})
			.from(mph)
			.where(
				and(
					eq(mph.modelId, modelId),
					gte(mphTs, startDate),
					excludeRegionalMappingRows(mph),
				),
			)
			.groupBy(mph.providerId),
	]);

	const providerIds = mappings.map((m) => m.providerId);
	const providerRows =
		providerIds.length > 0
			? await db.query.provider.findMany({
					where: { id: { in: providerIds } },
				})
			: [];

	const providerNameMap = new Map(providerRows.map((p) => [p.id, p.name]));
	const providerStatsMap = new Map(
		statsRows.map((r) => {
			const logsCount = Number(r.logsCount ?? 0);
			const cachedCount = Number(r.cachedCount ?? 0);
			// Only streamed requests record a time-to-first-token, so the average
			// divides by the sample count, not the request count. Reasoning-token
			// samples take precedence so thinking mappings aren't measured on
			// their (much later) first content token.
			const { total: totalTtft, count: ttftCount } = effectiveTtftTotals({
				totalTimeToFirstToken: Number(r.totalTtft ?? 0),
				timeToFirstTokenCount: Number(r.ttftCount ?? 0),
				totalTimeToFirstReasoningToken: Number(r.totalTtfrt ?? 0),
				timeToFirstReasoningTokenCount: Number(r.ttfrtCount ?? 0),
			});
			return [
				r.providerId,
				{
					logsCount,
					errorsCount: Number(r.errorsCount ?? 0),
					cachedCount,
					avgTtft: ttftCount > 0 ? totalTtft / ttftCount : null,
					breakdown: toTokenBreakdown(r),
				},
			];
		}),
	);

	const providerStats = mappings.map((m) => {
		const stats = providerStatsMap.get(m.providerId);
		return {
			providerId: m.providerId,
			providerName: providerNameMap.get(m.providerId) ?? m.providerId,
			logsCount: stats?.logsCount ?? 0,
			errorsCount: stats?.errorsCount ?? 0,
			cachedCount: stats?.cachedCount ?? 0,
			avgTimeToFirstToken: stats?.avgTtft ?? m.avgTimeToFirstToken,
			...(stats?.breakdown ?? EMPTY_TOKEN_BREAKDOWN),
			updatedAt: m.updatedAt.toISOString(),
		};
	});

	const agg = statsRows.reduce(
		(acc, r) => {
			acc.logsCount += Number(r.logsCount ?? 0);
			acc.errorsCount += Number(r.errorsCount ?? 0);
			acc.clientErrorsCount += Number(r.clientErrorsCount ?? 0);
			acc.gatewayErrorsCount += Number(r.gatewayErrorsCount ?? 0);
			acc.upstreamErrorsCount += Number(r.upstreamErrorsCount ?? 0);
			acc.completedCount += Number(r.completedCount ?? 0);
			acc.lengthLimitCount += Number(r.lengthLimitCount ?? 0);
			acc.contentFilterCount += Number(r.contentFilterCount ?? 0);
			acc.toolCallsCount += Number(r.toolCallsCount ?? 0);
			acc.canceledCount += Number(r.canceledCount ?? 0);
			acc.unknownFinishCount += Number(r.unknownFinishCount ?? 0);
			acc.cachedCount += Number(r.cachedCount ?? 0);
			acc.totalTtft += Number(r.totalTtft ?? 0);
			acc.ttftCount += Number(r.ttftCount ?? 0);
			acc.totalTtfrt += Number(r.totalTtfrt ?? 0);
			acc.ttfrtCount += Number(r.ttfrtCount ?? 0);
			addTokenBreakdown(acc.breakdown, r);
			return acc;
		},
		{
			logsCount: 0,
			errorsCount: 0,
			clientErrorsCount: 0,
			gatewayErrorsCount: 0,
			upstreamErrorsCount: 0,
			completedCount: 0,
			lengthLimitCount: 0,
			contentFilterCount: 0,
			toolCallsCount: 0,
			canceledCount: 0,
			unknownFinishCount: 0,
			cachedCount: 0,
			totalTtft: 0,
			ttftCount: 0,
			totalTtfrt: 0,
			ttfrtCount: 0,
			breakdown: { ...EMPTY_TOKEN_BREAKDOWN },
		},
	);
	const hasWindowData = agg.logsCount > 0;
	const { total: aggEffectiveTtft, count: aggEffectiveTtftCount } =
		effectiveTtftTotals({
			totalTimeToFirstToken: agg.totalTtft,
			timeToFirstTokenCount: agg.ttftCount,
			totalTimeToFirstReasoningToken: agg.totalTtfrt,
			timeToFirstReasoningTokenCount: agg.ttfrtCount,
		});
	const aggAvgTtft =
		aggEffectiveTtftCount > 0 ? aggEffectiveTtft / aggEffectiveTtftCount : null;

	return c.json({
		model: {
			id: model.id,
			name: model.name,
			family: model.family,
			free: model.free,
			stability: model.stability,
			status: model.status,
			logsCount: hasWindowData ? agg.logsCount : model.logsCount,
			errorsCount: hasWindowData ? agg.errorsCount : model.errorsCount,
			clientErrorsCount: hasWindowData
				? agg.clientErrorsCount
				: model.clientErrorsCount,
			gatewayErrorsCount: hasWindowData
				? agg.gatewayErrorsCount
				: model.gatewayErrorsCount,
			upstreamErrorsCount: hasWindowData
				? agg.upstreamErrorsCount
				: model.upstreamErrorsCount,
			completedCount: agg.completedCount,
			lengthLimitCount: agg.lengthLimitCount,
			contentFilterCount: agg.contentFilterCount,
			toolCallsCount: agg.toolCallsCount,
			canceledCount: agg.canceledCount,
			unknownFinishCount: agg.unknownFinishCount,
			cachedCount: hasWindowData ? agg.cachedCount : model.cachedCount,
			avgTimeToFirstToken: hasWindowData
				? (aggAvgTtft ??
					model.avgTimeToFirstReasoningToken ??
					model.avgTimeToFirstToken)
				: (model.avgTimeToFirstReasoningToken ?? model.avgTimeToFirstToken),
			providerCount: providerStats.length,
			...agg.breakdown,
			updatedAt: model.updatedAt.toISOString(),
		},
		providers: providerStats,
	});
});

// Gift credits to organization
const giftCreditsRoute = createRoute({
	method: "post",
	path: "/organizations/{orgId}/gift-credits",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						creditAmount: z
							.number()
							.min(0.01, "Credit amount must be positive"),
						comment: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						credits: z.string(),
					}),
				},
			},
			description: "Credits gifted successfully.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization not found.",
		},
	},
});

admin.openapi(giftCreditsRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { creditAmount, comment } = c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org || org.status === "deleted") {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const description = comment
		? `Credits gifted by Administrator: ${comment}`
		: "Credits gifted by Administrator";

	const { transactionId, updatedCredits } = await db.transaction(async (tx) => {
		const [txn] = await tx
			.insert(tables.transaction)
			.values({
				organizationId: orgId,
				type: "credit_gift",
				creditAmount: creditAmount.toString(),
				currency: "USD",
				status: "completed",
				description,
			})
			.returning({ id: tables.transaction.id });

		const [updatedOrg] = await tx
			.update(tables.organization)
			.set({
				credits: sql`${tables.organization.credits} + ${creditAmount}`,
			})
			.where(eq(tables.organization.id, orgId))
			.returning({ credits: tables.organization.credits });

		return {
			transactionId: txn.id,
			updatedCredits: String(updatedOrg.credits),
		};
	});

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "credits.gift",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			creditAmount,
			comment,
			transactionId,
		},
	});

	return c.json({
		message: "Credits gifted successfully",
		credits: updatedCredits,
	});
});

// Manually credit an organization for a payment received outside Stripe
const manualPaymentMethods = ["wire", "crypto", "paypal", "other"] as const;

const manualCreditsRoute = createRoute({
	method: "post",
	path: "/organizations/{orgId}/manual-credits",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						creditAmount: z
							.number()
							.min(0.01, "Credit amount must be positive"),
						paymentMethod: z.enum(manualPaymentMethods),
						// Identifier for the payment on its own channel: a bank wire
						// reference, an on-chain tx hash, a PayPal transaction id.
						externalReference: z.string().trim().max(255).optional(),
						comment: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						credits: z.string(),
					}),
				},
			},
			description: "Credits added successfully.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization not found.",
		},
	},
});

admin.openapi(manualCreditsRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { creditAmount, paymentMethod, externalReference, comment } =
		c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org || org.status === "deleted") {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const description = comment
		? `Manual payment (${paymentMethod}) credited by Administrator: ${comment}`
		: `Manual payment (${paymentMethod}) credited by Administrator`;

	const { transactionId, updatedCredits } = await db.transaction(async (tx) => {
		const [txn] = await tx
			.insert(tables.transaction)
			.values({
				organizationId: orgId,
				type: "credit_manual_payment",
				// The money was actually received, so `amount` (gross payment) and
				// `creditAmount` (credits granted) are the same figure: there are no
				// Stripe fees to net out on an off-Stripe channel.
				amount: creditAmount.toString(),
				creditAmount: creditAmount.toString(),
				currency: "USD",
				status: "completed",
				description,
				paymentMethod,
				externalReference: externalReference || null,
			})
			.returning({ id: tables.transaction.id });

		const [updatedOrg] = await tx
			.update(tables.organization)
			.set({
				credits: sql`${tables.organization.credits} + ${creditAmount}`,
			})
			.where(eq(tables.organization.id, orgId))
			.returning({ credits: tables.organization.credits });

		return {
			transactionId: txn.id,
			updatedCredits: String(updatedOrg.credits),
		};
	});

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "credits.manual_payment",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			creditAmount,
			paymentMethod,
			externalReference,
			comment,
			transactionId,
		},
	});

	return c.json({
		message: "Credits added successfully",
		credits: updatedCredits,
	});
});

const enterprisePaymentMethods = ["wire", "crypto", "other"] as const;

const enterpriseTransactionDateSchema = z.string().refine((value) => {
	const date = new Date(`${value}T00:00:00.000Z`);
	return (
		!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
	);
}, "Invalid transaction date");

const enterpriseDealBodySchema = z.object({
	amount: z.number().min(0.01, "Deal amount must be positive"),
	paymentMethod: z.enum(enterprisePaymentMethods),
	transactionDate: enterpriseTransactionDateSchema.optional(),
	externalReference: z.string().trim().max(255).optional(),
	comment: z.string().trim().max(2000).optional(),
});

function parseEnterpriseTransactionDate(transactionDate?: string) {
	return transactionDate
		? new Date(`${transactionDate}T00:00:00.000Z`)
		: undefined;
}

const createEnterpriseDealRoute = createRoute({
	method: "post",
	path: "/organizations/{orgId}/enterprise-deals",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: enterpriseDealBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						transactionId: z.string(),
					}),
				},
			},
			description: "Enterprise deal recorded successfully.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

admin.openapi(createEnterpriseDealRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { amount, paymentMethod, transactionDate, externalReference, comment } =
		c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org || org.status === "deleted") {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const [deal] = await db
		.insert(tables.transaction)
		.values({
			organizationId: orgId,
			type: "enterprise_license_fee",
			createdAt: parseEnterpriseTransactionDate(transactionDate),
			amount: amount.toString(),
			creditAmount: null,
			currency: "USD",
			status: "completed",
			description: comment || null,
			paymentMethod,
			externalReference: externalReference || null,
		})
		.returning({ id: tables.transaction.id });

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "enterprise_license_fee.create",
		resourceType: "transaction",
		resourceId: deal.id,
		metadata: {
			amount,
			paymentMethod,
			transactionDate,
			externalReference,
			comment,
		},
	});

	return c.json({
		message: "Enterprise deal recorded successfully",
		transactionId: deal.id,
	});
});

const updateEnterpriseDealRoute = createRoute({
	method: "patch",
	path: "/organizations/{orgId}/enterprise-deals/{transactionId}",
	request: {
		params: z.object({
			orgId: z.string(),
			transactionId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: enterpriseDealBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Enterprise deal updated successfully.",
		},
		404: {
			description: "Enterprise deal not found.",
		},
	},
});

admin.openapi(updateEnterpriseDealRoute, async (c) => {
	const user = c.get("user");
	const { orgId, transactionId } = c.req.valid("param");
	const { amount, paymentMethod, transactionDate, externalReference, comment } =
		c.req.valid("json");
	const createdAt = parseEnterpriseTransactionDate(transactionDate);

	const [updatedDeal] = await db
		.update(tables.transaction)
		.set({
			...(createdAt ? { createdAt } : {}),
			amount: amount.toString(),
			creditAmount: null,
			description: comment || null,
			paymentMethod,
			externalReference: externalReference || null,
		})
		.where(
			and(
				eq(tables.transaction.id, transactionId),
				eq(tables.transaction.organizationId, orgId),
				eq(tables.transaction.type, "enterprise_license_fee"),
			),
		)
		.returning({ id: tables.transaction.id });

	if (!updatedDeal) {
		throw new HTTPException(404, {
			message: "Enterprise deal not found",
		});
	}

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "enterprise_license_fee.update",
		resourceType: "transaction",
		resourceId: updatedDeal.id,
		metadata: {
			amount,
			paymentMethod,
			transactionDate,
			externalReference,
			comment,
		},
	});

	return c.json({ message: "Enterprise deal updated successfully" });
});

// Configure the referral signup bonus for an organization
const updateReferralBonusRoute = createRoute({
	method: "patch",
	path: "/organizations/{orgId}/referral-bonus",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						enabled: z.boolean(),
						percent: z.number().min(0).max(1000),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						referralBonusEnabled: z.boolean(),
						referralBonusPercent: z.number(),
					}),
				},
			},
			description: "Referral bonus updated successfully.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization not found.",
		},
	},
});

admin.openapi(updateReferralBonusRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { enabled, percent } = c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org || org.status === "deleted") {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	await db
		.update(tables.organization)
		.set({
			referralBonusEnabled: enabled,
			referralBonusPercent: percent.toString(),
		})
		.where(eq(tables.organization.id, orgId));

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "referral_bonus.update",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			enabled,
			percent,
		},
	});

	return c.json({
		message: "Referral bonus updated successfully",
		referralBonusEnabled: enabled,
		referralBonusPercent: percent,
	});
});

/**
 * Plan term dates are entered as plain calendar days (YYYY-MM-DD) because an
 * enterprise contract renews on a date, not at a wall-clock instant. They are
 * stored as the UTC midnight of that day, which is also the boundary the
 * shared `getPlanTerm` countdown counts against.
 */
const planTermDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
	// `new Date("2027-02-31")` silently rolls over to March 3 rather than
	// failing, so the parsed date has to round-trip back to the input before a
	// typo can be accepted as a contract date.
	.refine(
		(value) => {
			const parsed = new Date(value);
			return (
				!Number.isNaN(parsed.getTime()) &&
				parsed.toISOString().slice(0, 10) === value
			);
		},
		{ message: "Not a valid calendar date" },
	)
	.nullable();

// Manage an organization's plan tier, plan term, seat-limit and API-key-limit overrides
const manageOrganizationRoute = createRoute({
	method: "patch",
	path: "/organizations/{orgId}/manage",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						name: z.string().trim().min(1).max(255),
						plan: z.enum(["free", "pro", "enterprise"]),
						// Null clears the override and reverts to the plan default.
						seats: z.number().int().min(0).max(100000).nullable(),
						// Null clears the override and reverts to the plan default.
						apiKeyLimit: z.number().int().min(0).max(100000).nullable(),
						// Null clears the override and reverts to the plan default.
						projectLimit: z.number().int().min(0).max(100000).nullable(),
						// Trust-tier pin (0-4); takes precedence over the computed
						// age/spend ladder. Null reverts to the automatic ladder;
						// omitted leaves the current value unchanged.
						trustTierOverride: z
							.number()
							.int()
							.min(0)
							.max(4)
							.nullable()
							.optional(),
						// Null clears the plan term (open-ended plan).
						planExpiresAt: planTermDateSchema,
						planStartedAt: planTermDateSchema,
						// Enterprise trial window. `isTrialActive` false leaves the dates
						// on the record as history but stops the trial counting down.
						isTrialActive: z.boolean(),
						trialStartDate: planTermDateSchema,
						trialEndDate: planTermDateSchema,
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						name: z.string(),
						plan: z.string(),
						seats: z.number().int().nullable(),
						apiKeyLimit: z.number().int().nullable(),
						projectLimit: z.number().int().nullable(),
						trustTierOverride: z.number().int().nullable(),
						planExpiresAt: z.string().nullable(),
						planStartedAt: z.string().nullable(),
						isTrialActive: z.boolean(),
						trialStartDate: z.string().nullable(),
						trialEndDate: z.string().nullable(),
					}),
				},
			},
			description: "Organization updated successfully.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization not found.",
		},
	},
});

admin.openapi(manageOrganizationRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const {
		name,
		plan,
		seats,
		apiKeyLimit,
		projectLimit,
		trustTierOverride,
		planExpiresAt,
		planStartedAt,
		isTrialActive,
		trialStartDate,
		trialEndDate,
	} = c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org || org.status === "deleted") {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	const expiresAt = planExpiresAt ? new Date(planExpiresAt) : null;
	const startedAt = planStartedAt ? new Date(planStartedAt) : null;
	const trialStartsAt = trialStartDate ? new Date(trialStartDate) : null;
	const trialEndsAt = trialEndDate ? new Date(trialEndDate) : null;

	// A start date with no expiry is not a term: no surface renders one, and an
	// open-ended plan is expressed by leaving both dates empty. The reverse is
	// deliberately allowed — Stripe writes `planExpiresAt` on its own as a legacy
	// Pro renewal date, so organizations carrying one must stay manageable.
	if (startedAt && !expiresAt) {
		throw new HTTPException(400, {
			message: "A plan start date needs a plan expiry date",
		});
	}

	if (expiresAt && startedAt && startedAt.getTime() >= expiresAt.getTime()) {
		throw new HTTPException(400, {
			message: "Plan start date must be before the plan expiry date",
		});
	}

	if (
		trialStartsAt &&
		trialEndsAt &&
		trialStartsAt.getTime() >= trialEndsAt.getTime()
	) {
		throw new HTTPException(400, {
			message: "Trial start date must be before the trial end date",
		});
	}

	// A trial that is "active" with no end date would count down forever.
	if (isTrialActive && !trialEndsAt) {
		throw new HTTPException(400, {
			message: "An active trial needs a trial end date",
		});
	}

	const updateOrganization = async (
		executor: Pick<typeof db, "update">,
	): Promise<void> => {
		await executor
			.update(tables.organization)
			.set({
				name,
				plan,
				seats,
				apiKeyLimit,
				projectLimit,
				// undefined = leave unchanged (drizzle skips undefined set fields).
				trustTierOverride,
				planExpiresAt: expiresAt,
				planStartedAt: startedAt,
				isTrialActive,
				trialStartDate: trialStartsAt,
				trialEndDate: trialEndsAt,
			})
			.where(eq(tables.organization.id, orgId));
	};

	try {
		if (plan === "enterprise" && org.plan !== "enterprise") {
			await withEnterpriseSeatsForPromotion(orgId, updateOrganization);
		} else {
			await updateOrganization(db);
		}
	} catch (error) {
		if (error instanceof EnterpriseSeatLimitError) {
			throw new HTTPException(409, { message: error.message });
		}
		throw error;
	}

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "organization.manage",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			previousName: org.name,
			newName: name,
			previousPlan: org.plan,
			newPlan: plan,
			previousSeats: org.seats,
			newSeats: seats,
			previousApiKeyLimit: org.apiKeyLimit,
			newApiKeyLimit: apiKeyLimit,
			previousProjectLimit: org.projectLimit,
			previousTrustTierOverride: org.trustTierOverride,
			newTrustTierOverride:
				trustTierOverride === undefined
					? org.trustTierOverride
					: trustTierOverride,
			newProjectLimit: projectLimit,
			previousPlanExpiresAt: org.planExpiresAt?.toISOString() ?? null,
			newPlanExpiresAt: expiresAt?.toISOString() ?? null,
			previousPlanStartedAt: org.planStartedAt?.toISOString() ?? null,
			newPlanStartedAt: startedAt?.toISOString() ?? null,
			previousIsTrialActive: org.isTrialActive,
			newIsTrialActive: isTrialActive,
			previousTrialEndDate: org.trialEndDate?.toISOString() ?? null,
			newTrialEndDate: trialEndsAt?.toISOString() ?? null,
		},
	});

	return c.json({
		message: "Organization updated successfully",
		name,
		plan,
		seats,
		apiKeyLimit,
		projectLimit,
		trustTierOverride:
			trustTierOverride === undefined
				? org.trustTierOverride
				: trustTierOverride,
		planExpiresAt: expiresAt?.toISOString() ?? null,
		planStartedAt: startedAt?.toISOString() ?? null,
		isTrialActive,
		trialStartDate: trialStartsAt?.toISOString() ?? null,
		trialEndDate: trialEndsAt?.toISOString() ?? null,
	});
});

// --- Deleting/blocking an organization requires a non-positive balance ---

/**
 * Admin deletion is a fallback for abuse handling, not an account-closure tool.
 * An organization that still holds credits is a paying customer, so wiping it
 * from the admin panel is never the right move — the balance has to be spent,
 * refunded, or zeroed deliberately first, and the account then handled manually.
 *
 * Every path that marks an organization `deleted` (status toggle, single block,
 * bulk block) funnels through this guard so no single entry point can bypass it.
 */
function assertOrganizationDeletable(org: {
	name: string;
	credits: string | null;
}): void {
	const credits = Number(org.credits ?? "0");

	// Written as `!(credits <= 0)` rather than `credits > 0` so an unparseable
	// balance (NaN) also refuses the delete: not deleting is always the safe
	// direction here.
	if (!(credits <= 0)) {
		throw new HTTPException(409, {
			message: `"${org.name}" still has a positive credit balance (${org.credits ?? "0"}). Deleting is only allowed for organizations with zero or negative credits — zero out or refund the balance first, then handle this account manually.`,
		});
	}
}

// --- Set Organization Status ---

const orgStatusSchema = z.enum(["active", "deleted"]);

const setOrganizationStatusRoute = createRoute({
	method: "patch",
	path: "/organizations/{orgId}/status",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						status: orgStatusSchema,
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						status: orgStatusSchema,
					}),
				},
			},
			description: "Organization status updated.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization not found.",
		},
		409: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization still has a positive credit balance.",
		},
	},
});

admin.openapi(setOrganizationStatusRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { status } = c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	if (status === "deleted") {
		assertOrganizationDeletable(org);
	}

	const cancelledSubscriptionIds =
		status === "deleted" ? await cancelOrganizationSubscriptions(org) : [];

	const updateOrganization = async (
		executor: Pick<typeof db, "update">,
	): Promise<void> => {
		await executor
			.update(tables.organization)
			.set({
				status,
				...(status === "deleted" ? getCancelledOrganizationPlanState() : {}),
			})
			.where(eq(tables.organization.id, orgId));
	};

	try {
		if (status === "active" && org.status !== "active") {
			await withEnterpriseSeatsForActivation(orgId, updateOrganization);
		} else {
			await updateOrganization(db);
		}
	} catch (error) {
		if (error instanceof EnterpriseSeatLimitError) {
			throw new HTTPException(409, { message: error.message });
		}
		throw error;
	}

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action:
			status === "deleted" ? "organization.delete" : "organization.update",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			resourceName: org.name,
			previousStatus: org.status ?? "active",
			newStatus: status,
			cancelledSubscriptionIds,
			source: "admin",
		},
	});

	return c.json({
		message:
			status === "deleted"
				? "Organization disabled successfully"
				: "Organization re-enabled successfully",
		status,
	});
});

// --- Block Organization (cancel subscriptions immediately + disable access) ---

const blockOrganizationRoute = createRoute({
	method: "post",
	path: "/organizations/{orgId}/block",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						cancelledSubscriptionIds: z.array(z.string()),
					}),
				},
			},
			description:
				"Organization blocked, subscriptions cancelled, access disabled.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization not found.",
		},
		409: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Organization still has a positive credit balance.",
		},
	},
});

interface BlockOrganizationOutcome {
	cancelledSubscriptionIds: string[];
	memberCount: number;
	deactivatedUserCount: number;
}

/**
 * Blocks a single organization: cancels its Stripe subscriptions, marks it
 * deleted, deactivates every member, and writes the audit entry. Shared by the
 * single-org and bulk block endpoints so both paths always apply the exact same
 * effects.
 */
async function blockOrganizationById(
	orgId: string,
	adminUserId: string,
): Promise<BlockOrganizationOutcome> {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	// Checked before any Stripe call so a paying organization is refused without
	// its subscriptions being cancelled first.
	assertOrganizationDeletable(org);

	// Cancel every Stripe subscription the org holds (dashboard plan, DevPass and
	// Chat plan alike) before mutating local state.
	const cancelledSubscriptionIds = await cancelOrganizationSubscriptions(org);

	const memberLinks = await db.query.userOrganization.findMany({
		where: { organizationId: { eq: orgId } },
		columns: { userId: true },
	});
	const memberUserIds = memberLinks.map((m) => m.userId);

	await db.transaction(async (tx) => {
		await tx
			.update(tables.organization)
			.set({
				status: "deleted",
				...getCancelledOrganizationPlanState(),
			})
			.where(eq(tables.organization.id, orgId));

		if (memberUserIds.length > 0) {
			await tx
				.update(tables.user)
				.set({ status: "deactivated" })
				.where(inArray(tables.user.id, memberUserIds));

			await tx
				.delete(tables.session)
				.where(inArray(tables.session.userId, memberUserIds));
		}
	});

	if (memberUserIds.length > 0) {
		const members = await db.query.user.findMany({
			where: { id: { in: memberUserIds } },
			columns: { email: true },
		});

		await Promise.all(
			members.map((member) => deleteResendContact(member.email)),
		);
	}

	await logAuditEvent({
		organizationId: orgId,
		userId: adminUserId,
		action: "organization.block",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			resourceName: org.name,
			previousStatus: org.status ?? "active",
			cancelledSubscriptionIds,
			memberCount: memberUserIds.length,
			deactivatedUserCount: memberUserIds.length,
			source: "admin",
		},
	});

	return {
		cancelledSubscriptionIds,
		memberCount: memberUserIds.length,
		deactivatedUserCount: memberUserIds.length,
	};
}

admin.openapi(blockOrganizationRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");

	const { cancelledSubscriptionIds } = await blockOrganizationById(
		orgId,
		user!.id,
	);

	return c.json({
		message: "Organization blocked and subscriptions cancelled.",
		cancelledSubscriptionIds,
	});
});

// --- Bulk block organizations (filtered list) ---

const bulkBlockOrganizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	billingEmail: z.string(),
	plan: z.string(),
	status: z.string().nullable(),
	createdAt: z.string(),
});

interface BulkBlockCandidates {
	search: string;
	matched: number;
	candidates: {
		id: string;
		name: string;
		billingEmail: string;
		plan: string;
		status: string | null;
		createdAt: Date;
	}[];
}

/**
 * Resolves the exact set of organizations a bulk block would affect.
 *
 * Every guard that prevents a bulk block from degenerating into "ban
 * everything" lives here, so the preview and the mutation can never disagree
 * about the target set:
 * - an empty or too-short search throws, so there is no unfiltered code path;
 * - the LIKE filter escapes wildcards, so "%" cannot match every row;
 * - organizations that are already blocked are excluded;
 * - organizations that still hold credits are excluded, so a bulk block can
 *   never sweep up a paying customer (see assertOrganizationDeletable);
 * - organizations the acting admin belongs to are excluded, so an admin can
 *   never lock themselves (or their own org's members) out;
 * - a filter resolving to more than MAX_BULK_BLOCK_ORGANIZATIONS throws rather
 *   than silently truncating to the first N.
 *
 * Callers mutate strictly by the returned ids, never by re-running the filter
 * as the WHERE clause of an UPDATE.
 */
async function resolveBulkBlockCandidates(
	search: string,
	adminUserId: string,
): Promise<BulkBlockCandidates> {
	const trimmed = search.trim();

	if (trimmed.length < MIN_BULK_BLOCK_SEARCH_LENGTH) {
		throw new HTTPException(400, {
			message: `Bulk blocking requires a search filter of at least ${MIN_BULK_BLOCK_SEARCH_LENGTH} characters.`,
		});
	}

	const searchFilter = buildOrganizationSearchFilter(trimmed);

	if (!searchFilter) {
		throw new HTTPException(400, {
			message: "Bulk blocking requires a search filter.",
		});
	}

	const adminOrgLinks = await db.query.userOrganization.findMany({
		where: { userId: { eq: adminUserId } },
		columns: { organizationId: true },
	});
	const adminOrgIds = [
		...new Set(adminOrgLinks.map((link) => link.organizationId)),
	];

	const candidateFilter = and(
		searchFilter,
		or(
			isNull(tables.organization.status),
			ne(tables.organization.status, "deleted"),
		),
		lte(tables.organization.credits, "0"),
		adminOrgIds.length > 0
			? notInArray(tables.organization.id, adminOrgIds)
			: undefined,
	);

	const [matchedRow] = await db
		.select({ count: sql<number>`COUNT(*)`.as("count") })
		.from(tables.organization)
		.where(searchFilter);

	const candidates = await db
		.select({
			id: tables.organization.id,
			name: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
			plan: tables.organization.plan,
			status: tables.organization.status,
			createdAt: tables.organization.createdAt,
		})
		.from(tables.organization)
		.where(candidateFilter)
		.orderBy(asc(tables.organization.createdAt))
		.limit(MAX_BULK_BLOCK_ORGANIZATIONS + 1);

	if (candidates.length > MAX_BULK_BLOCK_ORGANIZATIONS) {
		throw new HTTPException(400, {
			message: `This filter matches more than ${MAX_BULK_BLOCK_ORGANIZATIONS} organizations. Narrow the search before bulk blocking.`,
		});
	}

	return {
		search: trimmed,
		matched: Number(matchedRow?.count ?? 0),
		candidates,
	};
}

const bulkBlockPreviewRoute = createRoute({
	method: "get",
	path: "/organizations/bulk-block/preview",
	request: {
		query: z.object({
			search: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						search: z.string(),
						matched: z.number(),
						blockable: z.number(),
						skipped: z.number(),
						maxBulkSize: z.number(),
						organizations: z.array(bulkBlockOrganizationSchema),
					}),
				},
			},
			description: "Organizations a bulk block would affect.",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Search filter missing, too short, or too broad.",
		},
	},
});

admin.openapi(bulkBlockPreviewRoute, async (c) => {
	const user = c.get("user");
	const { search } = c.req.valid("query");

	const {
		matched,
		candidates,
		search: normalizedSearch,
	} = await resolveBulkBlockCandidates(search, user!.id);

	return c.json(
		{
			search: normalizedSearch,
			matched,
			blockable: candidates.length,
			skipped: Math.max(0, matched - candidates.length),
			maxBulkSize: MAX_BULK_BLOCK_ORGANIZATIONS,
			organizations: candidates.map((org) => ({
				id: org.id,
				name: org.name,
				billingEmail: org.billingEmail,
				plan: org.plan,
				status: org.status,
				createdAt: org.createdAt.toISOString(),
			})),
		},
		200,
	);
});

const bulkBlockOrganizationsRoute = createRoute({
	method: "post",
	path: "/organizations/bulk-block",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						search: z.string(),
						// The number of organizations the admin confirmed in the UI. The
						// server re-resolves the set and refuses to act unless it matches
						// exactly, so a filter that widened between preview and confirm
						// blocks nothing instead of blocking extra organizations.
						expectedCount: z
							.number()
							.int()
							.min(1)
							.max(MAX_BULK_BLOCK_ORGANIZATIONS),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						blockedCount: z.number(),
						failedCount: z.number(),
						blocked: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								cancelledSubscriptionIds: z.array(z.string()),
							}),
						),
						failed: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								error: z.string(),
							}),
						),
					}),
				},
			},
			description: "Bulk block result.",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Search filter missing, too short, or too broad.",
		},
		409: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description:
				"The confirmed count no longer matches the filtered organizations.",
		},
	},
});

admin.openapi(bulkBlockOrganizationsRoute, async (c) => {
	const user = c.get("user");
	const { search, expectedCount } = c.req.valid("json");

	const { candidates } = await resolveBulkBlockCandidates(search, user!.id);

	if (candidates.length !== expectedCount) {
		throw new HTTPException(409, {
			message: `The filter now matches ${candidates.length} blockable organization(s) but ${expectedCount} were confirmed. Nothing was blocked — re-run the search and confirm again.`,
		});
	}

	// Defensive: `expectedCount` is already validated as >= 1, so this can only
	// trip if the guards above ever change. Blocking nothing is the safe outcome.
	if (candidates.length === 0) {
		throw new HTTPException(400, {
			message: "No organizations matched the filter.",
		});
	}

	const blocked: {
		id: string;
		name: string;
		cancelledSubscriptionIds: string[];
	}[] = [];
	const failed: { id: string; name: string; error: string }[] = [];

	// Sequential on purpose: each iteration talks to Stripe, and one failure must
	// not abort the organizations that follow it.
	for (const candidate of candidates) {
		try {
			const outcome = await blockOrganizationById(candidate.id, user!.id);
			blocked.push({
				id: candidate.id,
				name: candidate.name,
				cancelledSubscriptionIds: outcome.cancelledSubscriptionIds,
			});
		} catch (error) {
			const message =
				error instanceof HTTPException
					? error.message
					: error instanceof Error
						? error.message
						: "Unknown error";
			logger.error(
				`Bulk block failed for organization ${candidate.id}: ${message}`,
			);
			failed.push({ id: candidate.id, name: candidate.name, error: message });
		}
	}

	return c.json(
		{
			message:
				failed.length === 0
					? `Blocked ${blocked.length} organization(s).`
					: `Blocked ${blocked.length} organization(s), ${failed.length} failed.`,
			blockedCount: blocked.length,
			failedCount: failed.length,
			blocked,
			failed,
		},
		200,
	);
});

// --- History endpoints ---

const historyDataPointSchema = z.object({
	timestamp: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	clientErrorsCount: z.number(),
	gatewayErrorsCount: z.number(),
	upstreamErrorsCount: z.number(),
	cachedCount: z.number(),
	avgTtft: z.number().nullable(),
	avgDuration: z.number().nullable(),
	totalTokens: z.number(),
	totalCost: z.number(),
	...tokenBreakdownShape,
});

const historyResponseSchema = z.object({
	data: z.array(historyDataPointSchema),
});

function getHourFloor(date: Date): string {
	const d = new Date(date);
	d.setMinutes(0, 0, 0);
	return d.toISOString();
}

function mapHistoryRows(
	rows: {
		minuteTimestamp: Date;
		logsCount: number;
		errorsCount: number;
		clientErrorsCount?: number;
		gatewayErrorsCount?: number;
		upstreamErrorsCount?: number;
		cachedCount: number;
		totalDuration: number;
		totalTimeToFirstToken: number;
		timeToFirstTokenCount: number;
		totalTimeToFirstReasoningToken: number;
		timeToFirstReasoningTokenCount: number;
		totalTokens: number;
		totalCost?: number;
		inputTokens?: number;
		cachedTokens?: number;
		outputTokens?: number;
		inputCost?: number;
		cachedInputCost?: number;
		outputCost?: number;
	}[],
	costByHour: Map<string, number> = new Map(),
) {
	const requestsByHour = new Map<string, number>();
	for (const r of rows) {
		const hk = getHourFloor(r.minuteTimestamp);
		requestsByHour.set(hk, (requestsByHour.get(hk) ?? 0) + Number(r.logsCount));
	}

	return rows.map((r) => {
		const logsCount = Number(r.logsCount);
		const errorsCount = Number(r.errorsCount);
		const cachedCount = Number(r.cachedCount);
		const totalDuration = Number(r.totalDuration);
		// Only streamed requests record a time-to-first-token, so the average
		// divides by the sample count, not the request count. Reasoning-token
		// samples take precedence so thinking mappings aren't measured on their
		// (much later) first content token.
		const { total: totalTimeToFirstToken, count: timeToFirstTokenCount } =
			effectiveTtftTotals({
				totalTimeToFirstToken: Number(r.totalTimeToFirstToken),
				timeToFirstTokenCount: Number(r.timeToFirstTokenCount),
				totalTimeToFirstReasoningToken: Number(
					r.totalTimeToFirstReasoningToken,
				),
				timeToFirstReasoningTokenCount: Number(
					r.timeToFirstReasoningTokenCount,
				),
			});
		const totalTokens = Number(r.totalTokens);

		let totalCost: number;
		if (r.totalCost !== undefined && r.totalCost !== null) {
			totalCost = Number(r.totalCost);
		} else {
			const hk = getHourFloor(r.minuteTimestamp);
			const hourCost = costByHour.get(hk) ?? 0;
			const hourReqs = requestsByHour.get(hk) ?? 0;
			totalCost = hourReqs > 0 ? (logsCount / hourReqs) * hourCost : 0;
		}

		return {
			timestamp: r.minuteTimestamp.toISOString(),
			logsCount,
			errorsCount,
			clientErrorsCount: Number(r.clientErrorsCount ?? 0),
			gatewayErrorsCount: Number(r.gatewayErrorsCount ?? 0),
			upstreamErrorsCount: Number(r.upstreamErrorsCount ?? 0),
			cachedCount,
			avgTtft:
				timeToFirstTokenCount > 0
					? Math.round(totalTimeToFirstToken / timeToFirstTokenCount)
					: null,
			avgDuration: logsCount > 0 ? Math.round(totalDuration / logsCount) : null,
			totalTokens,
			totalCost,
			...toTokenBreakdown(r),
		};
	});
}

// Provider history
const getProviderHistory = createRoute({
	method: "get",
	path: "/providers/{providerId}/history",
	request: {
		params: z.object({ providerId: z.string() }),
		query: z.object({
			window: historyWindowSchema.default("4h").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: historyResponseSchema.openapi({}) },
			},
			description: "Provider history timeseries.",
		},
	},
});

admin.openapi(getProviderHistory, async (c) => {
	const { providerId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "4h";
	const startDate = getHistoryStartDate(window);
	const hourStartDate = floorToHourStart(startDate);

	// For windows longer than 24h, return hourly buckets straight from the
	// hourly rollup (which carries cost + latency), instead of minute rows.
	if (isHourlyWindow(window)) {
		const rows = await db
			.select({
				minuteTimestamp: modelProviderMappingHistoryHourly.hourTimestamp,
				logsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.logsCount})`.as(
						"logs_count",
					),
				errorsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.errorsCount})`.as(
						"errors_count",
					),
				clientErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.clientErrorsCount})`.as(
						"client_errors_count",
					),
				gatewayErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.gatewayErrorsCount})`.as(
						"gateway_errors_count",
					),
				upstreamErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.upstreamErrorsCount})`.as(
						"upstream_errors_count",
					),
				cachedCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.cachedCount})`.as(
						"cached_count",
					),
				totalDuration:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalDuration})`.as(
						"total_duration",
					),
				totalTimeToFirstToken:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalTimeToFirstToken})`.as(
						"total_ttft",
					),
				timeToFirstTokenCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.timeToFirstTokenCount})`.as(
						"ttft_count",
					),
				totalTimeToFirstReasoningToken:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalTimeToFirstReasoningToken})`.as(
						"total_ttfrt",
					),
				timeToFirstReasoningTokenCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.timeToFirstReasoningTokenCount})`.as(
						"ttfrt_count",
					),
				totalTokens:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalTokens})`.as(
						"total_tokens",
					),
				totalCost:
					sql<number>`SUM(cast(${modelProviderMappingHistoryHourly.totalCost} as double precision))`.as(
						"total_cost",
					),
				...tokenBreakdownSums(modelProviderMappingHistoryHourly),
			})
			.from(modelProviderMappingHistoryHourly)
			.where(
				and(
					eq(modelProviderMappingHistoryHourly.providerId, providerId),
					gte(modelProviderMappingHistoryHourly.hourTimestamp, hourStartDate),
					// Provider totals across models: the region-less root row already
					// carries each mapping's regional traffic.
					excludeRegionalMappingRows(modelProviderMappingHistoryHourly),
				),
			)
			.groupBy(modelProviderMappingHistoryHourly.hourTimestamp)
			.orderBy(asc(modelProviderMappingHistoryHourly.hourTimestamp));

		return c.json({ data: mapHistoryRows(rows) });
	}

	const [rows, costRows] = await Promise.all([
		db
			.select({
				minuteTimestamp: modelProviderMappingHistory.minuteTimestamp,
				logsCount:
					sql<number>`SUM(${modelProviderMappingHistory.logsCount})`.as(
						"logs_count",
					),
				errorsCount:
					sql<number>`SUM(${modelProviderMappingHistory.errorsCount})`.as(
						"errors_count",
					),
				clientErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistory.clientErrorsCount})`.as(
						"client_errors_count",
					),
				gatewayErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistory.gatewayErrorsCount})`.as(
						"gateway_errors_count",
					),
				upstreamErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistory.upstreamErrorsCount})`.as(
						"upstream_errors_count",
					),
				cachedCount:
					sql<number>`SUM(${modelProviderMappingHistory.cachedCount})`.as(
						"cached_count",
					),
				totalDuration:
					sql<number>`SUM(${modelProviderMappingHistory.totalDuration})`.as(
						"total_duration",
					),
				totalTimeToFirstToken:
					sql<number>`SUM(${modelProviderMappingHistory.totalTimeToFirstToken})`.as(
						"total_ttft",
					),
				timeToFirstTokenCount:
					sql<number>`SUM(${modelProviderMappingHistory.timeToFirstTokenCount})`.as(
						"ttft_count",
					),
				totalTimeToFirstReasoningToken:
					sql<number>`SUM(${modelProviderMappingHistory.totalTimeToFirstReasoningToken})`.as(
						"total_ttfrt",
					),
				timeToFirstReasoningTokenCount:
					sql<number>`SUM(${modelProviderMappingHistory.timeToFirstReasoningTokenCount})`.as(
						"ttfrt_count",
					),
				totalTokens:
					sql<number>`SUM(${modelProviderMappingHistory.totalTokens})`.as(
						"total_tokens",
					),
				...tokenBreakdownSums(modelProviderMappingHistory),
			})
			.from(modelProviderMappingHistory)
			.where(
				and(
					eq(modelProviderMappingHistory.providerId, providerId),
					gte(modelProviderMappingHistory.minuteTimestamp, startDate),
					excludeRegionalMappingRows(modelProviderMappingHistory),
				),
			)
			.groupBy(modelProviderMappingHistory.minuteTimestamp)
			.orderBy(asc(modelProviderMappingHistory.minuteTimestamp)),
		db
			.select({
				hourTimestamp: projectHourlyModelStats.hourTimestamp,
				cost: sql<number>`SUM(cast(${projectHourlyModelStats.cost} as double precision))`,
			})
			.from(projectHourlyModelStats)
			.where(
				and(
					eq(projectHourlyModelStats.usedProvider, providerId),
					gte(projectHourlyModelStats.hourTimestamp, hourStartDate),
				),
			)
			.groupBy(projectHourlyModelStats.hourTimestamp),
	]);

	const costByHour = new Map<string, number>(
		costRows.map((r) => {
			const d = new Date(r.hourTimestamp);
			d.setMinutes(0, 0, 0);
			return [d.toISOString(), Number(r.cost)];
		}),
	);

	return c.json({ data: mapHistoryRows(rows, costByHour) });
});

// Model history
const getModelHistory = createRoute({
	method: "get",
	path: "/models/{modelId}/history",
	request: {
		params: z.object({ modelId: z.string() }),
		query: z.object({
			window: historyWindowSchema.default("4h").optional(),
			projectId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: historyResponseSchema.openapi({}) },
			},
			description: "Model history timeseries.",
		},
	},
});

admin.openapi(getModelHistory, async (c) => {
	const { modelId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "4h";
	const projectId = query.projectId;
	const startDate = getHistoryStartDate(window);

	if (projectId) {
		const hourStartDate = new Date(startDate);
		hourStartDate.setMinutes(0, 0, 0);
		const rows = await db
			.select({
				hourTimestamp: projectHourlyModelStats.hourTimestamp,
				logsCount: sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"logs_count",
				),
				errorsCount: sql<number>`SUM(${projectHourlyModelStats.errorCount})`.as(
					"errors_count",
				),
				cachedCount: sql<number>`SUM(${projectHourlyModelStats.cacheCount})`.as(
					"cached_count",
				),
				totalTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC))`.as(
						"total_tokens",
					),
				cost: sql<number>`SUM(cast(${projectHourlyModelStats.cost} as double precision))`.as(
					"cost",
				),
				inputTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.inputTokens} AS NUMERIC))`.as(
						"input_tokens",
					),
				cachedTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.cachedTokens} AS NUMERIC))`.as(
						"cached_tokens",
					),
				outputTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.outputTokens} AS NUMERIC))`.as(
						"output_tokens",
					),
				inputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.inputCost} as double precision))`.as(
						"input_cost",
					),
				cachedInputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.cachedInputCost} as double precision))`.as(
						"cached_input_cost",
					),
				outputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.outputCost} as double precision))`.as(
						"output_cost",
					),
			})
			.from(projectHourlyModelStats)
			.where(
				and(
					eq(projectHourlyModelStats.projectId, projectId),
					eq(projectHourlyModelStats.usedModel, modelId),
					gte(projectHourlyModelStats.hourTimestamp, hourStartDate),
				),
			)
			.groupBy(projectHourlyModelStats.hourTimestamp)
			.orderBy(asc(projectHourlyModelStats.hourTimestamp));

		return c.json({
			data: rows.map((r) => ({
				timestamp: r.hourTimestamp.toISOString(),
				logsCount: Number(r.logsCount),
				errorsCount: Number(r.errorsCount),
				clientErrorsCount: 0,
				gatewayErrorsCount: 0,
				upstreamErrorsCount: 0,
				cachedCount: Number(r.cachedCount),
				avgTtft: null,
				avgDuration: null,
				totalTokens: Number(r.totalTokens),
				totalCost: Number(r.cost),
				...toTokenBreakdown(r),
			})),
		});
	}

	// For windows longer than 24h, bucket by hour from the hourly rollup.
	if (isHourlyWindow(window)) {
		const hourStartDate = floorToHourStart(startDate);
		const rows = await db
			.select({
				minuteTimestamp: modelHistoryHourly.hourTimestamp,
				logsCount: sql<number>`SUM(${modelHistoryHourly.logsCount})`.as(
					"logs_count",
				),
				errorsCount: sql<number>`SUM(${modelHistoryHourly.errorsCount})`.as(
					"errors_count",
				),
				clientErrorsCount:
					sql<number>`SUM(${modelHistoryHourly.clientErrorsCount})`.as(
						"client_errors_count",
					),
				gatewayErrorsCount:
					sql<number>`SUM(${modelHistoryHourly.gatewayErrorsCount})`.as(
						"gateway_errors_count",
					),
				upstreamErrorsCount:
					sql<number>`SUM(${modelHistoryHourly.upstreamErrorsCount})`.as(
						"upstream_errors_count",
					),
				cachedCount: sql<number>`SUM(${modelHistoryHourly.cachedCount})`.as(
					"cached_count",
				),
				totalDuration: sql<number>`SUM(${modelHistoryHourly.totalDuration})`.as(
					"total_duration",
				),
				totalTimeToFirstToken:
					sql<number>`SUM(${modelHistoryHourly.totalTimeToFirstToken})`.as(
						"total_ttft",
					),
				timeToFirstTokenCount:
					sql<number>`SUM(${modelHistoryHourly.timeToFirstTokenCount})`.as(
						"ttft_count",
					),
				totalTimeToFirstReasoningToken:
					sql<number>`SUM(${modelHistoryHourly.totalTimeToFirstReasoningToken})`.as(
						"total_ttfrt",
					),
				timeToFirstReasoningTokenCount:
					sql<number>`SUM(${modelHistoryHourly.timeToFirstReasoningTokenCount})`.as(
						"ttfrt_count",
					),
				totalTokens: sql<number>`SUM(${modelHistoryHourly.totalTokens})`.as(
					"total_tokens",
				),
				totalCost:
					sql<number>`SUM(cast(${modelHistoryHourly.totalCost} as double precision))`.as(
						"total_cost",
					),
				...tokenBreakdownSums(modelHistoryHourly),
			})
			.from(modelHistoryHourly)
			.where(
				and(
					eq(modelHistoryHourly.modelId, modelId),
					gte(modelHistoryHourly.hourTimestamp, hourStartDate),
				),
			)
			.groupBy(modelHistoryHourly.hourTimestamp)
			.orderBy(asc(modelHistoryHourly.hourTimestamp));

		return c.json({ data: mapHistoryRows(rows) });
	}

	const rows = await db
		.select({
			minuteTimestamp: modelHistory.minuteTimestamp,
			logsCount: sql<number>`SUM(${modelHistory.logsCount})`.as("logs_count"),
			errorsCount: sql<number>`SUM(${modelHistory.errorsCount})`.as(
				"errors_count",
			),
			clientErrorsCount: sql<number>`SUM(${modelHistory.clientErrorsCount})`.as(
				"client_errors_count",
			),
			gatewayErrorsCount:
				sql<number>`SUM(${modelHistory.gatewayErrorsCount})`.as(
					"gateway_errors_count",
				),
			upstreamErrorsCount:
				sql<number>`SUM(${modelHistory.upstreamErrorsCount})`.as(
					"upstream_errors_count",
				),
			cachedCount: sql<number>`SUM(${modelHistory.cachedCount})`.as(
				"cached_count",
			),
			totalDuration: sql<number>`SUM(${modelHistory.totalDuration})`.as(
				"total_duration",
			),
			totalTimeToFirstToken:
				sql<number>`SUM(${modelHistory.totalTimeToFirstToken})`.as(
					"total_ttft",
				),
			timeToFirstTokenCount:
				sql<number>`SUM(${modelHistory.timeToFirstTokenCount})`.as(
					"ttft_count",
				),
			totalTimeToFirstReasoningToken:
				sql<number>`SUM(${modelHistory.totalTimeToFirstReasoningToken})`.as(
					"total_ttfrt",
				),
			timeToFirstReasoningTokenCount:
				sql<number>`SUM(${modelHistory.timeToFirstReasoningTokenCount})`.as(
					"ttfrt_count",
				),
			totalTokens: sql<number>`SUM(${modelHistory.totalTokens})`.as(
				"total_tokens",
			),
			totalCost:
				sql<number>`SUM(cast(${modelHistory.totalCost} as double precision))`.as(
					"total_cost",
				),
			...tokenBreakdownSums(modelHistory),
		})
		.from(modelHistory)
		.where(
			and(
				eq(modelHistory.modelId, modelId),
				gte(modelHistory.minuteTimestamp, startDate),
			),
		)
		.groupBy(modelHistory.minuteTimestamp)
		.orderBy(asc(modelHistory.minuteTimestamp));

	return c.json({ data: mapHistoryRows(rows) });
});

// Mapping history (provider + model)
const getMappingHistory = createRoute({
	method: "get",
	path: "/providers/{providerId}/models/{modelId}/history",
	request: {
		params: z.object({
			providerId: z.string(),
			modelId: z.string(),
		}),
		query: z.object({
			window: historyWindowSchema.default("4h").optional(),
			projectId: z.string().optional(),
			region: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: historyResponseSchema.openapi({}) },
			},
			description: "Provider-model mapping history timeseries.",
		},
	},
});

admin.openapi(getMappingHistory, async (c) => {
	const { providerId, modelId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "4h";
	const projectId = query.projectId;
	const region = query.region;
	const startDate = getHistoryStartDate(window);
	const hourStartDate = new Date(startDate);
	hourStartDate.setMinutes(0, 0, 0);

	// When a region is given, restrict the minute-level mapping history to the
	// exact regional mapping(s). The hourly project rollups have no region
	// dimension, so region scoping only applies to the minute-granularity source.
	// Without a region the rows are summed across the mapping's variants, which
	// means the regional rows have to be dropped — the region-less root row
	// already includes their traffic.
	const regionMappingFilter =
		region !== undefined
			? inArray(
					modelProviderMappingHistory.modelProviderMappingId,
					db
						.select({ id: tables.modelProviderMapping.id })
						.from(tables.modelProviderMapping)
						.where(
							and(
								eq(tables.modelProviderMapping.providerId, providerId),
								eq(tables.modelProviderMapping.modelId, modelId),
								eq(tables.modelProviderMapping.region, region),
							),
						),
				)
			: excludeRegionalMappingRows(modelProviderMappingHistory);

	if (projectId) {
		const rows = await db
			.select({
				hourTimestamp: projectHourlyModelStats.hourTimestamp,
				logsCount: sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"logs_count",
				),
				errorsCount: sql<number>`SUM(${projectHourlyModelStats.errorCount})`.as(
					"errors_count",
				),
				cachedCount: sql<number>`SUM(${projectHourlyModelStats.cacheCount})`.as(
					"cached_count",
				),
				totalTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC))`.as(
						"total_tokens",
					),
				cost: sql<number>`SUM(cast(${projectHourlyModelStats.cost} as double precision))`.as(
					"cost",
				),
				inputTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.inputTokens} AS NUMERIC))`.as(
						"input_tokens",
					),
				cachedTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.cachedTokens} AS NUMERIC))`.as(
						"cached_tokens",
					),
				outputTokens:
					sql<number>`SUM(CAST(${projectHourlyModelStats.outputTokens} AS NUMERIC))`.as(
						"output_tokens",
					),
				inputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.inputCost} as double precision))`.as(
						"input_cost",
					),
				cachedInputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.cachedInputCost} as double precision))`.as(
						"cached_input_cost",
					),
				outputCost:
					sql<number>`SUM(cast(${projectHourlyModelStats.outputCost} as double precision))`.as(
						"output_cost",
					),
			})
			.from(projectHourlyModelStats)
			.where(
				and(
					eq(projectHourlyModelStats.projectId, projectId),
					eq(projectHourlyModelStats.usedProvider, providerId),
					eq(projectHourlyModelStats.usedModel, modelId),
					gte(projectHourlyModelStats.hourTimestamp, hourStartDate),
				),
			)
			.groupBy(projectHourlyModelStats.hourTimestamp)
			.orderBy(asc(projectHourlyModelStats.hourTimestamp));

		return c.json({
			data: rows.map((r) => ({
				timestamp: r.hourTimestamp.toISOString(),
				logsCount: Number(r.logsCount),
				errorsCount: Number(r.errorsCount),
				clientErrorsCount: 0,
				gatewayErrorsCount: 0,
				upstreamErrorsCount: 0,
				cachedCount: Number(r.cachedCount),
				avgTtft: null,
				avgDuration: null,
				totalTokens: Number(r.totalTokens),
				totalCost: Number(r.cost),
				...toTokenBreakdown(r),
			})),
		});
	}

	// For windows longer than 24h, bucket by hour straight from the hourly
	// rollup (counts, latency, tokens and cost all come from one source).
	if (isHourlyWindow(window)) {
		const hourlyRegionMappingFilter =
			region !== undefined
				? inArray(
						modelProviderMappingHistoryHourly.modelProviderMappingId,
						db
							.select({ id: tables.modelProviderMapping.id })
							.from(tables.modelProviderMapping)
							.where(
								and(
									eq(tables.modelProviderMapping.providerId, providerId),
									eq(tables.modelProviderMapping.modelId, modelId),
									eq(tables.modelProviderMapping.region, region),
								),
							),
					)
				: excludeRegionalMappingRows(modelProviderMappingHistoryHourly);

		const rows = await db
			.select({
				minuteTimestamp: modelProviderMappingHistoryHourly.hourTimestamp,
				logsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.logsCount})`.as(
						"logs_count",
					),
				errorsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.errorsCount})`.as(
						"errors_count",
					),
				clientErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.clientErrorsCount})`.as(
						"client_errors_count",
					),
				gatewayErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.gatewayErrorsCount})`.as(
						"gateway_errors_count",
					),
				upstreamErrorsCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.upstreamErrorsCount})`.as(
						"upstream_errors_count",
					),
				cachedCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.cachedCount})`.as(
						"cached_count",
					),
				totalDuration:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalDuration})`.as(
						"total_duration",
					),
				totalTimeToFirstToken:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalTimeToFirstToken})`.as(
						"total_ttft",
					),
				timeToFirstTokenCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.timeToFirstTokenCount})`.as(
						"ttft_count",
					),
				totalTimeToFirstReasoningToken:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalTimeToFirstReasoningToken})`.as(
						"total_ttfrt",
					),
				timeToFirstReasoningTokenCount:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.timeToFirstReasoningTokenCount})`.as(
						"ttfrt_count",
					),
				totalTokens:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalTokens})`.as(
						"total_tokens",
					),
				totalCost:
					sql<number>`SUM(cast(${modelProviderMappingHistoryHourly.totalCost} as double precision))`.as(
						"total_cost",
					),
				...tokenBreakdownSums(modelProviderMappingHistoryHourly),
			})
			.from(modelProviderMappingHistoryHourly)
			.where(
				and(
					eq(modelProviderMappingHistoryHourly.providerId, providerId),
					eq(modelProviderMappingHistoryHourly.modelId, modelId),
					gte(modelProviderMappingHistoryHourly.hourTimestamp, hourStartDate),
					hourlyRegionMappingFilter,
				),
			)
			.groupBy(modelProviderMappingHistoryHourly.hourTimestamp)
			.orderBy(asc(modelProviderMappingHistoryHourly.hourTimestamp));

		return c.json({ data: mapHistoryRows(rows) });
	}

	// 24h and below: minute granularity.
	const minuteRows = await db
		.select({
			minuteTimestamp: modelProviderMappingHistory.minuteTimestamp,
			logsCount: sql<number>`SUM(${modelProviderMappingHistory.logsCount})`.as(
				"logs_count",
			),
			errorsCount:
				sql<number>`SUM(${modelProviderMappingHistory.errorsCount})`.as(
					"errors_count",
				),
			clientErrorsCount:
				sql<number>`SUM(${modelProviderMappingHistory.clientErrorsCount})`.as(
					"client_errors_count",
				),
			gatewayErrorsCount:
				sql<number>`SUM(${modelProviderMappingHistory.gatewayErrorsCount})`.as(
					"gateway_errors_count",
				),
			upstreamErrorsCount:
				sql<number>`SUM(${modelProviderMappingHistory.upstreamErrorsCount})`.as(
					"upstream_errors_count",
				),
			cachedCount:
				sql<number>`SUM(${modelProviderMappingHistory.cachedCount})`.as(
					"cached_count",
				),
			totalDuration:
				sql<number>`SUM(${modelProviderMappingHistory.totalDuration})`.as(
					"total_duration",
				),
			totalTimeToFirstToken:
				sql<number>`SUM(${modelProviderMappingHistory.totalTimeToFirstToken})`.as(
					"total_ttft",
				),
			timeToFirstTokenCount:
				sql<number>`SUM(${modelProviderMappingHistory.timeToFirstTokenCount})`.as(
					"ttft_count",
				),
			totalTimeToFirstReasoningToken:
				sql<number>`SUM(${modelProviderMappingHistory.totalTimeToFirstReasoningToken})`.as(
					"total_ttfrt",
				),
			timeToFirstReasoningTokenCount:
				sql<number>`SUM(${modelProviderMappingHistory.timeToFirstReasoningTokenCount})`.as(
					"ttfrt_count",
				),
			totalTokens:
				sql<number>`SUM(${modelProviderMappingHistory.totalTokens})`.as(
					"total_tokens",
				),
			totalCost:
				sql<number>`SUM(cast(${modelProviderMappingHistory.totalCost} as double precision))`.as(
					"total_cost",
				),
			...tokenBreakdownSums(modelProviderMappingHistory),
		})
		.from(modelProviderMappingHistory)
		.where(
			and(
				eq(modelProviderMappingHistory.providerId, providerId),
				eq(modelProviderMappingHistory.modelId, modelId),
				gte(modelProviderMappingHistory.minuteTimestamp, startDate),
				regionMappingFilter,
			),
		)
		.groupBy(modelProviderMappingHistory.minuteTimestamp)
		.orderBy(asc(modelProviderMappingHistory.minuteTimestamp));

	return c.json({ data: mapHistoryRows(minuteRows) });
});

// Provider detail – aggregated stats + per-model breakdown for the window
const providerModelStatsSchema = z.object({
	modelId: z.string(),
	externalId: z.string(),
	mappingId: z.string(),
	region: z.string().nullable(),
	status: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	clientErrorsCount: z.number(),
	gatewayErrorsCount: z.number(),
	upstreamErrorsCount: z.number(),
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	totalCost: z.number(),
	...tokenBreakdownShape,
	updatedAt: z.string(),
});

const providerDetailSchema = z.object({
	provider: z.object({
		id: z.string(),
		name: z.string(),
		color: z.string().nullable(),
		description: z.string(),
		website: z.string().nullable(),
		status: z.string(),
		logsCount: z.number(),
		errorsCount: z.number(),
		clientErrorsCount: z.number(),
		gatewayErrorsCount: z.number(),
		upstreamErrorsCount: z.number(),
		cachedCount: z.number(),
		avgTimeToFirstToken: z.number().nullable(),
		modelCount: z.number(),
		...tokenBreakdownShape,
		updatedAt: z.string(),
	}),
	models: z.array(providerModelStatsSchema),
});

const getProviderDetail = createRoute({
	method: "get",
	path: "/providers/{providerId}",
	request: {
		params: z.object({ providerId: z.string() }),
		query: z.object({
			window: historyWindowSchema.default("4h").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: providerDetailSchema.openapi({}) },
			},
			description: "Provider detail with per-model stats.",
		},
	},
});

admin.openapi(getProviderDetail, async (c) => {
	const { providerId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "4h";
	const startDate = getHistoryStartDate(window);

	const providerRow = await db.query.provider.findFirst({
		where: { id: { eq: providerId } },
	});

	if (!providerRow) {
		throw new HTTPException(404, { message: "Provider not found" });
	}

	// For windows longer than 24h, aggregate the hourly rollup so long ranges
	// don't scan minute rows (sums are identical either way).
	const { table: mph, bucket: mphTs } = pickMappingHistoryTable(
		isHourlyWindow(window),
	);
	const [mappings, statsRows] = await Promise.all([
		db
			.select({
				id: tables.modelProviderMapping.id,
				modelId: tables.modelProviderMapping.modelId,
				externalId: tables.modelProviderMapping.externalId,
				region: tables.modelProviderMapping.region,
				status: tables.modelProviderMapping.status,
				avgTimeToFirstToken: sql<
					number | null
				>`COALESCE(${tables.modelProviderMapping.avgTimeToFirstReasoningToken}, ${tables.modelProviderMapping.avgTimeToFirstToken})`.as(
					"avgTimeToFirstToken",
				),
				updatedAt: tables.modelProviderMapping.updatedAt,
			})
			.from(tables.modelProviderMapping)
			.where(eq(tables.modelProviderMapping.providerId, providerId)),
		db
			.select({
				modelId: mph.modelId,
				logsCount: sql<number>`COALESCE(SUM(${mph.logsCount}), 0)`.as(
					"logs_count",
				),
				errorsCount: sql<number>`COALESCE(SUM(${mph.errorsCount}), 0)`.as(
					"errors_count",
				),
				clientErrorsCount:
					sql<number>`COALESCE(SUM(${mph.clientErrorsCount}), 0)`.as(
						"client_errors_count",
					),
				gatewayErrorsCount:
					sql<number>`COALESCE(SUM(${mph.gatewayErrorsCount}), 0)`.as(
						"gateway_errors_count",
					),
				upstreamErrorsCount:
					sql<number>`COALESCE(SUM(${mph.upstreamErrorsCount}), 0)`.as(
						"upstream_errors_count",
					),
				cachedCount: sql<number>`COALESCE(SUM(${mph.cachedCount}), 0)`.as(
					"cached_count",
				),
				totalTtft:
					sql<number>`COALESCE(SUM(${mph.totalTimeToFirstToken}), 0)`.as(
						"total_ttft",
					),
				ttftCount:
					sql<number>`COALESCE(SUM(${mph.timeToFirstTokenCount}), 0)`.as(
						"ttft_count",
					),
				totalTtfrt:
					sql<number>`COALESCE(SUM(${mph.totalTimeToFirstReasoningToken}), 0)`.as(
						"total_ttfrt",
					),
				ttfrtCount:
					sql<number>`COALESCE(SUM(${mph.timeToFirstReasoningTokenCount}), 0)`.as(
						"ttfrt_count",
					),
				totalCost:
					sql<number>`COALESCE(SUM(cast(${mph.totalCost} as double precision)), 0)`.as(
						"total_cost",
					),
				...tokenBreakdownSums(mph),
			})
			.from(mph)
			.where(
				and(
					eq(mph.providerId, providerId),
					gte(mphTs, startDate),
					// Grouped per model, so the mapping's regional rows would be added
					// on top of the root row that already contains them.
					excludeRegionalMappingRows(mph),
				),
			)
			.groupBy(mph.modelId),
	]);

	const statsByModel = new Map(statsRows.map((r) => [r.modelId, r]));

	const modelsOut = mappings.map((m) => {
		const s = statsByModel.get(m.modelId);
		const logsCount = Number(s?.logsCount ?? 0);
		const cachedCount = Number(s?.cachedCount ?? 0);
		// Only streamed requests record a time-to-first-token, so the average
		// divides by the sample count, not the request count. Reasoning-token
		// samples take precedence so thinking mappings aren't measured on their
		// (much later) first content token.
		const { total: totalTtft, count: ttftCount } = effectiveTtftTotals({
			totalTimeToFirstToken: Number(s?.totalTtft ?? 0),
			timeToFirstTokenCount: Number(s?.ttftCount ?? 0),
			totalTimeToFirstReasoningToken: Number(s?.totalTtfrt ?? 0),
			timeToFirstReasoningTokenCount: Number(s?.ttfrtCount ?? 0),
		});
		const avgTtft = ttftCount > 0 ? totalTtft / ttftCount : null;
		return {
			modelId: m.modelId,
			externalId: m.externalId,
			mappingId: m.id,
			region: m.region,
			status: m.status,
			logsCount,
			errorsCount: Number(s?.errorsCount ?? 0),
			clientErrorsCount: Number(s?.clientErrorsCount ?? 0),
			gatewayErrorsCount: Number(s?.gatewayErrorsCount ?? 0),
			upstreamErrorsCount: Number(s?.upstreamErrorsCount ?? 0),
			cachedCount,
			avgTimeToFirstToken: avgTtft ?? m.avgTimeToFirstToken,
			totalCost: Number(s?.totalCost ?? 0),
			...toTokenBreakdown(s),
			updatedAt: m.updatedAt.toISOString(),
		};
	});

	const agg = statsRows.reduce(
		(acc, r) => {
			acc.logsCount += Number(r.logsCount ?? 0);
			acc.errorsCount += Number(r.errorsCount ?? 0);
			acc.clientErrorsCount += Number(r.clientErrorsCount ?? 0);
			acc.gatewayErrorsCount += Number(r.gatewayErrorsCount ?? 0);
			acc.upstreamErrorsCount += Number(r.upstreamErrorsCount ?? 0);
			acc.cachedCount += Number(r.cachedCount ?? 0);
			acc.totalTtft += Number(r.totalTtft ?? 0);
			acc.ttftCount += Number(r.ttftCount ?? 0);
			acc.totalTtfrt += Number(r.totalTtfrt ?? 0);
			acc.ttfrtCount += Number(r.ttfrtCount ?? 0);
			addTokenBreakdown(acc.breakdown, r);
			return acc;
		},
		{
			logsCount: 0,
			errorsCount: 0,
			clientErrorsCount: 0,
			gatewayErrorsCount: 0,
			upstreamErrorsCount: 0,
			cachedCount: 0,
			totalTtft: 0,
			ttftCount: 0,
			totalTtfrt: 0,
			ttfrtCount: 0,
			breakdown: { ...EMPTY_TOKEN_BREAKDOWN },
		},
	);
	const hasWindowData = agg.logsCount > 0;
	const { total: aggEffectiveTtft, count: aggEffectiveTtftCount } =
		effectiveTtftTotals({
			totalTimeToFirstToken: agg.totalTtft,
			timeToFirstTokenCount: agg.ttftCount,
			totalTimeToFirstReasoningToken: agg.totalTtfrt,
			timeToFirstReasoningTokenCount: agg.ttfrtCount,
		});
	const aggAvgTtft =
		aggEffectiveTtftCount > 0 ? aggEffectiveTtft / aggEffectiveTtftCount : null;

	return c.json({
		provider: {
			id: providerRow.id,
			name: providerRow.name,
			color: providerRow.color,
			description: providerRow.description,
			website: providerRow.website,
			status: providerRow.status,
			logsCount: hasWindowData ? agg.logsCount : providerRow.logsCount,
			errorsCount: hasWindowData ? agg.errorsCount : providerRow.errorsCount,
			clientErrorsCount: hasWindowData
				? agg.clientErrorsCount
				: providerRow.clientErrorsCount,
			gatewayErrorsCount: hasWindowData
				? agg.gatewayErrorsCount
				: providerRow.gatewayErrorsCount,
			upstreamErrorsCount: hasWindowData
				? agg.upstreamErrorsCount
				: providerRow.upstreamErrorsCount,
			cachedCount: hasWindowData ? agg.cachedCount : providerRow.cachedCount,
			avgTimeToFirstToken: hasWindowData
				? (aggAvgTtft ??
					providerRow.avgTimeToFirstReasoningToken ??
					providerRow.avgTimeToFirstToken)
				: (providerRow.avgTimeToFirstReasoningToken ??
					providerRow.avgTimeToFirstToken),
			modelCount: mappings.length,
			...agg.breakdown,
			updatedAt: providerRow.updatedAt.toISOString(),
		},
		models: modelsOut,
	});
});

// Mapping detail – aggregated stats for a provider/model mapping in the window
const mappingDetailSchema = z.object({
	mapping: z.object({
		id: z.string(),
		modelId: z.string(),
		externalId: z.string(),
		providerId: z.string(),
		providerName: z.string(),
		region: z.string().nullable(),
		status: z.string(),
		inputPrice: z.string().nullable(),
		outputPrice: z.string().nullable(),
		cachedInputPrice: z.string().nullable(),
		cacheWriteInputPrice: z.string().nullable(),
		cacheWriteInputPrice1h: z.string().nullable(),
		imageInputPrice: z.string().nullable(),
		requestPrice: z.string().nullable(),
		contextSize: z.number().nullable(),
		maxOutput: z.number().nullable(),
		streaming: z.boolean(),
		logsCount: z.number(),
		errorsCount: z.number(),
		clientErrorsCount: z.number(),
		gatewayErrorsCount: z.number(),
		upstreamErrorsCount: z.number(),
		completedCount: z.number(),
		lengthLimitCount: z.number(),
		contentFilterCount: z.number(),
		toolCallsCount: z.number(),
		canceledCount: z.number(),
		unknownFinishCount: z.number(),
		cachedCount: z.number(),
		avgTimeToFirstToken: z.number().nullable(),
		totalCost: z.number(),
		...tokenBreakdownShape,
		updatedAt: z.string(),
	}),
});

const getMappingDetail = createRoute({
	method: "get",
	path: "/providers/{providerId}/models/{modelId}",
	request: {
		params: z.object({
			providerId: z.string(),
			modelId: z.string(),
		}),
		query: z.object({
			window: historyWindowSchema.default("4h").optional(),
			region: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: mappingDetailSchema.openapi({}) },
			},
			description: "Mapping detail with aggregated stats for the window.",
		},
	},
});

admin.openapi(getMappingDetail, async (c) => {
	const { providerId, modelId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "4h";
	const region = query.region;
	const startDate = getHistoryStartDate(window);

	const mappingRow = await db
		.select({
			id: tables.modelProviderMapping.id,
			modelId: tables.modelProviderMapping.modelId,
			externalId: tables.modelProviderMapping.externalId,
			providerId: tables.modelProviderMapping.providerId,
			providerName: tables.provider.name,
			region: tables.modelProviderMapping.region,
			status: tables.modelProviderMapping.status,
			inputPrice: tables.modelProviderMapping.inputPrice,
			outputPrice: tables.modelProviderMapping.outputPrice,
			cachedInputPrice: tables.modelProviderMapping.cachedInputPrice,
			cacheWriteInputPrice: tables.modelProviderMapping.cacheWriteInputPrice,
			cacheWriteInputPrice1h:
				tables.modelProviderMapping.cacheWriteInputPrice1h,
			imageInputPrice: tables.modelProviderMapping.imageInputPrice,
			requestPrice: tables.modelProviderMapping.requestPrice,
			contextSize: tables.modelProviderMapping.contextSize,
			maxOutput: tables.modelProviderMapping.maxOutput,
			streaming: tables.modelProviderMapping.streaming,
			logsCount: tables.modelProviderMapping.logsCount,
			errorsCount: tables.modelProviderMapping.errorsCount,
			clientErrorsCount: tables.modelProviderMapping.clientErrorsCount,
			gatewayErrorsCount: tables.modelProviderMapping.gatewayErrorsCount,
			upstreamErrorsCount: tables.modelProviderMapping.upstreamErrorsCount,
			cachedCount: tables.modelProviderMapping.cachedCount,
			avgTimeToFirstToken: sql<
				number | null
			>`COALESCE(${tables.modelProviderMapping.avgTimeToFirstReasoningToken}, ${tables.modelProviderMapping.avgTimeToFirstToken})`.as(
				"avgTimeToFirstToken",
			),
			updatedAt: tables.modelProviderMapping.updatedAt,
		})
		.from(tables.modelProviderMapping)
		.innerJoin(
			tables.provider,
			eq(tables.provider.id, tables.modelProviderMapping.providerId),
		)
		.where(
			and(
				eq(tables.modelProviderMapping.providerId, providerId),
				eq(tables.modelProviderMapping.modelId, modelId),
				region !== undefined
					? eq(tables.modelProviderMapping.region, region)
					: undefined,
			),
		)
		.limit(1);

	if (mappingRow.length === 0) {
		throw new HTTPException(404, { message: "Mapping not found" });
	}

	const m = mappingRow[0];

	// For windows longer than 24h, aggregate the hourly rollup so long ranges
	// don't scan minute rows (sums are identical either way).
	const { table: mph, bucket: mphTs } = pickMappingHistoryTable(
		isHourlyWindow(window),
	);
	const [aggRow] = await db
		.select({
			logsCount: sql<number>`COALESCE(SUM(${mph.logsCount}), 0)`.as(
				"logs_count",
			),
			errorsCount: sql<number>`COALESCE(SUM(${mph.errorsCount}), 0)`.as(
				"errors_count",
			),
			clientErrorsCount:
				sql<number>`COALESCE(SUM(${mph.clientErrorsCount}), 0)`.as(
					"client_errors_count",
				),
			gatewayErrorsCount:
				sql<number>`COALESCE(SUM(${mph.gatewayErrorsCount}), 0)`.as(
					"gateway_errors_count",
				),
			upstreamErrorsCount:
				sql<number>`COALESCE(SUM(${mph.upstreamErrorsCount}), 0)`.as(
					"upstream_errors_count",
				),
			completedCount: sql<number>`COALESCE(SUM(${mph.completedCount}), 0)`.as(
				"completed_count",
			),
			lengthLimitCount:
				sql<number>`COALESCE(SUM(${mph.lengthLimitCount}), 0)`.as(
					"length_limit_count",
				),
			contentFilterCount:
				sql<number>`COALESCE(SUM(${mph.contentFilterCount}), 0)`.as(
					"content_filter_count",
				),
			toolCallsCount: sql<number>`COALESCE(SUM(${mph.toolCallsCount}), 0)`.as(
				"tool_calls_count",
			),
			canceledCount: sql<number>`COALESCE(SUM(${mph.canceledCount}), 0)`.as(
				"canceled_count",
			),
			unknownFinishCount:
				sql<number>`COALESCE(SUM(${mph.unknownFinishCount}), 0)`.as(
					"unknown_finish_count",
				),
			cachedCount: sql<number>`COALESCE(SUM(${mph.cachedCount}), 0)`.as(
				"cached_count",
			),
			// Only streamed requests record a time-to-first-token, so the average
			// divides by the sample count, not the request count. Reasoning-token
			// samples take precedence so thinking mappings aren't measured on
			// their (much later) first content token.
			avgTtft: avgEffectiveTtftSql(mph).as("avg_ttft"),
			totalCost:
				sql<number>`COALESCE(SUM(cast(${mph.totalCost} as double precision)), 0)`.as(
					"total_cost",
				),
			...tokenBreakdownSums(mph),
		})
		.from(mph)
		.where(and(eq(mph.modelProviderMappingId, m.id), gte(mphTs, startDate)));

	const hasWindowData = Number(aggRow?.logsCount ?? 0) > 0;

	return c.json({
		mapping: {
			id: m.id,
			modelId: m.modelId,
			externalId: m.externalId,
			providerId: m.providerId,
			providerName: m.providerName,
			region: m.region,
			status: m.status,
			inputPrice: m.inputPrice,
			outputPrice: m.outputPrice,
			cachedInputPrice: m.cachedInputPrice,
			cacheWriteInputPrice: m.cacheWriteInputPrice,
			cacheWriteInputPrice1h: m.cacheWriteInputPrice1h,
			imageInputPrice: m.imageInputPrice,
			requestPrice: m.requestPrice,
			contextSize: m.contextSize,
			maxOutput: m.maxOutput,
			streaming: m.streaming,
			logsCount: hasWindowData ? Number(aggRow?.logsCount ?? 0) : m.logsCount,
			errorsCount: hasWindowData
				? Number(aggRow?.errorsCount ?? 0)
				: m.errorsCount,
			clientErrorsCount: hasWindowData
				? Number(aggRow?.clientErrorsCount ?? 0)
				: m.clientErrorsCount,
			gatewayErrorsCount: hasWindowData
				? Number(aggRow?.gatewayErrorsCount ?? 0)
				: m.gatewayErrorsCount,
			upstreamErrorsCount: hasWindowData
				? Number(aggRow?.upstreamErrorsCount ?? 0)
				: m.upstreamErrorsCount,
			completedCount: Number(aggRow?.completedCount ?? 0),
			lengthLimitCount: Number(aggRow?.lengthLimitCount ?? 0),
			contentFilterCount: Number(aggRow?.contentFilterCount ?? 0),
			toolCallsCount: Number(aggRow?.toolCallsCount ?? 0),
			canceledCount: Number(aggRow?.canceledCount ?? 0),
			unknownFinishCount: Number(aggRow?.unknownFinishCount ?? 0),
			cachedCount: hasWindowData
				? Number(aggRow?.cachedCount ?? 0)
				: m.cachedCount,
			avgTimeToFirstToken: hasWindowData
				? aggRow?.avgTtft !== undefined && aggRow?.avgTtft !== null
					? Number(aggRow.avgTtft)
					: m.avgTimeToFirstToken
				: m.avgTimeToFirstToken,
			totalCost: Number(aggRow?.totalCost ?? 0),
			...toTokenBreakdown(aggRow),
			updatedAt: m.updatedAt.toISOString(),
		},
	});
});

// --- Cost by model endpoints ---

const costByModelEntrySchema = z.object({
	model: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.number(),
	creditsRequestCount: z.number(),
	apiKeysRequestCount: z.number(),
	creditsCost: z.number(),
	apiKeysCost: z.number(),
});

const costByModelResponseSchema = z.object({
	window: tokenWindowSchema,
	models: z.array(costByModelEntrySchema),
	totalCost: z.number(),
	totalRequests: z.number(),
	totalCreditsRequests: z.number(),
	totalApiKeysRequests: z.number(),
	totalCreditsCost: z.number(),
	totalApiKeysCost: z.number(),
});

const costByModelViewSchema = z.enum(["mapping", "canonical"]);
const organizationCostGroupBySchema = z.enum([
	"model",
	"project",
	"api-key",
	"user",
]);

type CostBreakdownRow = z.infer<typeof costByModelEntrySchema>;

function summarizeCostBreakdown(
	rows: CostBreakdownRow[],
	window: z.infer<typeof tokenWindowSchema>,
) {
	const sorted = [...rows].sort((a, b) => b.cost - a.cost);
	return {
		window,
		models: sorted.slice(0, 20),
		totalCost: sorted.reduce((sum, row) => sum + row.cost, 0),
		totalRequests: sorted.reduce((sum, row) => sum + row.requestCount, 0),
		totalCreditsRequests: sorted.reduce(
			(sum, row) => sum + row.creditsRequestCount,
			0,
		),
		totalApiKeysRequests: sorted.reduce(
			(sum, row) => sum + row.apiKeysRequestCount,
			0,
		),
		totalCreditsCost: sorted.reduce((sum, row) => sum + row.creditsCost, 0),
		totalApiKeysCost: sorted.reduce((sum, row) => sum + row.apiKeysCost, 0),
	};
}

function dimensionLabel(label: string | null, id: string): string {
	return label && label !== id ? `${label} · ${id.slice(-6)}` : id;
}

function apiKeyDimensionColumns(groupBy: "api-key" | "user") {
	return groupBy === "user"
		? {
				id: sql<string>`COALESCE(${tables.user.id}, 'deleted-user')`,
				label: sql<string>`COALESCE(${tables.user.email}, 'Deleted user')`,
			}
		: {
				id: sql<string>`COALESCE(${tables.apiKey.id}, ${tables.apiKeyHourlyStats.apiKeyId})`,
				label: tables.apiKey.description,
			};
}

// Global cost by model
const getGlobalCostByModel = createRoute({
	method: "get",
	path: "/metrics/cost-by-model",
	request: {
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: costByModelResponseSchema.openapi({}),
				},
			},
			description: "Global cost breakdown by model.",
		},
	},
});

admin.openapi(getGlobalCostByModel, async (c) => {
	const query = c.req.valid("query");
	const window = query.window ?? "7d";

	let startDate: Date;
	let endDate: Date | undefined;
	if (query.from && query.to) {
		startDate = new Date(query.from + "T00:00:00");
		startDate.setUTCHours(0, 0, 0, 0);
		endDate = new Date(query.to + "T00:00:00");
		endDate.setUTCHours(23, 59, 59, 999);
	} else {
		startDate = getTokenWindowStartDate(window);
	}

	const rows = await db
		.select({
			usedModel: projectHourlyModelStats.usedModel,
			cost: sql<number>`SUM(cast(${projectHourlyModelStats.cost} as double precision))`.as(
				"cost",
			),
			requestCount:
				sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			...modeSplitFields(projectHourlyModelStats),
		})
		.from(projectHourlyModelStats)
		.where(
			endDate
				? and(
						gte(projectHourlyModelStats.hourTimestamp, startDate),
						lte(projectHourlyModelStats.hourTimestamp, endDate),
					)
				: gte(projectHourlyModelStats.hourTimestamp, startDate),
		)
		.groupBy(projectHourlyModelStats.usedModel)
		.orderBy(
			desc(sql`SUM(cast(${projectHourlyModelStats.cost} as double precision))`),
		);

	return c.json(
		summarizeCostBreakdown(
			rows.map((r) => ({
				model: r.usedModel,
				cost: Number(r.cost),
				requestCount: Number(r.requestCount),
				totalTokens: Number(r.totalTokens),
				creditsRequestCount: Number(r.creditsRequestCount),
				apiKeysRequestCount: Number(r.apiKeysRequestCount),
				creditsCost: Number(r.creditsCost),
				apiKeysCost: Number(r.apiKeysCost),
			})),
			window,
		),
	);
});

// Org cost by model
const getOrgCostByModel = createRoute({
	method: "get",
	path: "/organizations/{orgId}/cost-by-model",
	request: {
		params: z.object({ orgId: z.string() }),
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
			modelView: costByModelViewSchema.default("mapping").optional(),
			groupBy: organizationCostGroupBySchema.default("model").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: costByModelResponseSchema.openapi({}),
				},
			},
			description:
				"Organization cost breakdown by model, project, API key, or user.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

admin.openapi(getOrgCostByModel, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "7d";
	const modelView = query.modelView ?? "mapping";
	const groupBy = query.groupBy ?? "model";
	const startDate = getTokenWindowStartDate(window);

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org || org.status === "deleted") {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const projectIds = await db
		.select({ id: tables.project.id })
		.from(tables.project)
		.where(eq(tables.project.organizationId, orgId));

	const ids = projectIds.map((p) => p.id);

	if (ids.length === 0) {
		return c.json({
			window,
			models: [],
			totalCost: 0,
			totalRequests: 0,
			totalCreditsRequests: 0,
			totalApiKeysRequests: 0,
			totalCreditsCost: 0,
			totalApiKeysCost: 0,
		});
	}

	if (groupBy === "project") {
		const rows = await db
			.select({
				id: projectHourlyStats.projectId,
				label: tables.project.name,
				cost: sql<number>`SUM(cast(${projectHourlyStats.cost} as double precision))`.as(
					"cost",
				),
				requestCount: sql<number>`SUM(${projectHourlyStats.requestCount})`.as(
					"request_count",
				),
				totalTokens:
					sql<number>`SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC))`.as(
						"total_tokens",
					),
				...modeSplitFields(projectHourlyStats),
			})
			.from(projectHourlyStats)
			.innerJoin(
				tables.project,
				eq(tables.project.id, projectHourlyStats.projectId),
			)
			.where(
				and(
					inArray(projectHourlyStats.projectId, ids),
					gte(projectHourlyStats.hourTimestamp, startDate),
				),
			)
			.groupBy(projectHourlyStats.projectId, tables.project.name);

		return c.json(
			summarizeCostBreakdown(
				rows.map((row) => ({
					model: dimensionLabel(row.label, row.id),
					cost: Number(row.cost),
					requestCount: Number(row.requestCount),
					totalTokens: Number(row.totalTokens),
					creditsRequestCount: Number(row.creditsRequestCount),
					apiKeysRequestCount: Number(row.apiKeysRequestCount),
					creditsCost: Number(row.creditsCost),
					apiKeysCost: Number(row.apiKeysCost),
				})),
				window,
			),
		);
	}

	if (groupBy === "api-key" || groupBy === "user") {
		const dimension = apiKeyDimensionColumns(groupBy);
		const rows = await db
			.select({
				id: dimension.id,
				label: dimension.label,
				cost: sql<number>`SUM(cast(${tables.apiKeyHourlyStats.cost} as double precision))`.as(
					"cost",
				),
				requestCount:
					sql<number>`SUM(${tables.apiKeyHourlyStats.requestCount})`.as(
						"request_count",
					),
				totalTokens:
					sql<number>`SUM(CAST(${tables.apiKeyHourlyStats.totalTokens} AS NUMERIC))`.as(
						"total_tokens",
					),
				...modeSplitFields(tables.apiKeyHourlyStats),
			})
			.from(tables.apiKeyHourlyStats)
			.leftJoin(
				tables.apiKey,
				eq(tables.apiKey.id, tables.apiKeyHourlyStats.apiKeyId),
			)
			.leftJoin(tables.user, eq(tables.user.id, tables.apiKey.createdBy))
			.where(
				and(
					inArray(tables.apiKeyHourlyStats.projectId, ids),
					gte(tables.apiKeyHourlyStats.hourTimestamp, startDate),
				),
			)
			.groupBy(dimension.id, dimension.label);

		return c.json(
			summarizeCostBreakdown(
				rows.map((row) => ({
					model:
						groupBy === "user"
							? (row.label ?? "Deleted user")
							: dimensionLabel(row.label, row.id),
					cost: Number(row.cost),
					requestCount: Number(row.requestCount),
					totalTokens: Number(row.totalTokens),
					creditsRequestCount: Number(row.creditsRequestCount),
					apiKeysRequestCount: Number(row.apiKeysRequestCount),
					creditsCost: Number(row.creditsCost),
					apiKeysCost: Number(row.apiKeysCost),
				})),
				window,
			),
		);
	}

	const rows = await db
		.select({
			usedModel: projectHourlyModelStats.usedModel,
			cost: sql<number>`SUM(cast(${projectHourlyModelStats.cost} as double precision))`.as(
				"cost",
			),
			requestCount:
				sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			...modeSplitFields(projectHourlyModelStats),
		})
		.from(projectHourlyModelStats)
		.where(
			and(
				inArray(projectHourlyModelStats.projectId, ids),
				gte(projectHourlyModelStats.hourTimestamp, startDate),
			),
		)
		.groupBy(projectHourlyModelStats.usedModel);

	const byModel = new Map<string, CostBreakdownRow>();
	for (const row of rows) {
		const model =
			modelView === "canonical"
				? extractCanonicalModelId(row.usedModel)
				: row.usedModel;
		const current = byModel.get(model) ?? {
			model,
			cost: 0,
			requestCount: 0,
			totalTokens: 0,
			creditsRequestCount: 0,
			apiKeysRequestCount: 0,
			creditsCost: 0,
			apiKeysCost: 0,
		};
		current.cost += Number(row.cost);
		current.requestCount += Number(row.requestCount);
		current.totalTokens += Number(row.totalTokens);
		current.creditsRequestCount += Number(row.creditsRequestCount);
		current.apiKeysRequestCount += Number(row.apiKeysRequestCount);
		current.creditsCost += Number(row.creditsCost);
		current.apiKeysCost += Number(row.apiKeysCost);
		byModel.set(model, current);
	}

	return c.json(summarizeCostBreakdown([...byModel.values()], window));
});

// --- Cost by model time-series endpoints ---

const costTimeseriesGroupBySchema = z.enum(["model", "source"]);

const organizationCostTimeseriesGroupBySchema = z.enum([
	"model",
	"project",
	"api-key",
	"user",
]);

const TOP_TIMESERIES_SERIES = 10;

const costByModelTimeseriesBucketSchema = z.object({
	model: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.number(),
	creditsRequestCount: z.number(),
	apiKeysRequestCount: z.number(),
	creditsCost: z.number(),
	apiKeysCost: z.number(),
});

const costByModelTimeseriesPointSchema = z.object({
	timestamp: z.string(),
	entries: z.array(costByModelTimeseriesBucketSchema),
});

const costByModelTimeseriesResponseSchema = z.object({
	window: tokenWindowSchema,
	bucket: z.enum(["hour", "day"]),
	modelView: costByModelViewSchema,
	groupBy: z.enum(["model", "source", "project", "api-key", "user"]),
	models: z.array(z.string()),
	data: z.array(costByModelTimeseriesPointSchema),
});

function formatBucketTimestamp(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;
}

function truncateToBucket(date: Date, unit: "hour" | "day"): Date {
	const truncated = new Date(date);
	truncated.setUTCMilliseconds(0);
	truncated.setUTCSeconds(0);
	truncated.setUTCMinutes(0);
	if (unit === "day") {
		truncated.setUTCHours(0);
	}
	return truncated;
}

function generateBucketTimestamps(
	start: Date,
	end: Date,
	unit: "hour" | "day",
): string[] {
	const buckets: string[] = [];
	const stepMs = unit === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
	const startBucket = truncateToBucket(start, unit);
	const endBucket = truncateToBucket(end, unit);
	for (let t = startBucket.getTime(); t <= endBucket.getTime(); t += stepMs) {
		buckets.push(formatBucketTimestamp(new Date(t)));
	}
	return buckets;
}

const getOrgCostByModelTimeseries = createRoute({
	method: "get",
	path: "/organizations/{orgId}/cost-by-model-timeseries",
	request: {
		params: z.object({ orgId: z.string() }),
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
			modelView: costByModelViewSchema.default("mapping").optional(),
			groupBy: organizationCostTimeseriesGroupBySchema
				.default("model")
				.optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: costByModelTimeseriesResponseSchema.openapi({}),
				},
			},
			description:
				"Organization cost breakdown by model, project, API key, or user over time.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

admin.openapi(getOrgCostByModelTimeseries, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "7d";
	const modelView = query.modelView ?? "mapping";
	const groupBy = query.groupBy ?? "model";
	const startDate = getTokenWindowStartDate(window);
	const bucketUnit = getBucketUnitForWindow(window);

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org || org.status === "deleted") {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const projectIds = await db
		.select({ id: tables.project.id })
		.from(tables.project)
		.where(eq(tables.project.organizationId, orgId));

	const ids = projectIds.map((p) => p.id);

	if (ids.length === 0) {
		return c.json({
			window,
			bucket: bucketUnit,
			modelView,
			groupBy,
			models: [],
			data: [],
		});
	}

	const result =
		groupBy === "project"
			? await buildCostByProjectTimeseries({
					bucketUnit,
					startDate,
					projectIds: ids,
				})
			: groupBy === "api-key" || groupBy === "user"
				? await buildCostByApiKeyDimensionTimeseries({
						bucketUnit,
						startDate,
						projectIds: ids,
						groupBy,
					})
				: await buildCostByModelTimeseries({
						modelView,
						bucketUnit,
						startDate,
						baseFilter: and(
							inArray(projectHourlyModelStats.projectId, ids),
							gte(projectHourlyModelStats.hourTimestamp, startDate),
						),
					});

	return c.json({
		window,
		bucket: bucketUnit,
		modelView,
		groupBy,
		models: result.models,
		data: result.data,
	});
});

const getProjectCostByModelTimeseries = createRoute({
	method: "get",
	path: "/organizations/{orgId}/projects/{projectId}/cost-by-model-timeseries",
	request: {
		params: z.object({ orgId: z.string(), projectId: z.string() }),
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
			modelView: costByModelViewSchema.default("mapping").optional(),
			groupBy: costTimeseriesGroupBySchema.default("model").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: costByModelTimeseriesResponseSchema.openapi({}),
				},
			},
			description: "Project cost breakdown by model or source over time.",
		},
		404: {
			description: "Project not found.",
		},
	},
});

admin.openapi(getProjectCostByModelTimeseries, async (c) => {
	const { orgId, projectId } = c.req.valid("param");
	const query = c.req.valid("query");
	const window = query.window ?? "7d";
	const modelView = query.modelView ?? "mapping";
	const groupBy = query.groupBy ?? "model";
	const startDate = getTokenWindowStartDate(window);
	const bucketUnit = getBucketUnitForWindow(window);

	const project = await db.query.project.findFirst({
		where: {
			id: { eq: projectId },
			organizationId: { eq: orgId },
		},
	});

	if (!project) {
		throw new HTTPException(404, { message: "Project not found" });
	}

	const result =
		groupBy === "source"
			? await buildCostBySourceTimeseries({
					bucketUnit,
					startDate,
					baseFilter: and(
						eq(projectHourlySourceStats.projectId, projectId),
						gte(projectHourlySourceStats.hourTimestamp, startDate),
					),
				})
			: await buildCostByModelTimeseries({
					modelView,
					bucketUnit,
					startDate,
					baseFilter: and(
						eq(projectHourlyModelStats.projectId, projectId),
						gte(projectHourlyModelStats.hourTimestamp, startDate),
					),
				});

	return c.json({
		window,
		bucket: bucketUnit,
		modelView,
		groupBy,
		models: result.models,
		data: result.data,
	});
});

async function buildCostByProjectTimeseries({
	bucketUnit,
	startDate,
	projectIds,
}: {
	bucketUnit: "hour" | "day";
	startDate: Date;
	projectIds: string[];
}): Promise<{
	models: string[];
	data: z.infer<typeof costByModelTimeseriesPointSchema>[];
}> {
	const totals = await db
		.select({
			id: projectHourlyStats.projectId,
			label: tables.project.name,
			cost: sql<number>`SUM(cast(${projectHourlyStats.cost} as double precision))`.as(
				"cost",
			),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(tables.project.id, projectHourlyStats.projectId),
		)
		.where(
			and(
				inArray(projectHourlyStats.projectId, projectIds),
				gte(projectHourlyStats.hourTimestamp, startDate),
			),
		)
		.groupBy(projectHourlyStats.projectId, tables.project.name);

	const top = [...totals]
		.sort((a, b) => Number(b.cost) - Number(a.cost))
		.slice(0, TOP_TIMESERIES_SERIES)
		.map((row) => ({
			id: row.id,
			label: dimensionLabel(row.label, row.id),
		}));
	if (top.length === 0) {
		return { models: [], data: [] };
	}

	const labels = new Map(top.map((item) => [item.id, item.label]));
	const topIds = top.map((item) => item.id);
	const bucketExpr = sql<string>`to_char(date_trunc(${sql.raw(`'${bucketUnit}'`)}, ${projectHourlyStats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
	const rows = await db
		.select({
			bucket: bucketExpr.as("bucket"),
			id: projectHourlyStats.projectId,
			cost: sql<number>`SUM(cast(${projectHourlyStats.cost} as double precision))`.as(
				"cost",
			),
			requestCount: sql<number>`SUM(${projectHourlyStats.requestCount})`.as(
				"request_count",
			),
			totalTokens:
				sql<number>`SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			...modeSplitFields(projectHourlyStats),
		})
		.from(projectHourlyStats)
		.where(
			and(
				inArray(projectHourlyStats.projectId, topIds),
				gte(projectHourlyStats.hourTimestamp, startDate),
			),
		)
		.groupBy(bucketExpr, projectHourlyStats.projectId)
		.orderBy(asc(bucketExpr));

	return {
		models: top.map((item) => item.label),
		data: assembleCostTimeseriesPoints({
			allBuckets: generateBucketTimestamps(startDate, new Date(), bucketUnit),
			rows: rows.map((row) => ({
				bucket: row.bucket,
				key: labels.get(row.id) ?? row.id,
				cost: Number(row.cost),
				requestCount: Number(row.requestCount),
				totalTokens: Number(row.totalTokens),
				creditsRequestCount: Number(row.creditsRequestCount),
				apiKeysRequestCount: Number(row.apiKeysRequestCount),
				creditsCost: Number(row.creditsCost),
				apiKeysCost: Number(row.apiKeysCost),
			})),
		}),
	};
}

async function buildCostByApiKeyDimensionTimeseries({
	bucketUnit,
	startDate,
	projectIds,
	groupBy,
}: {
	bucketUnit: "hour" | "day";
	startDate: Date;
	projectIds: string[];
	groupBy: "api-key" | "user";
}): Promise<{
	models: string[];
	data: z.infer<typeof costByModelTimeseriesPointSchema>[];
}> {
	const dimension = apiKeyDimensionColumns(groupBy);
	const baseFilter = and(
		inArray(tables.apiKeyHourlyStats.projectId, projectIds),
		gte(tables.apiKeyHourlyStats.hourTimestamp, startDate),
	);
	const totals = await db
		.select({
			id: dimension.id,
			label: dimension.label,
			cost: sql<number>`SUM(cast(${tables.apiKeyHourlyStats.cost} as double precision))`.as(
				"cost",
			),
		})
		.from(tables.apiKeyHourlyStats)
		.leftJoin(
			tables.apiKey,
			eq(tables.apiKey.id, tables.apiKeyHourlyStats.apiKeyId),
		)
		.leftJoin(tables.user, eq(tables.user.id, tables.apiKey.createdBy))
		.where(baseFilter)
		.groupBy(dimension.id, dimension.label);

	const top = [...totals]
		.sort((a, b) => Number(b.cost) - Number(a.cost))
		.slice(0, TOP_TIMESERIES_SERIES)
		.map((row) => ({
			id: row.id,
			label:
				groupBy === "user"
					? (row.label ?? "Deleted user")
					: dimensionLabel(row.label, row.id),
		}));
	if (top.length === 0) {
		return { models: [], data: [] };
	}

	const labels = new Map(top.map((item) => [item.id, item.label]));
	const topIds = top.map((item) => item.id);
	const bucketExpr = sql<string>`to_char(date_trunc(${sql.raw(`'${bucketUnit}'`)}, ${tables.apiKeyHourlyStats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
	const rows = await db
		.select({
			bucket: bucketExpr.as("bucket"),
			id: dimension.id,
			cost: sql<number>`SUM(cast(${tables.apiKeyHourlyStats.cost} as double precision))`.as(
				"cost",
			),
			requestCount:
				sql<number>`SUM(${tables.apiKeyHourlyStats.requestCount})`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`SUM(CAST(${tables.apiKeyHourlyStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			...modeSplitFields(tables.apiKeyHourlyStats),
		})
		.from(tables.apiKeyHourlyStats)
		.leftJoin(
			tables.apiKey,
			eq(tables.apiKey.id, tables.apiKeyHourlyStats.apiKeyId),
		)
		.leftJoin(tables.user, eq(tables.user.id, tables.apiKey.createdBy))
		.where(and(baseFilter, inArray(dimension.id, topIds)))
		.groupBy(bucketExpr, dimension.id)
		.orderBy(asc(bucketExpr));

	return {
		models: top.map((item) => item.label),
		data: assembleCostTimeseriesPoints({
			allBuckets: generateBucketTimestamps(startDate, new Date(), bucketUnit),
			rows: rows.map((row) => ({
				bucket: row.bucket,
				key: labels.get(row.id) ?? row.id,
				cost: Number(row.cost),
				requestCount: Number(row.requestCount),
				totalTokens: Number(row.totalTokens),
				creditsRequestCount: Number(row.creditsRequestCount),
				apiKeysRequestCount: Number(row.apiKeysRequestCount),
				creditsCost: Number(row.creditsCost),
				apiKeysCost: Number(row.apiKeysCost),
			})),
		}),
	};
}

async function buildCostByModelTimeseries({
	modelView,
	bucketUnit,
	startDate,
	baseFilter,
}: {
	modelView: z.infer<typeof costByModelViewSchema>;
	bucketUnit: "hour" | "day";
	startDate: Date;
	baseFilter: ReturnType<typeof and>;
}): Promise<{
	models: string[];
	data: z.infer<typeof costByModelTimeseriesPointSchema>[];
}> {
	const keyOf = (usedModel: string) =>
		modelView === "canonical" ? extractCanonicalModelId(usedModel) : usedModel;

	const modelTotals = await db
		.select({
			usedModel: projectHourlyModelStats.usedModel,
			cost: sql<number>`SUM(cast(${projectHourlyModelStats.cost} as double precision))`.as(
				"cost",
			),
		})
		.from(projectHourlyModelStats)
		.where(baseFilter)
		.groupBy(projectHourlyModelStats.usedModel);

	const totalByKey = new Map<string, number>();
	const usedModelsByKey = new Map<string, string[]>();
	for (const row of modelTotals) {
		const key = keyOf(row.usedModel);
		totalByKey.set(key, (totalByKey.get(key) ?? 0) + Number(row.cost));
		const list = usedModelsByKey.get(key) ?? [];
		list.push(row.usedModel);
		usedModelsByKey.set(key, list);
	}

	const topKeys = [...totalByKey.entries()]
		.sort((a, b) => b[1] - a[1])
		.slice(0, TOP_TIMESERIES_SERIES)
		.map(([k]) => k);

	if (topKeys.length === 0) {
		return { models: [], data: [] };
	}

	const allBuckets = generateBucketTimestamps(
		startDate,
		new Date(),
		bucketUnit,
	);
	const usedModelsToFetch = topKeys.flatMap(
		(k) => usedModelsByKey.get(k) ?? [],
	);

	const bucketExpr = sql<string>`to_char(date_trunc(${sql.raw(`'${bucketUnit}'`)}, ${projectHourlyModelStats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

	const rows = await db
		.select({
			bucket: bucketExpr.as("bucket"),
			usedModel: projectHourlyModelStats.usedModel,
			cost: sql<number>`SUM(cast(${projectHourlyModelStats.cost} as double precision))`.as(
				"cost",
			),
			requestCount:
				sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			...modeSplitFields(projectHourlyModelStats),
		})
		.from(projectHourlyModelStats)
		.where(
			and(
				baseFilter,
				inArray(projectHourlyModelStats.usedModel, usedModelsToFetch),
			),
		)
		.groupBy(bucketExpr, projectHourlyModelStats.usedModel)
		.orderBy(asc(bucketExpr));

	return {
		models: topKeys,
		data: assembleCostTimeseriesPoints({
			allBuckets,
			rows: rows.map((row) => ({
				bucket: row.bucket,
				key: keyOf(row.usedModel),
				cost: Number(row.cost),
				requestCount: Number(row.requestCount),
				totalTokens: Number(row.totalTokens),
				creditsRequestCount: Number(row.creditsRequestCount),
				apiKeysRequestCount: Number(row.apiKeysRequestCount),
				creditsCost: Number(row.creditsCost),
				apiKeysCost: Number(row.apiKeysCost),
			})),
		}),
	};
}

async function buildCostBySourceTimeseries({
	bucketUnit,
	startDate,
	baseFilter,
}: {
	bucketUnit: "hour" | "day";
	startDate: Date;
	baseFilter: ReturnType<typeof and>;
}): Promise<{
	models: string[];
	data: z.infer<typeof costByModelTimeseriesPointSchema>[];
}> {
	const sourceTotals = await db
		.select({
			source: projectHourlySourceStats.source,
			cost: sql<number>`SUM(cast(${projectHourlySourceStats.cost} as double precision))`.as(
				"cost",
			),
		})
		.from(projectHourlySourceStats)
		.where(baseFilter)
		.groupBy(projectHourlySourceStats.source);

	const topKeys = [...sourceTotals]
		.sort((a, b) => Number(b.cost) - Number(a.cost))
		.slice(0, TOP_TIMESERIES_SERIES)
		.map((row) => row.source);

	if (topKeys.length === 0) {
		return { models: [], data: [] };
	}

	const allBuckets = generateBucketTimestamps(
		startDate,
		new Date(),
		bucketUnit,
	);

	const bucketExpr = sql<string>`to_char(date_trunc(${sql.raw(`'${bucketUnit}'`)}, ${projectHourlySourceStats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

	const rows = await db
		.select({
			bucket: bucketExpr.as("bucket"),
			source: projectHourlySourceStats.source,
			cost: sql<number>`SUM(cast(${projectHourlySourceStats.cost} as double precision))`.as(
				"cost",
			),
			requestCount:
				sql<number>`SUM(${projectHourlySourceStats.requestCount})`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`SUM(CAST(${projectHourlySourceStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
			...modeSplitFields(projectHourlySourceStats),
		})
		.from(projectHourlySourceStats)
		.where(and(baseFilter, inArray(projectHourlySourceStats.source, topKeys)))
		.groupBy(bucketExpr, projectHourlySourceStats.source)
		.orderBy(asc(bucketExpr));

	return {
		models: topKeys,
		data: assembleCostTimeseriesPoints({
			allBuckets,
			rows: rows.map((row) => ({
				bucket: row.bucket,
				key: row.source,
				cost: Number(row.cost),
				requestCount: Number(row.requestCount),
				totalTokens: Number(row.totalTokens),
				creditsRequestCount: Number(row.creditsRequestCount),
				apiKeysRequestCount: Number(row.apiKeysRequestCount),
				creditsCost: Number(row.creditsCost),
				apiKeysCost: Number(row.apiKeysCost),
			})),
		}),
	};
}

function assembleCostTimeseriesPoints({
	allBuckets,
	rows,
}: {
	allBuckets: string[];
	rows: {
		bucket: string;
		key: string;
		cost: number;
		requestCount: number;
		totalTokens: number;
		creditsRequestCount: number;
		apiKeysRequestCount: number;
		creditsCost: number;
		apiKeysCost: number;
	}[];
}): z.infer<typeof costByModelTimeseriesPointSchema>[] {
	const bucketMap = new Map<
		string,
		Map<
			string,
			{
				cost: number;
				requestCount: number;
				totalTokens: number;
				creditsRequestCount: number;
				apiKeysRequestCount: number;
				creditsCost: number;
				apiKeysCost: number;
			}
		>
	>();

	for (const row of rows) {
		const entry = bucketMap.get(row.bucket) ?? new Map();
		const existing = entry.get(row.key) ?? {
			cost: 0,
			requestCount: 0,
			totalTokens: 0,
			creditsRequestCount: 0,
			apiKeysRequestCount: 0,
			creditsCost: 0,
			apiKeysCost: 0,
		};
		existing.cost += row.cost;
		existing.requestCount += row.requestCount;
		existing.totalTokens += row.totalTokens;
		existing.creditsRequestCount += row.creditsRequestCount;
		existing.apiKeysRequestCount += row.apiKeysRequestCount;
		existing.creditsCost += row.creditsCost;
		existing.apiKeysCost += row.apiKeysCost;
		entry.set(row.key, existing);
		bucketMap.set(row.bucket, entry);
	}

	return allBuckets.map((timestamp) => ({
		timestamp,
		entries: Array.from(bucketMap.get(timestamp)?.entries() ?? []).map(
			([model, v]) => ({
				model,
				cost: v.cost,
				requestCount: v.requestCount,
				totalTokens: v.totalTokens,
				creditsRequestCount: v.creditsRequestCount,
				apiKeysRequestCount: v.apiKeysRequestCount,
				creditsCost: v.creditsCost,
				apiKeysCost: v.apiKeysCost,
			}),
		),
	}));
}

// --- Project Model-Provider Stats ---

const projectModelProviderStatsEntrySchema = z.object({
	modelId: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	clientErrorsCount: z.number(),
	cachedCount: z.number(),
	cost: z.number(),
	totalTokens: z.number(),
	creditsRequestCount: z.number(),
	apiKeysRequestCount: z.number(),
	creditsCost: z.number(),
	apiKeysCost: z.number(),
	...tokenBreakdownShape,
});

const projectModelProviderStatsResponseSchema = z.object({
	mappings: z.array(projectModelProviderStatsEntrySchema),
	total: z.number(),
	totalRequests: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	...tokenBreakdownShape,
});

const getProjectModelProviderStats = createRoute({
	method: "get",
	path: "/organizations/{orgId}/projects/{projectId}/model-provider-stats",
	request: {
		params: z.object({ orgId: z.string(), projectId: z.string() }),
		query: z.object({
			search: z.string().optional(),
			sortBy: z
				.enum(["logsCount", "errorsCount", "cost", "modelId", "providerId"])
				.optional(),
			sortOrder: z.enum(["asc", "desc"]).optional(),
			limit: z.coerce.number().optional(),
			offset: z.coerce.number().optional(),
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: projectModelProviderStatsResponseSchema.openapi({}),
				},
			},
			description: "Project model-provider stats.",
		},
	},
});

admin.openapi(getProjectModelProviderStats, async (c) => {
	const { projectId } = c.req.valid("param");
	const query = c.req.valid("query");
	const sortBy = query.sortBy ?? "logsCount";
	const sortOrder = query.sortOrder ?? "desc";
	const limit = query.limit ?? 100;
	const offset = query.offset ?? 0;
	const search = query.search ?? "";
	const { from, to } = query;

	let startDate: Date;
	let endDate: Date | undefined;
	if (from && to) {
		if (from.includes("T") || from.includes("Z")) {
			startDate = new Date(from);
			endDate = new Date(to);
		} else {
			startDate = new Date(from + "T00:00:00");
			startDate.setUTCHours(0, 0, 0, 0);
			endDate = new Date(to + "T00:00:00");
			endDate.setUTCHours(23, 59, 59, 999);
		}
	} else {
		const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
		startDate = new Date(Date.now() - sevenDaysMs);
	}

	const searchClause = search
		? or(
				sql`${projectHourlyModelStats.usedModel} ILIKE ${"%" + search + "%"}`,
				sql`${projectHourlyModelStats.usedProvider} ILIKE ${"%" + search + "%"}`,
			)
		: undefined;

	const whereConditions = and(
		eq(projectHourlyModelStats.projectId, projectId),
		gte(projectHourlyModelStats.hourTimestamp, startDate),
		endDate ? lte(projectHourlyModelStats.hourTimestamp, endDate) : undefined,
		searchClause,
	);

	const logsCountExpr =
		sql<number>`COALESCE(SUM(${projectHourlyModelStats.requestCount}), 0)`.as(
			"logs_count",
		);
	const errorsCountSql = sql<number>`COALESCE(SUM(${projectHourlyModelStats.errorCount}), 0)`;
	const errorsCountExpr = errorsCountSql.as("errors_count");
	const clientErrorsCountSql = sql<number>`COALESCE(SUM(${projectHourlyModelStats.clientErrorCount}), 0)`;
	const clientErrorsCountExpr = clientErrorsCountSql.as("client_errors_count");
	const cachedCountExpr =
		sql<number>`COALESCE(SUM(${projectHourlyModelStats.cacheCount}), 0)`.as(
			"cached_count",
		);
	const costExpr =
		sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
			"cost",
		);
	const totalTokensExpr =
		sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
			"total_tokens",
		);

	const sortColumn = (() => {
		switch (sortBy) {
			case "logsCount":
				return logsCountExpr;
			case "errorsCount":
				return sql`GREATEST(${errorsCountSql} - ${clientErrorsCountSql}, 0)`;
			case "cost":
				return costExpr;
			case "modelId":
				return projectHourlyModelStats.usedModel;
			case "providerId":
				return projectHourlyModelStats.usedProvider;
			default:
				return logsCountExpr;
		}
	})();

	const rows = await db
		.select({
			usedModel: projectHourlyModelStats.usedModel,
			usedProvider: projectHourlyModelStats.usedProvider,
			logsCount: logsCountExpr,
			errorsCount: errorsCountExpr,
			clientErrorsCount: clientErrorsCountExpr,
			cachedCount: cachedCountExpr,
			cost: costExpr,
			totalTokens: totalTokensExpr,
			...modeSplitFields(projectHourlyModelStats),
			inputTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.inputTokens} AS NUMERIC)), 0)`.as(
					"input_tokens",
				),
			cachedTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.cachedTokens} AS NUMERIC)), 0)`.as(
					"cached_tokens",
				),
			outputTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.outputTokens} AS NUMERIC)), 0)`.as(
					"output_tokens",
				),
			inputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.inputCost} as double precision)), 0)`.as(
					"input_cost",
				),
			cachedInputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cachedInputCost} as double precision)), 0)`.as(
					"cached_input_cost",
				),
			outputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.outputCost} as double precision)), 0)`.as(
					"output_cost",
				),
		})
		.from(projectHourlyModelStats)
		.where(whereConditions)
		.groupBy(
			projectHourlyModelStats.usedModel,
			projectHourlyModelStats.usedProvider,
		)
		.orderBy(sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn))
		.limit(limit)
		.offset(offset);

	const providerIds = [...new Set(rows.map((r) => r.usedProvider))];
	const providerRows =
		providerIds.length > 0
			? await db.query.provider.findMany({
					where: { id: { in: providerIds } },
				})
			: [];
	const providerNameMap = new Map(providerRows.map((p) => [p.id, p.name]));

	const totalRequests = rows.reduce((s, r) => s + Number(r.logsCount), 0);
	const totalTokens = rows.reduce((s, r) => s + Number(r.totalTokens), 0);
	const totalCost = rows.reduce((s, r) => s + Number(r.cost), 0);
	const totalBreakdown = { ...EMPTY_TOKEN_BREAKDOWN };
	for (const r of rows) {
		addTokenBreakdown(totalBreakdown, r);
	}

	return c.json({
		mappings: rows.map((r) => ({
			modelId: r.usedModel,
			providerId: r.usedProvider,
			providerName: providerNameMap.get(r.usedProvider) ?? r.usedProvider,
			logsCount: Number(r.logsCount),
			errorsCount: Number(r.errorsCount),
			clientErrorsCount: Number(r.clientErrorsCount),
			cachedCount: Number(r.cachedCount),
			cost: Number(r.cost),
			totalTokens: Number(r.totalTokens),
			creditsRequestCount: Number(r.creditsRequestCount),
			apiKeysRequestCount: Number(r.apiKeysRequestCount),
			creditsCost: Number(r.creditsCost),
			apiKeysCost: Number(r.apiKeysCost),
			...toTokenBreakdown(r),
		})),
		total: rows.length,
		totalRequests,
		totalTokens,
		totalCost,
		...totalBreakdown,
	});
});

// --- Model-Provider Mappings list ---

const modelProviderMappingEntrySchema = z.object({
	id: z.string(),
	modelId: z.string(),
	externalId: z.string(),
	region: z.string().nullable(),
	providerId: z.string(),
	providerName: z.string(),
	status: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	clientErrorsCount: z.number(),
	gatewayErrorsCount: z.number(),
	upstreamErrorsCount: z.number(),
	cachedCount: z.number(),
	cost: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	...tokenBreakdownShape,
	inputPrice: z.string().nullable(),
	outputPrice: z.string().nullable(),
	contextSize: z.number().nullable(),
	updatedAt: z.string(),
});

const modelProviderMappingsListSchema = z.object({
	mappings: z.array(modelProviderMappingEntrySchema),
	total: z.number(),
	totalRequests: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	...tokenBreakdownShape,
});

const providersWithHiddenRootMappings = providers
	.filter(
		(provider) =>
			provider.regionConfig && !provider.regionConfig.pinDefaultRegion,
	)
	.map((provider) => provider.id);

const getModelProviderMappings = createRoute({
	method: "get",
	path: "/model-provider-mappings",
	request: {
		query: z.object({
			search: z.string().optional(),
			sortBy: z
				.enum([
					"modelId",
					"providerId",
					"logsCount",
					"errorsCount",
					"clientErrorsCount",
					"gatewayErrorsCount",
					"upstreamErrorsCount",
					"cost",
					"avgTimeToFirstToken",
					"updatedAt",
				])
				.optional(),
			sortOrder: z.enum(["asc", "desc"]).optional(),
			limit: z.coerce.number().optional(),
			offset: z.coerce.number().optional(),
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: modelProviderMappingsListSchema.openapi({}),
				},
			},
			description: "List of all model-provider mappings.",
		},
	},
});

admin.openapi(getModelProviderMappings, async (c) => {
	const query = c.req.valid("query");
	const sortBy = query.sortBy ?? "logsCount";
	const sortOrder = query.sortOrder ?? "desc";
	const limit = query.limit ?? 100;
	const offset = query.offset ?? 0;
	const search = query.search ?? "";
	const { from, to } = query;

	const concreteRegionalMapping = aliasedTable(
		tables.modelProviderMapping,
		"concrete_regional_mapping",
	);
	const visibleMappingClause =
		providersWithHiddenRootMappings.length === 0
			? undefined
			: or(
					notInArray(
						tables.modelProviderMapping.providerId,
						providersWithHiddenRootMappings,
					),
					isNotNull(tables.modelProviderMapping.region),
					sql`NOT EXISTS (
						SELECT 1
						FROM ${tables.modelProviderMapping} ${concreteRegionalMapping}
						WHERE ${concreteRegionalMapping.providerId} = ${tables.modelProviderMapping.providerId}
							AND ${concreteRegionalMapping.modelId} = ${tables.modelProviderMapping.modelId}
							AND ${concreteRegionalMapping.externalId} = ${tables.modelProviderMapping.externalId}
							AND ${concreteRegionalMapping.region} IS NOT NULL
					)`,
				);
	const searchClause = search
		? or(
				sql`${tables.modelProviderMapping.modelId} ILIKE ${"%" + search + "%"}`,
				sql`${tables.modelProviderMapping.providerId} ILIKE ${"%" + search + "%"}`,
			)
		: undefined;
	const whereClause = and(visibleMappingClause, searchClause);

	const dateRange = (() => {
		if (!(from && to)) {
			return null;
		}

		let startDate: Date;
		let endDateExclusive: Date;
		if (from.includes("T") || from.includes("Z")) {
			startDate = new Date(from);
			endDateExclusive = new Date(to);
		} else {
			startDate = new Date(from + "T00:00:00");
			startDate.setUTCHours(0, 0, 0, 0);
			endDateExclusive = new Date(to + "T00:00:00");
			endDateExclusive.setUTCHours(0, 0, 0, 0);
			endDateExclusive.setDate(endDateExclusive.getDate() + 1);
		}

		return { startDate, endDateExclusive };
	})();

	// Ranges longer than 24h aggregate the hourly rollup so a full-window scan
	// across every mapping doesn't read minute rows (mirrors the models list).
	const mappingHistory = dateRange
		? pickMappingHistoryTable(
				isHourlyRange(dateRange.startDate, dateRange.endDateExclusive),
			)
		: null;

	const statsJoin = mappingHistory
		? db
				.select({
					mappingId: mappingHistory.table.modelProviderMappingId,
					logsCount:
						sql<number>`COALESCE(SUM(${mappingHistory.table.logsCount}), 0)`.as(
							"logsCount",
						),
					errorsCount:
						sql<number>`COALESCE(SUM(${mappingHistory.table.errorsCount}), 0)`.as(
							"errorsCount",
						),
					clientErrorsCount:
						sql<number>`COALESCE(SUM(${mappingHistory.table.clientErrorsCount}), 0)`.as(
							"clientErrorsCount",
						),
					gatewayErrorsCount:
						sql<number>`COALESCE(SUM(${mappingHistory.table.gatewayErrorsCount}), 0)`.as(
							"gatewayErrorsCount",
						),
					upstreamErrorsCount:
						sql<number>`COALESCE(SUM(${mappingHistory.table.upstreamErrorsCount}), 0)`.as(
							"upstreamErrorsCount",
						),
					cachedCount:
						sql<number>`COALESCE(SUM(${mappingHistory.table.cachedCount}), 0)`.as(
							"cachedCount",
						),
					cost: sql<number>`COALESCE(SUM(cast(${mappingHistory.table.totalCost} as double precision)), 0)`.as(
						"cost",
					),
					...tokenBreakdownSums(mappingHistory.table),
				})
				.from(mappingHistory.table)
				.where(
					and(
						gte(mappingHistory.bucket, dateRange!.startDate),
						lt(mappingHistory.bucket, dateRange!.endDateExclusive),
					),
				)
				.groupBy(mappingHistory.table.modelProviderMappingId)
				.as("mapping_stats_sub")
		: db
				.select({
					mappingId: tables.modelProviderMapping.id,
					logsCount: tables.modelProviderMapping.logsCount,
					errorsCount: tables.modelProviderMapping.errorsCount,
					clientErrorsCount: tables.modelProviderMapping.clientErrorsCount,
					gatewayErrorsCount: tables.modelProviderMapping.gatewayErrorsCount,
					upstreamErrorsCount: tables.modelProviderMapping.upstreamErrorsCount,
					cachedCount: tables.modelProviderMapping.cachedCount,
					// Cost and the token breakdown are only tracked in the history
					// table, so they are only available when a date range is provided
					// (mirrors the models list).
					cost: sql<number>`0`.as("cost"),
					inputTokens: sql<number>`0`.as("input_tokens"),
					cachedTokens: sql<number>`0`.as("cached_tokens"),
					outputTokens: sql<number>`0`.as("output_tokens"),
					inputCost: sql<number>`0`.as("input_cost"),
					cachedInputCost: sql<number>`0`.as("cached_input_cost"),
					outputCost: sql<number>`0`.as("output_cost"),
				})
				.from(tables.modelProviderMapping)
				.as("mapping_stats_sub");

	const totalsPromise = mappingHistory
		? db
				.select({
					totalRequests:
						sql<number>`COALESCE(SUM(${mappingHistory.table.logsCount}), 0)`.as(
							"totalRequests",
						),
					totalTokens:
						sql<number>`COALESCE(SUM(CAST(${mappingHistory.table.totalTokens} AS NUMERIC)), 0)`.as(
							"totalTokens",
						),
					totalCost:
						sql<number>`COALESCE(SUM(cast(${mappingHistory.table.totalCost} as double precision)), 0)`.as(
							"totalCost",
						),
					...tokenBreakdownSums(mappingHistory.table),
				})
				.from(mappingHistory.table)
				.innerJoin(
					tables.modelProviderMapping,
					eq(
						mappingHistory.table.modelProviderMappingId,
						tables.modelProviderMapping.id,
					),
				)
				.where(
					and(
						// Page rows may include both the synthetic root mapping and its
						// concrete regions. Totals use the root, which already contains
						// all regional traffic, independently of which rows are rendered.
						searchClause,
						gte(mappingHistory.bucket, dateRange!.startDate),
						lt(mappingHistory.bucket, dateRange!.endDateExclusive),
						excludeRegionalMappingRows(mappingHistory.table),
					),
				)
		: Promise.resolve([
				{
					totalRequests: 0,
					totalTokens: 0,
					totalCost: 0,
					...EMPTY_TOKEN_BREAKDOWN,
				},
			]);

	const orderFn = sortOrder === "asc" ? asc : desc;
	const sortColumnMap = {
		modelId: tables.modelProviderMapping.modelId,
		providerId: tables.modelProviderMapping.providerId,
		logsCount: sql`COALESCE(${statsJoin.logsCount}, 0)`,
		errorsCount: sql`GREATEST(COALESCE(${statsJoin.errorsCount}, 0) - COALESCE(${statsJoin.clientErrorsCount}, 0), 0)`,
		clientErrorsCount: sql`COALESCE(${statsJoin.clientErrorsCount}, 0)`,
		gatewayErrorsCount: sql`COALESCE(${statsJoin.gatewayErrorsCount}, 0)`,
		upstreamErrorsCount: sql`COALESCE(${statsJoin.upstreamErrorsCount}, 0)`,
		cost: sql`COALESCE(${statsJoin.cost}, 0)`,
		avgTimeToFirstToken: sql`COALESCE(${tables.modelProviderMapping.avgTimeToFirstReasoningToken}, ${tables.modelProviderMapping.avgTimeToFirstToken})`,
		updatedAt: tables.modelProviderMapping.updatedAt,
	} as const;

	const sortColumn = sortColumnMap[sortBy];

	const [[countResult], [totalsResult], rows] = await Promise.all([
		db
			.select({ count: sql<number>`COUNT(*)`.as("count") })
			.from(tables.modelProviderMapping)
			.where(whereClause),
		totalsPromise,
		db
			.select({
				id: tables.modelProviderMapping.id,
				modelId: tables.modelProviderMapping.modelId,
				externalId: tables.modelProviderMapping.externalId,
				region: tables.modelProviderMapping.region,
				providerId: tables.modelProviderMapping.providerId,
				providerName: tables.provider.name,
				status: tables.modelProviderMapping.status,
				logsCount: sql<number>`COALESCE(${statsJoin.logsCount}, 0)`.as(
					"logsCount",
				),
				errorsCount: sql<number>`COALESCE(${statsJoin.errorsCount}, 0)`.as(
					"errorsCount",
				),
				clientErrorsCount:
					sql<number>`COALESCE(${statsJoin.clientErrorsCount}, 0)`.as(
						"clientErrorsCount",
					),
				gatewayErrorsCount:
					sql<number>`COALESCE(${statsJoin.gatewayErrorsCount}, 0)`.as(
						"gatewayErrorsCount",
					),
				upstreamErrorsCount:
					sql<number>`COALESCE(${statsJoin.upstreamErrorsCount}, 0)`.as(
						"upstreamErrorsCount",
					),
				cachedCount: sql<number>`COALESCE(${statsJoin.cachedCount}, 0)`.as(
					"cachedCount",
				),
				cost: sql<number>`COALESCE(${statsJoin.cost}, 0)`.as("cost"),
				avgTimeToFirstToken: sql<
					number | null
				>`COALESCE(${tables.modelProviderMapping.avgTimeToFirstReasoningToken}, ${tables.modelProviderMapping.avgTimeToFirstToken})`.as(
					"avgTimeToFirstToken",
				),
				...tokenBreakdownFromSub(statsJoin),
				inputPrice: tables.modelProviderMapping.inputPrice,
				outputPrice: tables.modelProviderMapping.outputPrice,
				contextSize: tables.modelProviderMapping.contextSize,
				updatedAt: tables.modelProviderMapping.updatedAt,
			})
			.from(tables.modelProviderMapping)
			.innerJoin(
				tables.provider,
				eq(tables.modelProviderMapping.providerId, tables.provider.id),
			)
			.leftJoin(
				statsJoin,
				eq(tables.modelProviderMapping.id, statsJoin.mappingId),
			)
			.where(whereClause)
			.orderBy(orderFn(sortColumn), asc(tables.modelProviderMapping.id))
			.limit(limit)
			.offset(offset),
	]);

	return c.json({
		mappings: rows.map((r) => ({
			id: r.id,
			modelId: r.modelId,
			externalId: r.externalId,
			region: r.region,
			providerId: r.providerId,
			providerName: r.providerName,
			status: r.status,
			logsCount: Number(r.logsCount ?? 0),
			errorsCount: Number(r.errorsCount ?? 0),
			clientErrorsCount: Number(r.clientErrorsCount ?? 0),
			gatewayErrorsCount: Number(r.gatewayErrorsCount ?? 0),
			upstreamErrorsCount: Number(r.upstreamErrorsCount ?? 0),
			cachedCount: Number(r.cachedCount ?? 0),
			cost: Number(r.cost ?? 0),
			avgTimeToFirstToken: r.avgTimeToFirstToken,
			...toTokenBreakdown(r),
			inputPrice: r.inputPrice,
			outputPrice: r.outputPrice,
			contextSize: r.contextSize,
			updatedAt: r.updatedAt.toISOString(),
		})),
		total: Number(countResult?.count ?? 0),
		totalRequests: Number(totalsResult?.totalRequests ?? 0),
		totalTokens: Number(totalsResult?.totalTokens ?? 0),
		totalCost: Number(totalsResult?.totalCost ?? 0),
		...toTokenBreakdown(totalsResult),
	});
});

// ── Unstable Model Mappings ─────────────────────────────────────────────────

// The candidate set of logs is bounded both ways: only the latest logs from the
// selected time window, capped at the caller-supplied log limit (most recent
// rows). Both default to the tightest setting (4h / 100 logs) for the cheapest,
// most-critical view; callers can widen either via query params. Retried logs are
// excluded by default because the gateway already recovered from those failures
// via a fallback provider, so they should not count against a mapping's
// stability — but callers can opt to include them via `includeRetried`.
const UNSTABLE_MAPPINGS_DEFAULT_LOG_LIMIT = 100;
const UNSTABLE_MAPPINGS_MAX_LOG_LIMIT = 1000000;

// Supported time windows for the rankings, mapping each selectable value to its
// SQL interval bound and an hours count surfaced to the UI for the description.
const UNSTABLE_MAPPINGS_WINDOWS = {
	"1h": { interval: sql`now() - interval '1 hour'`, hours: 1 },
	"2h": { interval: sql`now() - interval '2 hours'`, hours: 2 },
	"4h": { interval: sql`now() - interval '4 hours'`, hours: 4 },
	"8h": { interval: sql`now() - interval '8 hours'`, hours: 8 },
	"12h": { interval: sql`now() - interval '12 hours'`, hours: 12 },
	"16h": { interval: sql`now() - interval '16 hours'`, hours: 16 },
	"24h": { interval: sql`now() - interval '24 hours'`, hours: 24 },
	"3d": { interval: sql`now() - interval '3 days'`, hours: 72 },
	"7d": { interval: sql`now() - interval '7 days'`, hours: 168 },
} as const;

const unstableMappingsWindowSchema = z.enum([
	"1h",
	"2h",
	"4h",
	"8h",
	"12h",
	"16h",
	"24h",
	"3d",
	"7d",
]);

type UnstableMappingsWindow = keyof typeof UNSTABLE_MAPPINGS_WINDOWS;

function resolveUnstableMappingsWindow(
	window: UnstableMappingsWindow | undefined,
) {
	return UNSTABLE_MAPPINGS_WINDOWS[window ?? "4h"];
}

// `retried` is nullable; legacy rows predate the column and are NULL. Treat
// those as non-retried so they are not silently dropped from the rankings.
const unstableMappingsNotRetriedClause = sql`AND ${tables.log.retried} IS DISTINCT FROM true`;

// Customer-owned keys are useful when debugging a customer report, but they
// should not affect the platform credential health ranking by default.
const unstableMappingsPlatformOnlyClause = sql`AND ${tables.log.usedMode} <> 'api-keys'`;

interface IgnoredErrorMatcherTarget {
	pattern: string | null;
	statusCode: number | null;
}

// Builds an OR chain across all stored matchers so expected upstream errors
// can be treated as non-errors. A substring pattern is matched
// case-insensitively against the serialized error details JSON (covering
// status text, response body, and cause); a status code is matched against the
// upstream `statusCode` field. When a matcher has both, both must match.
function buildIgnoredErrorMatchExpr(matchers: IgnoredErrorMatcherTarget[]) {
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

async function listIgnoredErrorMatchers() {
	return await db.query.ignoredErrorMatcher.findMany({
		orderBy: {
			createdAt: "desc",
		},
	});
}

const unstableMappingEntrySchema = z.object({
	modelId: z.string(),
	// Region suffix parsed from `used_model`, if any. Needed to disambiguate
	// regional mappings, which are unique on (model_id, provider_id, region).
	region: z.string().nullable(),
	// The raw `used_model` log value (`provider/model[:region]`); the error-detail
	// drilldown queries logs by this exact value.
	usedModel: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	/**
	 * Only populated when the ranking is split by provider key: the credential
	 * (managed or BYOK) whose token served this row's traffic. Null with the
	 * split on means the traffic ran on env-var keys, or failed before a
	 * credential was resolved — there is no key row to attribute it to.
	 */
	providerKeyId: z.string().nullable(),
	/** Operator note for managed keys or customer description for BYOK keys. */
	providerKeyLabel: z.string().nullable(),
	/** Masked credential shown only as hover context in the admin UI. */
	providerKeyMaskedToken: z.string().nullable(),
	providerKeyManaged: z.boolean().nullable(),
	logsCount: z.number(),
	errorsCount: z.number(),
	errorRate: z.number(),
});

const unstableMappingsListSchema = z.object({
	mappings: z.array(unstableMappingEntrySchema),
	sampledLogs: z.number(),
	windowHours: z.number(),
	logLimit: z.number(),
	includeRetried: z.boolean(),
	ignoreExpected: z.boolean(),
	splitByKey: z.boolean(),
	includeByok: z.boolean(),
	// Number of ignore matchers applied to this ranking (0 when disabled).
	ignoredMatcherCount: z.number(),
});

const getUnstableMappings = createRoute({
	method: "get",
	path: "/unstable-mappings",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(200).optional(),
			logLimit: z.coerce
				.number()
				.min(1)
				.max(UNSTABLE_MAPPINGS_MAX_LOG_LIMIT)
				.optional(),
			includeRetried: z.enum(["true", "false"]).optional(),
			window: unstableMappingsWindowSchema.optional(),
			ignoreExpected: z.enum(["true", "false"]).optional(),
			splitByKey: z.enum(["true", "false"]).optional(),
			includeByok: z.enum(["true", "false"]).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: unstableMappingsListSchema.openapi({}),
				},
			},
			description:
				"Model-provider mappings ranked by error rate over the latest non-retried logs.",
		},
	},
});

admin.openapi(getUnstableMappings, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	const includeRetried = query.includeRetried === "true";
	const logLimit = query.logLimit ?? UNSTABLE_MAPPINGS_DEFAULT_LOG_LIMIT;
	const retriedClause = includeRetried
		? sql``
		: unstableMappingsNotRetriedClause;
	const ignoreExpected = query.ignoreExpected !== "false";
	const splitByKey = query.splitByKey === "true";
	const includeByok = query.includeByok === "true";
	const byokClause = includeByok ? sql`` : unstableMappingsPlatformOnlyClause;
	const { interval: windowInterval, hours: windowHours } =
		resolveUnstableMappingsWindow(query.window);

	// With the split off every row carries a constant NULL key, so the extra
	// GROUP BY column is a no-op and both modes share one query shape.
	const providerKeyExpr = splitByKey
		? sql`${tables.log.providerKeyId}`
		: sql`NULL::text`;

	// When ignore matchers apply, errors matching any matcher count as
	// successes: the log stays in the sample (denominator) but no longer counts
	// against the mapping. NULL error details coalesce to "no match" so errors
	// without details are still counted. The full matcher count is returned
	// regardless so the UI can surface it even when ignoring is toggled off.
	const ignoredMatchers = await listIgnoredErrorMatchers();
	const hasErrorExpr =
		ignoreExpected && ignoredMatchers.length > 0
			? sql`(${tables.log.hasError} AND NOT COALESCE((${buildIgnoredErrorMatchExpr(ignoredMatchers)}), false))`
			: sql`${tables.log.hasError}`;

	const rows = await db.execute<{
		used_model: string;
		used_provider: string;
		provider_key_id: string | null;
		logs_count: string;
		errors_count: string;
		error_rate: string;
		sampled_logs: string;
	}>(sql`
		WITH recent_logs AS (
			SELECT ${tables.log.usedModel} AS used_model,
				${tables.log.usedProvider} AS used_provider,
				${providerKeyExpr} AS provider_key_id,
				${hasErrorExpr} AS has_error
			FROM ${tables.log}
			WHERE ${tables.log.createdAt} >= ${windowInterval}
				AND ${tables.log.unifiedFinishReason} IS DISTINCT FROM 'client_error'
				${retriedClause}
				${byokClause}
			ORDER BY ${tables.log.createdAt} DESC
			LIMIT ${logLimit}
		)
		SELECT used_model,
			used_provider,
			provider_key_id,
			COUNT(*) AS logs_count,
			COUNT(*) FILTER (WHERE has_error) AS errors_count,
			COUNT(*) FILTER (WHERE has_error)::float / COUNT(*) AS error_rate,
			(SELECT COUNT(*) FROM recent_logs) AS sampled_logs
		FROM recent_logs
		GROUP BY used_model, used_provider, provider_key_id
		HAVING COUNT(*) FILTER (WHERE has_error) > 0
		ORDER BY error_rate DESC, errors_count DESC
		LIMIT ${limit}
	`);

	const resultRows = rows.rows;
	const providerIds = [...new Set(resultRows.map((r) => r.used_provider))];
	const providerRows =
		providerIds.length > 0
			? await db.query.provider.findMany({
					where: { id: { in: providerIds } },
				})
			: [];
	const providerNameMap = new Map(providerRows.map((p) => [p.id, p.name]));

	// The key rows behind the split, for the label an operator can relate back
	// to the credentials pages: the note when one is set, the mask otherwise.
	const providerKeyIds = [
		...new Set(
			resultRows
				.map((r) => r.provider_key_id)
				.filter((id): id is string => id !== null),
		),
	];
	const providerKeyRows =
		providerKeyIds.length > 0
			? await db
					.select({
						id: tables.providerKey.id,
						comment: tables.providerKey.comment,
						description: tables.providerKey.description,
						tokenMasked: tables.providerKey.tokenMasked,
						// Legacy pre-encryption rows still carry plaintext here; it is
						// selected only to compute the mask below and must never reach
						// the response.
						legacyToken: tables.providerKey.token,
						managed: tables.providerKey.managed,
					})
					.from(tables.providerKey)
					.where(inArray(tables.providerKey.id, providerKeyIds))
			: [];
	const providerKeyMap = new Map(providerKeyRows.map((k) => [k.id, k]));

	const sampledLogs =
		resultRows.length > 0 ? Number(resultRows[0].sampled_logs) : 0;

	return c.json({
		mappings: resultRows.map((r) => {
			const { modelId, region } = parseUsedModel(r.used_model, r.used_provider);
			const keyRow = r.provider_key_id
				? providerKeyMap.get(r.provider_key_id)
				: undefined;
			return {
				modelId,
				region,
				usedModel: r.used_model,
				providerId: r.used_provider,
				providerName: providerNameMap.get(r.used_provider) ?? r.used_provider,
				providerKeyId: r.provider_key_id,
				providerKeyLabel: keyRow
					? keyRow.managed
						? keyRow.comment?.trim() ||
							(keyRow.tokenMasked ?? maskToken(keyRow.legacyToken ?? "", 6))
						: keyRow.description?.trim() || "Bring your own key"
					: null,
				providerKeyMaskedToken: keyRow
					? (keyRow.tokenMasked ?? maskToken(keyRow.legacyToken ?? "", 6))
					: null,
				providerKeyManaged: keyRow ? keyRow.managed : null,
				logsCount: Number(r.logs_count),
				errorsCount: Number(r.errors_count),
				errorRate: Number(r.error_rate),
			};
		}),
		sampledLogs,
		windowHours,
		logLimit,
		includeRetried,
		ignoreExpected,
		splitByKey,
		includeByok,
		ignoredMatcherCount: ignoredMatchers.length,
	});
});

const unstableMappingErrorDetailSchema = z.object({
	statusCode: z.number().nullable(),
	statusText: z.string().nullable(),
	responseText: z.string().nullable(),
	cause: z.string().nullable(),
	// The gateway's internal classification stored on the log
	// (`unified_finish_reason`, e.g. `client_error`, `gateway_error`,
	// `upstream_error`, `content_filter`). Surfaced because the HTTP status
	// alone is misleading: some 4xx responses are classified as gateway or
	// upstream errors.
	classification: z.string().nullable(),
	// Whether the failed request was a streaming request. Streaming and
	// non-streaming failures often have different causes, so the drilldown
	// groups errors by this flag.
	streamed: z.boolean(),
	count: z.number(),
});

const unstableMappingErrorsSchema = z.object({
	errors: z.array(unstableMappingErrorDetailSchema),
	sampledErrors: z.number(),
});

const getUnstableMappingErrors = createRoute({
	method: "get",
	path: "/unstable-mappings/errors",
	request: {
		query: z.object({
			model: z.string(),
			provider: z.string(),
			includeRetried: z.enum(["true", "false"]).optional(),
			window: unstableMappingsWindowSchema.optional(),
			logLimit: z.coerce
				.number()
				.min(1)
				.max(UNSTABLE_MAPPINGS_MAX_LOG_LIMIT)
				.optional(),
			ignoreExpected: z.enum(["true", "false"]).optional(),
			includeByok: z.enum(["true", "false"]).optional(),
			/**
			 * Narrows the sample to one provider key, mirroring a row of the
			 * key-split ranking. The literal `__unattributed__` selects logs with
			 * no key at all (env-var credentials, or failures that never resolved
			 * one).
			 */
			providerKeyId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: unstableMappingErrorsSchema.openapi({}),
				},
			},
			description:
				"Top 10 error details for a mapping over the latest error logs.",
		},
	},
});

admin.openapi(getUnstableMappingErrors, async (c) => {
	const {
		model,
		provider,
		includeRetried,
		window,
		logLimit,
		ignoreExpected,
		includeByok,
		providerKeyId,
	} = c.req.valid("query");
	const sampleLimit = logLimit ?? UNSTABLE_MAPPINGS_DEFAULT_LOG_LIMIT;
	const retriedClause =
		includeRetried === "true" ? sql`` : unstableMappingsNotRetriedClause;
	const byokClause =
		includeByok === "true" ? sql`` : unstableMappingsPlatformOnlyClause;
	const { interval: windowInterval } = resolveUnstableMappingsWindow(window);
	const providerKeyClause =
		providerKeyId === undefined
			? sql``
			: providerKeyId === "__unattributed__"
				? sql`AND ${tables.log.providerKeyId} IS NULL`
				: sql`AND ${tables.log.providerKeyId} = ${providerKeyId}`;

	// Mirror the ranking view: drop errors matching an ignore matcher so the
	// drilldown shows the same errors that counted against the mapping.
	const ignoredMatchers =
		ignoreExpected !== "false" ? await listIgnoredErrorMatchers() : [];
	const ignoredClause =
		ignoredMatchers.length > 0
			? sql`AND NOT COALESCE((${buildIgnoredErrorMatchExpr(ignoredMatchers)}), false)`
			: sql``;

	const rows = await db.execute<{
		status_code: string | null;
		status_text: string | null;
		response_text: string | null;
		cause: string | null;
		classification: string | null;
		streamed: boolean;
		count: string;
		sampled_errors: string;
	}>(sql`
		WITH recent_errors AS (
			SELECT ${tables.log.errorDetails} AS error_details,
				${tables.log.unifiedFinishReason} AS classification,
				COALESCE(${tables.log.streamed}, false) AS streamed
			FROM ${tables.log}
			WHERE ${tables.log.hasError} = true
				AND ${tables.log.unifiedFinishReason} IS DISTINCT FROM 'client_error'
				AND ${tables.log.usedModel} = ${model}
				AND ${tables.log.usedProvider} = ${provider}
				AND ${tables.log.createdAt} >= ${windowInterval}
				${providerKeyClause}
				${retriedClause}
				${byokClause}
				${ignoredClause}
			ORDER BY ${tables.log.createdAt} DESC
			LIMIT ${sampleLimit}
		)
		SELECT error_details->>'statusCode' AS status_code,
			error_details->>'statusText' AS status_text,
			LEFT(error_details->>'responseText', 2000) AS response_text,
			error_details->>'cause' AS cause,
			classification,
			streamed,
			COUNT(*) AS count,
			(SELECT COUNT(*) FROM recent_errors) AS sampled_errors
		FROM recent_errors
		GROUP BY status_code, status_text, response_text, cause, classification, streamed
		ORDER BY count DESC
		LIMIT 10
	`);

	const sampledErrors =
		rows.rows.length > 0 ? Number(rows.rows[0].sampled_errors) : 0;

	return c.json({
		errors: rows.rows.map((r) => ({
			statusCode: r.status_code !== null ? Number(r.status_code) : null,
			statusText: r.status_text,
			responseText: r.response_text,
			cause: r.cause,
			classification: r.classification,
			streamed: r.streamed,
			count: Number(r.count),
		})),
		sampledErrors,
	});
});

// ── Ignored Error Matchers ──────────────────────────────────────────────────

const ignoredErrorMatcherSchema = z.object({
	id: z.string(),
	pattern: z.string().nullable(),
	statusCode: z.number().nullable(),
	createdAt: z.string(),
});

const ignoredErrorMatchersListSchema = z.object({
	matchers: z.array(ignoredErrorMatcherSchema),
});

function serializeIgnoredErrorMatcher(matcher: {
	id: string;
	pattern: string | null;
	statusCode: number | null;
	createdAt: Date;
}) {
	return {
		id: matcher.id,
		pattern: matcher.pattern,
		statusCode: matcher.statusCode,
		createdAt: matcher.createdAt.toISOString(),
	};
}

const getIgnoredErrorMatchers = createRoute({
	method: "get",
	path: "/unstable-mappings/ignored-errors",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: ignoredErrorMatchersListSchema.openapi({}),
				},
			},
			description:
				"Substring matchers for expected upstream errors ignored by the unstable mappings rankings.",
		},
	},
});

admin.openapi(getIgnoredErrorMatchers, async (c) => {
	const matchers = await listIgnoredErrorMatchers();
	return c.json({ matchers: matchers.map(serializeIgnoredErrorMatcher) });
});

const createIgnoredErrorMatcher = createRoute({
	method: "post",
	path: "/unstable-mappings/ignored-errors",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z
						.object({
							pattern: z.string().trim().min(1).max(500).nullish(),
							statusCode: z.number().int().min(100).max(599).nullish(),
						})
						.refine(
							(value) =>
								(value.pattern ?? null) !== null ||
								(value.statusCode ?? null) !== null,
							{ message: "Provide a pattern or a status code" },
						)
						.openapi({}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: ignoredErrorMatcherSchema.openapi({}),
				},
			},
			description: "Created ignored error matcher.",
		},
		409: {
			description:
				"A matcher with this pattern/status code combination already exists.",
		},
	},
});

admin.openapi(createIgnoredErrorMatcher, async (c) => {
	const { pattern, statusCode } = c.req.valid("json");

	const [created] = await db
		.insert(tables.ignoredErrorMatcher)
		.values({ pattern: pattern ?? null, statusCode: statusCode ?? null })
		.onConflictDoNothing()
		.returning();

	if (!created) {
		throw new HTTPException(409, {
			message:
				"A matcher with this pattern/status code combination already exists",
		});
	}

	return c.json(serializeIgnoredErrorMatcher(created), 201);
});

const deleteIgnoredErrorMatcher = createRoute({
	method: "delete",
	path: "/unstable-mappings/ignored-errors/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Ignored error matcher deleted.",
		},
		404: {
			description: "Matcher not found.",
		},
	},
});

admin.openapi(deleteIgnoredErrorMatcher, async (c) => {
	const { id } = c.req.valid("param");

	const deleted = await db
		.delete(tables.ignoredErrorMatcher)
		.where(eq(tables.ignoredErrorMatcher.id, id))
		.returning();

	if (deleted.length === 0) {
		throw new HTTPException(404, { message: "Matcher not found" });
	}

	return c.json({ success: true });
});

// ── Enterprise Contact Submissions ──────────────────────────────────────────

const contactSubmissionSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	name: z.string(),
	email: z.string(),
	country: z.string(),
	size: z.string(),
	deployment: z.enum(["self_host", "cloud", "not_sure"]).nullable(),
	message: z.string(),
	ipAddress: z.string().nullable(),
	userAgent: z.string().nullable(),
	spamFilterStatus: z.string(),
	rejectionReason: z.string().nullable(),
	archivedAt: z.string().nullable(),
});

const contactSubmissionsListSchema = z.object({
	submissions: z.array(contactSubmissionSchema),
	total: z.number(),
});

const contactSubmissionsSortBySchema = z.enum([
	"createdAt",
	"name",
	"email",
	"spamFilterStatus",
]);

const getContactSubmissions = createRoute({
	method: "get",
	path: "/contact-submissions",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			search: z.string().optional(),
			status: z
				.enum(["pending", "rejected", "delivered", "delivery_failed"])
				.optional(),
			sortBy: contactSubmissionsSortBySchema.default("createdAt").optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
			archived: z
				.enum(["true", "false"])
				.default("false")
				.transform((v) => v === "true")
				.optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: contactSubmissionsListSchema.openapi({}),
				},
			},
			description: "List of enterprise contact submissions.",
		},
	},
});

admin.openapi(getContactSubmissions, async (c) => {
	const {
		limit = 50,
		offset = 0,
		search,
		status,
		sortBy = "createdAt",
		sortOrder = "desc",
		archived = false,
	} = c.req.valid("query");

	const t = tables.enterpriseContactSubmission;

	const conditions = [];
	if (search) {
		conditions.push(
			or(
				sql`${t.name} ILIKE ${"%" + search + "%"}`,
				sql`${t.email} ILIKE ${"%" + search + "%"}`,
				sql`${t.message} ILIKE ${"%" + search + "%"}`,
			),
		);
	}
	if (status) {
		conditions.push(eq(t.spamFilterStatus, status));
	}
	conditions.push(archived ? isNotNull(t.archivedAt) : isNull(t.archivedAt));

	const where = and(...conditions);

	const sortColumn = {
		createdAt: t.createdAt,
		name: t.name,
		email: t.email,
		spamFilterStatus: t.spamFilterStatus,
	}[sortBy];

	const orderFn = sortOrder === "asc" ? asc : desc;

	const [submissions, countResult] = await Promise.all([
		db
			.select({
				id: t.id,
				createdAt: t.createdAt,
				name: t.name,
				email: t.email,
				country: t.country,
				size: t.size,
				deployment: t.deployment,
				message: t.message,
				ipAddress: t.ipAddress,
				userAgent: t.userAgent,
				spamFilterStatus: t.spamFilterStatus,
				rejectionReason: t.rejectionReason,
				archivedAt: t.archivedAt,
			})
			.from(t)
			.where(where)
			.orderBy(orderFn(sortColumn), asc(t.id))
			.limit(limit)
			.offset(offset),
		db
			.select({ count: sql<number>`COUNT(*)`.as("count") })
			.from(t)
			.where(where),
	]);

	return c.json({
		submissions: submissions.map((s) => ({
			...s,
			createdAt: s.createdAt.toISOString(),
			archivedAt: s.archivedAt?.toISOString() ?? null,
		})),
		total: Number(countResult[0]?.count ?? 0),
	});
});

// ── Single Contact Submission ───────────────────────────────────────────────

const getContactSubmission = createRoute({
	method: "get",
	path: "/contact-submissions/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: contactSubmissionSchema.openapi({}),
				},
			},
			description: "Single enterprise contact submission.",
		},
	},
});

admin.openapi(getContactSubmission, async (c) => {
	const { id } = c.req.valid("param");
	const t = tables.enterpriseContactSubmission;

	const rows = await db
		.select({
			id: t.id,
			createdAt: t.createdAt,
			name: t.name,
			email: t.email,
			country: t.country,
			size: t.size,
			deployment: t.deployment,
			message: t.message,
			ipAddress: t.ipAddress,
			userAgent: t.userAgent,
			spamFilterStatus: t.spamFilterStatus,
			rejectionReason: t.rejectionReason,
			archivedAt: t.archivedAt,
		})
		.from(t)
		.where(eq(t.id, id))
		.limit(1);

	const submission = rows[0];
	if (!submission) {
		throw new HTTPException(404, { message: "Submission not found" });
	}

	return c.json({
		...submission,
		createdAt: submission.createdAt.toISOString(),
		archivedAt: submission.archivedAt?.toISOString() ?? null,
	});
});

// ── Reply to Contact Submission ─────────────────────────────────────────────

const replyContactSubmission = createRoute({
	method: "post",
	path: "/contact-submissions/{id}/reply",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						subject: z.string().min(1),
						body: z.string().min(1),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({ success: z.boolean(), message: z.string() })
						.openapi({}),
				},
			},
			description: "Reply sent or failed.",
		},
	},
});

admin.openapi(replyContactSubmission, async (c) => {
	const { id } = c.req.valid("param");
	const { subject, body: emailBody } = c.req.valid("json");
	const t = tables.enterpriseContactSubmission;

	const rows = await db
		.select({ email: t.email })
		.from(t)
		.where(eq(t.id, id))
		.limit(1);

	const submission = rows[0];
	if (!submission) {
		throw new HTTPException(404, { message: "Submission not found" });
	}

	const { getResendClient, fromEmail, replyToEmail } =
		await import("@llmgateway/shared/email");

	const resend = getResendClient();
	if (!resend) {
		return c.json(
			{ success: false, message: "Email service is not configured." },
			200,
		);
	}

	const { error } = await resend.emails.send({
		from: fromEmail,
		to: [submission.email],
		replyTo: replyToEmail,
		subject,
		text: emailBody,
	});

	if (error) {
		return c.json(
			{ success: false, message: `Failed to send: ${error.message}` },
			200,
		);
	}

	return c.json({ success: true, message: "Reply sent successfully." });
});

// ── Send Email to Any User ──────────────────────────────────────────────────

const sendEmail = createRoute({
	method: "post",
	path: "/send-email",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						to: z.string().email(),
						subject: z.string().min(1),
						body: z.string().min(1),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z
						.object({ success: z.boolean(), message: z.string() })
						.openapi({}),
				},
			},
			description: "Email sent or failed.",
		},
	},
});

admin.openapi(sendEmail, async (c) => {
	const { to, subject, body: emailBody } = c.req.valid("json");

	const { getResendClient, fromEmail, replyToEmail } =
		await import("@llmgateway/shared/email");

	const resend = getResendClient();
	if (!resend) {
		return c.json(
			{ success: false, message: "Email service is not configured." },
			200,
		);
	}

	const { error } = await resend.emails.send({
		from: fromEmail,
		to: [to],
		replyTo: replyToEmail,
		subject,
		text: emailBody,
	});

	if (error) {
		return c.json(
			{ success: false, message: `Failed to send: ${error.message}` },
			200,
		);
	}

	return c.json({ success: true, message: "Email sent successfully." });
});

// ── Chat Support Logs ───────────────────────────────────────────────────────

const chatSupportConversationSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	name: z.string().nullable(),
	email: z.string().nullable(),
	ipAddress: z.string().nullable(),
	userAgent: z.string().nullable(),
	messageCount: z.number(),
	escalatedAt: z.string().nullable(),
	archivedAt: z.string().nullable(),
	resolvedAt: z.string().nullable(),
	rating: z.number().int().min(0).max(5).nullable(),
	firstMessage: z.string().nullable(),
});

const chatSupportConversationsListSchema = z.object({
	conversations: z.array(chatSupportConversationSchema),
	total: z.number(),
});

const chatSupportMessageSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	role: z.string(),
	content: z.string(),
	sequence: z.number(),
	reaction: z.enum(["like", "dislike"]).nullable(),
});

const chatSupportConversationDetailSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	name: z.string().nullable(),
	email: z.string().nullable(),
	ipAddress: z.string().nullable(),
	userAgent: z.string().nullable(),
	messageCount: z.number(),
	escalatedAt: z.string().nullable(),
	archivedAt: z.string().nullable(),
	resolvedAt: z.string().nullable(),
	rating: z.number().int().min(0).max(5).nullable(),
	organizationId: z.string().nullable(),
	organizationName: z.string().nullable(),
	messages: z.array(chatSupportMessageSchema),
});

const chatSupportStatsSchema = z.object({
	totalRatings: z.number(),
	averageRating: z.number().nullable(),
	ratingDistribution: z.record(z.string(), z.number()),
	resolvedCount: z.number(),
	likes: z.number(),
	dislikes: z.number(),
});

const getChatSupportConversations = createRoute({
	method: "get",
	path: "/chat-support-logs",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			search: z.string().optional(),
			archived: z
				.enum(["true", "false"])
				.default("false")
				.transform((v) => v === "true")
				.optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: chatSupportConversationsListSchema.openapi({}),
				},
			},
			description: "List of chat support conversations.",
		},
	},
});

admin.openapi(getChatSupportConversations, async (c) => {
	const {
		limit = 50,
		offset = 0,
		search,
		archived = false,
	} = c.req.valid("query");

	const t = tables.chatSupportConversation;
	const mt = tables.chatSupportMessage;

	const conditions = [];
	if (search) {
		const matchingConvIds = db
			.select({ conversationId: mt.conversationId })
			.from(mt)
			.where(sql`${mt.content} ILIKE ${"%" + search + "%"}`)
			.groupBy(mt.conversationId);
		conditions.push(sql`${t.id} IN (${matchingConvIds})`);
	}
	conditions.push(archived ? isNotNull(t.archivedAt) : isNull(t.archivedAt));

	const where = and(...conditions);

	const firstMessageSubquery = db
		.selectDistinctOn([mt.conversationId], {
			conversationId: mt.conversationId,
			content: mt.content,
		})
		.from(mt)
		.orderBy(mt.conversationId, asc(mt.sequence))
		.as("first_msg");

	const [conversations, countResult] = await Promise.all([
		db
			.select({
				id: t.id,
				createdAt: t.createdAt,
				updatedAt: t.updatedAt,
				name: t.name,
				email: t.email,
				ipAddress: t.ipAddress,
				userAgent: t.userAgent,
				messageCount: t.messageCount,
				escalatedAt: t.escalatedAt,
				archivedAt: t.archivedAt,
				resolvedAt: t.resolvedAt,
				rating: t.rating,
				firstMessage: firstMessageSubquery.content,
			})
			.from(t)
			.leftJoin(
				firstMessageSubquery,
				eq(t.id, firstMessageSubquery.conversationId),
			)
			.where(where)
			.orderBy(desc(t.createdAt))
			.limit(limit)
			.offset(offset),
		db
			.select({ count: sql<number>`COUNT(*)`.as("count") })
			.from(t)
			.where(where),
	]);

	return c.json({
		conversations: conversations.map((conv) => ({
			...conv,
			createdAt: conv.createdAt.toISOString(),
			updatedAt: conv.updatedAt.toISOString(),
			escalatedAt: conv.escalatedAt?.toISOString() ?? null,
			archivedAt: conv.archivedAt?.toISOString() ?? null,
			resolvedAt: conv.resolvedAt?.toISOString() ?? null,
			rating: conv.rating ?? null,
			firstMessage: conv.firstMessage ?? null,
		})),
		total: Number(countResult[0]?.count ?? 0),
	});
});

const getChatSupportStats = createRoute({
	method: "get",
	path: "/chat-support-logs/stats",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: chatSupportStatsSchema.openapi({}),
				},
			},
			description: "Aggregate ratings and feedback across all conversations.",
		},
	},
});

admin.openapi(getChatSupportStats, async (c) => {
	const t = tables.chatSupportConversation;
	const mt = tables.chatSupportMessage;

	const [ratingRows, reactionRows] = await Promise.all([
		db
			.select({ rating: t.rating, count: sql<number>`COUNT(*)`.as("count") })
			.from(t)
			.where(isNotNull(t.rating))
			.groupBy(t.rating),
		db
			.select({
				reaction: mt.reaction,
				count: sql<number>`COUNT(*)`.as("count"),
			})
			.from(mt)
			.where(isNotNull(mt.reaction))
			.groupBy(mt.reaction),
	]);

	const ratingDistribution: Record<string, number> = {};
	let totalRatings = 0;
	let ratingSum = 0;
	for (const row of ratingRows) {
		const rating = row.rating ?? 0;
		const count = Number(row.count);
		ratingDistribution[String(rating)] = count;
		totalRatings += count;
		ratingSum += rating * count;
	}

	let likes = 0;
	let dislikes = 0;
	for (const row of reactionRows) {
		if (row.reaction === "like") {
			likes = Number(row.count);
		} else if (row.reaction === "dislike") {
			dislikes = Number(row.count);
		}
	}

	const [resolvedResult] = await db
		.select({ count: sql<number>`COUNT(*)`.as("count") })
		.from(t)
		.where(isNotNull(t.resolvedAt));

	return c.json({
		totalRatings,
		averageRating: totalRatings > 0 ? ratingSum / totalRatings : null,
		ratingDistribution,
		resolvedCount: Number(resolvedResult?.count ?? 0),
		likes,
		dislikes,
	});
});

const getChatSupportReadStatuses = createRoute({
	method: "get",
	path: "/chat-support-logs/read-statuses",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						readStatuses: z.record(z.string(), z.number()),
					}),
				},
			},
			description:
				"Map of conversationId to lastReadMessageCount for the current admin.",
		},
	},
});

admin.openapi(getChatSupportReadStatuses, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const rt = tables.chatSupportReadStatus;
	const rows = await db
		.select({
			conversationId: rt.conversationId,
			lastReadMessageCount: rt.lastReadMessageCount,
		})
		.from(rt)
		.where(eq(rt.adminUserId, user.id));

	const readStatuses: Record<string, number> = {};
	for (const row of rows) {
		readStatuses[row.conversationId] = row.lastReadMessageCount;
	}

	return c.json({ readStatuses });
});

const getChatSupportConversation = createRoute({
	method: "get",
	path: "/chat-support-logs/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: chatSupportConversationDetailSchema.openapi({}),
				},
			},
			description: "Single chat support conversation with messages.",
		},
		404: {
			description: "Conversation not found.",
		},
	},
});

admin.openapi(getChatSupportConversation, async (c) => {
	const { id } = c.req.valid("param");

	const t = tables.chatSupportConversation;
	const mt = tables.chatSupportMessage;

	const rows = await db
		.select({
			id: t.id,
			createdAt: t.createdAt,
			updatedAt: t.updatedAt,
			name: t.name,
			email: t.email,
			ipAddress: t.ipAddress,
			userAgent: t.userAgent,
			messageCount: t.messageCount,
			escalatedAt: t.escalatedAt,
			archivedAt: t.archivedAt,
			resolvedAt: t.resolvedAt,
			rating: t.rating,
		})
		.from(t)
		.where(eq(t.id, id))
		.limit(1);

	const conversation = rows[0];
	if (!conversation) {
		throw new HTTPException(404, { message: "Conversation not found" });
	}

	const messages = await db
		.select({
			id: mt.id,
			createdAt: mt.createdAt,
			role: mt.role,
			content: mt.content,
			sequence: mt.sequence,
			reaction: mt.reaction,
		})
		.from(mt)
		.where(eq(mt.conversationId, id))
		.orderBy(asc(mt.sequence));

	// Best-effort link to the visitor's organization so admins can jump straight
	// to their account. Matched by email; owners are preferred when a visitor
	// belongs to more than one org.
	let organizationId: string | null = null;
	let organizationName: string | null = null;
	if (conversation.email) {
		const orgRows = await db
			.select({
				id: tables.organization.id,
				name: tables.organization.name,
			})
			.from(tables.user)
			.innerJoin(
				tables.userOrganization,
				eq(tables.userOrganization.userId, tables.user.id),
			)
			.innerJoin(
				tables.organization,
				eq(tables.organization.id, tables.userOrganization.organizationId),
			)
			.where(sql`LOWER(${tables.user.email}) = LOWER(${conversation.email})`)
			.orderBy(
				sql`CASE ${tables.userOrganization.role} WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END`,
				asc(tables.userOrganization.createdAt),
			)
			.limit(1);
		if (orgRows[0]) {
			organizationId = orgRows[0].id;
			organizationName = orgRows[0].name;
		}
	}

	return c.json({
		...conversation,
		createdAt: conversation.createdAt.toISOString(),
		updatedAt: conversation.updatedAt.toISOString(),
		escalatedAt: conversation.escalatedAt?.toISOString() ?? null,
		archivedAt: conversation.archivedAt?.toISOString() ?? null,
		resolvedAt: conversation.resolvedAt?.toISOString() ?? null,
		rating: conversation.rating ?? null,
		organizationId,
		organizationName,
		messages: messages.map((m) => ({
			...m,
			createdAt: m.createdAt.toISOString(),
		})),
	});
});

// ── Chat Support Reply ─��────────────────────────────────────────────────────

const replyChatSupportConversation = createRoute({
	method: "post",
	path: "/chat-support-logs/{id}/reply",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						content: z.string().min(1),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						success: z.boolean(),
						message: z.string(),
					}),
				},
			},
			description: "Reply sent successfully.",
		},
		404: {
			description: "Conversation not found.",
		},
	},
});

admin.openapi(replyChatSupportConversation, async (c) => {
	const { id } = c.req.valid("param");
	const { content } = c.req.valid("json");

	const t = tables.chatSupportConversation;
	const mt = tables.chatSupportMessage;

	const rows = await db
		.select({
			id: t.id,
			name: t.name,
			email: t.email,
		})
		.from(t)
		.where(eq(t.id, id))
		.limit(1);

	const conversation = rows[0];
	if (!conversation) {
		throw new HTTPException(404, { message: "Conversation not found" });
	}

	await db.transaction(async (tx) => {
		const [updated] = await tx
			.update(t)
			.set({ messageCount: sql`${t.messageCount} + 1` })
			.where(eq(t.id, id))
			.returning({ messageCount: t.messageCount });

		const nextSequence = (updated?.messageCount ?? 1) - 1;

		await tx.insert(mt).values({
			conversationId: id,
			role: "admin",
			content,
			sequence: nextSequence,
		});
	});

	if (conversation.email) {
		const resend = getResendClient();
		if (!resend) {
			return c.json(
				{ success: false, message: "Email service is not configured." },
				200,
			);
		}

		const escapedName = conversation.name ? escapeHtml(conversation.name) : "";
		const escapedContent = escapeHtml(content);

		const { error } = await resend.emails.send({
			from: fromEmail,
			to: [conversation.email],
			replyTo: replyToEmail,
			subject: `Reply to your support conversation — LLM Gateway`,
			html: `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#fff;">
<table role="presentation" style="width:100%;border-collapse:collapse;">
<tr><td align="center" style="padding:40px 20px;">
<table role="presentation" style="max-width:600px;width:100%;border-collapse:collapse;">
<tr><td style="background-color:#000;padding:30px;text-align:center;border-radius:8px 8px 0 0;">
<h1 style="margin:0;color:#fff;font-size:22px;font-weight:600;">LLM Gateway Support</h1>
</td></tr>
<tr><td style="background-color:#f8f9fa;padding:30px;border-radius:0 0 8px 8px;">
<p style="margin:0 0 15px;font-size:16px;color:#333;">Hi${escapedName ? ` ${escapedName}` : ""},</p>
<p style="margin:0 0 15px;font-size:16px;color:#333;">Our team has replied to your support conversation:</p>
<div style="background:#fff;border:1px solid #e9ecef;border-radius:6px;padding:15px;font-size:14px;line-height:1.6;color:#333;white-space:pre-wrap;">${escapedContent}</div>
<p style="margin:20px 0 0;font-size:14px;color:#666;">If you need further help, just reply to this email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`.trim(),
		});

		if (error) {
			return c.json(
				{ success: false, message: `Failed to send: ${error.message}` },
				200,
			);
		}
	}

	return c.json({ success: true, message: "Reply sent successfully." });
});

// ── Chat Support Read Status ──────────────────────────────────────────────────

const markChatSupportRead = createRoute({
	method: "post",
	path: "/chat-support-logs/{id}/read",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						messageCount: z.number().int().min(0),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Conversation marked as read.",
		},
	},
});

admin.openapi(markChatSupportRead, async (c) => {
	const { id } = c.req.valid("param");
	const { messageCount } = c.req.valid("json");
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const rt = tables.chatSupportReadStatus;

	const existing = await db
		.select({ id: rt.id })
		.from(rt)
		.where(and(eq(rt.conversationId, id), eq(rt.adminUserId, user.id)))
		.limit(1);

	if (existing.length > 0) {
		await db
			.update(rt)
			.set({
				lastReadMessageCount: sql<number>`GREATEST(${rt.lastReadMessageCount}, ${messageCount})`,
				readAt: sql<Date>`CASE WHEN ${messageCount} >= ${rt.lastReadMessageCount} THEN NOW() ELSE ${rt.readAt} END`,
			})
			.where(eq(rt.id, existing[0]!.id));
	} else {
		await db.insert(rt).values({
			conversationId: id,
			adminUserId: user.id,
			lastReadMessageCount: messageCount,
		});
	}

	return c.json({ success: true });
});

// ── Delete Chat Support Conversation ──────────────────────────────────────────

const deleteChatSupportConversation = createRoute({
	method: "delete",
	path: "/chat-support-logs/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Conversation deleted.",
		},
		404: {
			description: "Conversation not found.",
		},
	},
});

admin.openapi(deleteChatSupportConversation, async (c) => {
	const { id } = c.req.valid("param");

	const existing = await db.query.chatSupportConversation.findFirst({
		where: { id: { eq: id } },
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Conversation not found" });
	}

	await db
		.delete(tables.chatSupportConversation)
		.where(eq(tables.chatSupportConversation.id, id));

	return c.json({ success: true });
});

// ── Bulk Delete Chat Support Conversations ────────────────────────────────────

const bulkDeleteChatSupportConversations = createRoute({
	method: "post",
	path: "/chat-support-logs/bulk-delete",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						ids: z.array(z.string()).min(1).max(100),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ deletedCount: z.number() }).openapi({}),
				},
			},
			description: "Conversations deleted.",
		},
	},
});

admin.openapi(bulkDeleteChatSupportConversations, async (c) => {
	const { ids } = c.req.valid("json");

	const deleted = await db
		.delete(tables.chatSupportConversation)
		.where(inArray(tables.chatSupportConversation.id, ids))
		.returning({ id: tables.chatSupportConversation.id });

	return c.json({ deletedCount: deleted.length });
});

// ── Delete Contact Submission ─────────────────────────────────────────────────

const deleteContactSubmission = createRoute({
	method: "delete",
	path: "/contact-submissions/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Submission deleted.",
		},
		404: {
			description: "Submission not found.",
		},
	},
});

admin.openapi(deleteContactSubmission, async (c) => {
	const { id } = c.req.valid("param");

	const existing = await db.query.enterpriseContactSubmission.findFirst({
		where: { id: { eq: id } },
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Submission not found" });
	}

	await db
		.delete(tables.enterpriseContactSubmission)
		.where(eq(tables.enterpriseContactSubmission.id, id));

	return c.json({ success: true });
});

// ── Archive Contact Submission ────────────────────────────────────────────────

const archiveContactSubmission = createRoute({
	method: "patch",
	path: "/contact-submissions/{id}/archive",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ archived: z.boolean() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Submission archived/unarchived.",
		},
		404: {
			description: "Submission not found.",
		},
	},
});

admin.openapi(archiveContactSubmission, async (c) => {
	const { id } = c.req.valid("param");
	const { archived } = c.req.valid("json");

	const rows = await db
		.update(tables.enterpriseContactSubmission)
		.set({ archivedAt: archived ? new Date() : null })
		.where(eq(tables.enterpriseContactSubmission.id, id))
		.returning();

	if (rows.length === 0) {
		throw new HTTPException(404, { message: "Submission not found" });
	}

	return c.json({ success: true });
});

// ── Provider Listing Requests ─────────────────────────────────────────────────

const providerListingRequestSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	providerName: z.string(),
	email: z.string(),
	url: z.string(),
	termsUrl: z.string().nullable(),
	privacyUrl: z.string().nullable(),
	statusPageUrl: z.string().nullable(),
	country: z.string(),
	complianceSoc2Type2: z.boolean(),
	complianceIso27001: z.boolean(),
	complianceGdpr: z.boolean(),
	dataRetentionDays: z.number().nullable(),
	trainsOnData: z.boolean().nullable(),
	paymentStatus: z.enum(["unpaid", "paid", "refunded"]),
	paidAt: z.string().nullable(),
	ipAddress: z.string().nullable(),
	userAgent: z.string().nullable(),
	spamFilterStatus: z.string(),
	rejectionReason: z.string().nullable(),
	archivedAt: z.string().nullable(),
});

const providerListingRequestsListSchema = z.object({
	requests: z.array(providerListingRequestSchema),
	total: z.number(),
});

const providerListingRequestsSortBySchema = z.enum([
	"createdAt",
	"providerName",
	"email",
	"spamFilterStatus",
]);

const getProviderListingRequests = createRoute({
	method: "get",
	path: "/provider-listing-requests",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			search: z.string().optional(),
			status: z
				.enum(["pending", "rejected", "delivered", "delivery_failed"])
				.optional(),
			sortBy: providerListingRequestsSortBySchema
				.default("createdAt")
				.optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
			archived: z
				.enum(["true", "false"])
				.default("false")
				.transform((v) => v === "true")
				.optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: providerListingRequestsListSchema.openapi({}),
				},
			},
			description: "List of provider listing requests.",
		},
	},
});

admin.openapi(getProviderListingRequests, async (c) => {
	const {
		limit = 50,
		offset = 0,
		search,
		status,
		sortBy = "createdAt",
		sortOrder = "desc",
		archived = false,
	} = c.req.valid("query");

	const t = tables.providerListingRequest;

	const conditions = [];
	if (search) {
		conditions.push(
			or(
				sql`${t.providerName} ILIKE ${"%" + search + "%"}`,
				sql`${t.email} ILIKE ${"%" + search + "%"}`,
				sql`${t.url} ILIKE ${"%" + search + "%"}`,
				sql`${t.country} ILIKE ${"%" + search + "%"}`,
			),
		);
	}
	if (status) {
		conditions.push(eq(t.spamFilterStatus, status));
	}
	conditions.push(archived ? isNotNull(t.archivedAt) : isNull(t.archivedAt));

	const where = and(...conditions);

	const sortColumn = {
		createdAt: t.createdAt,
		providerName: t.providerName,
		email: t.email,
		spamFilterStatus: t.spamFilterStatus,
	}[sortBy];

	const orderFn = sortOrder === "asc" ? asc : desc;

	const [requests, countResult] = await Promise.all([
		db
			.select({
				id: t.id,
				createdAt: t.createdAt,
				providerName: t.providerName,
				email: t.email,
				url: t.url,
				termsUrl: t.termsUrl,
				privacyUrl: t.privacyUrl,
				statusPageUrl: t.statusPageUrl,
				country: t.country,
				complianceSoc2Type2: t.complianceSoc2Type2,
				complianceIso27001: t.complianceIso27001,
				complianceGdpr: t.complianceGdpr,
				dataRetentionDays: t.dataRetentionDays,
				trainsOnData: t.trainsOnData,
				paymentStatus: t.paymentStatus,
				paidAt: t.paidAt,
				ipAddress: t.ipAddress,
				userAgent: t.userAgent,
				spamFilterStatus: t.spamFilterStatus,
				rejectionReason: t.rejectionReason,
				archivedAt: t.archivedAt,
			})
			.from(t)
			.where(where)
			.orderBy(orderFn(sortColumn), asc(t.id))
			.limit(limit)
			.offset(offset),
		db
			.select({ count: sql<number>`COUNT(*)`.as("count") })
			.from(t)
			.where(where),
	]);

	return c.json({
		requests: requests.map((r) => ({
			...r,
			createdAt: r.createdAt.toISOString(),
			paidAt: r.paidAt?.toISOString() ?? null,
			archivedAt: r.archivedAt?.toISOString() ?? null,
		})),
		total: Number(countResult[0]?.count ?? 0),
	});
});

const getProviderListingRequest = createRoute({
	method: "get",
	path: "/provider-listing-requests/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: providerListingRequestSchema.openapi({}),
				},
			},
			description: "Single provider listing request.",
		},
	},
});

admin.openapi(getProviderListingRequest, async (c) => {
	const { id } = c.req.valid("param");
	const t = tables.providerListingRequest;

	const rows = await db
		.select({
			id: t.id,
			createdAt: t.createdAt,
			providerName: t.providerName,
			email: t.email,
			url: t.url,
			termsUrl: t.termsUrl,
			privacyUrl: t.privacyUrl,
			statusPageUrl: t.statusPageUrl,
			country: t.country,
			complianceSoc2Type2: t.complianceSoc2Type2,
			complianceIso27001: t.complianceIso27001,
			complianceGdpr: t.complianceGdpr,
			dataRetentionDays: t.dataRetentionDays,
			trainsOnData: t.trainsOnData,
			paymentStatus: t.paymentStatus,
			paidAt: t.paidAt,
			ipAddress: t.ipAddress,
			userAgent: t.userAgent,
			spamFilterStatus: t.spamFilterStatus,
			rejectionReason: t.rejectionReason,
			archivedAt: t.archivedAt,
		})
		.from(t)
		.where(eq(t.id, id))
		.limit(1);

	const request = rows[0];
	if (!request) {
		throw new HTTPException(404, { message: "Request not found" });
	}

	return c.json({
		...request,
		createdAt: request.createdAt.toISOString(),
		paidAt: request.paidAt?.toISOString() ?? null,
		archivedAt: request.archivedAt?.toISOString() ?? null,
	});
});

const deleteProviderListingRequest = createRoute({
	method: "delete",
	path: "/provider-listing-requests/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Request deleted.",
		},
		404: {
			description: "Request not found.",
		},
	},
});

admin.openapi(deleteProviderListingRequest, async (c) => {
	const { id } = c.req.valid("param");

	const existing = await db.query.providerListingRequest.findFirst({
		where: { id: { eq: id } },
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Request not found" });
	}

	await db
		.delete(tables.providerListingRequest)
		.where(eq(tables.providerListingRequest.id, id));

	return c.json({ success: true });
});

const archiveProviderListingRequest = createRoute({
	method: "patch",
	path: "/provider-listing-requests/{id}/archive",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ archived: z.boolean() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Request archived/unarchived.",
		},
		404: {
			description: "Request not found.",
		},
	},
});

admin.openapi(archiveProviderListingRequest, async (c) => {
	const { id } = c.req.valid("param");
	const { archived } = c.req.valid("json");

	const rows = await db
		.update(tables.providerListingRequest)
		.set({ archivedAt: archived ? new Date() : null })
		.where(eq(tables.providerListingRequest.id, id))
		.returning();

	if (rows.length === 0) {
		throw new HTTPException(404, { message: "Request not found" });
	}

	return c.json({ success: true });
});

// ── Archive Chat Support Conversation ────────────────────────────────────────

const archiveChatSupportConversation = createRoute({
	method: "patch",
	path: "/chat-support-logs/{id}/archive",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({ archived: z.boolean() }),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }).openapi({}),
				},
			},
			description: "Conversation archived/unarchived.",
		},
		404: {
			description: "Conversation not found.",
		},
	},
});

admin.openapi(archiveChatSupportConversation, async (c) => {
	const { id } = c.req.valid("param");
	const { archived } = c.req.valid("json");

	const rows = await db
		.update(tables.chatSupportConversation)
		.set({ archivedAt: archived ? new Date() : null })
		.where(eq(tables.chatSupportConversation.id, id))
		.returning();

	if (rows.length === 0) {
		throw new HTTPException(404, { message: "Conversation not found" });
	}

	return c.json({ success: true });
});

// ─── Payment Failures ─────────────────────────────────────────────────────────

const paymentFailureSchema = z.object({
	id: z.string(),
	createdAt: z.string().datetime(),
	organizationId: z.string(),
	userEmail: z.string().nullable(),
	amount: z.string().nullable(),
	currency: z.string(),
	declineCode: z.string().nullable(),
	errorCode: z.string().nullable(),
	failureMessage: z.string().nullable(),
	stripePaymentIntentId: z.string().nullable(),
	source: z.string().nullable(),
});

const getPaymentFailures = createRoute({
	method: "get",
	path: "/payment-failures",
	request: {
		query: z.object({
			days: z.coerce.number().int().min(1).max(365).optional(),
			declineCode: z.string().optional(),
			search: z.string().optional(),
			limit: z.coerce.number().int().min(1).max(200).optional(),
			offset: z.coerce.number().int().min(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						failures: z.array(
							paymentFailureSchema.extend({
								organizationName: z.string(),
								billingEmail: z.string(),
							}),
						),
						summary: z.object({
							total7d: z.number(),
							total30d: z.number(),
							byDeclineCode: z.array(
								z.object({
									declineCode: z.string().nullable(),
									count: z.number(),
								}),
							),
						}),
						totalCount: z.number(),
					}),
				},
			},
			description: "Payment failures retrieved successfully",
		},
	},
});

admin.openapi(getPaymentFailures, async (c) => {
	const {
		days = 30,
		declineCode,
		search,
		limit: limitNum = 50,
		offset: offsetNum = 0,
	} = c.req.valid("query");

	const MS_PER_DAY = 24 * 60 * 60 * 1000;
	// eslint-disable-next-line no-mixed-operators
	const sinceDate = new Date(Date.now() - days * MS_PER_DAY);
	// eslint-disable-next-line no-mixed-operators
	const since7d = new Date(Date.now() - 7 * MS_PER_DAY);
	// eslint-disable-next-line no-mixed-operators
	const since30d = new Date(Date.now() - 30 * MS_PER_DAY);

	// Base conditions reference only paymentFailure columns (safe without JOIN)
	const baseConditions = [gte(tables.paymentFailure.createdAt, sinceDate)];

	if (declineCode) {
		baseConditions.push(eq(tables.paymentFailure.declineCode, declineCode));
	}

	// Search condition requires the org JOIN (checks both userEmail and billingEmail)
	const searchCondition = search
		? sql`(${tables.paymentFailure.userEmail} ILIKE ${"%" + search + "%"} OR ${tables.organization.billingEmail} ILIKE ${"%" + search + "%"})`
		: undefined;

	const failures = await db
		.select({
			id: tables.paymentFailure.id,
			createdAt: tables.paymentFailure.createdAt,
			organizationId: tables.paymentFailure.organizationId,
			userEmail: tables.paymentFailure.userEmail,
			amount: tables.paymentFailure.amount,
			currency: tables.paymentFailure.currency,
			declineCode: tables.paymentFailure.declineCode,
			errorCode: tables.paymentFailure.errorCode,
			failureMessage: tables.paymentFailure.failureMessage,
			stripePaymentIntentId: tables.paymentFailure.stripePaymentIntentId,
			source: tables.paymentFailure.source,
			organizationName: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
		})
		.from(tables.paymentFailure)
		.innerJoin(
			tables.organization,
			eq(tables.organization.id, tables.paymentFailure.organizationId),
		)
		.where(and(...baseConditions, searchCondition))
		.orderBy(desc(tables.paymentFailure.createdAt))
		.limit(limitNum)
		.offset(offsetNum);

	// Summary counts
	const [count7dResult] = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(tables.paymentFailure)
		.where(gte(tables.paymentFailure.createdAt, since7d));

	const [count30dResult] = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(tables.paymentFailure)
		.where(gte(tables.paymentFailure.createdAt, since30d));

	const byDeclineCode = await db
		.select({
			declineCode: tables.paymentFailure.declineCode,
			count: sql<number>`COUNT(*)`,
		})
		.from(tables.paymentFailure)
		.where(gte(tables.paymentFailure.createdAt, since30d))
		.groupBy(tables.paymentFailure.declineCode)
		.orderBy(sql`COUNT(*) DESC`);

	// totalCount needs the JOIN when search references org columns
	const totalCountQuery = db
		.select({ count: sql<number>`COUNT(*)` })
		.from(tables.paymentFailure);

	if (searchCondition) {
		totalCountQuery.innerJoin(
			tables.organization,
			eq(tables.organization.id, tables.paymentFailure.organizationId),
		);
	}

	const [totalCountResult] = await totalCountQuery.where(
		and(...baseConditions, searchCondition),
	);

	return c.json({
		failures,
		summary: {
			total7d: Number(count7dResult?.count ?? 0),
			total30d: Number(count30dResult?.count ?? 0),
			byDeclineCode: byDeclineCode.map((r) => ({
				declineCode: r.declineCode,
				count: Number(r.count),
			})),
		},
		totalCount: Number(totalCountResult?.count ?? 0),
	});
});

// =============================================================================
// DevPass admin routes
// =============================================================================

const devpassTierSchema = z.enum(["lite", "pro", "max", "none"]);
const devpassStatusSchema = z.enum([
	"active",
	"cancelled_pending",
	"expired",
	"churned",
]);

const devpassSubscriberSchema = z.object({
	id: z.string(),
	name: z.string(),
	billingEmail: z.string(),
	ownerUserId: z.string().nullable(),
	ownerName: z.string().nullable(),
	ownerEmail: z.string().nullable(),
	ownerUsername: z.string().nullable(),
	tier: devpassTierSchema,
	pendingTier: devpassTierSchema.nullable(),
	status: devpassStatusSchema,
	hasPaymentIssue: z.boolean(),
	creditsUsed: z.string(),
	creditsLimit: z.string(),
	premiumCreditsUsed: z.string(),
	premiumCreditsLimit: z.string(),
	premiumWeekStart: z.string().nullable(),
	utilizationPct: z.number().nullable(),
	cycleStart: z.string().nullable(),
	cycleDaysIn: z.number().nullable(),
	expiresAt: z.string().nullable(),
	cancelled: z.boolean(),
	mrr: z.number(),
	realCost: z.number(),
	// PAYG overflow state (opt-in): overflow usage is funded by the org's own
	// credit top-ups, so it is split out of the plan-margin math below.
	paygEnabled: z.boolean(),
	paygBalance: z.string(),
	autoTopUpEnabled: z.boolean(),
	// All-time gross `credit_topup` dollars charged (Stripe amount incl fees).
	allTimeTopUps: z.number(),
	// Cycle cost paid from the org's own credits rather than the plan pool:
	// realCost minus the pool draw (devPlanCreditsUsed), floored at 0.
	cycleOverflowCost: z.number(),
	// Plan economics only: tier price minus the pool-funded share of realCost;
	// overflow cost is excluded because its funding (top-ups) is not plan revenue.
	margin: z.number(),
	marginPct: z.number().nullable(),
	allTimeRevenue: z.number(),
	allTimeCost: z.number(),
	allTimeMargin: z.number(),
	subscribedSince: z.string().nullable(),
	tierChanges: z.number(),
	lastPaymentFailureAt: z.string().nullable(),
	createdAt: z.string(),
});

const devpassKpisSchema = z.object({
	activeByTier: z.object({
		lite: z.number(),
		pro: z.number(),
		max: z.number(),
	}),
	totalSubscribers: z.number(),
	totalSubscribersExcludingRefunded: z.number(),
	grossSubscriptionRevenue: z.number(),
	subscriptionRevenueExcludingRefunds: z.number(),
	totalActive: z.number(),
	cancelledPending: z.number(),
	churned: z.number(),
	grossMrr: z.number(),
	committedMrr: z.number(),
	startsThisMonth: z.number(),
	endsThisMonth: z.number(),
	netNewThisMonth: z.number(),
	refundsThisMonth: z.number(),
	refundedAmountThisMonth: z.number(),
	resetPassesSold: z.number(),
	resetPassRevenue: z.number(),
	// PAYG overflow adoption + monetization across active subscribers.
	paygOptedIn: z.number(),
	// Sum of credits balances held by active subscribers (deferred revenue —
	// top-ups charged but not yet spent on overflow usage).
	paygBalanceHeld: z.number(),
	topupRevenueThisMonth: z.number(),
	topupRevenueAllTime: z.number(),
	// Cycle cost across the universe that was paid from org credit balances
	// (not the plan pools); already excluded from totalMargin.
	totalOverflowCostCycle: z.number(),
	weightedAvgUtilization: z.number(),
	totalRealCostCycle: z.number(),
	totalMrrCycle: z.number(),
	totalMargin: z.number(),
	marginPct: z.number().nullable(),
});

const devpassListSchema = z.object({
	subscribers: z.array(devpassSubscriberSchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
});

const devpassSortBySchema = z.enum([
	"name",
	"billingEmail",
	"tier",
	"createdAt",
	"cycleStart",
	"expiresAt",
	"subscribedSince",
	"utilizationPct",
	"realCost",
	"margin",
	"mrr",
	"creditsUsed",
	"paygBalance",
	"allTimeTopUps",
	"allTimeRevenue",
	"allTimeCost",
	"allTimeMargin",
]);

const devpassUtilizationSchema = z.enum(["low", "healthy", "high", "over"]);

const getDevpassSubscribers = createRoute({
	method: "get",
	path: "/devpass",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			search: z.string().optional(),
			tier: devpassTierSchema.optional(),
			status: devpassStatusSchema.optional(),
			utilization: devpassUtilizationSchema.optional(),
			marginNegative: z.coerce.boolean().optional(),
			showChurned: z.coerce.boolean().default(false).optional(),
			sortBy: devpassSortBySchema.default("subscribedSince").optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: devpassListSchema.openapi({}),
				},
			},
			description: "List of DevPass subscribers.",
		},
	},
});

// Split out of the list endpoint: the KPI strip aggregates the whole
// subscriber universe and is far slower than one page of rows, so the admin
// page loads the two independently instead of blocking on the sum.
const getDevpassKpis = createRoute({
	method: "get",
	path: "/devpass/kpis",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: devpassKpisSchema.openapi({}),
				},
			},
			description: "DevPass KPI strip across the whole subscriber universe.",
		},
	},
});

const devpassTransactionSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	type: z.string(),
	amount: z.string().nullable(),
	creditAmount: z.string().nullable(),
	currency: z.string(),
	status: z.string(),
	description: z.string().nullable(),
	// The payment a refund reverses, so the two rows can be tied together in
	// the panel. Null on everything else.
	relatedTransactionId: z.string().nullable(),
	// Whether an admin can refund this payment, and how much of it is left.
	// `refundIneligibleReason` is null when `refundable` is true.
	refundable: z.boolean(),
	refundIneligibleReason: z.string().nullable(),
	refundedAmount: z.string(),
	refundableAmount: z.string(),
});

const devpassPaymentFailureSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	amount: z.string().nullable(),
	currency: z.string(),
	declineCode: z.string().nullable(),
	failureMessage: z.string().nullable(),
	source: z.string().nullable(),
});

const devpassResetPassesSchema = z.object({
	lite: z.number(),
	pro: z.number(),
	max: z.number(),
	includedRemaining: z.number(),
});

const devpassDetailSchema = z.object({
	subscriber: devpassSubscriberSchema,
	resetPasses: devpassResetPassesSchema,
	transactions: z.array(devpassTransactionSchema),
	paymentFailures: z.array(devpassPaymentFailureSchema),
});

const getDevpassSubscriber = createRoute({
	method: "get",
	path: "/devpass/{orgId}",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: devpassDetailSchema.openapi({}),
				},
			},
			description: "DevPass subscriber detail.",
		},
		404: {
			description: "Subscriber not found.",
		},
	},
});

// Gift Reset Passes to a DevPass subscriber. Increments the tier-bound
// purchased-pass inventory, so gifted passes behave exactly like bought ones:
// redeemable only while the org is on that tier, surviving plan changes.
const giftResetPassesRoute = createRoute({
	method: "post",
	path: "/devpass/{orgId}/gift-reset-passes",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						tier: z.enum(["lite", "pro", "max"]),
						count: z.number().int().min(1).max(10),
						comment: z.string().max(500).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						resetPasses: z.object({
							lite: z.number(),
							pro: z.number(),
							max: z.number(),
						}),
					}),
				},
			},
			description: "Reset Passes gifted successfully.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Subscriber not found.",
		},
	},
});

// Refund a DevPass payment on behalf of the subscriber. The Stripe refund is
// all this does directly: the `charge.refunded` webhook records the
// `credit_refund` row, deducts top-up credits, claws back an unused Reset Pass,
// and cancels the subscription when a plan payment is refunded in full.
const refundDevpassPaymentRoute = createRoute({
	method: "post",
	path: "/devpass/{orgId}/refund",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						transactionId: z.string(),
						// Omit for a full refund of whatever is left on the payment.
						amount: z.number().positive().optional(),
						reason: z
							.enum(ADMIN_REFUND_REASONS)
							.default("requested_by_customer"),
						comment: z.string().max(500).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						stripeRefundId: z.string(),
						amount: z.string(),
					}),
				},
			},
			description:
				"Refund created; bookkeeping is applied when Stripe confirms via webhook.",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Payment is not refundable.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Subscriber or transaction not found.",
		},
	},
});

// Cancel a DevPass subscription on behalf of the subscriber, either at the end
// of the paid period (the default, same as the customer-facing cancel) or
// immediately. Plan state is updated by the resulting Stripe webhook.
const cancelDevpassSubscriptionRoute = createRoute({
	method: "post",
	path: "/devpass/{orgId}/cancel-subscription",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						// Immediate cancellation ends access right away without
						// refunding the current period — pair it with a refund when the
						// customer should get their money back.
						immediate: z.boolean().default(false),
						comment: z.string().max(500).optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						immediate: z.boolean(),
						subscriptionId: z.string(),
					}),
				},
			},
			description: "DevPass subscription cancelled.",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "No active DevPass subscription.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Subscriber not found.",
		},
	},
});

const devpassTimeseriesPointSchema = z.object({
	date: z.string(),
	revenue: z.number(),
	rawRevenue: z.number(),
	// PAYG overflow top-ups that day (net of top-up refunds). Counted into
	// margin because `cost` includes the overflow usage they fund.
	topupRevenue: z.number(),
	cost: z.number(),
	margin: z.number(),
});

const devpassTimeseriesSchema = z.object({
	data: z.array(devpassTimeseriesPointSchema),
	totals: z.object({
		revenue: z.number(),
		rawRevenue: z.number(),
		topupRevenue: z.number(),
		cost: z.number(),
		margin: z.number(),
	}),
	range: z.object({
		from: z.string(),
		to: z.string(),
	}),
});

const getDevpassTimeseries = createRoute({
	method: "get",
	path: "/devpass/timeseries",
	request: {
		query: z.object({
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: devpassTimeseriesSchema.openapi({}),
				},
			},
			description: "DevPass revenue/cost/margin per day.",
		},
	},
});

// Standalone PAYG overflow stats: answers "how much $ did DevPass top-ups
// make" without paying for the full subscriber-list endpoint. Revenue is the
// gross Stripe `amount` (incl processing fees) of `credit_topup` purchases on
// devpass orgs; refunds are `credit_refund` rows whose original transaction is
// such a top-up; net = gross − refunds.
const devpassTopupWindowSchema = z.object({
	gross: z.number(),
	refunds: z.number(),
	net: z.number(),
});

const devpassPaygStatsSchema = z.object({
	// Active subscribers with the overflow opt-in.
	paygOptedIn: z.number(),
	// Credits balances held by active subscribers (deferred revenue).
	paygBalanceHeld: z.number(),
	// Cycle cost across active subscribers paid from org credits, not plans.
	totalOverflowCostCycle: z.number(),
	topups: z.object({
		thisMonth: devpassTopupWindowSchema,
		allTime: devpassTopupWindowSchema,
		// Present when from/to was supplied.
		range: devpassTopupWindowSchema
			.extend({ from: z.string(), to: z.string() })
			.nullable(),
	}),
});

const getDevpassPaygStats = createRoute({
	method: "get",
	path: "/devpass/payg",
	request: {
		query: z.object({
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: devpassPaygStatsSchema.openapi({}),
				},
			},
			description: "DevPass PAYG overflow adoption and top-up revenue.",
		},
	},
});

const devpassUsageRowSchema = z.object({
	id: z.string(),
	requestCount: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
});

const devpassUsageSchema = z.object({
	models: z.array(devpassUsageRowSchema),
	providers: z.array(devpassUsageRowSchema),
	sources: z.array(devpassUsageRowSchema),
	range: z.object({
		from: z.string(),
		to: z.string(),
	}),
});

const getDevpassUsage = createRoute({
	method: "get",
	path: "/devpass/usage",
	request: {
		query: z.object({
			from: z.string().optional(),
			to: z.string().optional(),
			limit: z.coerce.number().int().min(1).max(50).default(10).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: devpassUsageSchema.openapi({}),
				},
			},
			description: "DevPass usage breakdown by model, provider, and source.",
		},
	},
});

function tierPriceOf(tier: string): number {
	if (tier === "lite" || tier === "pro" || tier === "max") {
		return DEV_PLAN_PRICES[tier];
	}
	return 0;
}

function deriveStatus(
	tier: string,
	cancelled: boolean,
	expiresAt: Date | null,
	now: Date,
): "active" | "cancelled_pending" | "expired" | "churned" {
	if (tier === "none") {
		return "churned";
	}
	if (expiresAt && expiresAt.getTime() <= now.getTime()) {
		return "expired";
	}
	if (cancelled) {
		return "cancelled_pending";
	}
	return "active";
}

const devpassTierPriceExpr = sql<number>`CASE
	WHEN ${tables.organization.devPlan} = 'lite' THEN ${DEV_PLAN_PRICES.lite}
	WHEN ${tables.organization.devPlan} = 'pro' THEN ${DEV_PLAN_PRICES.pro}
	WHEN ${tables.organization.devPlan} = 'max' THEN ${DEV_PLAN_PRICES.max}
	ELSE 0
END`;

// Active subscriber universe: everything Stripe still counts as active,
// including subs flagged to cancel at period end.
function devpassActiveUniverseWhere() {
	return and(
		eq(tables.organization.kind, "devpass"),
		ne(tables.organization.devPlan, "none"),
		or(
			isNull(tables.organization.devPlanExpiresAt),
			sql`${tables.organization.devPlanExpiresAt} > NOW()`,
		)!,
	);
}

// Real provider cost in the current cycle, per org, plus the derived overflow
// split. Credits-mode cost only: BYOK ("api-keys") usage is paid by the
// customer's own provider key, so it is not a cost we bear and must not
// depress the margin.
function buildDevpassCycleCostExprs() {
	const realCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			realCost:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
					"real_cost",
				),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.project.organizationId, tables.organization.id),
				isNotNull(tables.organization.devPlanBillingCycleStart),
				sql`${projectHourlyStats.hourTimestamp} >= ${tables.organization.devPlanBillingCycleStart}`,
			),
		)
		.groupBy(tables.project.organizationId)
		.as("real_cost_sub");

	const realCostExpr = sql<number>`COALESCE(CAST(${realCostSub.realCost} AS NUMERIC), 0)`;
	// Cycle cost paid from the org's own credits (PAYG overflow) rather than
	// the plan pool. The pool draw this cycle IS devPlanCreditsUsed (the worker
	// increments it only for pool-funded usage, and renewal resets it together
	// with the cycle window realCost is scoped to), so anything above it hit
	// the org's `credits` balance.
	const overflowCostExpr = sql<number>`GREATEST((${realCostExpr}) - CAST(${tables.organization.devPlanCreditsUsed} AS NUMERIC), 0)`;

	return { realCostSub, realCostExpr, overflowCostExpr };
}

admin.openapi(getDevpassSubscribers, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	const offset = query.offset ?? 0;
	const search = query.search;
	const tierFilter = query.tier;
	const statusFilter = query.status;
	const utilizationFilter = query.utilization;
	const marginNegative = query.marginNegative ?? false;
	const showChurned = query.showChurned ?? false;
	const sortBy = query.sortBy ?? "subscribedSince";
	const sortOrder = query.sortOrder ?? "desc";

	const now = new Date();

	const { realCostSub, realCostExpr, overflowCostExpr } =
		buildDevpassCycleCostExprs();

	// Subquery: first dev plan start (subscribedSince) and tier change count.
	// Legacy rows used the generic "subscription_start" type before the
	// dev_plan_* rename, so include both to anchor the correct first date.
	const subscribedSinceSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			firstStart: sql<string>`MIN(${tables.transaction.createdAt})`.as(
				"first_start",
			),
		})
		.from(tables.transaction)
		.where(
			inArray(tables.transaction.type, [
				"dev_plan_start",
				"subscription_start",
			]),
		)
		.groupBy(tables.transaction.organizationId)
		.as("subscribed_since_sub");

	const tierChangesSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			count: sql<number>`COUNT(*)`.as("tier_change_count"),
		})
		.from(tables.transaction)
		.where(
			inArray(tables.transaction.type, [
				"dev_plan_upgrade",
				"dev_plan_downgrade",
			]),
		)
		.groupBy(tables.transaction.organizationId)
		.as("tier_changes_sub");

	const lastPaymentFailureSub = db
		.select({
			organizationId: tables.paymentFailure.organizationId,
			lastFailureAt: sql<string>`MAX(${tables.paymentFailure.createdAt})`.as(
				"last_failure_at",
			),
		})
		.from(tables.paymentFailure)
		.groupBy(tables.paymentFailure.organizationId)
		.as("last_payment_failure_sub");

	const ownerSub = buildOrganizationOwnerSubquery();

	// All-time provider cost per org: every project, every cycle, no status or
	// billing-cycle window. Unlike `realCostSub` (current cycle only) this never
	// collapses to 0 when a renewal advances `devPlanBillingCycleStart` or when
	// the org is blocked/expired, so the admin always sees the true spend.
	// Scoped to personal orgs (DevPass is personal-only) so the aggregation
	// doesn't scan every org's hourly stats.
	const allTimeCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			// Credits-mode cost only — BYOK usage is not a cost we bear.
			cost: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
				"all_time_cost",
			),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.project.organizationId, tables.organization.id),
				eq(tables.organization.kind, "devpass"),
			),
		)
		.groupBy(tables.project.organizationId)
		.as("all_time_cost_sub");

	// All-time DevPass revenue per org: sum of completed dev plan payments
	// (`amount` = actual dollars paid). Deduplicated by invoice with the same
	// NOT EXISTS guard as the timeseries endpoint — the first invoice of a
	// subscription inserts BOTH a `dev_plan_start` and a `dev_plan_renewal` row,
	// which would otherwise double-count. Scoped to personal orgs so legacy
	// `subscription_*` rows (still written for non-personal org Pro subs) can't
	// be misattributed as DevPass revenue.
	const allTimeRevenueSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			revenue:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"all_time_revenue",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.transaction.organizationId, tables.organization.id),
				eq(tables.organization.kind, "devpass"),
			),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				firstRowPerInvoiceFilter([
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
			),
		)
		.groupBy(tables.transaction.organizationId)
		.as("all_time_revenue_sub");

	// Refunds against DevPass payments per org, netted out of revenue. Scoped to
	// personal orgs for the same reason as the revenue subquery.
	const allTimeRefundOriginalTx = aliasedTable(
		tables.transaction,
		"all_time_refund_original_tx",
	);
	const allTimeRefundSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			refund:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"all_time_refund",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			allTimeRefundOriginalTx,
			eq(tables.transaction.relatedTransactionId, allTimeRefundOriginalTx.id),
		)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.transaction.organizationId, tables.organization.id),
				eq(tables.organization.kind, "devpass"),
			),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				or(
					inArray(allTimeRefundOriginalTx.type, [
						...DEV_PLAN_TX_TYPES,
						...LEGACY_DEV_PLAN_TX_TYPES,
					]),
					// PAYG overflow top-up refunds net out of all-time revenue,
					// mirroring the top-up subquery below on the revenue side —
					// so they are restricted to the same rows that subquery sums.
					refundsCountedTopupFilter(
						tables.transaction,
						allTimeRefundOriginalTx,
					),
				)!,
			),
		)
		.groupBy(tables.transaction.organizationId)
		.as("all_time_refund_sub");

	// All-time PAYG overflow top-ups per org: gross `credit_topup` dollars
	// charged (Stripe `amount`, incl processing fees). Cash basis like the
	// other revenue splits — a top-up is revenue when charged, with the unspent
	// remainder visible separately as the org's credits balance.
	const allTimeTopupsSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			topups:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"all_time_topups",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.transaction.organizationId, tables.organization.id),
				eq(tables.organization.kind, "devpass"),
			),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.transaction.type, "credit_topup"),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
			),
		)
		.groupBy(tables.transaction.organizationId)
		.as("all_time_topups_sub");

	const tierPriceExpr = devpassTierPriceExpr;

	const utilizationExpr = sql<number | null>`CASE
		WHEN CAST(${tables.organization.devPlanCreditsLimit} AS NUMERIC) > 0
		THEN (CAST(${tables.organization.devPlanCreditsUsed} AS NUMERIC)
			/ CAST(${tables.organization.devPlanCreditsLimit} AS NUMERIC)) * 100
		ELSE NULL
	END`;

	// Plan economics only: overflow cost is funded ~1:1 by the org's own
	// top-ups, so counting it against the tier price would understate margin.
	const marginExpr = sql<number>`(${tierPriceExpr}) - ((${realCostExpr}) - (${overflowCostExpr}))`;

	const allTimeCostExpr = sql<number>`COALESCE(CAST(${allTimeCostSub.cost} AS NUMERIC), 0)`;
	const allTimeTopupsExpr = sql<number>`COALESCE(CAST(${allTimeTopupsSub.topups} AS NUMERIC), 0)`;
	// Plan payments + PAYG top-ups, net of refunds against either. allTimeCost
	// includes overflow usage, so the top-ups that funded it must be counted
	// here for allTimeMargin to reconcile.
	const allTimeRevenueExpr = sql<number>`(COALESCE(CAST(${allTimeRevenueSub.revenue} AS NUMERIC), 0) + (${allTimeTopupsExpr}) - COALESCE(CAST(${allTimeRefundSub.refund} AS NUMERIC), 0))`;
	const allTimeMarginExpr = sql<number>`(${allTimeRevenueExpr}) - (${allTimeCostExpr})`;

	const conditions = [];

	// DevPass scope: subscribers (devPlan != 'none') OR (showChurned && has past dev_plan_start).
	// Only personal orgs can hold a DevPass plan — restrict to kind='devpass'
	// so the churned list doesn't surface non-personal "Default Organization"
	// rows that happen to share legacy `subscription_*` history with org Pro.
	conditions.push(eq(tables.organization.kind, "devpass"));
	if (showChurned) {
		conditions.push(
			or(
				ne(tables.organization.devPlan, "none"),
				isNotNull(subscribedSinceSub.firstStart),
			)!,
		);
	} else {
		conditions.push(ne(tables.organization.devPlan, "none"));
	}

	if (tierFilter) {
		conditions.push(eq(tables.organization.devPlan, tierFilter));
	}

	if (statusFilter === "active") {
		conditions.push(ne(tables.organization.devPlan, "none"));
		conditions.push(eq(tables.organization.devPlanCancelled, false));
		conditions.push(
			or(
				isNull(tables.organization.devPlanExpiresAt),
				sql`${tables.organization.devPlanExpiresAt} > NOW()`,
			)!,
		);
	} else if (statusFilter === "cancelled_pending") {
		conditions.push(ne(tables.organization.devPlan, "none"));
		conditions.push(eq(tables.organization.devPlanCancelled, true));
		conditions.push(
			or(
				isNull(tables.organization.devPlanExpiresAt),
				sql`${tables.organization.devPlanExpiresAt} > NOW()`,
			)!,
		);
	} else if (statusFilter === "expired") {
		conditions.push(ne(tables.organization.devPlan, "none"));
		conditions.push(isNotNull(tables.organization.devPlanExpiresAt));
		conditions.push(sql`${tables.organization.devPlanExpiresAt} <= NOW()`);
	} else if (statusFilter === "churned") {
		conditions.push(eq(tables.organization.devPlan, "none"));
		conditions.push(isNotNull(subscribedSinceSub.firstStart));
	}

	if (utilizationFilter === "low") {
		conditions.push(sql`${utilizationExpr} < 20`);
	} else if (utilizationFilter === "healthy") {
		conditions.push(sql`${utilizationExpr} >= 20 AND ${utilizationExpr} <= 80`);
	} else if (utilizationFilter === "high") {
		conditions.push(sql`${utilizationExpr} > 80 AND ${utilizationExpr} <= 100`);
	} else if (utilizationFilter === "over") {
		conditions.push(sql`${utilizationExpr} > 100`);
	}

	if (marginNegative) {
		conditions.push(sql`${marginExpr} < 0`);
	}

	if (search) {
		const searchLower = search.toLowerCase();
		conditions.push(
			or(
				sql`LOWER(${tables.organization.name}) LIKE ${`%${searchLower}%`}`,
				sql`LOWER(${tables.organization.billingEmail}) LIKE ${`%${searchLower}%`}`,
				sql`${tables.organization.id} LIKE ${`%${search}%`}`,
				sql`LOWER(${ownerSub.userEmail}) LIKE ${`%${searchLower}%`}`,
				sql`LOWER(${ownerSub.userUsername}) LIKE ${`%${searchLower}%`}`,
			)!,
		);
	}

	const whereClause = and(...conditions);

	const orderFn = sortOrder === "asc" ? asc : desc;
	const sortColumnMap = {
		name: tables.organization.name,
		billingEmail: tables.organization.billingEmail,
		tier: tables.organization.devPlan,
		createdAt: tables.organization.createdAt,
		cycleStart: tables.organization.devPlanBillingCycleStart,
		expiresAt: tables.organization.devPlanExpiresAt,
		subscribedSince: sql`${subscribedSinceSub.firstStart}`,
		utilizationPct: sql`${utilizationExpr}`,
		realCost: sql`${realCostExpr}`,
		margin: sql`${marginExpr}`,
		mrr: sql`${tierPriceExpr}`,
		creditsUsed: sql`CAST(${tables.organization.devPlanCreditsUsed} AS NUMERIC)`,
		paygBalance: sql`CAST(${tables.organization.credits} AS NUMERIC)`,
		allTimeTopUps: sql`${allTimeTopupsExpr}`,
		allTimeRevenue: sql`${allTimeRevenueExpr}`,
		allTimeCost: sql`${allTimeCostExpr}`,
		allTimeMargin: sql`${allTimeMarginExpr}`,
	} as const;
	const sortColumn = sortColumnMap[sortBy];

	const baseSelect = db
		.select({
			id: tables.organization.id,
			name: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
			tier: tables.organization.devPlan,
			pendingTier: tables.organization.devPlanPendingTier,
			creditsUsed: tables.organization.devPlanCreditsUsed,
			creditsLimit: tables.organization.devPlanCreditsLimit,
			premiumCreditsUsed: tables.organization.devPlanPremiumCreditsUsed,
			premiumWeekStart: tables.organization.devPlanPremiumWeekStart,
			cycleStart: tables.organization.devPlanBillingCycleStart,
			expiresAt: tables.organization.devPlanExpiresAt,
			cancelled: tables.organization.devPlanCancelled,
			createdAt: tables.organization.createdAt,
			paymentFailureCount: tables.organization.paymentFailureCount,
			utilizationPct: utilizationExpr,
			mrr: tierPriceExpr,
			realCost: realCostExpr,
			paygEnabled: tables.organization.devPlanPaygEnabled,
			paygBalance: tables.organization.credits,
			autoTopUpEnabled: tables.organization.autoTopUpEnabled,
			allTimeTopUps: allTimeTopupsExpr,
			cycleOverflowCost: overflowCostExpr,
			margin: marginExpr,
			allTimeRevenue: allTimeRevenueExpr,
			allTimeCost: allTimeCostExpr,
			allTimeMargin: allTimeMarginExpr,
			subscribedSince: subscribedSinceSub.firstStart,
			tierChanges: sql<number>`COALESCE(${tierChangesSub.count}, 0)`,
			lastPaymentFailureAt: lastPaymentFailureSub.lastFailureAt,
			ownerUserId: ownerSub.userId,
			ownerName: ownerSub.userName,
			ownerEmail: ownerSub.userEmail,
			ownerUsername: ownerSub.userUsername,
		})
		.from(tables.organization)
		.leftJoin(
			realCostSub,
			eq(tables.organization.id, realCostSub.organizationId),
		)
		.leftJoin(
			subscribedSinceSub,
			eq(tables.organization.id, subscribedSinceSub.organizationId),
		)
		.leftJoin(
			tierChangesSub,
			eq(tables.organization.id, tierChangesSub.organizationId),
		)
		.leftJoin(
			lastPaymentFailureSub,
			eq(tables.organization.id, lastPaymentFailureSub.organizationId),
		)
		.leftJoin(ownerSub, eq(tables.organization.id, ownerSub.organizationId))
		.leftJoin(
			allTimeCostSub,
			eq(tables.organization.id, allTimeCostSub.organizationId),
		)
		.leftJoin(
			allTimeRevenueSub,
			eq(tables.organization.id, allTimeRevenueSub.organizationId),
		)
		.leftJoin(
			allTimeRefundSub,
			eq(tables.organization.id, allTimeRefundSub.organizationId),
		)
		.leftJoin(
			allTimeTopupsSub,
			eq(tables.organization.id, allTimeTopupsSub.organizationId),
		);

	// Total count with same filters
	const countSelect = db
		.select({ count: sql<number>`COUNT(*)` })
		.from(tables.organization)
		.leftJoin(
			realCostSub,
			eq(tables.organization.id, realCostSub.organizationId),
		)
		.leftJoin(
			subscribedSinceSub,
			eq(tables.organization.id, subscribedSinceSub.organizationId),
		)
		.leftJoin(
			tierChangesSub,
			eq(tables.organization.id, tierChangesSub.organizationId),
		)
		.leftJoin(
			lastPaymentFailureSub,
			eq(tables.organization.id, lastPaymentFailureSub.organizationId),
		)
		.leftJoin(ownerSub, eq(tables.organization.id, ownerSub.organizationId));

	const [rows, [countRow]] = await Promise.all([
		baseSelect
			.where(whereClause)
			.orderBy(orderFn(sortColumn), asc(tables.organization.id))
			.limit(limit)
			.offset(offset),
		countSelect.where(whereClause),
	]);
	const total = Number(countRow?.count ?? 0);

	const subscribers = rows.map((row) => {
		const tier = row.tier;
		const cancelled = row.cancelled;
		const expiresAt = row.expiresAt;
		const status = deriveStatus(tier, cancelled, expiresAt, now);

		const cycleStart = row.cycleStart;
		const cycleDaysIn = cycleStart
			? Math.max(
					0,
					Math.floor(
						(now.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24),
					),
				)
			: null;

		const utilizationPctRaw = row.utilizationPct;
		const utilizationPct =
			utilizationPctRaw === null || utilizationPctRaw === undefined
				? null
				: Number(utilizationPctRaw);

		const lastPaymentFailureAt = row.lastPaymentFailureAt
			? new Date(row.lastPaymentFailureAt).toISOString()
			: null;
		const hasPaymentIssue = (row.paymentFailureCount ?? 0) > 0;

		const mrrNum = Number(row.mrr ?? 0);
		const marginNum = Number(row.margin ?? 0);
		const marginPct = mrrNum > 0 ? (marginNum / mrrNum) * 100 : null;

		const premiumCreditsLimitNum =
			tier === "none" ? 0 : getDevPlanPremiumWeeklyLimit(tier as DevPlanTier);
		const premiumWeekStart = row.premiumWeekStart
			? new Date(row.premiumWeekStart).toISOString()
			: null;

		return {
			id: row.id,
			name: row.name,
			billingEmail: row.billingEmail,
			ownerUserId: row.ownerUserId ?? null,
			ownerName: row.ownerName ?? null,
			ownerEmail: row.ownerEmail ?? null,
			ownerUsername: row.ownerUsername ?? null,
			tier,
			pendingTier: row.pendingTier ?? null,
			status,
			hasPaymentIssue,
			creditsUsed: String(row.creditsUsed),
			creditsLimit: String(row.creditsLimit),
			premiumCreditsUsed: String(row.premiumCreditsUsed ?? "0"),
			premiumCreditsLimit: String(premiumCreditsLimitNum),
			premiumWeekStart,
			utilizationPct,
			cycleStart: cycleStart ? cycleStart.toISOString() : null,
			cycleDaysIn,
			expiresAt: expiresAt ? expiresAt.toISOString() : null,
			cancelled,
			mrr: mrrNum,
			realCost: Number(row.realCost ?? 0),
			paygEnabled: row.paygEnabled,
			paygBalance: String(row.paygBalance ?? "0"),
			autoTopUpEnabled: row.autoTopUpEnabled,
			allTimeTopUps: Number(row.allTimeTopUps ?? 0),
			cycleOverflowCost: Number(row.cycleOverflowCost ?? 0),
			margin: marginNum,
			marginPct,
			allTimeRevenue: Number(row.allTimeRevenue ?? 0),
			allTimeCost: Number(row.allTimeCost ?? 0),
			allTimeMargin: Number(row.allTimeMargin ?? 0),
			subscribedSince: row.subscribedSince
				? new Date(row.subscribedSince).toISOString()
				: null,
			tierChanges: Number(row.tierChanges ?? 0),
			lastPaymentFailureAt,
			createdAt: row.createdAt.toISOString(),
		};
	});

	return c.json({
		subscribers,
		total,
		limit,
		offset,
	});
});

admin.openapi(getDevpassKpis, async (c) => {
	const now = new Date();
	const monthStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	);

	const { realCostSub, overflowCostExpr } = buildDevpassCycleCostExprs();

	const refundOriginalTx = aliasedTable(
		tables.transaction,
		"refund_original_tx",
	);
	const resetPassRefundOriginalTx = aliasedTable(
		tables.transaction,
		"reset_pass_refund_original_tx",
	);
	const subscriberStartTx = aliasedTable(
		tables.transaction,
		"subscriber_start_tx",
	);
	const subscriberRefundTx = aliasedTable(
		tables.transaction,
		"subscriber_refund_tx",
	);
	const subscriberRefundOriginalTx = aliasedTable(
		tables.transaction,
		"subscriber_refund_original_tx",
	);
	const subscriberPaymentTypes = [
		...DEV_PLAN_SUBSCRIPTION_TX_TYPES,
		"subscription_start",
	] as const;

	const subscriberStartsSub = db
		.select({ organizationId: subscriberStartTx.organizationId })
		.from(subscriberStartTx)
		.where(
			and(
				eq(subscriberStartTx.status, "completed"),
				inArray(subscriberStartTx.type, [
					"dev_plan_start",
					"subscription_start",
				]),
			),
		)
		.groupBy(subscriberStartTx.organizationId)
		.as("subscriber_starts");
	const subscriberPaymentsSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			grossRevenue:
				sql<string>`SUM(CAST(${tables.transaction.amount} AS NUMERIC))`.as(
					"gross_subscription_revenue",
				),
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.type, subscriberPaymentTypes),
				isNotNull(tables.transaction.amount),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
				firstRowPerInvoiceFilter(subscriberPaymentTypes),
			),
		)
		.groupBy(tables.transaction.organizationId)
		.as("subscriber_payments");
	const subscriberRefundsSub = db
		.select({
			organizationId: subscriberRefundTx.organizationId,
			refundedAmount:
				sql<string>`SUM(CAST(${subscriberRefundTx.amount} AS NUMERIC))`.as(
					"subscriber_refunded_amount",
				),
		})
		.from(subscriberRefundTx)
		.innerJoin(
			subscriberRefundOriginalTx,
			eq(
				subscriberRefundTx.relatedTransactionId,
				subscriberRefundOriginalTx.id,
			),
		)
		.where(
			and(
				eq(subscriberRefundTx.type, "credit_refund"),
				eq(subscriberRefundTx.status, "completed"),
				isNotNull(subscriberRefundTx.amount),
				sql`CAST(${subscriberRefundTx.amount} AS NUMERIC) > 0`,
				eq(
					subscriberRefundOriginalTx.organizationId,
					subscriberRefundTx.organizationId,
				),
				eq(subscriberRefundOriginalTx.status, "completed"),
				inArray(subscriberRefundOriginalTx.type, subscriberPaymentTypes),
				isNotNull(subscriberRefundOriginalTx.amount),
				sql`CAST(${subscriberRefundOriginalTx.amount} AS NUMERIC) > 0`,
			),
		)
		.groupBy(subscriberRefundTx.organizationId)
		.as("subscriber_refunds");

	// Every KPI is an independent aggregate over the same universe, so they run
	// concurrently rather than serially.
	const [
		activeRows,
		[subscriberCountsRow],
		[churnedRow],
		[startsRow],
		[endsRow],
		[refundsRow],
		[resetPassRow],
		[resetPassRefundRow],
		[utilRow],
		[universeRow],
		[topupRevenueRow],
	] = await Promise.all([
		// KPI strip — counts the full active subscriber base, matching Stripe's
		// "active" filter which includes cancel-at-period-end subs until the period
		// actually ends. `grossMrr` is the Stripe-aligned figure (what will be
		// invoiced this period). `committedMrr` excludes subs flagged to cancel,
		// representing the forward-looking MRR after impending churn lands.
		db
			.select({
				tier: tables.organization.devPlan,
				cancelled: tables.organization.devPlanCancelled,
				count: sql<number>`COUNT(*)`,
			})
			.from(tables.organization)
			.where(devpassActiveUniverseWhere())
			.groupBy(
				tables.organization.devPlan,
				tables.organization.devPlanCancelled,
			),
		// Historical subscribers must have both a completed plan start and a
		// completed, positive plan payment. The secondary count drops anyone with
		// a completed refund against one of those payments.
		db
			.select({
				total: sql<number>`COUNT(*)`,
				excludingRefunded: sql<number>`COUNT(*) FILTER (WHERE ${subscriberRefundsSub.organizationId} IS NULL)`,
				grossRevenue: sql<string>`COALESCE(SUM(CAST(${subscriberPaymentsSub.grossRevenue} AS NUMERIC)), 0)`,
				revenueExcludingRefunds: sql<string>`GREATEST(
						COALESCE(SUM(CAST(${subscriberPaymentsSub.grossRevenue} AS NUMERIC)), 0)
						- COALESCE(SUM(CAST(${subscriberRefundsSub.refundedAmount} AS NUMERIC)), 0),
						0
					)`,
			})
			.from(tables.organization)
			.innerJoin(
				subscriberStartsSub,
				eq(tables.organization.id, subscriberStartsSub.organizationId),
			)
			.innerJoin(
				subscriberPaymentsSub,
				eq(tables.organization.id, subscriberPaymentsSub.organizationId),
			)
			.leftJoin(
				subscriberRefundsSub,
				eq(tables.organization.id, subscriberRefundsSub.organizationId),
			)
			.where(eq(tables.organization.kind, "devpass")),
		db
			.select({
				count: sql<number>`COUNT(DISTINCT ${tables.transaction.organizationId})`,
			})
			.from(tables.transaction)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.organization.kind, "devpass"),
					eq(tables.transaction.type, "dev_plan_start"),
					eq(tables.organization.devPlan, "none"),
				),
			),
		db
			.select({ count: sql<number>`COUNT(*)` })
			.from(tables.transaction)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.organization.kind, "devpass"),
					eq(tables.transaction.type, "dev_plan_start"),
					gte(tables.transaction.createdAt, monthStart),
				),
			),
		db
			.select({ count: sql<number>`COUNT(*)` })
			.from(tables.transaction)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.organization.kind, "devpass"),
					inArray(tables.transaction.type, ["dev_plan_cancel", "dev_plan_end"]),
					gte(tables.transaction.createdAt, monthStart),
				),
			),
		// Refunds this month for DevPass transactions. Mirrors the timeseries
		// refund query (joins credit_refund rows to their original tx and filters
		// to dev plan types, plus legacy subscription_* rows on DevPass orgs) but
		// aggregates to a single month total so the KPI strip reflects refund
		// activity that the snapshot-based MRR cards can't show.
		db
			.select({
				count: sql<number>`COUNT(*)`,
				total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
			})
			.from(tables.transaction)
			.innerJoin(
				refundOriginalTx,
				eq(tables.transaction.relatedTransactionId, refundOriginalTx.id),
			)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.transaction.type, "credit_refund"),
					eq(tables.transaction.status, "completed"),
					gte(tables.transaction.createdAt, monthStart),
					eq(tables.organization.kind, "devpass"),
					inArray(refundOriginalTx.type, [
						...DEV_PLAN_TX_TYPES,
						...LEGACY_DEV_PLAN_TX_TYPES,
					]),
				),
			),
		// All-time Reset Pass sales on DevPass orgs. These are one-time
		// PaymentIntent purchases (no invoice), so no invoice dedup is needed;
		// revenue is netted against completed refunds whose original transaction
		// is a Reset Pass purchase, mirroring the all-time revenue subquery.
		db
			.select({
				count: sql<number>`COUNT(*)`,
				total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
			})
			.from(tables.transaction)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.transaction.type, "dev_plan_reset_pass"),
					eq(tables.transaction.status, "completed"),
					eq(tables.organization.kind, "devpass"),
				),
			),
		db
			.select({
				total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
			})
			.from(tables.transaction)
			.innerJoin(
				resetPassRefundOriginalTx,
				eq(
					tables.transaction.relatedTransactionId,
					resetPassRefundOriginalTx.id,
				),
			)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.transaction.type, "credit_refund"),
					eq(tables.transaction.status, "completed"),
					eq(tables.organization.kind, "devpass"),
					eq(resetPassRefundOriginalTx.type, "dev_plan_reset_pass"),
				),
			),
		// Weighted utilization across active subscribers
		db
			.select({
				totalUsed: sql<string>`COALESCE(SUM(CAST(${tables.organization.devPlanCreditsUsed} AS NUMERIC)), 0)`,
				totalLimit: sql<string>`COALESCE(SUM(CAST(${tables.organization.devPlanCreditsLimit} AS NUMERIC)), 0)`,
			})
			.from(tables.organization)
			.where(devpassActiveUniverseWhere()),
		// Cycle-windowed totals across the active subscriber universe (not paginated)
		db
			.select({
				totalCost: sql<string>`COALESCE(SUM(CAST(${realCostSub.realCost} AS NUMERIC)), 0)`,
				totalMrr: sql<string>`COALESCE(SUM(${devpassTierPriceExpr}), 0)`,
				totalOverflow: sql<string>`COALESCE(SUM(${overflowCostExpr}), 0)`,
				paygOptedIn: sql<number>`COUNT(*) FILTER (WHERE ${tables.organization.devPlanPaygEnabled})`,
				paygBalanceHeld: sql<string>`COALESCE(SUM(CAST(${tables.organization.credits} AS NUMERIC)), 0)`,
			})
			.from(tables.organization)
			.leftJoin(
				realCostSub,
				eq(tables.organization.id, realCostSub.organizationId),
			)
			.where(devpassActiveUniverseWhere()),
		// PAYG overflow top-up revenue on devpass orgs (gross Stripe amount).
		db
			.select({
				allTime: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
				thisMonth: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)) FILTER (WHERE ${tables.transaction.createdAt} >= ${monthStart}), 0)`,
			})
			.from(tables.transaction)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.transaction.type, "credit_topup"),
					eq(tables.transaction.status, "completed"),
					eq(tables.organization.kind, "devpass"),
					sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
				),
			),
	]);

	const activeByTier = { lite: 0, pro: 0, max: 0 };
	const cancellingByTier = { lite: 0, pro: 0, max: 0 };
	for (const r of activeRows) {
		const tierKey = r.tier as keyof typeof activeByTier;
		if (tierKey in activeByTier) {
			const n = Number(r.count);
			activeByTier[tierKey] += n;
			if (r.cancelled) {
				cancellingByTier[tierKey] += n;
			}
		}
	}
	const totalActive = activeByTier.lite + activeByTier.pro + activeByTier.max;
	const liteMrr = activeByTier.lite * DEV_PLAN_PRICES.lite;
	const proMrr = activeByTier.pro * DEV_PLAN_PRICES.pro;
	const maxMrr = activeByTier.max * DEV_PLAN_PRICES.max;
	const grossMrr = liteMrr + proMrr + maxMrr;
	const cancellingLiteMrr = cancellingByTier.lite * DEV_PLAN_PRICES.lite;
	const cancellingProMrr = cancellingByTier.pro * DEV_PLAN_PRICES.pro;
	const cancellingMaxMrr = cancellingByTier.max * DEV_PLAN_PRICES.max;
	const cancellingMrr = cancellingLiteMrr + cancellingProMrr + cancellingMaxMrr;
	const committedMrr = grossMrr - cancellingMrr;
	const cancelledPending =
		cancellingByTier.lite + cancellingByTier.pro + cancellingByTier.max;

	const startsThisMonth = Number(startsRow?.count ?? 0);
	const endsThisMonth = Number(endsRow?.count ?? 0);
	const resetPassRevenue =
		Number(resetPassRow?.total ?? 0) - Number(resetPassRefundRow?.total ?? 0);

	const totalUsed = Number(utilRow?.totalUsed ?? 0);
	const totalLimit = Number(utilRow?.totalLimit ?? 0);
	const weightedAvgUtilization =
		totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;

	const totalRealCostCycle = Number(universeRow?.totalCost ?? 0);
	const totalMrrCycle = Number(universeRow?.totalMrr ?? 0);
	const totalOverflowCostCycle = Number(universeRow?.totalOverflow ?? 0);
	// Plan economics: overflow cost is funded by the orgs' own top-ups, so it
	// doesn't count against plan MRR.
	const totalMargin =
		totalMrrCycle - (totalRealCostCycle - totalOverflowCostCycle);

	return c.json({
		activeByTier,
		totalSubscribers: Number(subscriberCountsRow?.total ?? 0),
		totalSubscribersExcludingRefunded: Number(
			subscriberCountsRow?.excludingRefunded ?? 0,
		),
		grossSubscriptionRevenue: Number(subscriberCountsRow?.grossRevenue ?? 0),
		subscriptionRevenueExcludingRefunds: Number(
			subscriberCountsRow?.revenueExcludingRefunds ?? 0,
		),
		totalActive,
		cancelledPending,
		churned: Number(churnedRow?.count ?? 0),
		grossMrr,
		committedMrr,
		startsThisMonth,
		endsThisMonth,
		netNewThisMonth: startsThisMonth - endsThisMonth,
		refundsThisMonth: Number(refundsRow?.count ?? 0),
		refundedAmountThisMonth: Number(refundsRow?.total ?? 0),
		resetPassesSold: Number(resetPassRow?.count ?? 0),
		resetPassRevenue,
		paygOptedIn: Number(universeRow?.paygOptedIn ?? 0),
		paygBalanceHeld: Number(universeRow?.paygBalanceHeld ?? 0),
		topupRevenueThisMonth: Number(topupRevenueRow?.thisMonth ?? 0),
		topupRevenueAllTime: Number(topupRevenueRow?.allTime ?? 0),
		totalOverflowCostCycle,
		weightedAvgUtilization,
		totalRealCostCycle,
		totalMrrCycle,
		totalMargin,
		marginPct: totalMrrCycle > 0 ? (totalMargin / totalMrrCycle) * 100 : null,
	});
});

// Registered before the `/devpass/{orgId}` handler below: Hono matches routes
// in registration order, so the literal `/devpass/timeseries` path must be
// declared first or it would be captured as `orgId="timeseries"` and 404.
admin.openapi(getDevpassTimeseries, async (c) => {
	const query = c.req.valid("query");
	const now = new Date();

	// Resolve range. When no from/to is provided, default to all-time
	// (anchored to the earliest dev plan start, falling back to today).
	// Scoped to DevPass orgs (kind = 'devpass') so legacy `subscription_start`
	// rows written before the dev_plan_* rename also extend the chart range,
	// while org Pro `subscription_*` rows are excluded.
	let startDate: Date;
	let endDate: Date;
	if (query.from && query.to) {
		startDate = new Date(query.from + "T00:00:00.000Z");
		endDate = new Date(query.to + "T23:59:59.999Z");
	} else {
		const [oldest] = await db
			.select({
				minDate: sql<string>`MIN(${tables.transaction.createdAt})`.as(
					"min_date",
				),
			})
			.from(tables.transaction)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.organization.kind, "devpass"),
					inArray(tables.transaction.type, [
						"dev_plan_start",
						"subscription_start",
					]),
				),
			);
		startDate = oldest?.minDate ? new Date(oldest.minDate) : now;
		startDate.setUTCHours(0, 0, 0, 0);
		endDate = new Date(now);
		endDate.setUTCHours(23, 59, 59, 999);
	}

	if (endDate.getTime() < startDate.getTime()) {
		endDate = new Date(startDate);
		endDate.setUTCHours(23, 59, 59, 999);
	}

	// Revenue per day from completed DevPass transactions. Joins organization
	// and scopes to kind = 'devpass' so legacy `subscription_*` rows are counted
	// only on DevPass orgs (where they are pre-rename dev plan rows, not org Pro).
	// Sums `amount` (actual dollars paid) — `creditAmount` is the credits
	// granted (price × DEV_PLAN_CREDITS_MULTIPLIER) and would over-report
	// revenue, and is null on legacy `subscription_*` rows so they would
	// otherwise contribute nothing.
	//
	// Deduplicated by (stripe_invoice_id, organization_id): the FIRST invoice
	// of every subscription triggers BOTH `checkout.session.completed` (which
	// inserts `dev_plan_start`) AND `invoice.payment_succeeded` (which then
	// inserts `dev_plan_renewal`) for the same invoice. Without this NOT
	// EXISTS guard the initial payment is counted twice. Race orderings can
	// also produce a `subscription_start` paired with a `dev_plan_start` for
	// the same invoice on personal orgs. We keep the earliest row per invoice
	// (tie-broken by id) so each Stripe invoice contributes exactly once.
	const revenuePerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
				eq(tables.organization.kind, "devpass"),
				inArray(tables.transaction.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
				firstRowPerInvoiceFilter([
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Refunds per day for DevPass transactions. `credit_refund` rows store the
	// refunded amount as a positive `amount` and link back via
	// `relatedTransactionId`. Net them out of revenue when the refunded
	// transaction was a dev plan or (legacy + personal org) subscription row.
	const originalTx = aliasedTable(tables.transaction, "original_tx");
	const refundsPerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			originalTx,
			eq(tables.transaction.relatedTransactionId, originalTx.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
				eq(tables.organization.kind, "devpass"),
				inArray(originalTx.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// PAYG overflow top-ups per day (gross), net of top-up refunds below.
	const topupsPerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_topup"),
				eq(tables.transaction.status, "completed"),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
				eq(tables.organization.kind, "devpass"),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	const topupRefundOriginalTx = aliasedTable(
		tables.transaction,
		"topup_refund_original_tx",
	);
	const topupRefundsPerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			topupRefundOriginalTx,
			eq(tables.transaction.relatedTransactionId, topupRefundOriginalTx.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
				eq(tables.organization.kind, "devpass"),
				refundsCountedTopupFilter(tables.transaction, topupRefundOriginalTx),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Provider cost per day for projects belonging to DevPass orgs
	// (kind = 'devpass'), which is stable across the subscription lifecycle so
	// churned orgs (devPlan = 'none') are still included without reconstructing
	// daily plan membership.
	const costPerDay = await db
		.select({
			date: sql<string>`DATE(${projectHourlyStats.hourTimestamp})`.as("date"),
			// Credits-mode cost only — BYOK usage is not a cost we bear.
			total:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(
			and(
				gte(projectHourlyStats.hourTimestamp, startDate),
				lte(projectHourlyStats.hourTimestamp, endDate),
				eq(tables.organization.kind, "devpass"),
			),
		)
		.groupBy(sql`DATE(${projectHourlyStats.hourTimestamp})`)
		.orderBy(asc(sql`DATE(${projectHourlyStats.hourTimestamp})`));

	const revenueMap = new Map<string, number>();
	for (const row of revenuePerDay) {
		revenueMap.set(row.date, Number(row.total));
	}
	const refundMap = new Map<string, number>();
	for (const row of refundsPerDay) {
		refundMap.set(row.date, Number(row.total));
	}
	const topupMap = new Map<string, number>();
	for (const row of topupsPerDay) {
		topupMap.set(row.date, Number(row.total));
	}
	const topupRefundMap = new Map<string, number>();
	for (const row of topupRefundsPerDay) {
		topupRefundMap.set(row.date, Number(row.total));
	}
	const costMap = new Map<string, number>();
	for (const row of costPerDay) {
		costMap.set(row.date, Number(row.total));
	}

	const data: Array<{
		date: string;
		revenue: number;
		rawRevenue: number;
		topupRevenue: number;
		cost: number;
		margin: number;
	}> = [];

	const cursor = new Date(
		Date.UTC(
			startDate.getUTCFullYear(),
			startDate.getUTCMonth(),
			startDate.getUTCDate(),
		),
	);
	const lastDay = Date.UTC(
		endDate.getUTCFullYear(),
		endDate.getUTCMonth(),
		endDate.getUTCDate(),
	);

	let totalRevenue = 0;
	let totalRawRevenue = 0;
	let totalTopupRevenue = 0;
	let totalCost = 0;

	// `rawRevenue` is the gross amount collected from dev plan payments that
	// day; `revenue` nets refunds out of it. `topupRevenue` is PAYG overflow
	// top-ups net of their refunds — counted into margin because `cost`
	// includes the overflow usage those top-ups fund. Margin stays net-based.
	while (cursor.getTime() <= lastDay) {
		const iso = cursor.toISOString().slice(0, 10);
		const rawRevenue = revenueMap.get(iso) ?? 0;
		const revenue = rawRevenue - (refundMap.get(iso) ?? 0);
		const topupRevenue =
			(topupMap.get(iso) ?? 0) - (topupRefundMap.get(iso) ?? 0);
		const cost = costMap.get(iso) ?? 0;
		const margin = revenue + topupRevenue - cost;
		data.push({ date: iso, revenue, rawRevenue, topupRevenue, cost, margin });
		totalRevenue += revenue;
		totalRawRevenue += rawRevenue;
		totalTopupRevenue += topupRevenue;
		totalCost += cost;
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}

	return c.json({
		data,
		totals: {
			revenue: totalRevenue,
			rawRevenue: totalRawRevenue,
			topupRevenue: totalTopupRevenue,
			cost: totalCost,
			margin: totalRevenue + totalTopupRevenue - totalCost,
		},
		range: {
			from: startDate.toISOString().slice(0, 10),
			to: endDate.toISOString().slice(0, 10),
		},
	});
});

admin.openapi(getDevpassPaygStats, async (c) => {
	const query = c.req.valid("query");
	const now = new Date();
	const monthStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	);

	const hasRange = Boolean(query.from && query.to);
	const rangeStart = hasRange ? new Date(query.from + "T00:00:00.000Z") : null;
	const rangeEnd = hasRange ? new Date(query.to + "T23:59:59.999Z") : null;

	// Adoption, balances, and cycle overflow across active subscribers.
	// Mirrors the KPI strip on /admin/devpass (same universe filter and
	// overflow derivation) without the rest of that endpoint's queries.
	const paygRealCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			realCost:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
					"payg_real_cost",
				),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.project.organizationId, tables.organization.id),
				isNotNull(tables.organization.devPlanBillingCycleStart),
				sql`${projectHourlyStats.hourTimestamp} >= ${tables.organization.devPlanBillingCycleStart}`,
			),
		)
		.groupBy(tables.project.organizationId)
		.as("payg_real_cost_sub");

	const paygOverflowExpr = sql<string>`GREATEST(COALESCE(CAST(${paygRealCostSub.realCost} AS NUMERIC), 0) - CAST(${tables.organization.devPlanCreditsUsed} AS NUMERIC), 0)`;

	const [universeRow] = await db
		.select({
			paygOptedIn: sql<number>`COUNT(*) FILTER (WHERE ${tables.organization.devPlanPaygEnabled})`,
			paygBalanceHeld: sql<string>`COALESCE(SUM(CAST(${tables.organization.credits} AS NUMERIC)), 0)`,
			totalOverflow: sql<string>`COALESCE(SUM(${paygOverflowExpr}), 0)`,
		})
		.from(tables.organization)
		.leftJoin(
			paygRealCostSub,
			eq(tables.organization.id, paygRealCostSub.organizationId),
		)
		.where(
			and(
				eq(tables.organization.kind, "devpass"),
				ne(tables.organization.devPlan, "none"),
				or(
					isNull(tables.organization.devPlanExpiresAt),
					sql`${tables.organization.devPlanExpiresAt} > NOW()`,
				)!,
			),
		);

	// Gross top-ups by window. Refund reversals are negative same-type rows
	// and excluded by the positive-amount filter; explicit refunds are netted
	// from the query below instead.
	const amountExpr = sql`CAST(${tables.transaction.amount} AS NUMERIC)`;
	const [grossRow] = await db
		.select({
			allTime: sql<string>`COALESCE(SUM(${amountExpr}), 0)`,
			thisMonth: sql<string>`COALESCE(SUM(${amountExpr}) FILTER (WHERE ${tables.transaction.createdAt} >= ${monthStart}), 0)`,
			range: hasRange
				? sql<string>`COALESCE(SUM(${amountExpr}) FILTER (WHERE ${tables.transaction.createdAt} >= ${rangeStart} AND ${tables.transaction.createdAt} <= ${rangeEnd}), 0)`
				: sql<string>`0`,
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_topup"),
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "devpass"),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
			),
		);

	const paygRefundOriginalTx = aliasedTable(
		tables.transaction,
		"payg_refund_original_tx",
	);
	const [refundRow] = await db
		.select({
			allTime: sql<string>`COALESCE(SUM(${amountExpr}), 0)`,
			thisMonth: sql<string>`COALESCE(SUM(${amountExpr}) FILTER (WHERE ${tables.transaction.createdAt} >= ${monthStart}), 0)`,
			range: hasRange
				? sql<string>`COALESCE(SUM(${amountExpr}) FILTER (WHERE ${tables.transaction.createdAt} >= ${rangeStart} AND ${tables.transaction.createdAt} <= ${rangeEnd}), 0)`
				: sql<string>`0`,
		})
		.from(tables.transaction)
		.innerJoin(
			paygRefundOriginalTx,
			eq(tables.transaction.relatedTransactionId, paygRefundOriginalTx.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "devpass"),
				refundsCountedTopupFilter(tables.transaction, paygRefundOriginalTx),
			),
		);

	const window = (gross: number, refunds: number) => ({
		gross,
		refunds,
		net: gross - refunds,
	});

	return c.json({
		paygOptedIn: Number(universeRow?.paygOptedIn ?? 0),
		paygBalanceHeld: Number(universeRow?.paygBalanceHeld ?? 0),
		totalOverflowCostCycle: Number(universeRow?.totalOverflow ?? 0),
		topups: {
			thisMonth: window(
				Number(grossRow?.thisMonth ?? 0),
				Number(refundRow?.thisMonth ?? 0),
			),
			allTime: window(
				Number(grossRow?.allTime ?? 0),
				Number(refundRow?.allTime ?? 0),
			),
			range:
				hasRange && rangeStart && rangeEnd
					? {
							from: rangeStart.toISOString().slice(0, 10),
							to: rangeEnd.toISOString().slice(0, 10),
							...window(
								Number(grossRow?.range ?? 0),
								Number(refundRow?.range ?? 0),
							),
						}
					: null,
		},
	});
});

admin.openapi(getDevpassUsage, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 10;
	const now = new Date();

	let startDate: Date;
	let endDate: Date;
	if (query.from && query.to) {
		startDate = new Date(query.from + "T00:00:00.000Z");
		endDate = new Date(query.to + "T23:59:59.999Z");
	} else {
		startDate = new Date(now);
		startDate.setUTCDate(startDate.getUTCDate() - 30);
		startDate.setUTCHours(0, 0, 0, 0);
		endDate = new Date(now);
		endDate.setUTCHours(23, 59, 59, 999);
	}

	if (endDate.getTime() < startDate.getTime()) {
		endDate = new Date(startDate);
		endDate.setUTCHours(23, 59, 59, 999);
	}

	// Filter: only DevPass orgs (kind = 'devpass'). Stable across the
	// subscription lifecycle, so churned orgs (devPlan = 'none') stay included.
	const devpassOrgFilter = eq(tables.organization.kind, "devpass");

	// Models + providers: use the per-project hourly model aggregator so the
	// dashboard reads from rollups instead of the raw `log` table. Joins
	// project -> organization to restrict to DevPass orgs.
	const projectModelWhere = and(
		gte(projectHourlyModelStats.hourTimestamp, startDate),
		lte(projectHourlyModelStats.hourTimestamp, endDate),
		devpassOrgFilter,
	);

	const modelRows = await db
		.select({
			id: projectHourlyModelStats.usedModel,
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlyModelStats.requestCount}), 0)`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
				"cost",
			),
		})
		.from(projectHourlyModelStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyModelStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(projectModelWhere)
		.groupBy(projectHourlyModelStats.usedModel)
		.orderBy(
			desc(
				sql`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`,
			),
		)
		.limit(limit);

	const providerRows = await db
		.select({
			id: projectHourlyModelStats.usedProvider,
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlyModelStats.requestCount}), 0)`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
				"cost",
			),
		})
		.from(projectHourlyModelStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyModelStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(projectModelWhere)
		.groupBy(projectHourlyModelStats.usedProvider)
		.orderBy(
			desc(
				sql`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`,
			),
		)
		.limit(limit);

	// Sources: use the per-project hourly source aggregator so the breakdown
	// is scoped to DevPass orgs (joins project -> organization), instead of the
	// cross-org globalSourceStats table.
	const projectSourceWhere = and(
		gte(projectHourlySourceStats.hourTimestamp, startDate),
		lte(projectHourlySourceStats.hourTimestamp, endDate),
		devpassOrgFilter,
	);

	const sourceRows = await db
		.select({
			id: projectHourlySourceStats.source,
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlySourceStats.requestCount}), 0)`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlySourceStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlySourceStats.cost} as double precision)), 0)`.as(
				"cost",
			),
		})
		.from(projectHourlySourceStats)
		.innerJoin(
			tables.project,
			eq(projectHourlySourceStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(projectSourceWhere)
		.groupBy(projectHourlySourceStats.source)
		.orderBy(
			desc(
				sql`COALESCE(SUM(cast(${projectHourlySourceStats.cost} as double precision)), 0)`,
			),
		)
		.limit(limit);

	const mapRow = (r: {
		id: string | null;
		requestCount: number;
		totalTokens: number;
		cost: number;
	}) => ({
		id: r.id ?? "unknown",
		requestCount: Number(r.requestCount),
		totalTokens: Number(r.totalTokens),
		cost: Number(r.cost),
	});

	return c.json({
		models: modelRows.map(mapRow),
		providers: providerRows.map(mapRow),
		sources: sourceRows.map(mapRow),
		range: {
			from: startDate.toISOString().slice(0, 10),
			to: endDate.toISOString().slice(0, 10),
		},
	});
});

admin.openapi(getDevpassSubscriber, async (c) => {
	const { orgId } = c.req.valid("param");
	const now = new Date();

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId }, kind: { eq: "devpass" } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Subscriber not found" });
	}

	const owner = await db
		.select({
			userId: tables.user.id,
			userName: tables.user.name,
			userEmail: tables.user.email,
			userUsername: tables.user.username,
		})
		.from(tables.userOrganization)
		.innerJoin(tables.user, eq(tables.userOrganization.userId, tables.user.id))
		.where(
			and(
				eq(tables.userOrganization.organizationId, orgId),
				eq(tables.userOrganization.role, "owner"),
			),
		)
		.limit(1);

	const [firstStartRow] = await db
		.select({
			firstStart: sql<string>`MIN(${tables.transaction.createdAt})`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				inArray(tables.transaction.type, [
					"dev_plan_start",
					"subscription_start",
				]),
			),
		);

	if (org.devPlan === "none" && !firstStartRow?.firstStart) {
		throw new HTTPException(404, { message: "Subscriber not found" });
	}

	const [tierChangesRow] = await db
		.select({
			count: sql<number>`COUNT(*)`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				inArray(tables.transaction.type, [
					"dev_plan_upgrade",
					"dev_plan_downgrade",
				]),
			),
		);

	const [realCostRow] = org.devPlanBillingCycleStart
		? await db
				.select({
					total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`,
				})
				.from(projectHourlyStats)
				.innerJoin(
					tables.project,
					eq(projectHourlyStats.projectId, tables.project.id),
				)
				.where(
					and(
						eq(tables.project.organizationId, orgId),
						gte(projectHourlyStats.hourTimestamp, org.devPlanBillingCycleStart),
					),
				)
		: [{ total: "0" }];

	const realCost = Number(realCostRow?.total ?? 0);
	const mrr = tierPriceOf(org.devPlan);
	// Cycle cost above the plan-pool draw was paid from the org's own credits
	// (PAYG overflow) and is funded by its top-ups, so plan margin only counts
	// the pool-funded share. Mirrors the list endpoint's overflowCostExpr.
	const cycleOverflowCost = Math.max(
		0,
		realCost - Number(org.devPlanCreditsUsed ?? 0),
	);
	const margin = mrr - (realCost - cycleOverflowCost);

	// All-time figures: never windowed on the (resettable) billing cycle and
	// never gated on plan status, so a blocked/expired/renewed org still shows
	// its true lifetime spend and margin. Mirrors the timeseries definitions —
	// revenue is the sum of completed dev plan payments (deduped by invoice,
	// refunds netted), cost is every project's provider cost. Legacy
	// `subscription_*` rows are only DevPass revenue on personal orgs (they are
	// org Pro subs otherwise), so only count them when the org is personal.
	const allTimeRevenueTypes =
		org.kind === "devpass"
			? [...DEV_PLAN_TX_TYPES, ...LEGACY_DEV_PLAN_TX_TYPES]
			: [...DEV_PLAN_TX_TYPES];
	const [allTimeCostRow] = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`,
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.where(eq(tables.project.organizationId, orgId));
	const allTimeCost = Number(allTimeCostRow?.total ?? 0);

	const [allTimeRevenueRow] = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.type, allTimeRevenueTypes),
				firstRowPerInvoiceFilter([
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
			),
		);

	// PAYG overflow top-ups (gross Stripe amount, cash basis) — counted into
	// all-time revenue because allTimeCost includes the overflow usage they
	// funded. Mirrors the list endpoint's allTimeTopupsSub.
	const [allTimeTopupsRow] = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				eq(tables.transaction.type, "credit_topup"),
				eq(tables.transaction.status, "completed"),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
			),
		);
	const allTimeTopUps = Number(allTimeTopupsRow?.total ?? 0);

	const detailRefundOriginalTx = aliasedTable(
		tables.transaction,
		"detail_refund_original_tx",
	);
	const [allTimeRefundRow] = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
		})
		.from(tables.transaction)
		.innerJoin(
			detailRefundOriginalTx,
			eq(tables.transaction.relatedTransactionId, detailRefundOriginalTx.id),
		)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				or(
					inArray(detailRefundOriginalTx.type, allTimeRevenueTypes),
					// Top-up refunds net out of revenue like the top-ups counted
					// in, so they match the same rows allTimeTopUps sums.
					refundsCountedTopupFilter(tables.transaction, detailRefundOriginalTx),
				)!,
			),
		);

	const allTimeRevenue =
		Number(allTimeRevenueRow?.total ?? 0) +
		allTimeTopUps -
		Number(allTimeRefundRow?.total ?? 0);
	const allTimeMargin = allTimeRevenue - allTimeCost;

	const status = deriveStatus(
		org.devPlan,
		org.devPlanCancelled,
		org.devPlanExpiresAt,
		now,
	);
	const utilizationPct =
		Number(org.devPlanCreditsLimit) > 0
			? (Number(org.devPlanCreditsUsed) / Number(org.devPlanCreditsLimit)) * 100
			: null;
	const cycleDaysIn = org.devPlanBillingCycleStart
		? Math.max(
				0,
				Math.floor(
					(now.getTime() - org.devPlanBillingCycleStart.getTime()) /
						(1000 * 60 * 60 * 24),
				),
			)
		: null;

	const [lastFailureRow] = await db
		.select({
			lastFailureAt: sql<string>`MAX(${tables.paymentFailure.createdAt})`,
		})
		.from(tables.paymentFailure)
		.where(eq(tables.paymentFailure.organizationId, orgId));

	const hasPaymentIssue = (org.paymentFailureCount ?? 0) > 0;

	const marginPct = mrr > 0 ? (margin / mrr) * 100 : null;

	const premiumCreditsLimitNum =
		org.devPlan === "none"
			? 0
			: getDevPlanPremiumWeeklyLimit(org.devPlan as DevPlanTier);

	const subscriber = {
		id: org.id,
		name: org.name,
		billingEmail: org.billingEmail,
		ownerUserId: owner[0]?.userId ?? null,
		ownerName: owner[0]?.userName ?? null,
		ownerEmail: owner[0]?.userEmail ?? null,
		ownerUsername: owner[0]?.userUsername ?? null,
		tier: org.devPlan,
		pendingTier: org.devPlanPendingTier ?? null,
		status,
		hasPaymentIssue,
		creditsUsed: String(org.devPlanCreditsUsed),
		creditsLimit: String(org.devPlanCreditsLimit),
		premiumCreditsUsed: String(org.devPlanPremiumCreditsUsed ?? "0"),
		premiumCreditsLimit: String(premiumCreditsLimitNum),
		premiumWeekStart: org.devPlanPremiumWeekStart
			? org.devPlanPremiumWeekStart.toISOString()
			: null,
		utilizationPct,
		cycleStart: org.devPlanBillingCycleStart
			? org.devPlanBillingCycleStart.toISOString()
			: null,
		cycleDaysIn,
		expiresAt: org.devPlanExpiresAt ? org.devPlanExpiresAt.toISOString() : null,
		cancelled: org.devPlanCancelled,
		mrr,
		realCost,
		paygEnabled: org.devPlanPaygEnabled,
		paygBalance: String(org.credits ?? "0"),
		autoTopUpEnabled: org.autoTopUpEnabled,
		allTimeTopUps,
		cycleOverflowCost,
		margin,
		marginPct,
		allTimeRevenue,
		allTimeCost,
		allTimeMargin,
		subscribedSince: firstStartRow?.firstStart
			? new Date(firstStartRow.firstStart).toISOString()
			: null,
		tierChanges: Number(tierChangesRow?.count ?? 0),
		lastPaymentFailureAt: lastFailureRow?.lastFailureAt
			? new Date(lastFailureRow.lastFailureAt).toISOString()
			: null,
		createdAt: org.createdAt.toISOString(),
	};

	const transactions = await db
		.select({
			id: tables.transaction.id,
			createdAt: tables.transaction.createdAt,
			type: tables.transaction.type,
			amount: tables.transaction.amount,
			creditAmount: tables.transaction.creditAmount,
			currency: tables.transaction.currency,
			status: tables.transaction.status,
			description: tables.transaction.description,
			relatedTransactionId: tables.transaction.relatedTransactionId,
			stripePaymentIntentId: tables.transaction.stripePaymentIntentId,
			stripeInvoiceId: tables.transaction.stripeInvoiceId,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				inArray(tables.transaction.type, [
					"dev_plan_start",
					"dev_plan_upgrade",
					"dev_plan_downgrade",
					"dev_plan_cancel",
					"dev_plan_resume",
					"dev_plan_end",
					"dev_plan_renewal",
					"dev_plan_reset_pass",
					"dev_plan_reset_pass_gift",
					"dev_plan_reset_pass_reward",
					// PAYG overflow top-ups are DevPass billing events too.
					"credit_topup",
					// Money and credits going back out. Without `credit_refund` a
					// refunded payment reads as a charge that was never reversed —
					// the refund exists only as a badge on the original row — and
					// gifted or manually paid credits appear from nowhere.
					"credit_refund",
					"credit_gift",
					"credit_manual_payment",
					// Legacy types — pre dev_plan_* rename, still in DB for older
					// dev plan subscribers; without these their history reads as empty.
					"subscription_start",
					"subscription_cancel",
					"subscription_end",
				]),
			),
		)
		.orderBy(desc(tables.transaction.createdAt))
		.limit(100);

	// Refunds already issued against those payments, so the panel can show what
	// is left to refund instead of offering a button that Stripe would reject.
	const refundedByTransactionId = await sumRefundsByTransaction(
		orgId,
		transactions.map((t) => t.id),
	);

	const paymentFailures = await db
		.select({
			id: tables.paymentFailure.id,
			createdAt: tables.paymentFailure.createdAt,
			amount: tables.paymentFailure.amount,
			currency: tables.paymentFailure.currency,
			declineCode: tables.paymentFailure.declineCode,
			failureMessage: tables.paymentFailure.failureMessage,
			source: tables.paymentFailure.source,
		})
		.from(tables.paymentFailure)
		.where(eq(tables.paymentFailure.organizationId, orgId))
		.orderBy(desc(tables.paymentFailure.createdAt))
		.limit(50);

	return c.json({
		subscriber,
		resetPasses: {
			lite: org.devPlanResetPassesLite,
			pro: org.devPlanResetPassesPro,
			max: org.devPlanResetPassesMax,
			includedRemaining:
				org.devPlan === "none"
					? 0
					: getIncludedResetPassesRemaining(
							org.devPlan as DevPlanTier,
							org.devPlanIncludedResetPassesUsed,
						),
		},
		transactions: transactions.map((t) => {
			const refundability = computeAdminRefundability({
				transaction: t,
				refundedAmount: refundedByTransactionId.get(t.id) ?? new Decimal(0),
			});
			return {
				id: t.id,
				createdAt: t.createdAt.toISOString(),
				type: t.type,
				amount: t.amount ?? null,
				creditAmount: t.creditAmount ?? null,
				currency: t.currency,
				status: t.status,
				description: t.description ?? null,
				relatedTransactionId: t.relatedTransactionId ?? null,
				refundable: refundability.refundable,
				refundIneligibleReason: refundability.reason,
				refundedAmount: refundability.refundedAmount,
				refundableAmount: refundability.refundableAmount,
			};
		}),
		paymentFailures: paymentFailures.map((p) => ({
			id: p.id,
			createdAt: p.createdAt.toISOString(),
			amount: p.amount ?? null,
			currency: p.currency,
			declineCode: p.declineCode ?? null,
			failureMessage: p.failureMessage ?? null,
			source: p.source ?? null,
		})),
	});
});

admin.openapi(giftResetPassesRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { tier, count, comment } = c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId }, kind: { eq: "devpass" } },
	});

	if (!org || org.status === "deleted") {
		throw new HTTPException(404, { message: "Subscriber not found" });
	}

	const base = `${count}× ${tier} Reset Pass${count === 1 ? "" : "es"} gifted by Administrator`;
	const description = comment ? `${base}: ${comment}` : base;

	const { transactionId, resetPasses } = await db.transaction(async (tx) => {
		const [txn] = await tx
			.insert(tables.transaction)
			.values({
				organizationId: orgId,
				type: "dev_plan_reset_pass_gift",
				currency: "USD",
				status: "completed",
				description,
			})
			.returning({ id: tables.transaction.id });

		const [updatedOrg] = await tx
			.update(tables.organization)
			.set(
				tier === "lite"
					? {
							devPlanResetPassesLite: sql`${tables.organization.devPlanResetPassesLite} + ${count}`,
						}
					: tier === "pro"
						? {
								devPlanResetPassesPro: sql`${tables.organization.devPlanResetPassesPro} + ${count}`,
							}
						: {
								devPlanResetPassesMax: sql`${tables.organization.devPlanResetPassesMax} + ${count}`,
							},
			)
			.where(eq(tables.organization.id, orgId))
			.returning({
				lite: tables.organization.devPlanResetPassesLite,
				pro: tables.organization.devPlanResetPassesPro,
				max: tables.organization.devPlanResetPassesMax,
			});

		return { transactionId: txn.id, resetPasses: updatedOrg };
	});

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "dev_plan.reset_pass_gift",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			tier,
			count,
			comment,
			transactionId,
		},
	});

	return c.json({
		message: "Reset Passes gifted successfully",
		resetPasses,
	});
});

admin.openapi(refundDevpassPaymentRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { transactionId, amount, reason, comment } = c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId }, kind: { eq: "devpass" } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Subscriber not found" });
	}

	const transaction = await db.query.transaction.findFirst({
		where: { id: { eq: transactionId }, organizationId: { eq: orgId } },
	});

	if (!transaction) {
		throw new HTTPException(404, { message: "Transaction not found" });
	}

	const refundedByTransactionId = await sumRefundsByTransaction(orgId, [
		transaction.id,
	]);

	const { stripeRefundId, amount: refundedAmount } = await executeAdminRefund({
		organization: org,
		transaction,
		adminUserId: user!.id,
		amount,
		refundedAmount:
			refundedByTransactionId.get(transaction.id) ?? new Decimal(0),
		reason,
		comment,
	});

	return c.json({
		message: `Refund of $${refundedAmount} created. Credits, Reset Passes and plan status update once Stripe confirms.`,
		stripeRefundId,
		amount: refundedAmount,
	});
});

admin.openapi(cancelDevpassSubscriptionRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");
	const { immediate, comment } = c.req.valid("json");

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId }, kind: { eq: "devpass" } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Subscriber not found" });
	}

	const subscriptionId = org.devPlanStripeSubscriptionId;
	if (!subscriptionId) {
		throw new HTTPException(400, {
			message: "This subscriber has no active DevPass subscription",
		});
	}

	const cancellationDetails = comment ? { comment } : undefined;

	try {
		if (immediate) {
			await getStripe().subscriptions.cancel(subscriptionId, {
				invoice_now: false,
				prorate: false,
				...(cancellationDetails
					? { cancellation_details: cancellationDetails }
					: {}),
			});
		} else {
			await getStripe().subscriptions.update(subscriptionId, {
				cancel_at_period_end: true,
				...(cancellationDetails
					? { cancellation_details: cancellationDetails }
					: {}),
			});
		}
	} catch (error) {
		// A subscription Stripe has already ended is exactly the state we want;
		// the plan columns are reset by the webhook (or the customer's next
		// dashboard visit), so report success instead of failing the action.
		if (isTerminalSubscriptionError(error)) {
			logger.info(
				`DevPass subscription ${subscriptionId} already terminal, skipping admin cancel`,
			);
		} else {
			throw error;
		}
	}

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "dev_plan.admin_cancel",
		resourceType: "dev_plan",
		resourceId: subscriptionId,
		metadata: {
			tier: org.devPlan,
			immediate,
			comment,
		},
	});

	return c.json({
		message: immediate
			? "DevPass subscription cancelled immediately"
			: "DevPass subscription will end at the end of the current period",
		immediate,
		subscriptionId,
	});
});

// =============================================================================
// Chat Plans admin routes
// =============================================================================

const chatPlansTierSchema = z.enum(["starter", "plus", "pro", "none"]);
const chatPlansStatusSchema = z.enum([
	"active",
	"cancelled_pending",
	"expired",
	"churned",
]);

const chatPlansSubscriberSchema = z.object({
	id: z.string(),
	name: z.string(),
	billingEmail: z.string(),
	ownerUserId: z.string().nullable(),
	ownerName: z.string().nullable(),
	ownerEmail: z.string().nullable(),
	tier: chatPlansTierSchema,
	status: chatPlansStatusSchema,
	hasPaymentIssue: z.boolean(),
	creditsUsed: z.string(),
	creditsLimit: z.string(),
	utilizationPct: z.number().nullable(),
	cycleStart: z.string().nullable(),
	cycleDaysIn: z.number().nullable(),
	expiresAt: z.string().nullable(),
	cancelled: z.boolean(),
	mrr: z.number(),
	realCost: z.number(),
	margin: z.number(),
	marginPct: z.number().nullable(),
	allTimeRevenue: z.number(),
	allTimeCost: z.number(),
	allTimeMargin: z.number(),
	subscribedSince: z.string().nullable(),
	tierChanges: z.number(),
	lastPaymentFailureAt: z.string().nullable(),
	createdAt: z.string(),
});

const chatPlansKpisSchema = z.object({
	activeByTier: z.object({
		starter: z.number(),
		plus: z.number(),
		pro: z.number(),
	}),
	totalActive: z.number(),
	cancelledPending: z.number(),
	churned: z.number(),
	grossMrr: z.number(),
	committedMrr: z.number(),
	startsThisMonth: z.number(),
	endsThisMonth: z.number(),
	netNewThisMonth: z.number(),
	refundsThisMonth: z.number(),
	refundedAmountThisMonth: z.number(),
	weightedAvgUtilization: z.number(),
	totalRealCostCycle: z.number(),
	totalMrrCycle: z.number(),
	totalMargin: z.number(),
	marginPct: z.number().nullable(),
});

const chatPlansListSchema = z.object({
	subscribers: z.array(chatPlansSubscriberSchema),
	total: z.number(),
	kpis: chatPlansKpisSchema,
	limit: z.number(),
	offset: z.number(),
});

const chatPlansSortBySchema = z.enum([
	"name",
	"billingEmail",
	"tier",
	"createdAt",
	"cycleStart",
	"expiresAt",
	"subscribedSince",
	"utilizationPct",
	"realCost",
	"margin",
	"mrr",
	"creditsUsed",
	"allTimeRevenue",
	"allTimeCost",
	"allTimeMargin",
]);

const chatPlansUtilizationSchema = z.enum(["low", "healthy", "high", "over"]);

const getChatPlansSubscribers = createRoute({
	method: "get",
	path: "/chat-plans",
	request: {
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(50).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			search: z.string().optional(),
			tier: chatPlansTierSchema.optional(),
			status: chatPlansStatusSchema.optional(),
			utilization: chatPlansUtilizationSchema.optional(),
			marginNegative: z.coerce.boolean().optional(),
			showChurned: z.coerce.boolean().default(false).optional(),
			sortBy: chatPlansSortBySchema.default("subscribedSince").optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: chatPlansListSchema.openapi({}),
				},
			},
			description: "List of Chat Plan subscribers.",
		},
	},
});

const chatPlansTransactionSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	type: z.string(),
	amount: z.string().nullable(),
	creditAmount: z.string().nullable(),
	currency: z.string(),
	status: z.string(),
	description: z.string().nullable(),
});

const chatPlansPaymentFailureSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	amount: z.string().nullable(),
	currency: z.string(),
	declineCode: z.string().nullable(),
	failureMessage: z.string().nullable(),
	source: z.string().nullable(),
});

const chatPlansDetailSchema = z.object({
	subscriber: chatPlansSubscriberSchema,
	transactions: z.array(chatPlansTransactionSchema),
	paymentFailures: z.array(chatPlansPaymentFailureSchema),
});

const getChatPlansSubscriber = createRoute({
	method: "get",
	path: "/chat-plans/{orgId}",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: chatPlansDetailSchema.openapi({}),
				},
			},
			description: "Chat Plan subscriber detail.",
		},
		404: {
			description: "Subscriber not found.",
		},
	},
});

const chatPlansTimeseriesPointSchema = z.object({
	date: z.string(),
	revenue: z.number(),
	cost: z.number(),
	margin: z.number(),
});

const chatPlansTimeseriesSchema = z.object({
	data: z.array(chatPlansTimeseriesPointSchema),
	totals: z.object({
		revenue: z.number(),
		cost: z.number(),
		margin: z.number(),
	}),
	range: z.object({
		from: z.string(),
		to: z.string(),
	}),
});

const getChatPlansTimeseries = createRoute({
	method: "get",
	path: "/chat-plans/timeseries",
	request: {
		query: z.object({
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: chatPlansTimeseriesSchema.openapi({}),
				},
			},
			description: "Chat Plan revenue/cost/margin per day.",
		},
	},
});

const chatPlansUsageRowSchema = z.object({
	id: z.string(),
	requestCount: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
});

const chatPlansUsageSchema = z.object({
	models: z.array(chatPlansUsageRowSchema),
	providers: z.array(chatPlansUsageRowSchema),
	sources: z.array(chatPlansUsageRowSchema),
	range: z.object({
		from: z.string(),
		to: z.string(),
	}),
});

const getChatPlansUsage = createRoute({
	method: "get",
	path: "/chat-plans/usage",
	request: {
		query: z.object({
			from: z.string().optional(),
			to: z.string().optional(),
			limit: z.coerce.number().int().min(1).max(50).default(10).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: chatPlansUsageSchema.openapi({}),
				},
			},
			description: "Chat Plan usage breakdown by model, provider, and source.",
		},
	},
});

function chatTierPriceOf(tier: string): number {
	if (tier === "starter" || tier === "plus" || tier === "pro") {
		return CHAT_PLAN_PRICES[tier];
	}
	return 0;
}

function deriveChatStatus(
	tier: string,
	cancelled: boolean,
	expiresAt: Date | null,
	now: Date,
): "active" | "cancelled_pending" | "expired" | "churned" {
	if (tier === "none") {
		return "churned";
	}
	if (expiresAt && expiresAt.getTime() <= now.getTime()) {
		return "expired";
	}
	if (cancelled) {
		return "cancelled_pending";
	}
	return "active";
}

admin.openapi(getChatPlansSubscribers, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	const offset = query.offset ?? 0;
	const search = query.search;
	const tierFilter = query.tier;
	const statusFilter = query.status;
	const utilizationFilter = query.utilization;
	const marginNegative = query.marginNegative ?? false;
	const showChurned = query.showChurned ?? false;
	const sortBy = query.sortBy ?? "subscribedSince";
	const sortOrder = query.sortOrder ?? "desc";

	const now = new Date();
	const monthStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	);

	// Subquery: real provider cost in current cycle, per org. Credits-mode cost
	// only: BYOK ("api-keys") usage is paid by the customer's own provider key,
	// so it is not a cost we bear and must not depress the margin.
	const realCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			realCost:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
					"real_cost",
				),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.project.organizationId, tables.organization.id),
				isNotNull(tables.organization.chatPlanBillingCycleStart),
				sql`${projectHourlyStats.hourTimestamp} >= ${tables.organization.chatPlanBillingCycleStart}`,
			),
		)
		.groupBy(tables.project.organizationId)
		.as("real_cost_sub");

	const subscribedSinceSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			firstStart: sql<string>`MIN(${tables.transaction.createdAt})`.as(
				"first_start",
			),
		})
		.from(tables.transaction)
		.where(eq(tables.transaction.type, "chat_plan_start"))
		.groupBy(tables.transaction.organizationId)
		.as("subscribed_since_sub");

	const tierChangesSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			count: sql<number>`COUNT(*)`.as("tier_change_count"),
		})
		.from(tables.transaction)
		.where(
			inArray(tables.transaction.type, [
				"chat_plan_upgrade",
				"chat_plan_downgrade",
			]),
		)
		.groupBy(tables.transaction.organizationId)
		.as("tier_changes_sub");

	const lastPaymentFailureSub = db
		.select({
			organizationId: tables.paymentFailure.organizationId,
			lastFailureAt: sql<string>`MAX(${tables.paymentFailure.createdAt})`.as(
				"last_failure_at",
			),
		})
		.from(tables.paymentFailure)
		.groupBy(tables.paymentFailure.organizationId)
		.as("last_payment_failure_sub");

	const ownerSub = buildOrganizationOwnerSubquery();

	// All-time provider cost per org: every project, every cycle, no status or
	// billing-cycle window. Scoped to chat orgs so the aggregation doesn't scan
	// every org's hourly stats.
	const allTimeCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			// Credits-mode cost only — BYOK usage is not a cost we bear.
			cost: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
				"all_time_cost",
			),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.project.organizationId, tables.organization.id),
				eq(tables.organization.kind, "chat"),
			),
		)
		.groupBy(tables.project.organizationId)
		.as("all_time_cost_sub");

	// All-time Chat Plan revenue per org: sum of completed chat plan payments
	// (`amount` = actual dollars paid). Deduplicated by invoice with the same
	// NOT EXISTS guard as the timeseries endpoint — the first invoice of a
	// subscription inserts BOTH a `chat_plan_start` and a `chat_plan_renewal`
	// row, which would otherwise double-count.
	const allTimeRevenueSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			revenue:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"all_time_revenue",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.transaction.organizationId, tables.organization.id),
				eq(tables.organization.kind, "chat"),
			),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.type, [...CHAT_PLAN_TX_TYPES]),
				firstRowPerInvoiceFilter(CHAT_PLAN_TX_TYPES),
			),
		)
		.groupBy(tables.transaction.organizationId)
		.as("all_time_revenue_sub");

	// Refunds against Chat Plan payments per org, netted out of revenue.
	const allTimeRefundOriginalTx = aliasedTable(
		tables.transaction,
		"chat_all_time_refund_original_tx",
	);
	const allTimeRefundSub = db
		.select({
			organizationId: tables.transaction.organizationId,
			refund:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"all_time_refund",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			allTimeRefundOriginalTx,
			eq(tables.transaction.relatedTransactionId, allTimeRefundOriginalTx.id),
		)
		.innerJoin(
			tables.organization,
			and(
				eq(tables.transaction.organizationId, tables.organization.id),
				eq(tables.organization.kind, "chat"),
			),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				inArray(allTimeRefundOriginalTx.type, [...CHAT_PLAN_TX_TYPES]),
			),
		)
		.groupBy(tables.transaction.organizationId)
		.as("chat_all_time_refund_sub");

	const tierPriceExpr = sql<number>`CASE
		WHEN ${tables.organization.chatPlan} = 'starter' THEN ${CHAT_PLAN_PRICES.starter}
		WHEN ${tables.organization.chatPlan} = 'plus' THEN ${CHAT_PLAN_PRICES.plus}
		WHEN ${tables.organization.chatPlan} = 'pro' THEN ${CHAT_PLAN_PRICES.pro}
		ELSE 0
	END`;

	const utilizationExpr = sql<number | null>`CASE
		WHEN CAST(${tables.organization.chatPlanCreditsLimit} AS NUMERIC) > 0
		THEN (CAST(${tables.organization.chatPlanCreditsUsed} AS NUMERIC)
			/ CAST(${tables.organization.chatPlanCreditsLimit} AS NUMERIC)) * 100
		ELSE NULL
	END`;

	const realCostExpr = sql<number>`COALESCE(CAST(${realCostSub.realCost} AS NUMERIC), 0)`;
	const marginExpr = sql<number>`(${tierPriceExpr}) - COALESCE(CAST(${realCostSub.realCost} AS NUMERIC), 0)`;

	const allTimeCostExpr = sql<number>`COALESCE(CAST(${allTimeCostSub.cost} AS NUMERIC), 0)`;
	const allTimeRevenueExpr = sql<number>`(COALESCE(CAST(${allTimeRevenueSub.revenue} AS NUMERIC), 0) - COALESCE(CAST(${allTimeRefundSub.refund} AS NUMERIC), 0))`;
	const allTimeMarginExpr = sql<number>`(${allTimeRevenueExpr}) - (${allTimeCostExpr})`;

	const conditions = [];

	// Chat Plan scope: subscribers (chatPlan != 'none') OR (showChurned && has
	// past chat_plan_start). Chat plans live on the dedicated Chat org, so
	// restrict to kind='chat'.
	conditions.push(eq(tables.organization.kind, "chat"));
	if (showChurned) {
		conditions.push(
			or(
				ne(tables.organization.chatPlan, "none"),
				isNotNull(subscribedSinceSub.firstStart),
			)!,
		);
	} else {
		conditions.push(ne(tables.organization.chatPlan, "none"));
	}

	if (tierFilter) {
		conditions.push(eq(tables.organization.chatPlan, tierFilter));
	}

	if (statusFilter === "active") {
		conditions.push(ne(tables.organization.chatPlan, "none"));
		conditions.push(eq(tables.organization.chatPlanCancelled, false));
		conditions.push(
			or(
				isNull(tables.organization.chatPlanExpiresAt),
				sql`${tables.organization.chatPlanExpiresAt} > NOW()`,
			)!,
		);
	} else if (statusFilter === "cancelled_pending") {
		conditions.push(ne(tables.organization.chatPlan, "none"));
		conditions.push(eq(tables.organization.chatPlanCancelled, true));
		conditions.push(
			or(
				isNull(tables.organization.chatPlanExpiresAt),
				sql`${tables.organization.chatPlanExpiresAt} > NOW()`,
			)!,
		);
	} else if (statusFilter === "expired") {
		conditions.push(ne(tables.organization.chatPlan, "none"));
		conditions.push(isNotNull(tables.organization.chatPlanExpiresAt));
		conditions.push(sql`${tables.organization.chatPlanExpiresAt} <= NOW()`);
	} else if (statusFilter === "churned") {
		conditions.push(eq(tables.organization.chatPlan, "none"));
		conditions.push(isNotNull(subscribedSinceSub.firstStart));
	}

	if (utilizationFilter === "low") {
		conditions.push(sql`${utilizationExpr} < 20`);
	} else if (utilizationFilter === "healthy") {
		conditions.push(sql`${utilizationExpr} >= 20 AND ${utilizationExpr} <= 80`);
	} else if (utilizationFilter === "high") {
		conditions.push(sql`${utilizationExpr} > 80 AND ${utilizationExpr} <= 100`);
	} else if (utilizationFilter === "over") {
		conditions.push(sql`${utilizationExpr} > 100`);
	}

	if (marginNegative) {
		conditions.push(sql`${marginExpr} < 0`);
	}

	if (search) {
		const searchLower = search.toLowerCase();
		conditions.push(
			or(
				sql`LOWER(${tables.organization.name}) LIKE ${`%${searchLower}%`}`,
				sql`LOWER(${tables.organization.billingEmail}) LIKE ${`%${searchLower}%`}`,
				sql`${tables.organization.id} LIKE ${`%${search}%`}`,
				sql`LOWER(${ownerSub.userEmail}) LIKE ${`%${searchLower}%`}`,
			)!,
		);
	}

	const whereClause = and(...conditions);

	const orderFn = sortOrder === "asc" ? asc : desc;
	const sortColumnMap = {
		name: tables.organization.name,
		billingEmail: tables.organization.billingEmail,
		tier: tables.organization.chatPlan,
		createdAt: tables.organization.createdAt,
		cycleStart: tables.organization.chatPlanBillingCycleStart,
		expiresAt: tables.organization.chatPlanExpiresAt,
		subscribedSince: sql`${subscribedSinceSub.firstStart}`,
		utilizationPct: sql`${utilizationExpr}`,
		realCost: sql`${realCostExpr}`,
		margin: sql`${marginExpr}`,
		mrr: sql`${tierPriceExpr}`,
		creditsUsed: sql`CAST(${tables.organization.chatPlanCreditsUsed} AS NUMERIC)`,
		allTimeRevenue: sql`${allTimeRevenueExpr}`,
		allTimeCost: sql`${allTimeCostExpr}`,
		allTimeMargin: sql`${allTimeMarginExpr}`,
	} as const;
	const sortColumn = sortColumnMap[sortBy];

	const baseSelect = db
		.select({
			id: tables.organization.id,
			name: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
			tier: tables.organization.chatPlan,
			creditsUsed: tables.organization.chatPlanCreditsUsed,
			creditsLimit: tables.organization.chatPlanCreditsLimit,
			cycleStart: tables.organization.chatPlanBillingCycleStart,
			expiresAt: tables.organization.chatPlanExpiresAt,
			cancelled: tables.organization.chatPlanCancelled,
			createdAt: tables.organization.createdAt,
			paymentFailureCount: tables.organization.paymentFailureCount,
			utilizationPct: utilizationExpr,
			mrr: tierPriceExpr,
			realCost: realCostExpr,
			margin: marginExpr,
			allTimeRevenue: allTimeRevenueExpr,
			allTimeCost: allTimeCostExpr,
			allTimeMargin: allTimeMarginExpr,
			subscribedSince: subscribedSinceSub.firstStart,
			tierChanges: sql<number>`COALESCE(${tierChangesSub.count}, 0)`,
			lastPaymentFailureAt: lastPaymentFailureSub.lastFailureAt,
			ownerUserId: ownerSub.userId,
			ownerName: ownerSub.userName,
			ownerEmail: ownerSub.userEmail,
		})
		.from(tables.organization)
		.leftJoin(
			realCostSub,
			eq(tables.organization.id, realCostSub.organizationId),
		)
		.leftJoin(
			subscribedSinceSub,
			eq(tables.organization.id, subscribedSinceSub.organizationId),
		)
		.leftJoin(
			tierChangesSub,
			eq(tables.organization.id, tierChangesSub.organizationId),
		)
		.leftJoin(
			lastPaymentFailureSub,
			eq(tables.organization.id, lastPaymentFailureSub.organizationId),
		)
		.leftJoin(ownerSub, eq(tables.organization.id, ownerSub.organizationId))
		.leftJoin(
			allTimeCostSub,
			eq(tables.organization.id, allTimeCostSub.organizationId),
		)
		.leftJoin(
			allTimeRevenueSub,
			eq(tables.organization.id, allTimeRevenueSub.organizationId),
		)
		.leftJoin(
			allTimeRefundSub,
			eq(tables.organization.id, allTimeRefundSub.organizationId),
		);

	const rows = await baseSelect
		.where(whereClause)
		.orderBy(orderFn(sortColumn), asc(tables.organization.id))
		.limit(limit)
		.offset(offset);

	const countSelect = db
		.select({ count: sql<number>`COUNT(*)` })
		.from(tables.organization)
		.leftJoin(
			realCostSub,
			eq(tables.organization.id, realCostSub.organizationId),
		)
		.leftJoin(
			subscribedSinceSub,
			eq(tables.organization.id, subscribedSinceSub.organizationId),
		)
		.leftJoin(
			tierChangesSub,
			eq(tables.organization.id, tierChangesSub.organizationId),
		)
		.leftJoin(
			lastPaymentFailureSub,
			eq(tables.organization.id, lastPaymentFailureSub.organizationId),
		)
		.leftJoin(ownerSub, eq(tables.organization.id, ownerSub.organizationId));

	const [countRow] = await countSelect.where(whereClause);
	const total = Number(countRow?.count ?? 0);

	const activeRows = await db
		.select({
			tier: tables.organization.chatPlan,
			cancelled: tables.organization.chatPlanCancelled,
			count: sql<number>`COUNT(*)`,
		})
		.from(tables.organization)
		.where(
			and(
				eq(tables.organization.kind, "chat"),
				ne(tables.organization.chatPlan, "none"),
				or(
					isNull(tables.organization.chatPlanExpiresAt),
					sql`${tables.organization.chatPlanExpiresAt} > NOW()`,
				)!,
			),
		)
		.groupBy(
			tables.organization.chatPlan,
			tables.organization.chatPlanCancelled,
		);

	const activeByTier = { starter: 0, plus: 0, pro: 0 };
	const cancellingByTier = { starter: 0, plus: 0, pro: 0 };
	for (const r of activeRows) {
		const tierKey = r.tier as keyof typeof activeByTier;
		if (tierKey in activeByTier) {
			const n = Number(r.count);
			activeByTier[tierKey] += n;
			if (r.cancelled) {
				cancellingByTier[tierKey] += n;
			}
		}
	}
	const totalActive =
		activeByTier.starter + activeByTier.plus + activeByTier.pro;
	const starterMrr = activeByTier.starter * CHAT_PLAN_PRICES.starter;
	const plusMrr = activeByTier.plus * CHAT_PLAN_PRICES.plus;
	const proMrr = activeByTier.pro * CHAT_PLAN_PRICES.pro;
	const grossMrr = starterMrr + plusMrr + proMrr;
	const cancellingStarterMrr =
		cancellingByTier.starter * CHAT_PLAN_PRICES.starter;
	const cancellingPlusMrr = cancellingByTier.plus * CHAT_PLAN_PRICES.plus;
	const cancellingProMrr = cancellingByTier.pro * CHAT_PLAN_PRICES.pro;
	const cancellingMrr =
		cancellingStarterMrr + cancellingPlusMrr + cancellingProMrr;
	const committedMrr = grossMrr - cancellingMrr;
	const cancelledPending =
		cancellingByTier.starter + cancellingByTier.plus + cancellingByTier.pro;

	const [churnedRow] = await db
		.select({
			count: sql<number>`COUNT(DISTINCT ${tables.transaction.organizationId})`,
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "chat_plan_start"),
				eq(tables.organization.kind, "chat"),
				eq(tables.organization.chatPlan, "none"),
			),
		);
	const churned = Number(churnedRow?.count ?? 0);

	const [startsRow] = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.type, "chat_plan_start"),
				gte(tables.transaction.createdAt, monthStart),
			),
		);
	const startsThisMonth = Number(startsRow?.count ?? 0);

	const [endsRow] = await db
		.select({ count: sql<number>`COUNT(*)` })
		.from(tables.transaction)
		.where(
			and(
				inArray(tables.transaction.type, ["chat_plan_cancel", "chat_plan_end"]),
				gte(tables.transaction.createdAt, monthStart),
			),
		);
	const endsThisMonth = Number(endsRow?.count ?? 0);

	const refundOriginalTx = aliasedTable(
		tables.transaction,
		"chat_refund_original_tx",
	);
	const [refundsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`,
			total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
		})
		.from(tables.transaction)
		.innerJoin(
			refundOriginalTx,
			eq(tables.transaction.relatedTransactionId, refundOriginalTx.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				gte(tables.transaction.createdAt, monthStart),
				eq(tables.organization.kind, "chat"),
				inArray(refundOriginalTx.type, [...CHAT_PLAN_TX_TYPES]),
			),
		);
	const refundsThisMonth = Number(refundsRow?.count ?? 0);
	const refundedAmountThisMonth = Number(refundsRow?.total ?? 0);

	const [utilRow] = await db
		.select({
			totalUsed: sql<string>`COALESCE(SUM(CAST(${tables.organization.chatPlanCreditsUsed} AS NUMERIC)), 0)`,
			totalLimit: sql<string>`COALESCE(SUM(CAST(${tables.organization.chatPlanCreditsLimit} AS NUMERIC)), 0)`,
		})
		.from(tables.organization)
		.where(
			and(
				eq(tables.organization.kind, "chat"),
				ne(tables.organization.chatPlan, "none"),
				or(
					isNull(tables.organization.chatPlanExpiresAt),
					sql`${tables.organization.chatPlanExpiresAt} > NOW()`,
				)!,
			),
		);
	const totalUsed = Number(utilRow?.totalUsed ?? 0);
	const totalLimit = Number(utilRow?.totalLimit ?? 0);
	const weightedAvgUtilization =
		totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;

	const [universeRow] = await db
		.select({
			totalCost: sql<string>`COALESCE(SUM(CAST(${realCostSub.realCost} AS NUMERIC)), 0)`,
			totalMrr: sql<string>`COALESCE(SUM(${tierPriceExpr}), 0)`,
		})
		.from(tables.organization)
		.leftJoin(
			realCostSub,
			eq(tables.organization.id, realCostSub.organizationId),
		)
		.where(
			and(
				eq(tables.organization.kind, "chat"),
				ne(tables.organization.chatPlan, "none"),
				or(
					isNull(tables.organization.chatPlanExpiresAt),
					sql`${tables.organization.chatPlanExpiresAt} > NOW()`,
				)!,
			),
		);
	const totalRealCostCycle = Number(universeRow?.totalCost ?? 0);
	const totalMrrCycle = Number(universeRow?.totalMrr ?? 0);
	const totalMargin = totalMrrCycle - totalRealCostCycle;

	const subscribers = rows.map((row) => {
		const tier = row.tier;
		const cancelled = row.cancelled;
		const expiresAt = row.expiresAt;
		const status = deriveChatStatus(tier, cancelled, expiresAt, now);

		const cycleStart = row.cycleStart;
		const cycleDaysIn = cycleStart
			? Math.max(
					0,
					Math.floor(
						(now.getTime() - cycleStart.getTime()) / (1000 * 60 * 60 * 24),
					),
				)
			: null;

		const utilizationPctRaw = row.utilizationPct;
		const utilizationPct =
			utilizationPctRaw === null || utilizationPctRaw === undefined
				? null
				: Number(utilizationPctRaw);

		const lastPaymentFailureAt = row.lastPaymentFailureAt
			? new Date(row.lastPaymentFailureAt).toISOString()
			: null;
		const hasPaymentIssue = (row.paymentFailureCount ?? 0) > 0;

		const mrrNum = Number(row.mrr ?? 0);
		const marginNum = Number(row.margin ?? 0);
		const marginPct = mrrNum > 0 ? (marginNum / mrrNum) * 100 : null;

		return {
			id: row.id,
			name: row.name,
			billingEmail: row.billingEmail,
			ownerUserId: row.ownerUserId ?? null,
			ownerName: row.ownerName ?? null,
			ownerEmail: row.ownerEmail ?? null,
			tier,
			status,
			hasPaymentIssue,
			creditsUsed: String(row.creditsUsed),
			creditsLimit: String(row.creditsLimit),
			utilizationPct,
			cycleStart: cycleStart ? cycleStart.toISOString() : null,
			cycleDaysIn,
			expiresAt: expiresAt ? expiresAt.toISOString() : null,
			cancelled,
			mrr: mrrNum,
			realCost: Number(row.realCost ?? 0),
			margin: marginNum,
			marginPct,
			allTimeRevenue: Number(row.allTimeRevenue ?? 0),
			allTimeCost: Number(row.allTimeCost ?? 0),
			allTimeMargin: Number(row.allTimeMargin ?? 0),
			subscribedSince: row.subscribedSince
				? new Date(row.subscribedSince).toISOString()
				: null,
			tierChanges: Number(row.tierChanges ?? 0),
			lastPaymentFailureAt,
			createdAt: row.createdAt.toISOString(),
		};
	});

	const kpiMarginPct =
		totalMrrCycle > 0 ? (totalMargin / totalMrrCycle) * 100 : null;

	return c.json({
		subscribers,
		total,
		kpis: {
			activeByTier,
			totalActive,
			cancelledPending,
			churned,
			grossMrr,
			committedMrr,
			startsThisMonth,
			endsThisMonth,
			netNewThisMonth: startsThisMonth - endsThisMonth,
			refundsThisMonth,
			refundedAmountThisMonth,
			weightedAvgUtilization,
			totalRealCostCycle,
			totalMrrCycle,
			totalMargin,
			marginPct: kpiMarginPct,
		},
		limit,
		offset,
	});
});

// Registered before the `/chat-plans/{orgId}` handler below: Hono matches
// routes in registration order, so the literal `/chat-plans/timeseries` path
// must be declared first or it would be captured as `orgId="timeseries"`.
admin.openapi(getChatPlansTimeseries, async (c) => {
	const query = c.req.valid("query");
	const now = new Date();

	let startDate: Date;
	let endDate: Date;
	if (query.from && query.to) {
		startDate = new Date(query.from + "T00:00:00.000Z");
		endDate = new Date(query.to + "T23:59:59.999Z");
	} else {
		const [oldest] = await db
			.select({
				minDate: sql<string>`MIN(${tables.transaction.createdAt})`.as(
					"min_date",
				),
			})
			.from(tables.transaction)
			.innerJoin(
				tables.organization,
				eq(tables.transaction.organizationId, tables.organization.id),
			)
			.where(
				and(
					eq(tables.transaction.type, "chat_plan_start"),
					eq(tables.organization.kind, "chat"),
				),
			);
		startDate = oldest?.minDate ? new Date(oldest.minDate) : now;
		startDate.setUTCHours(0, 0, 0, 0);
		endDate = new Date(now);
		endDate.setUTCHours(23, 59, 59, 999);
	}

	if (endDate.getTime() < startDate.getTime()) {
		endDate = new Date(startDate);
		endDate.setUTCHours(23, 59, 59, 999);
	}

	// Revenue per day from completed Chat Plan transactions, scoped to chat orgs.
	// Sums `amount` (actual dollars paid). Deduplicated by (stripe_invoice_id,
	// organization_id): the first invoice of every subscription triggers both a
	// `chat_plan_start` and a `chat_plan_renewal` row for the same invoice.
	const revenuePerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "chat"),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
				inArray(tables.transaction.type, [...CHAT_PLAN_TX_TYPES]),
				firstRowPerInvoiceFilter(CHAT_PLAN_TX_TYPES),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Refunds per day for Chat Plan transactions, netted out of revenue.
	const originalTx = aliasedTable(tables.transaction, "chat_original_tx");
	const refundsPerDay = await db
		.select({
			date: sql<string>`DATE(${tables.transaction.createdAt})`.as("date"),
			total:
				sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(tables.transaction)
		.innerJoin(
			originalTx,
			eq(tables.transaction.relatedTransactionId, originalTx.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.transaction.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				eq(tables.organization.kind, "chat"),
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
				inArray(originalTx.type, [...CHAT_PLAN_TX_TYPES]),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Provider cost per day for projects belonging to orgs that are or were ever
	// on a Chat Plan (currently chatPlan != 'none' OR have a historical
	// chat_plan_start), scoped to chat orgs.
	const costPerDay = await db
		.select({
			date: sql<string>`DATE(${projectHourlyStats.hourTimestamp})`.as("date"),
			// Credits-mode cost only — BYOK usage is not a cost we bear.
			total:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`.as(
					"total",
				),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(
			and(
				eq(tables.organization.kind, "chat"),
				gte(projectHourlyStats.hourTimestamp, startDate),
				lte(projectHourlyStats.hourTimestamp, endDate),
				or(
					ne(tables.organization.chatPlan, "none"),
					sql`EXISTS (
						SELECT 1 FROM ${tables.transaction} t
						WHERE t.organization_id = ${tables.organization.id}
						AND t.type = 'chat_plan_start'
					)`,
				)!,
			),
		)
		.groupBy(sql`DATE(${projectHourlyStats.hourTimestamp})`)
		.orderBy(asc(sql`DATE(${projectHourlyStats.hourTimestamp})`));

	const revenueMap = new Map<string, number>();
	for (const row of revenuePerDay) {
		revenueMap.set(row.date, Number(row.total));
	}
	const refundMap = new Map<string, number>();
	for (const row of refundsPerDay) {
		refundMap.set(row.date, Number(row.total));
	}
	const costMap = new Map<string, number>();
	for (const row of costPerDay) {
		costMap.set(row.date, Number(row.total));
	}

	const data: Array<{
		date: string;
		revenue: number;
		cost: number;
		margin: number;
	}> = [];

	const cursor = new Date(
		Date.UTC(
			startDate.getUTCFullYear(),
			startDate.getUTCMonth(),
			startDate.getUTCDate(),
		),
	);
	const lastDay = Date.UTC(
		endDate.getUTCFullYear(),
		endDate.getUTCMonth(),
		endDate.getUTCDate(),
	);

	let totalRevenue = 0;
	let totalCost = 0;

	while (cursor.getTime() <= lastDay) {
		const iso = cursor.toISOString().slice(0, 10);
		const revenue = (revenueMap.get(iso) ?? 0) - (refundMap.get(iso) ?? 0);
		const cost = costMap.get(iso) ?? 0;
		const margin = revenue - cost;
		data.push({ date: iso, revenue, cost, margin });
		totalRevenue += revenue;
		totalCost += cost;
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}

	return c.json({
		data,
		totals: {
			revenue: totalRevenue,
			cost: totalCost,
			margin: totalRevenue - totalCost,
		},
		range: {
			from: startDate.toISOString().slice(0, 10),
			to: endDate.toISOString().slice(0, 10),
		},
	});
});

admin.openapi(getChatPlansUsage, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 10;
	const now = new Date();

	let startDate: Date;
	let endDate: Date;
	if (query.from && query.to) {
		startDate = new Date(query.from + "T00:00:00.000Z");
		endDate = new Date(query.to + "T23:59:59.999Z");
	} else {
		startDate = new Date(now);
		startDate.setUTCDate(startDate.getUTCDate() - 30);
		startDate.setUTCHours(0, 0, 0, 0);
		endDate = new Date(now);
		endDate.setUTCHours(23, 59, 59, 999);
	}

	if (endDate.getTime() < startDate.getTime()) {
		endDate = new Date(startDate);
		endDate.setUTCHours(23, 59, 59, 999);
	}

	// Filter: only chat orgs that are or were ever on a Chat Plan. Mirrors the
	// cost-per-day query in /chat-plans/timeseries.
	const chatPlanOrgFilter = and(
		eq(tables.organization.kind, "chat"),
		or(
			ne(tables.organization.chatPlan, "none"),
			sql`EXISTS (
				SELECT 1 FROM ${tables.transaction} t
				WHERE t.organization_id = ${tables.organization.id}
				AND t.type = 'chat_plan_start'
			)`,
		)!,
	);

	const projectModelWhere = and(
		gte(projectHourlyModelStats.hourTimestamp, startDate),
		lte(projectHourlyModelStats.hourTimestamp, endDate),
		chatPlanOrgFilter,
	);

	const modelRows = await db
		.select({
			id: projectHourlyModelStats.usedModel,
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlyModelStats.requestCount}), 0)`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
				"cost",
			),
		})
		.from(projectHourlyModelStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyModelStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(projectModelWhere)
		.groupBy(projectHourlyModelStats.usedModel)
		.orderBy(
			desc(
				sql`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`,
			),
		)
		.limit(limit);

	const providerRows = await db
		.select({
			id: projectHourlyModelStats.usedProvider,
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlyModelStats.requestCount}), 0)`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
				"cost",
			),
		})
		.from(projectHourlyModelStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyModelStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(projectModelWhere)
		.groupBy(projectHourlyModelStats.usedProvider)
		.orderBy(
			desc(
				sql`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`,
			),
		)
		.limit(limit);

	const projectSourceWhere = and(
		gte(projectHourlySourceStats.hourTimestamp, startDate),
		lte(projectHourlySourceStats.hourTimestamp, endDate),
		chatPlanOrgFilter,
	);

	const sourceRows = await db
		.select({
			id: projectHourlySourceStats.source,
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlySourceStats.requestCount}), 0)`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlySourceStats.totalTokens} AS NUMERIC)), 0)`.as(
					"total_tokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlySourceStats.cost} as double precision)), 0)`.as(
				"cost",
			),
		})
		.from(projectHourlySourceStats)
		.innerJoin(
			tables.project,
			eq(projectHourlySourceStats.projectId, tables.project.id),
		)
		.innerJoin(
			tables.organization,
			eq(tables.project.organizationId, tables.organization.id),
		)
		.where(projectSourceWhere)
		.groupBy(projectHourlySourceStats.source)
		.orderBy(
			desc(
				sql`COALESCE(SUM(cast(${projectHourlySourceStats.cost} as double precision)), 0)`,
			),
		)
		.limit(limit);

	const mapRow = (r: {
		id: string | null;
		requestCount: number;
		totalTokens: number;
		cost: number;
	}) => ({
		id: r.id ?? "unknown",
		requestCount: Number(r.requestCount),
		totalTokens: Number(r.totalTokens),
		cost: Number(r.cost),
	});

	return c.json({
		models: modelRows.map(mapRow),
		providers: providerRows.map(mapRow),
		sources: sourceRows.map(mapRow),
		range: {
			from: startDate.toISOString().slice(0, 10),
			to: endDate.toISOString().slice(0, 10),
		},
	});
});

admin.openapi(getChatPlansSubscriber, async (c) => {
	const { orgId } = c.req.valid("param");
	const now = new Date();

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId }, kind: { eq: "chat" } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Subscriber not found" });
	}

	const owner = await db
		.select({
			userId: tables.user.id,
			userName: tables.user.name,
			userEmail: tables.user.email,
		})
		.from(tables.userOrganization)
		.innerJoin(tables.user, eq(tables.userOrganization.userId, tables.user.id))
		.where(
			and(
				eq(tables.userOrganization.organizationId, orgId),
				eq(tables.userOrganization.role, "owner"),
			),
		)
		.limit(1);

	const [firstStartRow] = await db
		.select({
			firstStart: sql<string>`MIN(${tables.transaction.createdAt})`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				eq(tables.transaction.type, "chat_plan_start"),
			),
		);

	if (org.chatPlan === "none" && !firstStartRow?.firstStart) {
		throw new HTTPException(404, { message: "Subscriber not found" });
	}

	const [tierChangesRow] = await db
		.select({
			count: sql<number>`COUNT(*)`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				inArray(tables.transaction.type, [
					"chat_plan_upgrade",
					"chat_plan_downgrade",
				]),
			),
		);

	const [realCostRow] = org.chatPlanBillingCycleStart
		? await db
				.select({
					total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`,
				})
				.from(projectHourlyStats)
				.innerJoin(
					tables.project,
					eq(projectHourlyStats.projectId, tables.project.id),
				)
				.where(
					and(
						eq(tables.project.organizationId, orgId),
						gte(
							projectHourlyStats.hourTimestamp,
							org.chatPlanBillingCycleStart,
						),
					),
				)
		: [{ total: "0" }];

	const realCost = Number(realCostRow?.total ?? 0);
	const mrr = chatTierPriceOf(org.chatPlan);
	const margin = mrr - realCost;

	const [allTimeCostRow] = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.creditsCost} AS NUMERIC)), 0)`,
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.where(eq(tables.project.organizationId, orgId));
	const allTimeCost = Number(allTimeCostRow?.total ?? 0);

	const [allTimeRevenueRow] = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				eq(tables.transaction.status, "completed"),
				inArray(tables.transaction.type, [...CHAT_PLAN_TX_TYPES]),
				firstRowPerInvoiceFilter(CHAT_PLAN_TX_TYPES),
			),
		);

	const detailRefundOriginalTx = aliasedTable(
		tables.transaction,
		"chat_detail_refund_original_tx",
	);
	const [allTimeRefundRow] = await db
		.select({
			total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
		})
		.from(tables.transaction)
		.innerJoin(
			detailRefundOriginalTx,
			eq(tables.transaction.relatedTransactionId, detailRefundOriginalTx.id),
		)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				eq(tables.transaction.type, "credit_refund"),
				eq(tables.transaction.status, "completed"),
				inArray(detailRefundOriginalTx.type, [...CHAT_PLAN_TX_TYPES]),
			),
		);

	const allTimeRevenue =
		Number(allTimeRevenueRow?.total ?? 0) -
		Number(allTimeRefundRow?.total ?? 0);
	const allTimeMargin = allTimeRevenue - allTimeCost;

	const status = deriveChatStatus(
		org.chatPlan,
		org.chatPlanCancelled,
		org.chatPlanExpiresAt,
		now,
	);
	const utilizationPct =
		Number(org.chatPlanCreditsLimit) > 0
			? (Number(org.chatPlanCreditsUsed) / Number(org.chatPlanCreditsLimit)) *
				100
			: null;
	const cycleDaysIn = org.chatPlanBillingCycleStart
		? Math.max(
				0,
				Math.floor(
					(now.getTime() - org.chatPlanBillingCycleStart.getTime()) /
						(1000 * 60 * 60 * 24),
				),
			)
		: null;

	const [lastFailureRow] = await db
		.select({
			lastFailureAt: sql<string>`MAX(${tables.paymentFailure.createdAt})`,
		})
		.from(tables.paymentFailure)
		.where(eq(tables.paymentFailure.organizationId, orgId));

	const hasPaymentIssue = (org.paymentFailureCount ?? 0) > 0;

	const marginPct = mrr > 0 ? (margin / mrr) * 100 : null;

	const subscriber = {
		id: org.id,
		name: org.name,
		billingEmail: org.billingEmail,
		ownerUserId: owner[0]?.userId ?? null,
		ownerName: owner[0]?.userName ?? null,
		ownerEmail: owner[0]?.userEmail ?? null,
		tier: org.chatPlan,
		status,
		hasPaymentIssue,
		creditsUsed: String(org.chatPlanCreditsUsed),
		creditsLimit: String(org.chatPlanCreditsLimit),
		utilizationPct,
		cycleStart: org.chatPlanBillingCycleStart
			? org.chatPlanBillingCycleStart.toISOString()
			: null,
		cycleDaysIn,
		expiresAt: org.chatPlanExpiresAt
			? org.chatPlanExpiresAt.toISOString()
			: null,
		cancelled: org.chatPlanCancelled,
		mrr,
		realCost,
		margin,
		marginPct,
		allTimeRevenue,
		allTimeCost,
		allTimeMargin,
		subscribedSince: firstStartRow?.firstStart
			? new Date(firstStartRow.firstStart).toISOString()
			: null,
		tierChanges: Number(tierChangesRow?.count ?? 0),
		lastPaymentFailureAt: lastFailureRow?.lastFailureAt
			? new Date(lastFailureRow.lastFailureAt).toISOString()
			: null,
		createdAt: org.createdAt.toISOString(),
	};

	const transactions = await db
		.select({
			id: tables.transaction.id,
			createdAt: tables.transaction.createdAt,
			type: tables.transaction.type,
			amount: tables.transaction.amount,
			creditAmount: tables.transaction.creditAmount,
			currency: tables.transaction.currency,
			status: tables.transaction.status,
			description: tables.transaction.description,
		})
		.from(tables.transaction)
		.where(
			and(
				eq(tables.transaction.organizationId, orgId),
				inArray(tables.transaction.type, [
					"chat_plan_start",
					"chat_plan_upgrade",
					"chat_plan_downgrade",
					"chat_plan_cancel",
					"chat_plan_resume",
					"chat_plan_end",
					"chat_plan_renewal",
				]),
			),
		)
		.orderBy(desc(tables.transaction.createdAt))
		.limit(100);

	const paymentFailures = await db
		.select({
			id: tables.paymentFailure.id,
			createdAt: tables.paymentFailure.createdAt,
			amount: tables.paymentFailure.amount,
			currency: tables.paymentFailure.currency,
			declineCode: tables.paymentFailure.declineCode,
			failureMessage: tables.paymentFailure.failureMessage,
			source: tables.paymentFailure.source,
		})
		.from(tables.paymentFailure)
		.where(eq(tables.paymentFailure.organizationId, orgId))
		.orderBy(desc(tables.paymentFailure.createdAt))
		.limit(50);

	return c.json({
		subscriber,
		transactions: transactions.map((t) => ({
			id: t.id,
			createdAt: t.createdAt.toISOString(),
			type: t.type,
			amount: t.amount ?? null,
			creditAmount: t.creditAmount ?? null,
			currency: t.currency,
			status: t.status,
			description: t.description ?? null,
		})),
		paymentFailures: paymentFailures.map((p) => ({
			id: p.id,
			createdAt: p.createdAt.toISOString(),
			amount: p.amount ?? null,
			currency: p.currency,
			declineCode: p.declineCode ?? null,
			failureMessage: p.failureMessage ?? null,
			source: p.source ?? null,
		})),
	});
});

export default admin;
