import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import Stripe from "stripe";
import { z } from "zod";

import { deleteResendContact } from "@/auth/config.js";
import { maskToken } from "@/lib/maskToken.js";
import { parseReferralBonusPercent } from "@/lib/referral-bonus.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { getStripe } from "@/routes/payments.js";
import {
	CHAT_PLAN_TX_TYPES,
	DEV_PLAN_TX_TYPES,
	firstRowPerInvoiceFilter,
	LEGACY_DEV_PLAN_TX_TYPES,
	notEndUserNonRevenueFilter,
	notEndUserWalletFilter,
	notPlanFilter,
	paidTransactionFilter,
} from "@/utils/devpass-filter.js";
import {
	HOURLY_BUCKET_THRESHOLD_MINUTES,
	floorToHourStart,
	isHourlyRange,
	pickMappingHistoryTable,
	pickModelHistoryTable,
} from "@/utils/history-window.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	aliasedTable,
	and,
	asc,
	db,
	desc,
	eq,
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
} from "@llmgateway/shared";
import {
	getResendClient,
	fromEmail,
	replyToEmail,
} from "@llmgateway/shared/email";

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

export const admin = new OpenAPIHono<ServerTypes>();

admin.use("/*", adminMiddleware);

const adminMetricsSchema = z.object({
	totalSignups: z.number(),
	verifiedUsers: z.number(),
	payingCustomers: z.number(),
	totalRevenue: z.number(),
	totalProcessed: z.number(),
	totalOrganizations: z.number(),
	totalToppedUp: z.number(),
	totalSpent: z.number(),
	unusedCredits: z.number(),
	overage: z.number(),
	totalGiftedCredits: z.number(),
	totalBonusCredits: z.number(),
	totalRefunds: z.number(),
	// Gross revenue across all products (Stripe `amount`, i.e. before Stripe
	// fees; refunds not netted out), split by product.
	grossRevenue: z.number(),
	grossCreditsRevenue: z.number(),
	grossDevpassRevenue: z.number(),
	grossChatPlansRevenue: z.number(),
	grossProSubscriptionsRevenue: z.number(),
});

const timeseriesRangeSchema = z.enum(["7d", "30d", "90d", "365d", "all"]);

const timeseriesDataPointSchema = z.object({
	date: z.string(),
	signups: z.number(),
	paidCustomers: z.number(),
	revenue: z.number(),
	processed: z.number(),
	refunds: z.number(),
	net: z.number(),
	// Per-day (non-cumulative) values. The cumulative series above start from a
	// pre-range baseline, so clients cannot derive day-one deltas themselves.
	dailySignups: z.number(),
	dailyPaidCustomers: z.number(),
	dailyNet: z.number(),
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
		net: z.number(),
	}),
});

const tokenWindowSchema = z.enum([
	"1h",
	"4h",
	"12h",
	"1d",
	"7d",
	"30d",
	"90d",
	"365d",
]);

const organizationSchema = z.object({
	id: z.string(),
	name: z.string(),
	billingEmail: z.string(),
	kind: z.enum(["default", "chat", "devpass"]),
	plan: z.string(),
	devPlan: z.string(),
	// Manual seat-limit override; null = use the plan default.
	seats: z.number().int().nullable().optional(),
	// Manual API-key-limit override; null = use the plan default.
	apiKeyLimit: z.number().int().nullable().optional(),
	credits: z.string(),
	totalCreditsAllTime: z.string().optional(),
	totalSpent: z.string().optional(),
	createdAt: z.string(),
	status: z.string().nullable(),
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

const orgMetricsSchema = z.object({
	organization: organizationSchema,
	window: tokenWindowSchema,
	startDate: z.string(),
	endDate: z.string(),
	totalRequests: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	inputTokens: z.number(),
	inputCost: z.number(),
	outputTokens: z.number(),
	outputCost: z.number(),
	cachedTokens: z.number(),
	cachedCost: z.number(),
	cacheWriteTokens: z.number(),
	cacheWriteCost: z.number(),
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

const apiKeysListSchema = z.object({
	apiKeys: z.array(apiKeySchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
});

const providerKeyAdminSchema = z.object({
	id: z.string(),
	token: z.string(),
	provider: z.string(),
	name: z.string().nullable(),
	baseUrl: z.string().nullable(),
	status: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

const providerKeysListSchema = z.object({
	providerKeys: z.array(providerKeyAdminSchema),
	total: z.number(),
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

	// Total revenue: completed credit-purchase rows — org credit top-ups AND
	// end-user wallet top-ups (`end_user_topup`, reversed on refund) — using
	// creditAmount to exclude Stripe fees. Excludes gifts, all plan rows
	// (DevPass/legacy subscription/Chat Plan), and the non-revenue end-user rows
	// (developer margin + funded bonus).
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
				notPlanFilter,
				notEndUserNonRevenueFilter,
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

	// Total processed (gross Stripe amounts from completed non-gift, non-plan transactions)
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
				notPlanFilter,
				notEndUserNonRevenueFilter,
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

	// Total refunds (positive `amount` on credit_refund rows — Stripe-side refunds).
	const [refundsRow] = await db
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
				eq(tables.transaction.type, "credit_refund"),
				transactionDateFilter,
			),
		);

	const totalRefunds = Number(refundsRow?.value ?? 0);

	// Gross revenue splits: actual dollars charged via Stripe (`amount`, so
	// including Stripe fees), before netting refunds out.
	//
	// Credits: org credit top-ups + end-user wallet top-ups. Refund reversals
	// are negative same-type rows, so only positive amounts count as gross.
	const [grossCreditsRow] = await db
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
				inArray(tables.transaction.type, ["credit_topup", "end_user_topup"]),
				sql`CAST(${tables.transaction.amount} AS NUMERIC) > 0`,
				transactionDateFilter,
			),
		);

	const grossCreditsRevenue = Number(grossCreditsRow?.value ?? 0);

	// DevPass: dev plan payments (+ legacy `subscription_*` rows on devpass
	// orgs), deduplicated per Stripe invoice. Mirrors /admin/devpass/timeseries.
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
					...DEV_PLAN_TX_TYPES,
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

	const grossRevenue =
		grossCreditsRevenue +
		grossDevpassRevenue +
		grossChatPlansRevenue +
		grossProSubscriptionsRevenue;

	const rawBalance = totalToppedUp - totalSpent;
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
		unusedCredits,
		overage,
		totalGiftedCredits,
		totalBonusCredits,
		totalRefunds,
		grossRevenue,
		grossCreditsRevenue,
		grossDevpassRevenue,
		grossChatPlansRevenue,
		grossProSubscriptionsRevenue,
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

	// Revenue per day (creditAmount, post-fees; matches /admin/metrics totalRevenue)
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
				notPlanFilter,
				notEndUserNonRevenueFilter,
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
				notPlanFilter,
				notEndUserNonRevenueFilter,
				gte(tables.transaction.createdAt, startDate),
				lte(tables.transaction.createdAt, endDate),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Refunds per day (positive amount on credit_refund rows)
	const refundsPerDay = await db
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
				eq(tables.transaction.type, "credit_refund"),
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
				notPlanFilter,
				notEndUserNonRevenueFilter,
				sql`${tables.transaction.createdAt} < ${startDate}`,
			),
		);
	const preRangeRevenue = Number(preRangeRevenueRow?.total ?? 0);

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
				notPlanFilter,
				notEndUserNonRevenueFilter,
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
	for (const row of refundsPerDay) {
		refundsMap.set(row.date, Number(row.total));
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
		net: number;
		dailySignups: number;
		dailyPaidCustomers: number;
		dailyNet: number;
	}> = [];
	let cumulativePaid = preRangeCount;
	let totalSignups = 0;
	let totalRevenue = preRangeRevenue;
	let totalProcessed = preRangeProcessed;
	let totalRefunds = preRangeRefunds;

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
		const dailyPaidCustomers = newPaidMap.get(dateStr) ?? 0;
		cumulativePaid += dailyPaidCustomers;

		totalSignups += dailySignups;
		totalRevenue += dailyRevenue;
		totalProcessed += dailyProcessed;
		totalRefunds += dailyRefunds;

		data.push({
			date: dateStr,
			signups: totalSignups,
			paidCustomers: cumulativePaid,
			revenue: totalRevenue,
			processed: totalProcessed,
			refunds: totalRefunds,
			net: totalRevenue - totalRefunds,
			dailySignups,
			dailyPaidCustomers,
			dailyNet: dailyRevenue - dailyRefunds,
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
			net: totalRevenue - totalRefunds,
		},
	});
});

