import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	asc,
	db,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	ne,
	or,
	sql,
	tables,
	projectHourlyStats,
	projectHourlyModelStats,
} from "@llmgateway/db";
import { models, providers } from "@llmgateway/models";

import type { ServerTypes } from "@/vars.js";

export const admin = new OpenAPIHono<ServerTypes>();

admin.use("/*", adminMiddleware);

const adminMetricsSchema = z.object({
	totalSignups: z.number(),
	verifiedUsers: z.number(),
	payingCustomers: z.number(),
	totalRevenue: z.number(),
	totalOrganizations: z.number(),
	totalToppedUp: z.number(),
	totalSpent: z.number(),
	unusedCredits: z.number(),
	overage: z.number(),
});

const timeseriesRangeSchema = z.enum(["7d", "30d", "90d", "365d", "all"]);

const timeseriesDataPointSchema = z.object({
	date: z.string(),
	signups: z.number(),
	paidCustomers: z.number(),
	revenue: z.number(),
});

const adminTimeseriesSchema = z.object({
	range: timeseriesRangeSchema,
	data: z.array(timeseriesDataPointSchema),
	totals: z.object({
		signups: z.number(),
		paidCustomers: z.number(),
		revenue: z.number(),
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
	plan: z.string(),
	devPlan: z.string(),
	credits: z.string(),
	totalCreditsAllTime: z.string().optional(),
	totalSpent: z.string().optional(),
	createdAt: z.string(),
	status: z.string().nullable(),
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
});

const apiKeysListSchema = z.object({
	apiKeys: z.array(apiKeySchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
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
	const range = query.range ?? "all";

	const rangeDays: Record<string, number | null> = {
		"7d": 7,
		"30d": 30,
		"90d": 90,
		"365d": 365,
		all: null,
	};
	const days = range in rangeDays ? rangeDays[range] : null;

	let startDate: Date | null = null;
	if (days !== null) {
		// eslint-disable-next-line no-mixed-operators
		startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
		startDate.setUTCHours(0, 0, 0, 0);
	}

	// Total signups
	const [signupsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.user)
		.where(startDate ? gte(tables.user.createdAt, startDate) : undefined);

	const totalSignups = Number(signupsRow?.count ?? 0);

	// Verified users (email verified)
	const [verifiedRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.user)
		.where(
			startDate
				? and(
						eq(tables.user.emailVerified, true),
						gte(tables.user.createdAt, startDate),
					)
				: eq(tables.user.emailVerified, true),
		);

	const verifiedUsers = Number(verifiedRow?.count ?? 0);

	// Paying customers: organizations with at least one completed transaction
	const [payingRow] = await db
		.select({
			count:
				sql<number>`COUNT(DISTINCT ${tables.transaction.organizationId})`.as(
					"count",
				),
		})
		.from(tables.transaction)
		.where(
			startDate
				? and(
						eq(tables.transaction.status, "completed"),
						gte(tables.transaction.createdAt, startDate),
					)
				: eq(tables.transaction.status, "completed"),
		);

	const payingCustomers = Number(payingRow?.count ?? 0);

	// Total revenue (completed transactions, excluding gifts, using creditAmount to exclude Stripe fees)
	const [revenueRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			startDate
				? and(
						eq(tables.transaction.status, "completed"),
						ne(tables.transaction.type, "credit_gift"),
						gte(tables.transaction.createdAt, startDate),
					)
				: and(
						eq(tables.transaction.status, "completed"),
						ne(tables.transaction.type, "credit_gift"),
					),
		);

	const totalRevenue = Number(revenueRow?.value ?? 0);

	// Total organizations
	const [orgsRow] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.organization)
		.where(
			startDate ? gte(tables.organization.createdAt, startDate) : undefined,
		);

	const totalOrganizations = Number(orgsRow?.count ?? 0);

	// Total topped up (credits from completed transactions)
	const [toppedUpRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${tables.transaction.creditAmount} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(tables.transaction)
		.where(
			startDate
				? and(
						eq(tables.transaction.status, "completed"),
						gte(tables.transaction.createdAt, startDate),
					)
				: eq(tables.transaction.status, "completed"),
		);

	const totalToppedUp = Number(toppedUpRow?.value ?? 0);

	// Total spent (usage cost from hourly stats)
	const [spentRow] = await db
		.select({
			value:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.cost} AS NUMERIC)), 0)`.as(
					"value",
				),
		})
		.from(projectHourlyStats)
		.where(
			startDate ? gte(projectHourlyStats.hourTimestamp, startDate) : undefined,
		);

	const totalSpent = Number(spentRow?.value ?? 0);

	const rawBalance = totalToppedUp - totalSpent;
	const unusedCredits = Math.max(0, rawBalance);
	const overage = Math.max(0, -rawBalance);

	return c.json({
		totalSignups,
		verifiedUsers,
		payingCustomers,
		totalRevenue,
		totalOrganizations,
		totalToppedUp,
		totalSpent,
		unusedCredits,
		overage,
	});
});

const getTimeseries = createRoute({
	method: "get",
	path: "/metrics/timeseries",
	request: {
		query: z.object({
			range: timeseriesRangeSchema.default("all").optional(),
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
	const range = query.range ?? "all";

	const now = new Date();
	const rangeDays: Record<string, number | null> = {
		"7d": 7,
		"30d": 30,
		"90d": 90,
		"365d": 365,
		all: null,
	};
	const days = range in rangeDays ? rangeDays[range] : 30;

	let startDate: Date;
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

	// Normalize to start of day in UTC
	startDate.setUTCHours(0, 0, 0, 0);
	const endDate = new Date(now);
	endDate.setUTCHours(23, 59, 59, 999);

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

	// Revenue per day (completed transactions, excluding gifts, using creditAmount)
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
				gte(tables.transaction.createdAt, startDate),
			),
		)
		.groupBy(sql`DATE(${tables.transaction.createdAt})`)
		.orderBy(asc(sql`DATE(${tables.transaction.createdAt})`));

	// Revenue earned before the range (for cumulative chart, excluding gifts, using creditAmount)
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
				sql`${tables.transaction.createdAt} < ${startDate}`,
			),
		);
	const preRangeRevenue = Number(preRangeRevenueRow?.total ?? 0);

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
				.where(eq(tables.transaction.status, "completed"))
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
				.where(eq(tables.transaction.status, "completed"))
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
	}> = [];
	let cumulativePaid = preRangeCount;
	let totalSignups = 0;
	let totalRevenue = preRangeRevenue;

	const totalDays = Math.ceil(
		(endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000),
	);
	for (let i = 0; i < totalDays; i++) {
		// eslint-disable-next-line no-mixed-operators
		const current = new Date(startDate.getTime() + i * 24 * 60 * 60 * 1000);
		const dateStr = current.toISOString().split("T")[0];
		const dailySignups = signupsMap.get(dateStr) ?? 0;
		const dailyRevenue = revenueMap.get(dateStr) ?? 0;
		cumulativePaid += newPaidMap.get(dateStr) ?? 0;

		totalSignups += dailySignups;
		totalRevenue += dailyRevenue;

		data.push({
			date: dateStr,
			signups: totalSignups,
			paidCustomers: cumulativePaid,
			revenue: totalRevenue,
		});
	}

	return c.json({
		range,
		data,
		totals: {
			signups: totalSignups,
			paidCustomers: cumulativePaid,
			revenue: totalRevenue,
		},
	});
});

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
		.where(whereClause)
		.orderBy(orderFn(sortColumn))
		.limit(limit)
		.offset(offset);

	return c.json({
		organizations: organizations.map((org) => ({
			id: org.id,
			name: org.name,
			billingEmail: org.billingEmail,
			plan: org.plan,
			devPlan: org.devPlan,
			credits: String(org.credits),
			totalCreditsAllTime: String(org.totalCreditsAllTime ?? "0"),
			totalSpent: String(org.totalSpent ?? "0"),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
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
			plan: org.plan,
			devPlan: org.devPlan,
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
			plan: org.plan,
			devPlan: org.devPlan,
			credits: String(org.credits),
			createdAt: org.createdAt.toISOString(),
			status: org.status,
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

	return c.json({
		apiKeys: apiKeys.map((k) => ({
			...k,
			usage: String(k.usage),
			usageLimit: k.usageLimit ? String(k.usageLimit) : null,
			createdAt: k.createdAt.toISOString(),
		})),
		total,
		limit,
		offset,
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
	usedModel: z.string(),
	usedProvider: z.string(),
	totalTokens: z.string().nullable(),
	cost: z.number().nullable(),
	hasError: z.boolean().nullable(),
	unifiedFinishReason: z.string().nullable(),
	cached: z.boolean().nullable(),
	cachedTokens: z.string().nullable(),
	source: z.string().nullable(),
	content: z.string().nullable(),
	usedMode: z.string(),
	discount: z.number().nullable(),
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
	const { cursor } = query;

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
			usedModel: tables.log.usedModel,
			usedProvider: tables.log.usedProvider,
			totalTokens: tables.log.totalTokens,
			cost: tables.log.cost,
			hasError: tables.log.hasError,
			unifiedFinishReason: tables.log.unifiedFinishReason,
			cached: tables.log.cached,
			cachedTokens: tables.log.cachedTokens,
			source: tables.log.source,
			content: tables.log.content,
			usedMode: tables.log.usedMode,
			discount: tables.log.discount,
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
			totalTokens: l.totalTokens ? String(l.totalTokens) : null,
			cachedTokens: l.cachedTokens ? String(l.cachedTokens) : null,
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

// Build a map of provider -> Set of valid model names for that provider
// This includes both root model IDs and provider-specific modelNames
const providerModelMappings = new Map<string, Set<string>>();
for (const model of models) {
	for (const mapping of model.providers) {
		if (!providerModelMappings.has(mapping.providerId)) {
			providerModelMappings.set(mapping.providerId, new Set<string>());
		}
		const modelSet = providerModelMappings.get(mapping.providerId)!;
		// Add the provider-specific model name
		modelSet.add(mapping.modelName);
		// Also add the root model ID for backwards compatibility
		modelSet.add(model.id);
	}
}

// Get all valid model names (union of all provider model names + root IDs)
const validModelIds = new Set<string>();
for (const model of models) {
	validModelIds.add(model.id);
	for (const mapping of model.providers) {
		validModelIds.add(mapping.modelName);
	}
}

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
									rootModelId: z.string(),
									rootModelName: z.string(),
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
	// Build mappings from all models and their providers
	const mappings: Array<{
		providerId: string;
		providerName: string;
		modelId: string;
		modelName: string;
		rootModelId: string;
		rootModelName: string;
		family: string;
	}> = [];

	for (const model of models) {
		for (const mapping of model.providers) {
			const provider = providers.find((p) => p.id === mapping.providerId);
			if (provider) {
				mappings.push({
					providerId: mapping.providerId,
					providerName: provider.name,
					modelId: mapping.modelName, // The provider-specific model name
					modelName: mapping.modelName,
					rootModelId: model.id, // The root model ID
					rootModelName: (model as { name?: string }).name ?? model.id,
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
	"logsCount",
	"errorsCount",
	"cachedCount",
	"avgTimeToFirstToken",
	"modelCount",
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
	updatedAt: z.string(),
});

const providersListSchema = z.object({
	providers: z.array(providerStatsSchema),
	total: z.number(),
});

const getProviderStats = createRoute({
	method: "get",
	path: "/providers",
	request: {
		query: z.object({
			sortBy: providerSortBySchema.default("logsCount").optional(),
			sortOrder: sortOrderSchema.default("desc").optional(),
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

	const modelCountSub = db
		.select({
			providerId: tables.modelProviderMapping.providerId,
			count: sql<number>`COUNT(*)`.as("model_count"),
		})
		.from(tables.modelProviderMapping)
		.groupBy(tables.modelProviderMapping.providerId)
		.as("model_count_sub");

	const orderFn = sortOrder === "asc" ? asc : desc;

	const sortColumnMap = {
		name: tables.provider.name,
		logsCount: tables.provider.logsCount,
		errorsCount: tables.provider.errorsCount,
		cachedCount: tables.provider.cachedCount,
		avgTimeToFirstToken: tables.provider.avgTimeToFirstToken,
		modelCount: sql`COALESCE(${modelCountSub.count}, 0)`,
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
			updatedAt: r.updatedAt.toISOString(),
		})),
		total: rows.length,
	});
});

const modelSortBySchema = z.enum([
	"name",
	"family",
	"logsCount",
	"errorsCount",
	"cachedCount",
	"avgTimeToFirstToken",
	"providerCount",
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
	cachedCount: z.number(),
	avgTimeToFirstToken: z.number().nullable(),
	providerCount: z.number(),
	updatedAt: z.string(),
});

const modelsListSchema = z.object({
	models: z.array(modelStatsSchema),
	total: z.number(),
	limit: z.number(),
	offset: z.number(),
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

	const providerCountSub = db
		.select({
			modelId: tables.modelProviderMapping.modelId,
			count: sql<number>`COUNT(*)`.as("provider_count"),
		})
		.from(tables.modelProviderMapping)
		.groupBy(tables.modelProviderMapping.modelId)
		.as("provider_count_sub");

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

	const [countResult] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.model)
		.where(whereClause);

	const total = Number(countResult?.count ?? 0);

	const orderFn = sortOrderVal === "asc" ? asc : desc;

	const sortColumnMap = {
		name: tables.model.name,
		family: tables.model.family,
		logsCount: tables.model.logsCount,
		errorsCount: tables.model.errorsCount,
		cachedCount: tables.model.cachedCount,
		avgTimeToFirstToken: tables.model.avgTimeToFirstToken,
		providerCount: sql`COALESCE(${providerCountSub.count}, 0)`,
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
			cachedCount: tables.model.cachedCount,
			avgTimeToFirstToken: tables.model.avgTimeToFirstToken,
			providerCount: sql<number>`COALESCE(${providerCountSub.count}, 0)`.as(
				"providerCount",
			),
			updatedAt: tables.model.updatedAt,
		})
		.from(tables.model)
		.leftJoin(providerCountSub, eq(tables.model.id, providerCountSub.modelId))
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
			cachedCount: r.cachedCount,
			avgTimeToFirstToken: r.avgTimeToFirstToken,
			providerCount: Number(r.providerCount),
			updatedAt: r.updatedAt.toISOString(),
		})),
		total,
		limit,
		offset,
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

export default admin;
