import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	getBucketUnitForWindow,
	getWindowBucketTimestamps,
	tokenWindowSchema,
} from "@/lib/stats-window.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { createRoute } from "@/utils/create-route.js";
import {
	CHAT_PLAN_TX_TYPES,
	DEV_PLAN_SUBSCRIPTION_TX_TYPES,
	firstRowPerInvoiceFilter,
} from "@/utils/devpass-filter.js";
import { createRouter } from "@/utils/router.js";

import {
	aliasedTable,
	and,
	asc,
	CONTENT_FILTER_STATS_ALL_CATEGORY,
	contentFilterHourlyApiKeyStats,
	contentFilterHourlyModelStats,
	contentFilterHourlyStats,
	db,
	desc,
	eq,
	gte,
	inArray,
	isNotNull,
	lte,
	ne,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const adminContentFilter = createRouter<ServerTypes>();

adminContentFilter.use("/*", adminMiddleware);

const violationsWindowSchema = z.enum(["24h", "7d", "30d"]);
const violationsSortSchema = z.enum(["violations", "rate"]);

const WINDOW_HOURS: Record<z.infer<typeof violationsWindowSchema>, number> = {
	"24h": 24,
	"7d": 168,
	"30d": 720,
};

const TOP_ORGANIZATIONS = 50;
const TOP_CATEGORIES = 5;
const TOP_MODELS = 5;
const TOP_PROVIDERS = 5;
const TOP_ORGANIZATION_CATEGORIES = 10;
const TOP_ORGANIZATION_MODELS = 10;
const TOP_API_KEYS = 5;
const TOP_ORGANIZATION_API_KEYS = 10;
const TOP_GLOBAL_MODELS = 25;
const FOCUS_ORGANIZATIONS = 50;
// Sample floor for the per-slice rate ranking. Organizations under it are still
// returned, flagged and ranked below, so a slice with little traffic is not an
// empty panel and a single flagged request cannot claim the top spot.
const FOCUS_RATE_MIN_SAMPLED = 20;

const sampled = sql<number>`coalesce(sum(${contentFilterHourlyStats.sampledCount}), 0)::int`;
const violations = sql<number>`coalesce(sum(${contentFilterHourlyStats.violationCount}), 0)::int`;
const blocked = sql<number>`coalesce(sum(${contentFilterHourlyStats.blockedCount}), 0)::int`;
// Zero rather than NULL for unsampled orgs so a DESC sort does not float
// them to the top.
const violationRate = sql<number>`coalesce(sum(${contentFilterHourlyStats.violationCount})::float / nullif(sum(${contentFilterHourlyStats.sampledCount}), 0), 0)`;

const modelSampled = sql<number>`coalesce(sum(${contentFilterHourlyModelStats.sampledCount}), 0)::int`;
const modelViolations = sql<number>`coalesce(sum(${contentFilterHourlyModelStats.violationCount}), 0)::int`;
const modelBlocked = sql<number>`coalesce(sum(${contentFilterHourlyModelStats.blockedCount}), 0)::int`;
// Legacy shadow rows hold the removed shadow classifier's verdicts; every
// dashboard figure is the deciding classifier's.
const isDeciding = eq(contentFilterHourlyStats.role, "deciding");
const isDecidingModel = eq(contentFilterHourlyModelStats.role, "deciding");

const modelViolationRate = sql<number>`coalesce(sum(${contentFilterHourlyModelStats.violationCount})::float / nullif(sum(${contentFilterHourlyModelStats.sampledCount}), 0), 0)`;

const apiKeySampled = sql<number>`coalesce(sum(${contentFilterHourlyApiKeyStats.sampledCount}), 0)::int`;
const apiKeyViolations = sql<number>`coalesce(sum(${contentFilterHourlyApiKeyStats.violationCount}), 0)::int`;
const apiKeyBlocked = sql<number>`coalesce(sum(${contentFilterHourlyApiKeyStats.blockedCount}), 0)::int`;
const isDecidingApiKey = eq(contentFilterHourlyApiKeyStats.role, "deciding");

const categoryCountSchema = z.object({
	category: z.string(),
	violationCount: z.number(),
});

const apiKeyBreakdownSchema = z.object({
	apiKeyId: z.string(),
	// Null when the key row no longer exists.
	description: z.string().nullable(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	projectId: z.string(),
	sampledCount: z.number(),
	violationCount: z.number(),
	blockedCount: z.number(),
	violationRate: z.number(),
});

const organizationApiKeySchema = apiKeyBreakdownSchema.extend({
	projectName: z.string().nullable(),
	topCategories: z.array(categoryCountSchema),
});

type ApiKeyBreakdown = z.infer<typeof apiKeyBreakdownSchema>;

// The rollup has no foreign key to api_key, so a removed key keeps its counts.
const apiKeyJoin = and(
	eq(tables.apiKey.id, contentFilterHourlyApiKeyStats.apiKeyId),
	eq(tables.apiKey.projectId, contentFilterHourlyApiKeyStats.projectId),
);

const apiKeyColumns = {
	apiKeyId: contentFilterHourlyApiKeyStats.apiKeyId,
	projectId: contentFilterHourlyApiKeyStats.projectId,
	description: tables.apiKey.description,
	status: tables.apiKey.status,
	sampledCount: apiKeySampled,
	violationCount: apiKeyViolations,
	blockedCount: apiKeyBlocked,
};

function toApiKeyBreakdown(row: {
	apiKeyId: string;
	projectId: string;
	description: string | null;
	status: ApiKeyBreakdown["status"];
	sampledCount: number;
	violationCount: number;
	blockedCount: number;
}): ApiKeyBreakdown {
	const sampledCount = Number(row.sampledCount);
	const violationCount = Number(row.violationCount);
	return {
		apiKeyId: row.apiKeyId,
		description: row.description ?? null,
		status: row.status ?? null,
		projectId: row.projectId,
		sampledCount,
		violationCount,
		blockedCount: Number(row.blockedCount),
		violationRate: sampledCount > 0 ? violationCount / sampledCount : 0,
	};
}

const modelBreakdownSchema = z.object({
	usedModel: z.string(),
	usedProvider: z.string(),
	sampledCount: z.number(),
	violationCount: z.number(),
	blockedCount: z.number(),
	violationRate: z.number(),
});

const providerBreakdownSchema = z.object({
	usedProvider: z.string(),
	sampledCount: z.number(),
	violationCount: z.number(),
	blockedCount: z.number(),
	violationRate: z.number(),
});

type ModelBreakdown = z.infer<typeof modelBreakdownSchema>;
type ProviderBreakdown = z.infer<typeof providerBreakdownSchema>;

/**
 * Collapse per-model rows onto their provider. Done in memory rather than as a
 * second GROUP BY because the per-model rows for these organizations are
 * already loaded, and a provider is just the sum of its models.
 */
function toProviderBreakdowns(models: ModelBreakdown[]): ProviderBreakdown[] {
	const byProvider = new Map<string, ProviderBreakdown>();
	for (const model of models) {
		const entry = byProvider.get(model.usedProvider) ?? {
			usedProvider: model.usedProvider,
			sampledCount: 0,
			violationCount: 0,
			blockedCount: 0,
			violationRate: 0,
		};
		entry.sampledCount += model.sampledCount;
		entry.violationCount += model.violationCount;
		entry.blockedCount += model.blockedCount;
		byProvider.set(model.usedProvider, entry);
	}
	return [...byProvider.values()]
		.map((entry) => ({
			...entry,
			violationRate:
				entry.sampledCount > 0 ? entry.violationCount / entry.sampledCount : 0,
		}))
		.sort((a, b) => b.violationCount - a.violationCount);
}

function toModelBreakdown(row: {
	usedModel: string;
	usedProvider: string;
	sampledCount: number;
	violationCount: number;
	blockedCount: number;
}): ModelBreakdown {
	const sampledCount = Number(row.sampledCount);
	const violationCount = Number(row.violationCount);
	return {
		usedModel: row.usedModel,
		usedProvider: row.usedProvider,
		sampledCount,
		violationCount,
		blockedCount: Number(row.blockedCount),
		violationRate: sampledCount > 0 ? violationCount / sampledCount : 0,
	};
}

// Recurring plan charges: DevPass, Chat Plans and org Pro subscriptions.
// Cancel/end rows are bookkeeping and never carry a positive amount.
const SUBSCRIPTION_PAYMENT_TYPES = [
	...DEV_PLAN_SUBSCRIPTION_TX_TYPES,
	...CHAT_PLAN_TX_TYPES,
	"subscription_start",
] as const;

// Sums of NUMERIC strings drift in float math; report whole cents.
function toDollars(value: number): number {
	return Math.round(value * 100) / 100;
}

interface OrganizationRevenue {
	topUpNet: number;
	subscriptionNet: number;
}

/**
 * All-time money in per organization, so a violation can be weighed against
 * what the customer is worth. Top-ups mirror the admin org list's
 * "credits all time": `creditAmount` of top-ups and manual payments plus the
 * (negative) clawback on their refunds — plan rows store virtual credits there,
 * so they are excluded. Subscriptions sum `amount` once per Stripe invoice and
 * subtract refunds booked against those charges.
 */
async function loadOrganizationRevenue(
	organizationIds: string[],
): Promise<Map<string, OrganizationRevenue>> {
	const revenue = new Map<string, OrganizationRevenue>();
	if (organizationIds.length === 0) {
		return revenue;
	}

	const refundedCharge = aliasedTable(tables.transaction, "refunded_charge");
	const [topUpRows, subscriptionRows, subscriptionRefundRows] =
		await Promise.all([
			db
				.select({
					organizationId: tables.transaction.organizationId,
					total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`,
				})
				.from(tables.transaction)
				.where(
					and(
						inArray(tables.transaction.organizationId, organizationIds),
						eq(tables.transaction.status, "completed"),
						inArray(tables.transaction.type, [
							"credit_topup",
							"credit_manual_payment",
							"credit_refund",
						]),
					),
				)
				.groupBy(tables.transaction.organizationId),
			db
				.select({
					organizationId: tables.transaction.organizationId,
					total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
				})
				.from(tables.transaction)
				.where(
					and(
						inArray(tables.transaction.organizationId, organizationIds),
						eq(tables.transaction.status, "completed"),
						inArray(tables.transaction.type, SUBSCRIPTION_PAYMENT_TYPES),
						isNotNull(tables.transaction.amount),
						sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
						firstRowPerInvoiceFilter(SUBSCRIPTION_PAYMENT_TYPES),
					),
				)
				.groupBy(tables.transaction.organizationId),
			db
				.select({
					organizationId: tables.transaction.organizationId,
					total: sql<string>`COALESCE(SUM(CAST(${tables.transaction.amount} AS NUMERIC)), 0)`,
				})
				.from(tables.transaction)
				.innerJoin(
					refundedCharge,
					eq(tables.transaction.relatedTransactionId, refundedCharge.id),
				)
				.where(
					and(
						inArray(tables.transaction.organizationId, organizationIds),
						eq(tables.transaction.type, "credit_refund"),
						eq(tables.transaction.status, "completed"),
						sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
						eq(
							refundedCharge.organizationId,
							tables.transaction.organizationId,
						),
						eq(refundedCharge.status, "completed"),
						inArray(refundedCharge.type, SUBSCRIPTION_PAYMENT_TYPES),
					),
				)
				.groupBy(tables.transaction.organizationId),
		]);

	const entry = (organizationId: string) => {
		const existing = revenue.get(organizationId);
		if (existing) {
			return existing;
		}
		const created = { topUpNet: 0, subscriptionNet: 0 };
		revenue.set(organizationId, created);
		return created;
	};
	for (const row of topUpRows) {
		entry(row.organizationId).topUpNet += Number(row.total);
	}
	for (const row of subscriptionRows) {
		entry(row.organizationId).subscriptionNet += Number(row.total);
	}
	for (const row of subscriptionRefundRows) {
		entry(row.organizationId).subscriptionNet -= Number(row.total);
	}
	return revenue;
}

const violationsResponseSchema = z
	.object({
		window: violationsWindowSchema,
		sort: violationsSortSchema,
		minSampled: z.number(),
		totals: z.object({
			sampledCount: z.number(),
			violationCount: z.number(),
			blockedCount: z.number(),
		}),
		organizations: z.array(
			z.object({
				organizationId: z.string(),
				organizationName: z.string().nullable(),
				billingEmail: z.string().nullable(),
				plan: z.string().nullable(),
				sampledCount: z.number(),
				violationCount: z.number(),
				blockedCount: z.number(),
				violationRate: z.number(),
				topCategories: z.array(
					z.object({ category: z.string(), violationCount: z.number() }),
				),
				topModels: z.array(modelBreakdownSchema),
				topProviders: z.array(
					providerBreakdownSchema.extend({
						topCategories: z.array(categoryCountSchema),
					}),
				),
				topApiKeys: z.array(apiKeyBreakdownSchema),
				// All-time PAYG credits bought (top-ups and manual payments) net of
				// their refunds, in USD.
				topUpNet: z.number(),
				// All-time subscription payments (DevPass, Chat Plan, Pro) net of
				// their refunds, in USD.
				subscriptionNet: z.number(),
			}),
		),
		models: z.array(modelBreakdownSchema),
		providers: z.array(providerBreakdownSchema),
	})
	.openapi({});

const getViolations = createRoute({
	method: "get",
	path: "/content-filter/violations",
	request: {
		query: z.object({
			window: violationsWindowSchema.default("24h").optional(),
			// "rate" ranks by violations / sampled; pair it with minSampled so a
			// single flagged request cannot put a one-request org at 100%.
			sort: violationsSortSchema.default("violations").optional(),
			minSampled: z.coerce.number().int().min(0).default(0).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: violationsResponseSchema },
			},
			description:
				"Organizations and models ranked by gateway content filter violations or violation rate over the window, from the hourly rollup.",
		},
	},
});

function windowStartFor(window: z.infer<typeof violationsWindowSchema>): Date {
	const start = new Date();
	start.setUTCMinutes(0, 0, 0);
	const offsetMs = (WINDOW_HOURS[window] - 1) * 3_600_000;
	start.setTime(start.getTime() - offsetMs);
	return start;
}

adminContentFilter.openapi(getViolations, async (c) => {
	const query = c.req.valid("query");
	const window = query.window ?? "24h";
	const sort = query.sort ?? "violations";
	const minSampled = query.minSampled ?? 0;
	const windowStart = windowStartFor(window);

	const orgRows = await db
		.select({
			organizationId: contentFilterHourlyStats.organizationId,
			organizationName: tables.organization.name,
			billingEmail: tables.organization.billingEmail,
			plan: tables.organization.plan,
			sampledCount: sampled,
			violationCount: violations,
			blockedCount: blocked,
		})
		.from(contentFilterHourlyStats)
		.leftJoin(
			tables.organization,
			eq(tables.organization.id, contentFilterHourlyStats.organizationId),
		)
		.where(
			and(
				gte(contentFilterHourlyStats.hourTimestamp, windowStart),
				isDeciding,
				eq(
					contentFilterHourlyStats.category,
					CONTENT_FILTER_STATS_ALL_CATEGORY,
				),
			),
		)
		.groupBy(
			contentFilterHourlyStats.organizationId,
			tables.organization.name,
			tables.organization.billingEmail,
			tables.organization.plan,
		)
		.having(minSampled > 0 ? gte(sampled, minSampled) : undefined)
		.orderBy(
			...(sort === "rate"
				? [desc(violationRate), desc(violations), desc(sampled)]
				: [desc(violations), desc(sampled)]),
		)
		.limit(TOP_ORGANIZATIONS);

	const organizationIds = orgRows.map((row) => row.organizationId);
	const revenueByOrg = await loadOrganizationRevenue(organizationIds);
	const categoryRows =
		organizationIds.length > 0
			? await db
					.select({
						organizationId: contentFilterHourlyStats.organizationId,
						category: contentFilterHourlyStats.category,
						violationCount: violations,
					})
					.from(contentFilterHourlyStats)
					.where(
						and(
							gte(contentFilterHourlyStats.hourTimestamp, windowStart),
							isDeciding,
							ne(
								contentFilterHourlyStats.category,
								CONTENT_FILTER_STATS_ALL_CATEGORY,
							),
							inArray(contentFilterHourlyStats.organizationId, organizationIds),
						),
					)
					.groupBy(
						contentFilterHourlyStats.organizationId,
						contentFilterHourlyStats.category,
					)
			: [];

	const categoriesByOrg = new Map<
		string,
		{ category: string; violationCount: number }[]
	>();
	for (const row of categoryRows) {
		const list = categoriesByOrg.get(row.organizationId) ?? [];
		list.push({
			category: row.category,
			violationCount: Number(row.violationCount),
		});
		categoriesByOrg.set(row.organizationId, list);
	}

	const modelRows =
		organizationIds.length > 0
			? await db
					.select({
						organizationId: contentFilterHourlyModelStats.organizationId,
						usedModel: contentFilterHourlyModelStats.usedModel,
						usedProvider: contentFilterHourlyModelStats.usedProvider,
						sampledCount: modelSampled,
						violationCount: modelViolations,
						blockedCount: modelBlocked,
					})
					.from(contentFilterHourlyModelStats)
					.where(
						and(
							gte(contentFilterHourlyModelStats.hourTimestamp, windowStart),
							isDecidingModel,
							eq(
								contentFilterHourlyModelStats.category,
								CONTENT_FILTER_STATS_ALL_CATEGORY,
							),
							inArray(
								contentFilterHourlyModelStats.organizationId,
								organizationIds,
							),
						),
					)
					.groupBy(
						contentFilterHourlyModelStats.organizationId,
						contentFilterHourlyModelStats.usedModel,
						contentFilterHourlyModelStats.usedProvider,
					)
			: [];

	const modelsByOrg = new Map<string, ModelBreakdown[]>();
	for (const row of modelRows) {
		const list = modelsByOrg.get(row.organizationId) ?? [];
		list.push(toModelBreakdown(row));
		modelsByOrg.set(row.organizationId, list);
	}

	const providerCategoryRows =
		organizationIds.length > 0
			? await db
					.select({
						organizationId: contentFilterHourlyModelStats.organizationId,
						usedProvider: contentFilterHourlyModelStats.usedProvider,
						category: contentFilterHourlyModelStats.category,
						violationCount: modelViolations,
					})
					.from(contentFilterHourlyModelStats)
					.where(
						and(
							gte(contentFilterHourlyModelStats.hourTimestamp, windowStart),
							isDecidingModel,
							ne(
								contentFilterHourlyModelStats.category,
								CONTENT_FILTER_STATS_ALL_CATEGORY,
							),
							inArray(
								contentFilterHourlyModelStats.organizationId,
								organizationIds,
							),
						),
					)
					.groupBy(
						contentFilterHourlyModelStats.organizationId,
						contentFilterHourlyModelStats.usedProvider,
						contentFilterHourlyModelStats.category,
					)
					.having(sql`sum(${contentFilterHourlyModelStats.violationCount}) > 0`)
			: [];

	// Keyed by organization, then provider.
	const providerCategoriesByOrg = new Map<
		string,
		Map<string, z.infer<typeof categoryCountSchema>[]>
	>();
	for (const row of providerCategoryRows) {
		const byProvider =
			providerCategoriesByOrg.get(row.organizationId) ??
			new Map<string, z.infer<typeof categoryCountSchema>[]>();
		const list = byProvider.get(row.usedProvider) ?? [];
		list.push({
			category: row.category,
			violationCount: Number(row.violationCount),
		});
		byProvider.set(row.usedProvider, list);
		providerCategoriesByOrg.set(row.organizationId, byProvider);
	}

	// Ranked per organization in the database, so only the top keys of each
	// org leave it. Keys without a violation never take a slot here; the
	// per-org activity endpoint still lists them.
	const rankedApiKeys = db
		.select({
			organizationId: contentFilterHourlyApiKeyStats.organizationId,
			apiKeyId: contentFilterHourlyApiKeyStats.apiKeyId,
			projectId: contentFilterHourlyApiKeyStats.projectId,
			sampledCount: apiKeySampled.as("sampled_count"),
			violationCount: apiKeyViolations.as("violation_count"),
			blockedCount: apiKeyBlocked.as("blocked_count"),
			rank: sql<number>`row_number() over (
				partition by ${contentFilterHourlyApiKeyStats.organizationId}
				order by sum(${contentFilterHourlyApiKeyStats.violationCount}) desc,
					sum(${contentFilterHourlyApiKeyStats.sampledCount}) desc,
					${contentFilterHourlyApiKeyStats.apiKeyId}
			)`.as("rank"),
		})
		.from(contentFilterHourlyApiKeyStats)
		.where(
			and(
				gte(contentFilterHourlyApiKeyStats.hourTimestamp, windowStart),
				isDecidingApiKey,
				eq(
					contentFilterHourlyApiKeyStats.category,
					CONTENT_FILTER_STATS_ALL_CATEGORY,
				),
				inArray(contentFilterHourlyApiKeyStats.organizationId, organizationIds),
			),
		)
		.groupBy(
			contentFilterHourlyApiKeyStats.organizationId,
			contentFilterHourlyApiKeyStats.apiKeyId,
			contentFilterHourlyApiKeyStats.projectId,
		)
		.having(sql`sum(${contentFilterHourlyApiKeyStats.violationCount}) > 0`)
		.as("ranked_api_keys");

	const apiKeyRows =
		organizationIds.length > 0
			? await db
					.select({
						organizationId: rankedApiKeys.organizationId,
						apiKeyId: rankedApiKeys.apiKeyId,
						projectId: rankedApiKeys.projectId,
						description: tables.apiKey.description,
						status: tables.apiKey.status,
						sampledCount: rankedApiKeys.sampledCount,
						violationCount: rankedApiKeys.violationCount,
						blockedCount: rankedApiKeys.blockedCount,
					})
					.from(rankedApiKeys)
					.leftJoin(
						tables.apiKey,
						and(
							eq(tables.apiKey.id, rankedApiKeys.apiKeyId),
							eq(tables.apiKey.projectId, rankedApiKeys.projectId),
						),
					)
					.where(lte(rankedApiKeys.rank, TOP_API_KEYS))
					.orderBy(rankedApiKeys.organizationId, rankedApiKeys.rank)
			: [];

	const apiKeysByOrg = new Map<string, ApiKeyBreakdown[]>();
	for (const row of apiKeyRows) {
		const list = apiKeysByOrg.get(row.organizationId) ?? [];
		list.push(toApiKeyBreakdown(row));
		apiKeysByOrg.set(row.organizationId, list);
	}

	// Cross-tenant model ranking, independent of the org list cap: which models
	// the filter flags most across the whole platform.
	const globalModelRows = await db
		.select({
			usedModel: contentFilterHourlyModelStats.usedModel,
			usedProvider: contentFilterHourlyModelStats.usedProvider,
			sampledCount: modelSampled,
			violationCount: modelViolations,
			blockedCount: modelBlocked,
		})
		.from(contentFilterHourlyModelStats)
		.where(
			and(
				gte(contentFilterHourlyModelStats.hourTimestamp, windowStart),
				isDecidingModel,
				eq(
					contentFilterHourlyModelStats.category,
					CONTENT_FILTER_STATS_ALL_CATEGORY,
				),
			),
		)
		.groupBy(
			contentFilterHourlyModelStats.usedModel,
			contentFilterHourlyModelStats.usedProvider,
		)
		.having(minSampled > 0 ? gte(modelSampled, minSampled) : undefined)
		.orderBy(
			...(sort === "rate"
				? [desc(modelViolationRate), desc(modelViolations), desc(modelSampled)]
				: [desc(modelViolations), desc(modelSampled)]),
		)
		.limit(TOP_GLOBAL_MODELS);

	// Grouped in the database rather than folded out of globalModelRows: that
	// list is capped, so summing it would undercount a provider whose models all
	// sit below the cap.
	const globalProviderRows = await db
		.select({
			usedProvider: contentFilterHourlyModelStats.usedProvider,
			sampledCount: modelSampled,
			violationCount: modelViolations,
			blockedCount: modelBlocked,
		})
		.from(contentFilterHourlyModelStats)
		.where(
			and(
				gte(contentFilterHourlyModelStats.hourTimestamp, windowStart),
				isDecidingModel,
				eq(
					contentFilterHourlyModelStats.category,
					CONTENT_FILTER_STATS_ALL_CATEGORY,
				),
			),
		)
		.groupBy(contentFilterHourlyModelStats.usedProvider)
		.having(minSampled > 0 ? gte(modelSampled, minSampled) : undefined)
		.orderBy(
			...(sort === "rate"
				? [desc(modelViolationRate), desc(modelViolations), desc(modelSampled)]
				: [desc(modelViolations), desc(modelSampled)]),
		);

	// Window-wide, independent of the ranked list cap and sample floor.
	const [globalTotals] = await db
		.select({
			sampledCount: sampled,
			violationCount: violations,
			blockedCount: blocked,
		})
		.from(contentFilterHourlyStats)
		.where(
			and(
				gte(contentFilterHourlyStats.hourTimestamp, windowStart),
				isDeciding,
				eq(
					contentFilterHourlyStats.category,
					CONTENT_FILTER_STATS_ALL_CATEGORY,
				),
			),
		);
	const totals = {
		sampledCount: Number(globalTotals?.sampledCount ?? 0),
		violationCount: Number(globalTotals?.violationCount ?? 0),
		blockedCount: Number(globalTotals?.blockedCount ?? 0),
	};
	const globalModels = globalModelRows.map(toModelBreakdown);
	const organizations = orgRows.map((row) => {
		const orgModels = modelsByOrg.get(row.organizationId) ?? [];
		const sampledCount = Number(row.sampledCount);
		const violationCount = Number(row.violationCount);
		const blockedCount = Number(row.blockedCount);
		const revenue = revenueByOrg.get(row.organizationId);
		return {
			organizationId: row.organizationId,
			organizationName: row.organizationName ?? null,
			billingEmail: row.billingEmail ?? null,
			plan: row.plan ?? null,
			sampledCount,
			violationCount,
			blockedCount,
			violationRate: sampledCount > 0 ? violationCount / sampledCount : 0,
			topCategories: (categoriesByOrg.get(row.organizationId) ?? [])
				.sort((a, b) => b.violationCount - a.violationCount)
				.slice(0, TOP_CATEGORIES),
			topModels: orgModels
				.slice()
				.sort((a, b) => b.violationCount - a.violationCount)
				.slice(0, TOP_MODELS),
			topProviders: toProviderBreakdowns(orgModels)
				.slice(0, TOP_PROVIDERS)
				.map((provider) => ({
					...provider,
					topCategories: (
						providerCategoriesByOrg
							.get(row.organizationId)
							?.get(provider.usedProvider) ?? []
					)
						.sort((a, b) => b.violationCount - a.violationCount)
						.slice(0, TOP_CATEGORIES),
				})),
			topApiKeys: apiKeysByOrg.get(row.organizationId) ?? [],
			topUpNet: toDollars(revenue?.topUpNet ?? 0),
			subscriptionNet: toDollars(revenue?.subscriptionNet ?? 0),
		};
	});

	return c.json({
		window,
		sort,
		minSampled,
		totals,
		organizations,
		models: globalModels,
		providers: globalProviderRows.map((row) => {
			const sampledCount = Number(row.sampledCount);
			const violationCount = Number(row.violationCount);
			return {
				usedProvider: row.usedProvider,
				sampledCount,
				violationCount,
				blockedCount: Number(row.blockedCount),
				violationRate: sampledCount > 0 ? violationCount / sampledCount : 0,
			};
		}),
	});
});

const focusResponseSchema = z
	.object({
		window: violationsWindowSchema,
		usedProvider: z.string(),
		usedModel: z.string().nullable(),
		minSampled: z.number(),
		totals: z.object({
			sampledCount: z.number(),
			violationCount: z.number(),
			blockedCount: z.number(),
			violationRate: z.number(),
		}),
		organizations: z.array(
			z.object({
				organizationId: z.string(),
				organizationName: z.string().nullable(),
				plan: z.string().nullable(),
				sampledCount: z.number(),
				violationCount: z.number(),
				blockedCount: z.number(),
				violationRate: z.number(),
				belowSampleFloor: z.boolean(),
			}),
		),
	})
	.openapi({});

const getFocusOrganizations = createRoute({
	method: "get",
	path: "/content-filter/violations/organizations",
	request: {
		query: z.object({
			window: violationsWindowSchema.default("24h").optional(),
			usedProvider: z.string().min(1),
			// Omit to summarize the whole provider rather than one of its models.
			usedModel: z.string().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: focusResponseSchema },
			},
			description:
				"Organizations ranked by violation rate on one provider, or one of its models, over the window.",
		},
	},
});

adminContentFilter.openapi(getFocusOrganizations, async (c) => {
	const query = c.req.valid("query");
	const window = query.window ?? "24h";
	const windowStart = windowStartFor(window);
	const slice = and(
		gte(contentFilterHourlyModelStats.hourTimestamp, windowStart),
		isDecidingModel,
		eq(
			contentFilterHourlyModelStats.category,
			CONTENT_FILTER_STATS_ALL_CATEGORY,
		),
		eq(contentFilterHourlyModelStats.usedProvider, query.usedProvider),
		query.usedModel
			? eq(contentFilterHourlyModelStats.usedModel, query.usedModel)
			: undefined,
	);

	// Rate first, but only for organizations with enough traffic on this slice to
	// mean anything; the rest keep their volume order underneath.
	const meetsFloor = sql<boolean>`coalesce(sum(${contentFilterHourlyModelStats.sampledCount}), 0) >= ${FOCUS_RATE_MIN_SAMPLED}`;
	const floorRate = sql<number>`case when coalesce(sum(${contentFilterHourlyModelStats.sampledCount}), 0) >= ${FOCUS_RATE_MIN_SAMPLED} then ${modelViolationRate} else 0 end`;

	const [orgRows, [totals]] = await Promise.all([
		db
			.select({
				organizationId: contentFilterHourlyModelStats.organizationId,
				organizationName: tables.organization.name,
				plan: tables.organization.plan,
				sampledCount: modelSampled,
				violationCount: modelViolations,
				blockedCount: modelBlocked,
				meetsFloor,
			})
			.from(contentFilterHourlyModelStats)
			.leftJoin(
				tables.organization,
				eq(
					tables.organization.id,
					contentFilterHourlyModelStats.organizationId,
				),
			)
			.where(slice)
			.groupBy(
				contentFilterHourlyModelStats.organizationId,
				tables.organization.name,
				tables.organization.plan,
			)
			.orderBy(
				desc(meetsFloor),
				desc(floorRate),
				desc(modelViolations),
				desc(modelSampled),
			)
			.limit(FOCUS_ORGANIZATIONS),
		db
			.select({
				sampledCount: modelSampled,
				violationCount: modelViolations,
				blockedCount: modelBlocked,
			})
			.from(contentFilterHourlyModelStats)
			.where(slice),
	]);

	const sampledCount = Number(totals?.sampledCount ?? 0);
	const violationCount = Number(totals?.violationCount ?? 0);

	return c.json({
		window,
		usedProvider: query.usedProvider,
		usedModel: query.usedModel ?? null,
		minSampled: FOCUS_RATE_MIN_SAMPLED,
		totals: {
			sampledCount,
			violationCount,
			blockedCount: Number(totals?.blockedCount ?? 0),
			violationRate: sampledCount > 0 ? violationCount / sampledCount : 0,
		},
		organizations: orgRows.map((row) => {
			const orgSampled = Number(row.sampledCount);
			const orgViolations = Number(row.violationCount);
			return {
				organizationId: row.organizationId,
				organizationName: row.organizationName ?? null,
				plan: row.plan ?? null,
				sampledCount: orgSampled,
				violationCount: orgViolations,
				blockedCount: Number(row.blockedCount),
				violationRate: orgSampled > 0 ? orgViolations / orgSampled : 0,
				belowSampleFloor: !row.meetsFloor,
			};
		}),
	});
});

const activityResponseSchema = z
	.object({
		window: tokenWindowSchema,
		bucket: z.enum(["hour", "day"]),
		totals: z.object({
			sampledCount: z.number(),
			violationCount: z.number(),
			blockedCount: z.number(),
			violationRate: z.number(),
		}),
		topCategories: z.array(categoryCountSchema),
		topModels: z.array(modelBreakdownSchema),
		topApiKeys: z.array(organizationApiKeySchema),
		data: z.array(
			z.object({
				timestamp: z.string(),
				sampledCount: z.number(),
				violationCount: z.number(),
				blockedCount: z.number(),
			}),
		),
	})
	.openapi({});

const getOrganizationActivity = createRoute({
	method: "get",
	path: "/organizations/{orgId}/content-filter",
	request: {
		params: z.object({ orgId: z.string() }),
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": { schema: activityResponseSchema },
			},
			description:
				"One organization's gateway content filter activity over time: sampled, violating and blocked requests per bucket, plus window totals, top categories, top models and top API keys.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminContentFilter.openapi(getOrganizationActivity, async (c) => {
	const { orgId } = c.req.valid("param");
	const window = c.req.valid("query").window ?? "7d";
	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
		columns: { id: true },
	});
	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const bucket = getBucketUnitForWindow(window);
	// Filter from the first bucket boundary rather than the raw window start so
	// the leading bucket is not zeroed by rows that fall just before it.
	const bucketTimestamps = getWindowBucketTimestamps(window);
	const startDate = new Date(bucketTimestamps[0] ?? Date.now());
	const bucketExpr = sql<string>`to_char(date_trunc(${sql.raw(`'${bucket}'`)}, ${contentFilterHourlyStats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
	const orgWindow = and(
		eq(contentFilterHourlyStats.organizationId, orgId),
		gte(contentFilterHourlyStats.hourTimestamp, startDate),
		isDeciding,
	);

	const modelWindow = and(
		eq(contentFilterHourlyModelStats.organizationId, orgId),
		gte(contentFilterHourlyModelStats.hourTimestamp, startDate),
		isDecidingModel,
	);

	const apiKeyWindow = and(
		eq(contentFilterHourlyApiKeyStats.organizationId, orgId),
		gte(contentFilterHourlyApiKeyStats.hourTimestamp, startDate),
		isDecidingApiKey,
	);

	const [series, categories, models, apiKeys] = await Promise.all([
		db
			.select({
				bucket: bucketExpr,
				sampledCount: sampled,
				violationCount: violations,
				blockedCount: blocked,
			})
			.from(contentFilterHourlyStats)
			.where(
				and(
					orgWindow,
					eq(
						contentFilterHourlyStats.category,
						CONTENT_FILTER_STATS_ALL_CATEGORY,
					),
				),
			)
			.groupBy(bucketExpr),
		db
			.select({
				category: contentFilterHourlyStats.category,
				violationCount: violations,
			})
			.from(contentFilterHourlyStats)
			.where(
				and(
					orgWindow,
					ne(
						contentFilterHourlyStats.category,
						CONTENT_FILTER_STATS_ALL_CATEGORY,
					),
				),
			)
			.groupBy(contentFilterHourlyStats.category)
			.orderBy(desc(violations))
			.limit(TOP_ORGANIZATION_CATEGORIES),
		db
			.select({
				usedModel: contentFilterHourlyModelStats.usedModel,
				usedProvider: contentFilterHourlyModelStats.usedProvider,
				sampledCount: modelSampled,
				violationCount: modelViolations,
				blockedCount: modelBlocked,
			})
			.from(contentFilterHourlyModelStats)
			.where(
				and(
					modelWindow,
					eq(
						contentFilterHourlyModelStats.category,
						CONTENT_FILTER_STATS_ALL_CATEGORY,
					),
				),
			)
			.groupBy(
				contentFilterHourlyModelStats.usedModel,
				contentFilterHourlyModelStats.usedProvider,
			)
			.orderBy(desc(modelViolations), desc(modelSampled))
			.limit(TOP_ORGANIZATION_MODELS),
		db
			.select({ ...apiKeyColumns, projectName: tables.project.name })
			.from(contentFilterHourlyApiKeyStats)
			.leftJoin(tables.apiKey, apiKeyJoin)
			.leftJoin(
				tables.project,
				eq(tables.project.id, contentFilterHourlyApiKeyStats.projectId),
			)
			.where(
				and(
					apiKeyWindow,
					eq(
						contentFilterHourlyApiKeyStats.category,
						CONTENT_FILTER_STATS_ALL_CATEGORY,
					),
				),
			)
			.groupBy(
				contentFilterHourlyApiKeyStats.apiKeyId,
				contentFilterHourlyApiKeyStats.projectId,
				tables.apiKey.description,
				tables.apiKey.status,
				tables.project.name,
			)
			.orderBy(
				desc(apiKeyViolations),
				desc(apiKeySampled),
				asc(contentFilterHourlyApiKeyStats.apiKeyId),
			)
			.limit(TOP_ORGANIZATION_API_KEYS),
	]);

	const apiKeyIds = apiKeys.map((row) => row.apiKeyId);
	const apiKeyCategoryRows =
		apiKeyIds.length > 0
			? await db
					.select({
						apiKeyId: contentFilterHourlyApiKeyStats.apiKeyId,
						category: contentFilterHourlyApiKeyStats.category,
						violationCount: apiKeyViolations,
					})
					.from(contentFilterHourlyApiKeyStats)
					.where(
						and(
							apiKeyWindow,
							ne(
								contentFilterHourlyApiKeyStats.category,
								CONTENT_FILTER_STATS_ALL_CATEGORY,
							),
							inArray(contentFilterHourlyApiKeyStats.apiKeyId, apiKeyIds),
						),
					)
					.groupBy(
						contentFilterHourlyApiKeyStats.apiKeyId,
						contentFilterHourlyApiKeyStats.category,
					)
			: [];
	const categoriesByApiKey = new Map<
		string,
		z.infer<typeof categoryCountSchema>[]
	>();
	for (const row of apiKeyCategoryRows) {
		const list = categoriesByApiKey.get(row.apiKeyId) ?? [];
		list.push({
			category: row.category,
			violationCount: Number(row.violationCount),
		});
		categoriesByApiKey.set(row.apiKeyId, list);
	}

	const byBucket = new Map(
		series.map((row) => [new Date(row.bucket).toISOString(), row]),
	);
	const totals = { sampledCount: 0, violationCount: 0, blockedCount: 0 };
	const data = bucketTimestamps.map((timestamp) => {
		const row = byBucket.get(timestamp);
		const point = {
			timestamp,
			sampledCount: Number(row?.sampledCount ?? 0),
			violationCount: Number(row?.violationCount ?? 0),
			blockedCount: Number(row?.blockedCount ?? 0),
		};
		totals.sampledCount += point.sampledCount;
		totals.violationCount += point.violationCount;
		totals.blockedCount += point.blockedCount;
		return point;
	});

	return c.json({
		window,
		bucket,
		totals: {
			...totals,
			violationRate:
				totals.sampledCount > 0
					? totals.violationCount / totals.sampledCount
					: 0,
		},
		topCategories: categories.map((row) => ({
			category: row.category,
			violationCount: Number(row.violationCount),
		})),
		topModels: models.map(toModelBreakdown),
		topApiKeys: apiKeys.map((row) => ({
			...toApiKeyBreakdown(row),
			projectName: row.projectName ?? null,
			topCategories: (categoriesByApiKey.get(row.apiKeyId) ?? [])
				.sort(
					(a, b) =>
						b.violationCount - a.violationCount ||
						a.category.localeCompare(b.category),
				)
				.slice(0, TOP_CATEGORIES),
		})),
		data,
	});
});