const globalStatsRangeSchema = z.enum(["7d", "30d", "90d", "365d", "all"]);
const globalStatsGroupBySchema = z.enum(["model", "source"]);
const globalStatsModelViewSchema = z.enum(["mapping", "canonical", "provider"]);
const globalStatsDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

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
	totals: globalStatsMetricsSchema,
	timeseries: z.array(globalStatsTimeseriesPointSchema),
	timeseriesBreakdown: z.array(globalStatsTimeseriesBreakdownPointSchema),
	breakdown: z.array(globalStatsBreakdownItemSchema),
});

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

	const dayMs = 24 * 60 * 60 * 1000;
	const MAX_GLOBAL_STATS_DAYS = 731;

	const sourceTable =
		groupBy === "model" ? globalModelStats : globalSourceStats;

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
			.from(sourceTable);
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
		requestCount:
			sql<number>`COALESCE(SUM(${sourceTable.requestCount}), 0)::int`.as(
				"requestCount",
			),
		errorCount:
			sql<number>`COALESCE(SUM(${sourceTable.errorCount}), 0)::int`.as(
				"errorCount",
			),
		cacheCount:
			sql<number>`COALESCE(SUM(${sourceTable.cacheCount}), 0)::int`.as(
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
		cost: sql<number>`COALESCE(SUM(${sourceTable.cost}), 0)::float8`.as("cost"),
		inputCost:
			sql<number>`COALESCE(SUM(${sourceTable.inputCost}), 0)::float8`.as(
				"inputCost",
			),
		cachedInputCost:
			sql<number>`COALESCE(SUM(${sourceTable.cachedInputCost}), 0)::float8`.as(
				"cachedInputCost",
			),
		outputCost:
			sql<number>`COALESCE(SUM(${sourceTable.outputCost}), 0)::float8`.as(
				"outputCost",
			),
	};

	const dateExpr =
		sql<string>`to_char(${sourceTable.dayTimestamp}, 'YYYY-MM-DD')`.as("date");

	const timeseriesRows = await db
		.select({
			date: dateExpr,
			...metricSums,
		})
		.from(sourceTable)
		.where(
			and(
				gte(sourceTable.dayTimestamp, startDate),
				lte(sourceTable.dayTimestamp, endDate),
			),
		)
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

	const breakdownRows =
		groupBy === "model"
			? await db
					.select({
						usedModel: globalModelStats.usedModel,
						usedProvider: globalModelStats.usedProvider,
						...metricSums,
					})
					.from(globalModelStats)
					.where(
						and(
							gte(globalModelStats.dayTimestamp, startDate),
							lte(globalModelStats.dayTimestamp, endDate),
						),
					)
					.groupBy(globalModelStats.usedModel, globalModelStats.usedProvider)
					.orderBy(desc(metricSums.requestCount))
			: await db
					.select({
						source: globalSourceStats.source,
						...metricSums,
					})
					.from(globalSourceStats)
					.where(
						and(
							gte(globalSourceStats.dayTimestamp, startDate),
							lte(globalSourceStats.dayTimestamp, endDate),
						),
					)
					.groupBy(globalSourceStats.source)
					.orderBy(desc(metricSums.requestCount));

	const breakdown: z.infer<typeof globalStatsBreakdownItemSchema>[] =
		groupBy === "model" && modelView === "canonical"
			? aggregateModelRowsByCanonicalId(
					breakdownRows as Array<
						(typeof breakdownRows)[number] & {
							usedModel: string;
						}
					>,
				)
			: groupBy === "model" && modelView === "provider"
				? aggregateModelRowsByProvider(
						breakdownRows as Array<
							(typeof breakdownRows)[number] & {
								usedProvider: string;
							}
						>,
					)
				: breakdownRows.map((row) => {
						const isModel = "usedModel" in row;
						const key = isModel ? row.usedModel : row.source;
						const label = isModel ? row.usedModel : row.source;
						return {
							key,
							label,
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
					.where(
						and(
							gte(globalModelStats.dayTimestamp, startDate),
							lte(globalModelStats.dayTimestamp, endDate),
						),
					)
					.groupBy(
						globalModelStats.dayTimestamp,
						globalModelStats.usedModel,
						globalModelStats.usedProvider,
					)
			: await db
					.select({
						date: dateExpr,
						source: globalSourceStats.source,
						...metricSums,
					})
					.from(globalSourceStats)
					.where(
						and(
							gte(globalSourceStats.dayTimestamp, startDate),
							lte(globalSourceStats.dayTimestamp, endDate),
						),
					)
					.groupBy(globalSourceStats.dayTimestamp, globalSourceStats.source);

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
			key = (
				row as (typeof timeseriesBreakdownRows)[number] & { source: string }
			).source;
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
				label: key,
				requestCount: Number(row.requestCount),
				cost: Number(row.cost),
				totalTokens: Number(row.totalTokens),
			});
		}
	}
	const timeseriesBreakdown = Array.from(timeseriesBreakdownMap.values());

	return c.json({
		start: startDate.toISOString().split("T")[0],
		end: endDate.toISOString().split("T")[0],
		groupBy,
		modelView,
		totals,
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

function aggregateModelRowsByCanonicalId(
	rows: Array<{
		usedModel: string;
		requestCount: number;
		errorCount: number;
		cacheCount: number;
		inputTokens: number;
		cachedTokens: number;
		outputTokens: number;
		totalTokens: number;
		cost: number;
		inputCost: number;
		cachedInputCost: number;
		outputCost: number;
	}>,
): z.infer<typeof globalStatsBreakdownItemSchema>[] {
	const aggregated = new Map<
		string,
		z.infer<typeof globalStatsBreakdownItemSchema>
	>();
	for (const row of rows) {
		const canonical = extractCanonicalModelId(row.usedModel);
		const existing = aggregated.get(canonical);
		if (existing) {
			existing.requestCount += Number(row.requestCount);
			existing.errorCount += Number(row.errorCount);
			existing.cacheCount += Number(row.cacheCount);
			existing.inputTokens += Number(row.inputTokens);
			existing.cachedTokens += Number(row.cachedTokens);
			existing.outputTokens += Number(row.outputTokens);
			existing.totalTokens += Number(row.totalTokens);
			existing.cost += Number(row.cost);
			existing.inputCost += Number(row.inputCost);
			existing.cachedInputCost += Number(row.cachedInputCost);
			existing.outputCost += Number(row.outputCost);
		} else {
			aggregated.set(canonical, {
				key: canonical,
				label: canonical,
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
	}
	return Array.from(aggregated.values()).sort(
		(a, b) => b.requestCount - a.requestCount,
	);
}

function aggregateModelRowsByProvider(
	rows: Array<{
		usedProvider: string;
		requestCount: number;
		errorCount: number;
		cacheCount: number;
		inputTokens: number;
		cachedTokens: number;
		outputTokens: number;
		totalTokens: number;
		cost: number;
		inputCost: number;
		cachedInputCost: number;
		outputCost: number;
	}>,
): z.infer<typeof globalStatsBreakdownItemSchema>[] {
	const aggregated = new Map<
		string,
		z.infer<typeof globalStatsBreakdownItemSchema>
	>();
	for (const row of rows) {
		const provider = row.usedProvider || "unknown";
		const existing = aggregated.get(provider);
		if (existing) {
			existing.requestCount += Number(row.requestCount);
			existing.errorCount += Number(row.errorCount);
			existing.cacheCount += Number(row.cacheCount);
			existing.inputTokens += Number(row.inputTokens);
			existing.cachedTokens += Number(row.cachedTokens);
			existing.outputTokens += Number(row.outputTokens);
			existing.totalTokens += Number(row.totalTokens);
			existing.cost += Number(row.cost);
			existing.inputCost += Number(row.inputCost);
			existing.cachedInputCost += Number(row.cachedInputCost);
			existing.outputCost += Number(row.outputCost);
		} else {
			aggregated.set(provider, {
				key: provider,
				label: provider,
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
	}
	return Array.from(aggregated.values()).sort(
		(a, b) => b.requestCount - a.requestCount,
	);
}

admin.openapi(getOrganizations, async (c) => {
	const query = c.req.valid("query");
	const limit = query.limit ?? 50;
	const offset = query.offset ?? 0;
	const search = query.search;
	const sortBy = query.sortBy ?? "createdAt";
	const sortOrder = query.sortOrder ?? "desc";

	const searchLower = search?.toLowerCase();
	const whereClause = searchLower
		? or(
				sql`LOWER(${tables.organization.name}) LIKE ${`%${searchLower}%`}`,
				sql`LOWER(${tables.organization.billingEmail}) LIKE ${`%${searchLower}%`}`,
				sql`${tables.organization.id} LIKE ${`%${search}%`}`,
				sql`EXISTS (SELECT 1 FROM ${tables.userOrganization} uo JOIN ${tables.user} u ON uo.user_id = u.id WHERE uo.organization_id = ${tables.organization.id} AND LOWER(u.email) LIKE ${`%${searchLower}%`})`,
			)
		: undefined;

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

	// Subquery for total spent (usage cost) per org
	const totalSpentSub = db
		.select({
			organizationId: tables.project.organizationId,
			total:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
					"total_spent",
				),
		})
		.from(projectHourlyStats)
		.innerJoin(
			tables.project,
			eq(projectHourlyStats.projectId, tables.project.id),
		)
		.groupBy(tables.project.organizationId)
		.as("total_spent");

	// Subquery for owner user per org
	const ownerSub = db
		.select({
			organizationId: tables.userOrganization.organizationId,
			userId: tables.user.id,
			userName: tables.user.name,
			userEmail: tables.user.email,
		})
		.from(tables.userOrganization)
		.innerJoin(tables.user, eq(tables.userOrganization.userId, tables.user.id))
		.where(eq(tables.userOrganization.role, "owner"))
		.as("owner_sub");

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
			credits: tables.organization.credits,
			createdAt: tables.organization.createdAt,
			status: tables.organization.status,
			totalCreditsAllTime:
				sql<string>`COALESCE(${allTimeCredits.total}, '0')`.as(
					"totalCreditsAllTime",
				),
			totalSpent: sql<string>`COALESCE(${totalSpentSub.total}, '0')`.as(
				"totalSpent",
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
		.orderBy(orderFn(sortColumn))
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
			credits: String(org.credits),
			totalCreditsAllTime: String(org.totalCreditsAllTime ?? "0"),
			totalSpent: String(org.totalSpent ?? "0"),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
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
	let inputTokens = 0;
	let inputCost = 0;
	let outputTokens = 0;
	let outputCost = 0;
	let cachedTokens = 0;
	let cachedCost = 0;
	let cacheWriteTokens = 0;
	let cacheWriteCost = 0;
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
				totalCost: sql<number>`COALESCE(SUM(${projectHourlyStats.cost}), 0)`.as(
					"totalCost",
				),
				inputCost:
					sql<number>`COALESCE(SUM(${projectHourlyStats.inputCost}), 0)`.as(
						"inputCost",
					),
				outputCost:
					sql<number>`COALESCE(SUM(${projectHourlyStats.outputCost}), 0)`.as(
						"outputCost",
					),
				discountSavings:
					sql<number>`COALESCE(SUM(${projectHourlyStats.discountSavings}), 0)`.as(
						"discountSavings",
					),
				cachedInputCost:
					sql<number>`COALESCE(SUM(${projectHourlyStats.cachedInputCost}), 0)`.as(
						"cachedInputCost",
					),
				cacheWriteInputCost:
					sql<number>`COALESCE(SUM(${projectHourlyStats.cacheWriteInputCost}), 0)`.as(
						"cacheWriteInputCost",
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
			inputTokens = Number(totals.inputTokens) || 0;
			inputCost = Number(totals.inputCost) || 0;
			outputTokens = Number(totals.outputTokens) || 0;
			outputCost = Number(totals.outputCost) || 0;
			cachedTokens = Number(totals.cachedTokens) || 0;
			cachedCost = Number(totals.cachedInputCost) || 0;
			cacheWriteTokens = Number(totals.cacheWriteTokens) || 0;
			cacheWriteCost = Number(totals.cacheWriteInputCost) || 0;
			discountSavings = Number(totals.discountSavings) || 0;
		}

		// Query model stats for most used model (by cost)
		const modelRows = await db
			.select({
				usedModel: projectHourlyModelStats.usedModel,
				usedProvider: projectHourlyModelStats.usedProvider,
				totalCost:
					sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as(
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

	return c.json({
		organization: {
			id: org.id,
			name: org.name,
			billingEmail: org.billingEmail,
			kind: org.kind,
			plan: org.plan,
			devPlan: org.devPlan,
			seats: org.seats,
			apiKeyLimit: org.apiKeyLimit,
			credits: String(org.credits),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
		},
		window: windowParam,
		startDate: startDate.toISOString(),
		endDate: now.toISOString(),
		totalRequests,
		totalTokens,
		totalCost,
		inputTokens,
		inputCost,
		outputTokens,
		outputCost,
		cachedTokens,
		cachedCost,
		cacheWriteTokens,
		cacheWriteCost,
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
			seats: org.seats,
			apiKeyLimit: org.apiKeyLimit,
			credits: String(org.credits),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
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
		});
	}

	const [countResult] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.apiKey)
		.where(inArray(tables.apiKey.projectId, ids));

	const total = Number(countResult?.count ?? 0);

	const apiKeys = await db
		.select({
			id: tables.apiKey.id,
			token: tables.apiKey.token,
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
		.where(inArray(tables.apiKey.projectId, ids))
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
	});
});

admin.openapi(getOrganizationProviderKeys, async (c) => {
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

	const providerKeys = await db
		.select({
			id: tables.providerKey.id,
			token: tables.providerKey.token,
			provider: tables.providerKey.provider,
			name: tables.providerKey.name,
			baseUrl: tables.providerKey.baseUrl,
			status: tables.providerKey.status,
			createdAt: tables.providerKey.createdAt,
			updatedAt: tables.providerKey.updatedAt,
		})
		.from(tables.providerKey)
		.where(eq(tables.providerKey.organizationId, orgId))
		.orderBy(desc(tables.providerKey.createdAt));

	return c.json({
		providerKeys: providerKeys.map((k) => ({
			...k,
			token: maskToken(k.token, 6),
			createdAt: k.createdAt.toISOString(),
			updatedAt: k.updatedAt.toISOString(),
		})),
		total: providerKeys.length,
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
	inputTokens: z.number(),
	inputCost: z.number(),
	outputTokens: z.number(),
	outputCost: z.number(),
	cachedTokens: z.number(),
	cachedCost: z.number(),
	cacheWriteTokens: z.number(),
	cacheWriteCost: z.number(),
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
	let inputTokens = 0;
	let inputCost = 0;
	let outputTokens = 0;
	let outputCost = 0;
	let cachedTokens = 0;
	let cachedCost = 0;
	let cacheWriteTokens = 0;
	let cacheWriteCost = 0;
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
			totalCost: sql<number>`COALESCE(SUM(${projectHourlyStats.cost}), 0)`.as(
				"totalCost",
			),
			inputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.inputCost}), 0)`.as(
					"inputCost",
				),
			outputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.outputCost}), 0)`.as(
					"outputCost",
				),
			discountSavings:
				sql<number>`COALESCE(SUM(${projectHourlyStats.discountSavings}), 0)`.as(
					"discountSavings",
				),
			cachedInputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.cachedInputCost}), 0)`.as(
					"cachedInputCost",
				),
			cacheWriteInputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.cacheWriteInputCost}), 0)`.as(
					"cacheWriteInputCost",
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
		inputTokens = Number(totals.inputTokens) || 0;
		inputCost = Number(totals.inputCost) || 0;
		outputTokens = Number(totals.outputTokens) || 0;
		outputCost = Number(totals.outputCost) || 0;
		cachedTokens = Number(totals.cachedTokens) || 0;
		cachedCost = Number(totals.cachedInputCost) || 0;
		cacheWriteTokens = Number(totals.cacheWriteTokens) || 0;
		cacheWriteCost = Number(totals.cacheWriteInputCost) || 0;
		discountSavings = Number(totals.discountSavings) || 0;
	}

	// Query model stats for most used model (by cost)
	const modelRows = await db
		.select({
			usedModel: projectHourlyModelStats.usedModel,
			usedProvider: projectHourlyModelStats.usedProvider,
			totalCost:
				sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as(
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
		inputTokens,
		inputCost,
		outputTokens,
		outputCost,
		cachedTokens,
		cachedCost,
		cacheWriteTokens,
		cacheWriteCost,
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
	finishReason: z.string().nullable(),
	unifiedFinishReason: z.string().nullable(),
	cached: z.boolean().nullable(),
	streamed: z.boolean().nullable(),
	canceled: z.boolean().nullable(),
	retried: z.boolean().nullable(),
	retriedByLogId: z.string().nullable(),
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
			finishReason: tables.log.finishReason,
			unifiedFinishReason: tables.log.unifiedFinishReason,
			cached: tables.log.cached,
			streamed: tables.log.streamed,
			canceled: tables.log.canceled,
			retried: tables.log.retried,
			retriedByLogId: tables.log.retriedByLogId,
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

// Build a map of provider -> Set of valid root model IDs served by that provider.
// Only root model IDs are accepted as discount/rate-limit targets — the
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

// All valid root model IDs.
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
	// modelId is the canonical root model id — the provider-specific upstream
	// externalId is never exposed here or stored as a discount target. modelName
	// in this response is the root model's human-readable display name.
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
	// modelId is the canonical root model id — the provider-specific upstream
	// externalId is never exposed here or stored as a rate-limit target.
	// modelName in this response is the root model's human-readable display
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
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	modelCount: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
	updatedAt: z.string(),
});

const providersListSchema = z.object({
	providers: z.array(providerStatsSchema),
	total: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
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
				cachedCount: sql<number>`COALESCE(SUM(${mph.cachedCount}), 0)`.as(
					"cachedCount",
				),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${mph.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				totalCost: sql<number>`COALESCE(SUM(${mph.totalCost}), 0)`.as(
					"totalCost",
				),
				avgTimeToFirstToken: sql<
					number | null
				>`CASE WHEN SUM(${mph.logsCount}) - SUM(${mph.cachedCount}) > 0 THEN SUM(${mph.totalTimeToFirstToken})::float / (SUM(${mph.logsCount}) - SUM(${mph.cachedCount})) ELSE NULL END`.as(
					"avgTimeToFirstToken",
				),
			})
			.from(mph)
			.where(and(gte(mphTs, startDate), lt(mphTs, endDateExclusive)))
			.groupBy(mph.providerId)
			.as("provider_stats_sub");

		const orderFn = sortOrder === "asc" ? asc : desc;
		const sortColumnMap = {
			name: tables.provider.name,
			status: tables.provider.status,
			logsCount: sql`COALESCE(${providerStatsSub.logsCount}, 0)`,
			errorsCount: sql`COALESCE(${providerStatsSub.errorsCount}, 0)`,
			cachedCount: sql`COALESCE(${providerStatsSub.cachedCount}, 0)`,
			totalCost: sql`COALESCE(${providerStatsSub.totalCost}, 0)`,
			avgTimeToFirstToken: sql`COALESCE(${providerStatsSub.avgTimeToFirstToken}, ${tables.provider.avgTimeToFirstToken})`,
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
						sql<number>`COALESCE(SUM(COALESCE(${providerStatsSub.totalCost}, 0)), 0)`.as(
							"totalCost",
						),
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
					cachedCount:
						sql<number>`COALESCE(${providerStatsSub.cachedCount}, 0)`.as(
							"cachedCount",
						),
					avgTimeToFirstToken: sql<
						number | null
					>`COALESCE(${providerStatsSub.avgTimeToFirstToken}, ${tables.provider.avgTimeToFirstToken})`.as(
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
				.orderBy(orderFn(sortColumn)),
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
				cachedCount: Number(r.cachedCount ?? 0),
				avgTimeToFirstToken: r.avgTimeToFirstToken,
				modelCount: Number(r.modelCount ?? 0),
				totalTokens: Number(r.totalTokens ?? 0),
				totalCost: Number(r.totalCost ?? 0),
				updatedAt: r.updatedAt.toISOString(),
			})),
			total: rows.length,
			totalTokens: totalTokensAgg,
			totalCost: totalCostAgg,
		});
	}

	const orderFn = sortOrder === "asc" ? asc : desc;

	const sortColumnMap = {
		name: tables.provider.name,
		status: tables.provider.status,
		logsCount: tables.provider.logsCount,
		errorsCount: tables.provider.errorsCount,
		cachedCount: tables.provider.cachedCount,
		totalCost: sql`0`,
		avgTimeToFirstToken: tables.provider.avgTimeToFirstToken,
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
			cachedCount: tables.provider.cachedCount,
			avgTimeToFirstToken: tables.provider.avgTimeToFirstToken,
			modelCount: sql<number>`COALESCE(${modelCountSub.count}, 0)`.as(
				"modelCount",
			),
			updatedAt: tables.provider.updatedAt,
		})
		.from(tables.provider)
		.leftJoin(modelCountSub, eq(tables.provider.id, modelCountSub.providerId))
		.orderBy(orderFn(sortColumn));

	return c.json({
		providers: rows.map((r) => ({
			id: r.id,
			name: r.name,
			color: r.color,
			status: r.status,
			logsCount: r.logsCount,
			errorsCount: r.errorsCount,
			cachedCount: r.cachedCount,
			avgTimeToFirstToken: r.avgTimeToFirstToken,
			modelCount: Number(r.modelCount),
			totalTokens: 0,
			totalCost: 0,
			updatedAt: r.updatedAt.toISOString(),
		})),
		total: rows.length,
		totalTokens: 0,
		totalCost: 0,
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
				totalCost: sql<number>`COALESCE(SUM(${mh.totalCost}), 0)`.as(
					"totalCost",
				),
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
			errorsCount: sql`COALESCE(${modelAggSub.errorsCount}, 0)`,
			clientErrorsCount: sql`COALESCE(${modelAggSub.clientErrorsCount}, 0)`,
			gatewayErrorsCount: sql`COALESCE(${modelAggSub.gatewayErrorsCount}, 0)`,
			upstreamErrorsCount: sql`COALESCE(${modelAggSub.upstreamErrorsCount}, 0)`,
			cachedCount: sql`COALESCE(${modelAggSub.cachedCount}, 0)`,
			avgTimeToFirstToken: tables.model.avgTimeToFirstToken,
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
					sql<number>`COALESCE(SUM(COALESCE(${modelAggSub.totalCost}, 0)), 0)`.as(
						"totalCost",
					),
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
				avgTimeToFirstToken: tables.model.avgTimeToFirstToken,
				providerCount: sql<number>`COALESCE(${providerCountSub.count}, 0)`.as(
					"providerCount",
				),
				totalTokens: sql<number>`COALESCE(${modelAggSub.totalTokens}, 0)`.as(
					"totalTokens",
				),
				totalCost: sql<number>`COALESCE(${modelAggSub.totalCost}, 0)`.as(
					"totalCost",
				),
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
				.orderBy(orderFn(sortColumn))
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
		errorsCount: tables.model.errorsCount,
		clientErrorsCount: tables.model.clientErrorsCount,
		gatewayErrorsCount: tables.model.gatewayErrorsCount,
		upstreamErrorsCount: tables.model.upstreamErrorsCount,
		cachedCount: tables.model.cachedCount,
		avgTimeToFirstToken: tables.model.avgTimeToFirstToken,
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
			avgTimeToFirstToken: tables.model.avgTimeToFirstToken,
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
		.orderBy(orderFn(sortColumn))
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
				updatedAt: model.updatedAt.toISOString(),
			},
			providers: statsRows.map((r) => ({
				providerId: r.usedProvider,
				providerName: providerNameMap.get(r.usedProvider) ?? r.usedProvider,
				logsCount: Number(r.logsCount),
				errorsCount: Number(r.errorsCount),
				cachedCount: Number(r.cachedCount),
				avgTimeToFirstToken: null,
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
				avgTimeToFirstToken: tables.modelProviderMapping.avgTimeToFirstToken,
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
			})
			.from(mph)
			.where(and(eq(mph.modelId, modelId), gte(mphTs, startDate)))
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
			const nonCached = logsCount - cachedCount;
			const totalTtft = Number(r.totalTtft ?? 0);
			return [
				r.providerId,
				{
					logsCount,
					errorsCount: Number(r.errorsCount ?? 0),
					cachedCount,
					avgTtft: nonCached > 0 ? totalTtft / nonCached : null,
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
		},
	);
	const hasWindowData = agg.logsCount > 0;
	const aggNonCached = agg.logsCount - agg.cachedCount;
	const aggAvgTtft = aggNonCached > 0 ? agg.totalTtft / aggNonCached : null;

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
				? (aggAvgTtft ?? model.avgTimeToFirstToken)
				: model.avgTimeToFirstToken,
			providerCount: providerStats.length,
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

// Manage an organization's plan tier, seat-limit and API-key-limit overrides
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
						plan: z.enum(["free", "pro", "enterprise"]),
						// Null clears the override and reverts to the plan default.
						seats: z.number().int().min(0).max(100000).nullable(),
						// Null clears the override and reverts to the plan default.
						apiKeyLimit: z.number().int().min(0).max(100000).nullable(),
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
						plan: z.string(),
						seats: z.number().int().nullable(),
						apiKeyLimit: z.number().int().nullable(),
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
	const { plan, seats, apiKeyLimit } = c.req.valid("json");

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
			plan,
			seats,
			apiKeyLimit,
		})
		.where(eq(tables.organization.id, orgId));

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "organization.manage",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			previousPlan: org.plan,
			newPlan: plan,
			previousSeats: org.seats,
			newSeats: seats,
			previousApiKeyLimit: org.apiKeyLimit,
			newApiKeyLimit: apiKeyLimit,
		},
	});

	return c.json({
		message: "Organization updated successfully",
		plan,
		seats,
		apiKeyLimit,
	});
});

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

	const memberLinks = await db.query.userOrganization.findMany({
		where: { organizationId: { eq: orgId } },
		columns: { userId: true },
	});
	const memberUserIds = memberLinks.map((m) => m.userId);

	await db.transaction(async (tx) => {
		await tx
			.update(tables.organization)
			.set({ status })
			.where(eq(tables.organization.id, orgId));

		if (memberUserIds.length === 0) {
			return;
		}

		if (status === "deleted") {
			await tx
				.update(tables.user)
				.set({ status: "deactivated" })
				.where(inArray(tables.user.id, memberUserIds));

			await tx
				.delete(tables.session)
				.where(inArray(tables.session.userId, memberUserIds));
		} else {
			const otherLinks = await tx.query.userOrganization.findMany({
				where: { userId: { in: memberUserIds } },
				with: {
					organization: {
						columns: { id: true, status: true },
					},
				},
			});

			const stillBlocked = new Set(
				otherLinks
					.filter(
						(link) =>
							link.organization?.id !== orgId &&
							link.organization?.status === "deleted",
					)
					.map((link) => link.userId),
			);

			const reactivateIds = memberUserIds.filter((id) => !stillBlocked.has(id));

			if (reactivateIds.length > 0) {
				await tx
					.update(tables.user)
					.set({ status: "active" })
					.where(inArray(tables.user.id, reactivateIds));
			}
		}
	});

	if (status === "deleted" && memberUserIds.length > 0) {
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
		userId: user!.id,
		action:
			status === "deleted" ? "organization.delete" : "organization.update",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			resourceName: org.name,
			previousStatus: org.status ?? "active",
			newStatus: status,
			source: "admin",
			affectedUserCount: memberUserIds.length,
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
	},
});

