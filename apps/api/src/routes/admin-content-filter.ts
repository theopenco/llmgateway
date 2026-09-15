import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	getBucketUnitForWindow,
	getWindowBucketTimestamps,
	tokenWindowSchema,
} from "@/lib/stats-window.js";
import { adminMiddleware } from "@/middleware/admin.js";

import {
	and,
	CONTENT_FILTER_STATS_ALL_CATEGORY,
	contentFilterHourlyModelStats,
	contentFilterHourlyStats,
	db,
	desc,
	eq,
	gte,
	inArray,
	ne,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const adminContentFilter = new OpenAPIHono<ServerTypes>();

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
const TOP_GLOBAL_MODELS = 25;

const sampled = sql<number>`coalesce(sum(${contentFilterHourlyStats.sampledCount}), 0)::int`;
const violations = sql<number>`coalesce(sum(${contentFilterHourlyStats.violationCount}), 0)::int`;
const blocked = sql<number>`coalesce(sum(${contentFilterHourlyStats.blockedCount}), 0)::int`;
// Zero rather than NULL for unsampled orgs so a DESC sort does not float
// them to the top.
const violationRate = sql<number>`coalesce(sum(${contentFilterHourlyStats.violationCount})::float / nullif(sum(${contentFilterHourlyStats.sampledCount}), 0), 0)`;

const modelSampled = sql<number>`coalesce(sum(${contentFilterHourlyModelStats.sampledCount}), 0)::int`;
const modelViolations = sql<number>`coalesce(sum(${contentFilterHourlyModelStats.violationCount}), 0)::int`;
const modelBlocked = sql<number>`coalesce(sum(${contentFilterHourlyModelStats.blockedCount}), 0)::int`;
const modelViolationRate = sql<number>`coalesce(sum(${contentFilterHourlyModelStats.violationCount})::float / nullif(sum(${contentFilterHourlyModelStats.sampledCount}), 0), 0)`;

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
				plan: z.string().nullable(),
				sampledCount: z.number(),
				violationCount: z.number(),
				blockedCount: z.number(),
				violationRate: z.number(),
				topCategories: z.array(
					z.object({ category: z.string(), violationCount: z.number() }),
				),
				topModels: z.array(modelBreakdownSchema),
				topProviders: z.array(providerBreakdownSchema),
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

adminContentFilter.openapi(getViolations, async (c) => {
	const query = c.req.valid("query");
	const window = query.window ?? "24h";
	const sort = query.sort ?? "violations";
	const minSampled = query.minSampled ?? 0;
	const windowStart = new Date();
	windowStart.setUTCMinutes(0, 0, 0);
	const windowOffsetMs = (WINDOW_HOURS[window] - 1) * 3_600_000;
	windowStart.setTime(windowStart.getTime() - windowOffsetMs);

	const orgRows = await db
		.select({
			organizationId: contentFilterHourlyStats.organizationId,
			organizationName: tables.organization.name,
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
				eq(
					contentFilterHourlyStats.category,
					CONTENT_FILTER_STATS_ALL_CATEGORY,
				),
			),
		)
		.groupBy(
			contentFilterHourlyStats.organizationId,
			tables.organization.name,
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
		return {
			organizationId: row.organizationId,
			organizationName: row.organizationName ?? null,
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
			topProviders: toProviderBreakdowns(orgModels).slice(0, TOP_PROVIDERS),
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
		topCategories: z.array(
			z.object({ category: z.string(), violationCount: z.number() }),
		),
		topModels: z.array(modelBreakdownSchema),
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
				"One organization's gateway content filter activity over time: sampled, violating and blocked requests per bucket, plus window totals, top categories and top models.",
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
	);

	const modelWindow = and(
		eq(contentFilterHourlyModelStats.organizationId, orgId),
		gte(contentFilterHourlyModelStats.hourTimestamp, startDate),
	);

	const [series, categories, models] = await Promise.all([
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
	]);

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
		data,
	});
});