admin.openapi(blockOrganizationRoute, async (c) => {
	const user = c.get("user");
	const { orgId } = c.req.valid("param");

	const org = await db.query.organization.findFirst({
		where: { id: { eq: orgId } },
	});

	if (!org) {
		throw new HTTPException(404, { message: "Organization not found" });
	}

	const subscriptionIds = [
		org.stripeSubscriptionId,
		org.devPlanStripeSubscriptionId,
	].filter((id): id is string => Boolean(id));

	// Cancel every Stripe subscription before mutating local state. Treat
	// already-cancelled or missing subscriptions as success (their terminal
	// state matches what we want anyway); re-throw other Stripe errors so the
	// admin can retry once Stripe is healthy.
	const cancelledSubscriptionIds: string[] = [];
	for (const subscriptionId of subscriptionIds) {
		try {
			await getStripe().subscriptions.cancel(subscriptionId, {
				invoice_now: false,
				prorate: false,
			});
			cancelledSubscriptionIds.push(subscriptionId);
		} catch (error) {
			if (
				error instanceof Stripe.errors.StripeInvalidRequestError &&
				(error.code === "resource_missing" ||
					error.statusCode === 404 ||
					error.message.includes("already been canceled") ||
					error.message.includes("already canceled"))
			) {
				logger.info(
					`Stripe subscription ${subscriptionId} already terminal, skipping cancel: ${error.message}`,
				);
				cancelledSubscriptionIds.push(subscriptionId);
				continue;
			}
			throw error;
		}
	}

	const memberLinks = await db.query.userOrganization.findMany({
		where: { organizationId: { eq: orgId } },
		columns: { userId: true },
	});
	const memberUserIds = memberLinks.map((m) => m.userId);

	// Only deactivate users whose remaining org memberships are all already
	// deleted — mirrors the re-enable flow in setOrganizationStatus. A member
	// who still belongs to another active org keeps their access there.
	let userIdsToDeactivate: string[] = [];
	if (memberUserIds.length > 0) {
		const otherLinks = await db.query.userOrganization.findMany({
			where: { userId: { in: memberUserIds } },
			with: {
				organization: {
					columns: { id: true, status: true },
				},
			},
		});

		const hasOtherActiveOrg = new Set(
			otherLinks
				.filter(
					(link) =>
						link.organization?.id !== orgId &&
						link.organization?.status !== "deleted",
				)
				.map((link) => link.userId),
		);

		userIdsToDeactivate = memberUserIds.filter(
			(id) => !hasOtherActiveOrg.has(id),
		);
	}

	await db.transaction(async (tx) => {
		await tx
			.update(tables.organization)
			.set({
				status: "deleted",
				devPlan: "none",
				devPlanStripeSubscriptionId: null,
				devPlanCancelled: true,
				devPlanExpiresAt: new Date(),
				subscriptionCancelled: true,
			})
			.where(eq(tables.organization.id, orgId));

		if (userIdsToDeactivate.length > 0) {
			await tx
				.update(tables.user)
				.set({ status: "deactivated" })
				.where(inArray(tables.user.id, userIdsToDeactivate));

			await tx
				.delete(tables.session)
				.where(inArray(tables.session.userId, userIdsToDeactivate));
		}
	});

	if (userIdsToDeactivate.length > 0) {
		const members = await db.query.user.findMany({
			where: { id: { in: userIdsToDeactivate } },
			columns: { email: true },
		});

		await Promise.all(
			members.map((member) => deleteResendContact(member.email)),
		);
	}

	await logAuditEvent({
		organizationId: orgId,
		userId: user!.id,
		action: "organization.block",
		resourceType: "organization",
		resourceId: orgId,
		metadata: {
			resourceName: org.name,
			previousStatus: org.status ?? "active",
			cancelledSubscriptionIds,
			memberCount: memberUserIds.length,
			deactivatedUserCount: userIdsToDeactivate.length,
			source: "admin",
		},
	});

	return c.json({
		message: "Organization blocked and subscriptions cancelled.",
		cancelledSubscriptionIds,
	});
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
		totalTokens: number;
		totalCost?: number;
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
		const totalTimeToFirstToken = Number(r.totalTimeToFirstToken);
		const totalTokens = Number(r.totalTokens);
		const nonCached = logsCount - cachedCount;

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
				nonCached > 0 ? Math.round(totalTimeToFirstToken / nonCached) : null,
			avgDuration: logsCount > 0 ? Math.round(totalDuration / logsCount) : null,
			totalTokens,
			totalCost,
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
				totalTokens:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalTokens})`.as(
						"total_tokens",
					),
				totalCost:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalCost})`.as(
						"total_cost",
					),
			})
			.from(modelProviderMappingHistoryHourly)
			.where(
				and(
					eq(modelProviderMappingHistoryHourly.providerId, providerId),
					gte(modelProviderMappingHistoryHourly.hourTimestamp, hourStartDate),
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
				totalTokens:
					sql<number>`SUM(${modelProviderMappingHistory.totalTokens})`.as(
						"total_tokens",
					),
			})
			.from(modelProviderMappingHistory)
			.where(
				and(
					eq(modelProviderMappingHistory.providerId, providerId),
					gte(modelProviderMappingHistory.minuteTimestamp, startDate),
				),
			)
			.groupBy(modelProviderMappingHistory.minuteTimestamp)
			.orderBy(asc(modelProviderMappingHistory.minuteTimestamp)),
		db
			.select({
				hourTimestamp: projectHourlyModelStats.hourTimestamp,
				cost: sql<number>`SUM(${projectHourlyModelStats.cost})`,
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
				cost: sql<number>`SUM(${projectHourlyModelStats.cost})`.as("cost"),
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
				totalTokens: sql<number>`SUM(${modelHistoryHourly.totalTokens})`.as(
					"total_tokens",
				),
				totalCost: sql<number>`SUM(${modelHistoryHourly.totalCost})`.as(
					"total_cost",
				),
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
			totalTokens: sql<number>`SUM(${modelHistory.totalTokens})`.as(
				"total_tokens",
			),
			totalCost: sql<number>`SUM(${modelHistory.totalCost})`.as("total_cost"),
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
			: undefined;

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
				cost: sql<number>`SUM(${projectHourlyModelStats.cost})`.as("cost"),
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
				: undefined;

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
				totalTokens:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalTokens})`.as(
						"total_tokens",
					),
				totalCost:
					sql<number>`SUM(${modelProviderMappingHistoryHourly.totalCost})`.as(
						"total_cost",
					),
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
			totalTokens:
				sql<number>`SUM(${modelProviderMappingHistory.totalTokens})`.as(
					"total_tokens",
				),
			totalCost: sql<number>`SUM(${modelProviderMappingHistory.totalCost})`.as(
				"total_cost",
			),
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
				avgTimeToFirstToken: tables.modelProviderMapping.avgTimeToFirstToken,
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
				totalCost: sql<number>`COALESCE(SUM(${mph.totalCost}), 0)`.as(
					"total_cost",
				),
			})
			.from(mph)
			.where(and(eq(mph.providerId, providerId), gte(mphTs, startDate)))
			.groupBy(mph.modelId),
	]);

	const statsByModel = new Map(statsRows.map((r) => [r.modelId, r]));

	const modelsOut = mappings.map((m) => {
		const s = statsByModel.get(m.modelId);
		const logsCount = Number(s?.logsCount ?? 0);
		const cachedCount = Number(s?.cachedCount ?? 0);
		const nonCached = logsCount - cachedCount;
		const totalTtft = Number(s?.totalTtft ?? 0);
		const avgTtft = nonCached > 0 ? totalTtft / nonCached : null;
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
		},
	);
	const hasWindowData = agg.logsCount > 0;
	const aggNonCached = agg.logsCount - agg.cachedCount;
	const aggAvgTtft = aggNonCached > 0 ? agg.totalTtft / aggNonCached : null;

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
				? (aggAvgTtft ?? providerRow.avgTimeToFirstToken)
				: providerRow.avgTimeToFirstToken,
			modelCount: mappings.length,
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
			avgTimeToFirstToken: tables.modelProviderMapping.avgTimeToFirstToken,
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
			avgTtft: sql<
				number | null
			>`CASE WHEN SUM(${mph.logsCount}) - SUM(${mph.cachedCount}) > 0 THEN SUM(${mph.totalTimeToFirstToken})::float / (SUM(${mph.logsCount}) - SUM(${mph.cachedCount})) ELSE NULL END`.as(
				"avg_ttft",
			),
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
});

const costByModelResponseSchema = z.object({
	window: tokenWindowSchema,
	models: z.array(costByModelEntrySchema),
	totalCost: z.number(),
	totalRequests: z.number(),
});

function getTokenWindowStartDate(window: string): Date {
	const windowMs: Record<string, number> = {
		"1h": 60 * 60 * 1000,
		"4h": 4 * 60 * 60 * 1000,
		"12h": 12 * 60 * 60 * 1000,
		"1d": 24 * 60 * 60 * 1000,
		"7d": 7 * 24 * 60 * 60 * 1000,
		"30d": 30 * 24 * 60 * 60 * 1000,
		"90d": 90 * 24 * 60 * 60 * 1000,
		"365d": 365 * 24 * 60 * 60 * 1000,
	};
	const ms = windowMs[window] ?? 7 * 24 * 60 * 60 * 1000;
	return new Date(Date.now() - ms);
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
			cost: sql<number>`SUM(${projectHourlyModelStats.cost})`.as("cost"),
			requestCount:
				sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
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
		.orderBy(desc(sql`SUM(${projectHourlyModelStats.cost})`))
		.limit(20);

	const totalCost = rows.reduce((sum, r) => sum + Number(r.cost), 0);
	const totalRequests = rows.reduce(
		(sum, r) => sum + Number(r.requestCount),
		0,
	);

	return c.json({
		window,
		models: rows.map((r) => ({
			model: r.usedModel,
			cost: Number(r.cost),
			requestCount: Number(r.requestCount),
			totalTokens: Number(r.totalTokens),
		})),
		totalCost,
		totalRequests,
	});
});

// Org cost by model
const getOrgCostByModel = createRoute({
	method: "get",
	path: "/organizations/{orgId}/cost-by-model",
	request: {
		params: z.object({ orgId: z.string() }),
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: costByModelResponseSchema.openapi({}),
				},
			},
			description: "Organization cost breakdown by model.",
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
		});
	}

	const rows = await db
		.select({
			usedModel: projectHourlyModelStats.usedModel,
			cost: sql<number>`SUM(${projectHourlyModelStats.cost})`.as("cost"),
			requestCount:
				sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
		})
		.from(projectHourlyModelStats)
		.where(
			and(
				inArray(projectHourlyModelStats.projectId, ids),
				gte(projectHourlyModelStats.hourTimestamp, startDate),
			),
		)
		.groupBy(projectHourlyModelStats.usedModel)
		.orderBy(desc(sql`SUM(${projectHourlyModelStats.cost})`))
		.limit(20);

	const totalCost = rows.reduce((sum, r) => sum + Number(r.cost), 0);
	const totalRequests = rows.reduce(
		(sum, r) => sum + Number(r.requestCount),
		0,
	);

	return c.json({
		window,
		models: rows.map((r) => ({
			model: r.usedModel,
			cost: Number(r.cost),
			requestCount: Number(r.requestCount),
			totalTokens: Number(r.totalTokens),
		})),
		totalCost,
		totalRequests,
	});
});

// --- Cost by model time-series endpoints ---

const costByModelTimeseriesModelViewSchema = z.enum(["mapping", "canonical"]);

const costByModelTimeseriesBucketSchema = z.object({
	model: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.number(),
});

const costByModelTimeseriesPointSchema = z.object({
	timestamp: z.string(),
	entries: z.array(costByModelTimeseriesBucketSchema),
});

const costByModelTimeseriesResponseSchema = z.object({
	window: tokenWindowSchema,
	bucket: z.enum(["hour", "day"]),
	modelView: costByModelTimeseriesModelViewSchema,
	models: z.array(z.string()),
	data: z.array(costByModelTimeseriesPointSchema),
});

function getBucketUnitForWindow(window: string): "hour" | "day" {
	if (
		window === "1h" ||
		window === "4h" ||
		window === "12h" ||
		window === "1d"
	) {
		return "hour";
	}
	return "day";
}

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
			modelView: costByModelTimeseriesModelViewSchema
				.default("mapping")
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
			description: "Organization cost breakdown by model over time.",
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
			models: [],
			data: [],
		});
	}

	const result = await buildCostByModelTimeseries({
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
			modelView: costByModelTimeseriesModelViewSchema
				.default("mapping")
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
			description: "Project cost breakdown by model over time.",
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

	const result = await buildCostByModelTimeseries({
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
		models: result.models,
		data: result.data,
	});
});

async function buildCostByModelTimeseries({
	modelView,
	bucketUnit,
	startDate,
	baseFilter,
}: {
	modelView: z.infer<typeof costByModelTimeseriesModelViewSchema>;
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
			cost: sql<number>`SUM(${projectHourlyModelStats.cost})`.as("cost"),
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
		.slice(0, 10)
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
			cost: sql<number>`SUM(${projectHourlyModelStats.cost})`.as("cost"),
			requestCount:
				sql<number>`SUM(${projectHourlyModelStats.requestCount})`.as(
					"request_count",
				),
			totalTokens:
				sql<number>`SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC))`.as(
					"total_tokens",
				),
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

	const bucketMap = new Map<
		string,
		Map<string, { cost: number; requestCount: number; totalTokens: number }>
	>();

	for (const row of rows) {
		const ts = row.bucket;
		const key = keyOf(row.usedModel);
		const entry = bucketMap.get(ts) ?? new Map();
		const existing = entry.get(key) ?? {
			cost: 0,
			requestCount: 0,
			totalTokens: 0,
		};
		existing.cost += Number(row.cost);
		existing.requestCount += Number(row.requestCount);
		existing.totalTokens += Number(row.totalTokens);
		entry.set(key, existing);
		bucketMap.set(ts, entry);
	}

	const data = allBuckets.map((timestamp) => ({
		timestamp,
		entries: Array.from(bucketMap.get(timestamp)?.entries() ?? []).map(
			([model, v]) => ({
				model,
				cost: v.cost,
				requestCount: v.requestCount,
				totalTokens: v.totalTokens,
			}),
		),
	}));

	return { models: topKeys, data };
}

// --- Project Model-Provider Stats ---

const projectModelProviderStatsEntrySchema = z.object({
	modelId: z.string(),
	providerId: z.string(),
	providerName: z.string(),
	logsCount: z.number(),
	errorsCount: z.number(),
	cachedCount: z.number(),
	cost: z.number(),
	totalTokens: z.number(),
});

const projectModelProviderStatsResponseSchema = z.object({
	mappings: z.array(projectModelProviderStatsEntrySchema),
	total: z.number(),
	totalRequests: z.number(),
	totalTokens: z.number(),
	totalCost: z.number(),
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
	const errorsCountExpr =
		sql<number>`COALESCE(SUM(${projectHourlyModelStats.errorCount}), 0)`.as(
			"errors_count",
		);
	const cachedCountExpr =
		sql<number>`COALESCE(SUM(${projectHourlyModelStats.cacheCount}), 0)`.as(
			"cached_count",
		);
	const costExpr =
		sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as("cost");
	const totalTokensExpr =
		sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
			"total_tokens",
		);

	const sortColumn = (() => {
		switch (sortBy) {
			case "logsCount":
				return logsCountExpr;
			case "errorsCount":
				return errorsCountExpr;
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
			cachedCount: cachedCountExpr,
			cost: costExpr,
			totalTokens: totalTokensExpr,
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

	return c.json({
		mappings: rows.map((r) => ({
			modelId: r.usedModel,
			providerId: r.usedProvider,
			providerName: providerNameMap.get(r.usedProvider) ?? r.usedProvider,
			logsCount: Number(r.logsCount),
			errorsCount: Number(r.errorsCount),
			cachedCount: Number(r.cachedCount),
			cost: Number(r.cost),
			totalTokens: Number(r.totalTokens),
		})),
		total: rows.length,
		totalRequests,
		totalTokens,
		totalCost,
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
					cost: sql<number>`COALESCE(SUM(${mappingHistory.table.totalCost}), 0)`.as(
						"cost",
					),
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
					// Cost is only tracked in the history table, so it is only
					// available when a date range is provided (mirrors the models list).
					cost: sql<number>`0`.as("cost"),
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
						sql<number>`COALESCE(SUM(${mappingHistory.table.totalCost}), 0)`.as(
							"totalCost",
						),
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
						whereClause,
						gte(mappingHistory.bucket, dateRange!.startDate),
						lt(mappingHistory.bucket, dateRange!.endDateExclusive),
					),
				)
		: Promise.resolve([
				{
					totalRequests: 0,
					totalTokens: 0,
					totalCost: 0,
				},
			]);

	const orderFn = sortOrder === "asc" ? asc : desc;
	const sortColumnMap = {
		modelId: tables.modelProviderMapping.modelId,
		providerId: tables.modelProviderMapping.providerId,
		logsCount: sql`COALESCE(${statsJoin.logsCount}, 0)`,
		errorsCount: sql`COALESCE(${statsJoin.errorsCount}, 0)`,
		clientErrorsCount: sql`COALESCE(${statsJoin.clientErrorsCount}, 0)`,
		gatewayErrorsCount: sql`COALESCE(${statsJoin.gatewayErrorsCount}, 0)`,
		upstreamErrorsCount: sql`COALESCE(${statsJoin.upstreamErrorsCount}, 0)`,
		cost: sql`COALESCE(${statsJoin.cost}, 0)`,
		avgTimeToFirstToken: tables.modelProviderMapping.avgTimeToFirstToken,
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
				avgTimeToFirstToken: tables.modelProviderMapping.avgTimeToFirstToken,
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
			.orderBy(orderFn(sortColumn))
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
			inputPrice: r.inputPrice,
			outputPrice: r.outputPrice,
			contextSize: r.contextSize,
			updatedAt: r.updatedAt.toISOString(),
		})),
		total: Number(countResult?.count ?? 0),
		totalRequests: Number(totalsResult?.totalRequests ?? 0),
		totalTokens: Number(totalsResult?.totalTokens ?? 0),
		totalCost: Number(totalsResult?.totalCost ?? 0),
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
	"4h": { interval: sql`now() - interval '4 hours'`, hours: 4 },
	"24h": { interval: sql`now() - interval '24 hours'`, hours: 24 },
	"3d": { interval: sql`now() - interval '3 days'`, hours: 72 },
	"7d": { interval: sql`now() - interval '7 days'`, hours: 168 },
} as const;

const unstableMappingsWindowSchema = z.enum(["4h", "24h", "3d", "7d"]);

type UnstableMappingsWindow = keyof typeof UNSTABLE_MAPPINGS_WINDOWS;

function resolveUnstableMappingsWindow(
	window: UnstableMappingsWindow | undefined,
) {
	return UNSTABLE_MAPPINGS_WINDOWS[window ?? "4h"];
}

// `retried` is nullable; legacy rows predate the column and are NULL. Treat
// those as non-retried so they are not silently dropped from the rankings.
const unstableMappingsNotRetriedClause = sql`AND ${tables.log.retried} IS DISTINCT FROM true`;

// Gateway logs store `used_model` as the display value `provider/model[:region]`
// (for example `openai/gpt-5-nano` or `alibaba/glm-4.6:cn-beijing`), but the
// mapping detail page and the `model_provider_mapping` table key off the bare
// `model_id` plus `region`. Split the provider prefix and region suffix so the
// table can link to the exact regional mapping rather than a root/other region.
function parseUsedModel(
	usedModel: string,
	usedProvider: string,
): { modelId: string; region: string | null } {
	let rest = usedModel;
	const prefix = `${usedProvider}/`;
	if (rest.startsWith(prefix)) {
		rest = rest.slice(prefix.length);
	} else if (rest.includes("/")) {
		rest = rest.slice(rest.indexOf("/") + 1);
	}
	const regionIdx = rest.lastIndexOf(":");
	return regionIdx === -1
		? { modelId: rest, region: null }
		: { modelId: rest.slice(0, regionIdx), region: rest.slice(regionIdx + 1) };
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
	const { interval: windowInterval, hours: windowHours } =
		resolveUnstableMappingsWindow(query.window);

	const rows = await db.execute<{
		used_model: string;
		used_provider: string;
		logs_count: string;
		errors_count: string;
		error_rate: string;
		sampled_logs: string;
	}>(sql`
		WITH recent_logs AS (
			SELECT ${tables.log.usedModel} AS used_model,
				${tables.log.usedProvider} AS used_provider,
				${tables.log.hasError} AS has_error
			FROM ${tables.log}
			WHERE ${tables.log.createdAt} >= ${windowInterval}
				${retriedClause}
			ORDER BY ${tables.log.createdAt} DESC
			LIMIT ${logLimit}
		)
		SELECT used_model,
			used_provider,
			COUNT(*) AS logs_count,
			COUNT(*) FILTER (WHERE has_error) AS errors_count,
			COUNT(*) FILTER (WHERE has_error)::float / COUNT(*) AS error_rate,
			(SELECT COUNT(*) FROM recent_logs) AS sampled_logs
		FROM recent_logs
		GROUP BY used_model, used_provider
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

	const sampledLogs =
		resultRows.length > 0 ? Number(resultRows[0].sampled_logs) : 0;

	return c.json({
		mappings: resultRows.map((r) => {
			const { modelId, region } = parseUsedModel(r.used_model, r.used_provider);
			return {
				modelId,
				region,
				usedModel: r.used_model,
				providerId: r.used_provider,
				providerName: providerNameMap.get(r.used_provider) ?? r.used_provider,
				logsCount: Number(r.logs_count),
				errorsCount: Number(r.errors_count),
				errorRate: Number(r.error_rate),
			};
		}),
		sampledLogs,
		windowHours,
		logLimit,
		includeRetried,
	});
});

const unstableMappingErrorDetailSchema = z.object({
	statusCode: z.number().nullable(),
	statusText: z.string().nullable(),
	responseText: z.string().nullable(),
	cause: z.string().nullable(),
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
	const { model, provider, includeRetried, window, logLimit } =
		c.req.valid("query");
	const sampleLimit = logLimit ?? UNSTABLE_MAPPINGS_DEFAULT_LOG_LIMIT;
	const retriedClause =
		includeRetried === "true" ? sql`` : unstableMappingsNotRetriedClause;
	const { interval: windowInterval } = resolveUnstableMappingsWindow(window);

	const rows = await db.execute<{
		status_code: string | null;
		status_text: string | null;
		response_text: string | null;
		cause: string | null;
		count: string;
		sampled_errors: string;
	}>(sql`
		WITH recent_errors AS (
			SELECT ${tables.log.errorDetails} AS error_details
			FROM ${tables.log}
			WHERE ${tables.log.hasError} = true
				AND ${tables.log.usedModel} = ${model}
				AND ${tables.log.usedProvider} = ${provider}
				AND ${tables.log.createdAt} >= ${windowInterval}
				${retriedClause}
			ORDER BY ${tables.log.createdAt} DESC
			LIMIT ${sampleLimit}
		)
		SELECT error_details->>'statusCode' AS status_code,
			error_details->>'statusText' AS status_text,
			LEFT(error_details->>'responseText', 2000) AS response_text,
			error_details->>'cause' AS cause,
			COUNT(*) AS count,
			(SELECT COUNT(*) FROM recent_errors) AS sampled_errors
		FROM recent_errors
		GROUP BY status_code, status_text, response_text, cause
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
			count: Number(r.count),
		})),
		sampledErrors,
	});
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
			.orderBy(orderFn(sortColumn))
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

	const { getResendClient, fromEmail, replyToEmail } = await import(
		"@llmgateway/shared/email"
	);

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

	const { getResendClient, fromEmail, replyToEmail } = await import(
		"@llmgateway/shared/email"
	);

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
			.orderBy(orderFn(sortColumn))
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
	allowAllModels: z.boolean(),
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

const devpassKpisSchema = z.object({
	activeByTier: z.object({
		lite: z.number(),
		pro: z.number(),
		max: z.number(),
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

const devpassListSchema = z.object({
	subscribers: z.array(devpassSubscriberSchema),
	total: z.number(),
	kpis: devpassKpisSchema,
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

const devpassTransactionSchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	type: z.string(),
	amount: z.string().nullable(),
	creditAmount: z.string().nullable(),
	currency: z.string(),
	status: z.string(),
	description: z.string().nullable(),
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

const devpassDetailSchema = z.object({
	subscriber: devpassSubscriberSchema,
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

const devpassTimeseriesPointSchema = z.object({
	date: z.string(),
	revenue: z.number(),
	rawRevenue: z.number(),
	cost: z.number(),
	margin: z.number(),
});

const devpassTimeseriesSchema = z.object({
	data: z.array(devpassTimeseriesPointSchema),
	totals: z.object({
		revenue: z.number(),
		rawRevenue: z.number(),
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
	const monthStart = new Date(
		Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
	);

	// Subquery: real provider cost in current cycle, per org
	const realCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			realCost:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
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

	const ownerSub = db
		.select({
			organizationId: tables.userOrganization.organizationId,
			userId: tables.user.id,
			userName: tables.user.name,
			userEmail: tables.user.email,
		})
		.from(tables.userOrganization)
		.innerJoin(tables.user, eq(tables.userOrganization.userId, tables.user.id))
		.where(eq(tables.userOrganization.role, "owner"))
		.as("owner_sub");

	// All-time provider cost per org: every project, every cycle, no status or
	// billing-cycle window. Unlike `realCostSub` (current cycle only) this never
	// collapses to 0 when a renewal advances `devPlanBillingCycleStart` or when
	// the org is blocked/expired, so the admin always sees the true spend.
	// Scoped to personal orgs (DevPass is personal-only) so the aggregation
	// doesn't scan every org's hourly stats.
	const allTimeCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			cost: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
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
				inArray(allTimeRefundOriginalTx.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
			),
		)
		.groupBy(tables.transaction.organizationId)
		.as("all_time_refund_sub");

	const tierPriceExpr = sql<number>`CASE
		WHEN ${tables.organization.devPlan} = 'lite' THEN ${DEV_PLAN_PRICES.lite}
		WHEN ${tables.organization.devPlan} = 'pro' THEN ${DEV_PLAN_PRICES.pro}
		WHEN ${tables.organization.devPlan} = 'max' THEN ${DEV_PLAN_PRICES.max}
		ELSE 0
	END`;

	const utilizationExpr = sql<number | null>`CASE
		WHEN CAST(${tables.organization.devPlanCreditsLimit} AS NUMERIC) > 0
		THEN (CAST(${tables.organization.devPlanCreditsUsed} AS NUMERIC)
			/ CAST(${tables.organization.devPlanCreditsLimit} AS NUMERIC)) * 100
		ELSE NULL
	END`;

	const realCostExpr = sql<number>`COALESCE(CAST(${realCostSub.realCost} AS NUMERIC), 0)`;
	const marginExpr = sql<number>`(${tierPriceExpr}) - COALESCE(CAST(${realCostSub.realCost} AS NUMERIC), 0)`;

	const allTimeCostExpr = sql<number>`COALESCE(CAST(${allTimeCostSub.cost} AS NUMERIC), 0)`;
	const allTimeRevenueExpr = sql<number>`(COALESCE(CAST(${allTimeRevenueSub.revenue} AS NUMERIC), 0) - COALESCE(CAST(${allTimeRefundSub.refund} AS NUMERIC), 0))`;
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
			allowAllModels: tables.organization.devPlanAllowAllModels,
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
		.orderBy(orderFn(sortColumn))
		.limit(limit)
		.offset(offset);

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

	const [countRow] = await countSelect.where(whereClause);
	const total = Number(countRow?.count ?? 0);

	// KPI strip — counts the full active subscriber base, matching Stripe's
	// "active" filter which includes cancel-at-period-end subs until the period
	// actually ends. `grossMrr` is the Stripe-aligned figure (what will be
	// invoiced this period). `committedMrr` excludes subs flagged to cancel,
	// representing the forward-looking MRR after impending churn lands.
	const activeRows = await db
		.select({
			tier: tables.organization.devPlan,
			cancelled: tables.organization.devPlanCancelled,
			count: sql<number>`COUNT(*)`,
		})
		.from(tables.organization)
		.where(
			and(
				eq(tables.organization.kind, "devpass"),
				ne(tables.organization.devPlan, "none"),
				or(
					isNull(tables.organization.devPlanExpiresAt),
					sql`${tables.organization.devPlanExpiresAt} > NOW()`,
				)!,
			),
		)
		.groupBy(tables.organization.devPlan, tables.organization.devPlanCancelled);

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
				eq(tables.organization.kind, "devpass"),
				eq(tables.transaction.type, "dev_plan_start"),
				eq(tables.organization.devPlan, "none"),
			),
		);
	const churned = Number(churnedRow?.count ?? 0);

	const [startsRow] = await db
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
		);
	const startsThisMonth = Number(startsRow?.count ?? 0);

	const [endsRow] = await db
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
		);
	const endsThisMonth = Number(endsRow?.count ?? 0);

	// Refunds this month for DevPass transactions. Mirrors the timeseries
	// refund query (joins credit_refund rows to their original tx and filters
	// to dev plan types, plus legacy subscription_* rows on DevPass orgs) but
	// aggregates to a single month total so the KPI strip reflects refund
	// activity that the snapshot-based MRR cards can't show.
	const refundOriginalTx = aliasedTable(
		tables.transaction,
		"refund_original_tx",
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
				eq(tables.organization.kind, "devpass"),
				inArray(refundOriginalTx.type, [
					...DEV_PLAN_TX_TYPES,
					...LEGACY_DEV_PLAN_TX_TYPES,
				]),
			),
		);
	const refundsThisMonth = Number(refundsRow?.count ?? 0);
	const refundedAmountThisMonth = Number(refundsRow?.total ?? 0);

	// Weighted utilization across active subscribers
	const [utilRow] = await db
		.select({
			totalUsed: sql<string>`COALESCE(SUM(CAST(${tables.organization.devPlanCreditsUsed} AS NUMERIC)), 0)`,
			totalLimit: sql<string>`COALESCE(SUM(CAST(${tables.organization.devPlanCreditsLimit} AS NUMERIC)), 0)`,
		})
		.from(tables.organization)
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
	const totalUsed = Number(utilRow?.totalUsed ?? 0);
	const totalLimit = Number(utilRow?.totalLimit ?? 0);
	const weightedAvgUtilization =
		totalLimit > 0 ? (totalUsed / totalLimit) * 100 : 0;

	// Cycle-windowed totals across the active subscriber universe (not paginated)
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
				eq(tables.organization.kind, "devpass"),
				ne(tables.organization.devPlan, "none"),
				or(
					isNull(tables.organization.devPlanExpiresAt),
					sql`${tables.organization.devPlanExpiresAt} > NOW()`,
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
			allowAllModels: row.allowAllModels,
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

	// Provider cost per day for projects belonging to DevPass orgs
	// (kind = 'devpass'), which is stable across the subscription lifecycle so
	// churned orgs (devPlan = 'none') are still included without reconstructing
	// daily plan membership.
	const costPerDay = await db
		.select({
			date: sql<string>`DATE(${projectHourlyStats.hourTimestamp})`.as("date"),
			total:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
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
	const costMap = new Map<string, number>();
	for (const row of costPerDay) {
		costMap.set(row.date, Number(row.total));
	}

	const data: Array<{
		date: string;
		revenue: number;
		rawRevenue: number;
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
	let totalCost = 0;

	// `rawRevenue` is the gross amount collected from dev plan payments that
	// day; `revenue` nets refunds out of it. Margin stays net-based.
	while (cursor.getTime() <= lastDay) {
		const iso = cursor.toISOString().slice(0, 10);
		const rawRevenue = revenueMap.get(iso) ?? 0;
		const revenue = rawRevenue - (refundMap.get(iso) ?? 0);
		const cost = costMap.get(iso) ?? 0;
		const margin = revenue - cost;
		data.push({ date: iso, revenue, rawRevenue, cost, margin });
		totalRevenue += revenue;
		totalRawRevenue += rawRevenue;
		totalCost += cost;
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}

	return c.json({
		data,
		totals: {
			revenue: totalRevenue,
			rawRevenue: totalRawRevenue,
			cost: totalCost,
			margin: totalRevenue - totalCost,
		},
		range: {
			from: startDate.toISOString().slice(0, 10),
			to: endDate.toISOString().slice(0, 10),
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
			cost: sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as(
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
		.orderBy(desc(sql`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`))
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
			cost: sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as(
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
		.orderBy(desc(sql`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`))
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
			cost: sql<number>`COALESCE(SUM(${projectHourlySourceStats.cost}), 0)`.as(
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
		.orderBy(desc(sql`COALESCE(SUM(${projectHourlySourceStats.cost}), 0)`))
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
					total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`,
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
	const margin = mrr - realCost;

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
			total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`,
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
				inArray(detailRefundOriginalTx.type, allTimeRevenueTypes),
			),
		);

	const allTimeRevenue =
		Number(allTimeRevenueRow?.total ?? 0) -
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
		allowAllModels: org.devPlanAllowAllModels,
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
					"dev_plan_start",
					"dev_plan_upgrade",
					"dev_plan_downgrade",
					"dev_plan_cancel",
					"dev_plan_end",
					"dev_plan_renewal",
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

	// Subquery: real provider cost in current cycle, per org
	const realCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			realCost:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
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

	const ownerSub = db
		.select({
			organizationId: tables.userOrganization.organizationId,
			userId: tables.user.id,
			userName: tables.user.name,
			userEmail: tables.user.email,
		})
		.from(tables.userOrganization)
		.innerJoin(tables.user, eq(tables.userOrganization.userId, tables.user.id))
		.where(eq(tables.userOrganization.role, "owner"))
		.as("owner_sub");

	// All-time provider cost per org: every project, every cycle, no status or
	// billing-cycle window. Scoped to chat orgs so the aggregation doesn't scan
	// every org's hourly stats.
	const allTimeCostSub = db
		.select({
			organizationId: tables.project.organizationId,
			cost: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
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
		.orderBy(orderFn(sortColumn))
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
			total:
				sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
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
			cost: sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as(
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
		.orderBy(desc(sql`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`))
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
			cost: sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as(
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
		.orderBy(desc(sql`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`))
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
			cost: sql<number>`COALESCE(SUM(${projectHourlySourceStats.cost}), 0)`.as(
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
		.orderBy(desc(sql`COALESCE(SUM(${projectHourlySourceStats.cost}), 0)`))
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
					total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`,
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
			total: sql<string>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`,
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
