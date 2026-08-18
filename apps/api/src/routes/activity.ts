import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { apiKeyScopeFilter } from "@/lib/api-key-scope-filter.js";
import {
	mapModeSplit,
	modeSplitFields,
	modeSplitSchema,
} from "@/lib/mode-split.js";
import { requireEnterpriseAdmin } from "@/lib/require-enterprise-admin.js";
import { getUserUsageBreakdown } from "@/lib/user-usage-breakdown.js";
import {
	getApiKeyScope,
	getUserProjectIds,
	isKeyScoped,
	userHasProjectAccess,
} from "@/utils/authorization.js";
import {
	bucketDate,
	generateTimeSlots,
	isValidTimeZone,
	zonedTimeToUtc,
} from "@/utils/timezone.js";

import {
	db,
	sql,
	inArray,
	and,
	gte,
	lte,
	eq,
	desc,
	apiKey,
	projectHourlyStats,
	projectHourlyModelStats,
	projectHourlySourceStats,
	apiKeyHourlyStats,
	apiKeyHourlyModelStats,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";
import type { AnyColumn } from "@llmgateway/db";

export const activity = new OpenAPIHono<ServerTypes>();

// Define the response schema for model-specific usage
const modelUsageSchema = z.object({
	id: z.string(),
	provider: z.string(),
	requestCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	...modeSplitSchema,
});

// Define the response schema for api-key-specific usage
const apiKeyUsageSchema = z.object({
	id: z.string(),
	description: z.string(),
	requestCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	...modeSplitSchema,
});

// Define the response schema for per-member usage. Requests are attributed to
// the member who created the api key that made them (api_key.created_by),
// matching the organization-wide member analytics.
const userUsageSchema = z.object({
	id: z.string(),
	name: z.string(),
	requestCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	...modeSplitSchema,
});

// Define the response schema for daily activity
const dailyActivitySchema = z.object({
	date: z.string(),
	requestCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	cachedTokens: z.number(),
	cacheWriteTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	inputCost: z.number(),
	outputCost: z.number(),
	requestCost: z.number(),
	dataStorageCost: z.number(),
	imageInputCost: z.number(),
	audioInputCost: z.number(),
	audioOutputCost: z.number(),
	imageOutputCost: z.number(),
	videoOutputCost: z.number(),
	cachedInputCost: z.number(),
	cacheWriteInputCost: z.number(),
	errorCount: z.number(),
	errorRate: z.number(),
	cacheCount: z.number(),
	cacheRate: z.number(),
	discountSavings: z.number(),
	creditsRequestCount: z.number(),
	apiKeysRequestCount: z.number(),
	creditsCost: z.number(),
	apiKeysCost: z.number(),
	creditsDataStorageCost: z.number(),
	apiKeysDataStorageCost: z.number(),
	modelBreakdown: z.array(modelUsageSchema),
	apiKeyBreakdown: z.array(apiKeyUsageSchema),
	userBreakdown: z.array(userUsageSchema),
});

type ActivityRow = z.infer<typeof dailyActivitySchema>;

function buildEmptyActivityRow(date: string): ActivityRow {
	return {
		date,
		requestCount: 0,
		inputTokens: 0,
		outputTokens: 0,
		cachedTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		cost: 0,
		inputCost: 0,
		outputCost: 0,
		requestCost: 0,
		dataStorageCost: 0,
		imageInputCost: 0,
		audioInputCost: 0,
		audioOutputCost: 0,
		imageOutputCost: 0,
		videoOutputCost: 0,
		cachedInputCost: 0,
		cacheWriteInputCost: 0,
		errorCount: 0,
		errorRate: 0,
		cacheCount: 0,
		cacheRate: 0,
		discountSavings: 0,
		creditsRequestCount: 0,
		apiKeysRequestCount: 0,
		creditsCost: 0,
		apiKeysCost: 0,
		creditsDataStorageCost: 0,
		apiKeysDataStorageCost: 0,
		modelBreakdown: [],
		apiKeyBreakdown: [],
		userBreakdown: [],
	};
}

function padActivity(
	rows: ActivityRow[],
	startDate: Date,
	endDate: Date,
	isHourly: boolean,
	timeZone: string,
): ActivityRow[] {
	const slots = generateTimeSlots(startDate, endDate, isHourly, timeZone);
	const byDate = new Map(rows.map((r) => [r.date, r]));
	return slots.map((slot) => byDate.get(slot) ?? buildEmptyActivityRow(slot));
}

// Define the route for getting activity data
const getActivity = createRoute({
	method: "get",
	path: "/",
	request: {
		query: z.object({
			days: z
				.string()
				.transform((val) => parseInt(val, 10))
				.pipe(z.number().int().positive())
				.optional(),
			from: z.string().optional(),
			to: z.string().optional(),
			projectId: z.string().optional(),
			apiKeyId: z.string().optional(),
			timeRange: z.enum(["1h", "4h", "24h", "7d", "30d", "365d"]).optional(),
			groupBy: z.enum(["model", "apiKey", "user"]).optional(),
			timezone: z
				.string()
				.max(64)
				.refine(isValidTimeZone, { message: "Invalid IANA timezone" })
				.optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						activity: z.array(dailyActivitySchema),
						granularity: z.enum(["hourly", "daily"]).optional(),
					}),
				},
			},
			description: "Activity data grouped by day or hour",
		},
	},
});

activity.openapi(getActivity, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Get the query parameters
	const { days, from, to, projectId, apiKeyId, timeRange, groupBy, timezone } =
		c.req.valid("query");
	const breakdownDimension = groupBy ?? "model";
	const timeZone = timezone ?? "UTC";

	// Calculate the date range and granularity
	let startDate: Date;
	let endDate: Date;
	let granularity: "hourly" | "daily" = "daily";

	if (timeRange) {
		endDate = new Date();
		startDate = new Date();
		switch (timeRange) {
			case "1h":
				startDate.setHours(startDate.getHours() - 1);
				granularity = "hourly";
				break;
			case "4h":
				startDate.setHours(startDate.getHours() - 4);
				granularity = "hourly";
				break;
			case "24h":
				startDate.setHours(startDate.getHours() - 24);
				granularity = "hourly";
				break;
			case "7d":
				startDate.setDate(startDate.getDate() - 7);
				granularity = "daily";
				break;
			case "30d":
				startDate.setDate(startDate.getDate() - 30);
				granularity = "daily";
				break;
			case "365d":
				startDate.setDate(startDate.getDate() - 365);
				granularity = "daily";
				break;
		}
	} else if (from && to) {
		startDate = zonedTimeToUtc(from + "T00:00:00.000", timeZone);
		endDate = zonedTimeToUtc(to + "T23:59:59.999", timeZone);
	} else {
		const effectiveDays = days ?? 7;
		endDate = new Date();
		startDate = new Date();
		startDate.setDate(startDate.getDate() - effectiveDays);
	}

	// SQL expressions that change based on granularity
	const isHourly = granularity === "hourly";

	// The per-member breakdown exposes every member's spend, so it needs the same
	// enterprise + owner/admin gate as the organization-wide member analytics.
	// Without a project the request can span several organizations, which leaves
	// nothing unambiguous to gate on, so require one.
	if (breakdownDimension === "user" && !projectId) {
		throw new HTTPException(400, {
			message: "projectId is required when grouping by user",
		});
	}

	// Projects the user can access (RBAC-aware: developers are limited to their
	// granted projects).
	const accessibleProjectIds = await getUserProjectIds(user.id);

	if (!accessibleProjectIds.length) {
		return c.json({
			activity: [],
		});
	}

	if (projectId && !accessibleProjectIds.includes(projectId)) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	if (breakdownDimension === "user" && projectId) {
		const targetProject = await db.query.project.findFirst({
			where: { id: { eq: projectId } },
		});

		if (!targetProject) {
			throw new HTTPException(404, { message: "Project not found" });
		}

		await requireEnterpriseAdmin(user.id, targetProject.organizationId);
	}

	const projectIds = projectId ? [projectId] : accessibleProjectIds;

	if (!projectIds.length) {
		return c.json({
			activity: [],
		});
	}

	// Developers only see their own keys' traffic, even in a project they were
	// granted. Everything below is filtered through this scope.
	const scope = await getApiKeyScope(user.id, projectIds);
	const keyScoped = isKeyScoped(scope);
	const scopeFilter = (projectIdColumn: AnyColumn, apiKeyIdColumn: AnyColumn) =>
		apiKeyScopeFilter(scope, projectIdColumn, apiKeyIdColumn);

	if (apiKeyId && keyScoped && !scope.ownApiKeyIds.includes(apiKeyId)) {
		const inRestrictedProject = await db.query.apiKey.findFirst({
			where: {
				id: { eq: apiKeyId },
				projectId: { in: scope.restrictedProjectIds },
			},
			columns: { id: true },
		});
		if (inRestrictedProject) {
			throw new HTTPException(403, {
				message: "You don't have access to this API key",
			});
		}
	}

	// Read from the per-key rollups whenever the result must be narrowed to
	// individual keys: an explicit apiKeyId filter, or a developer who may only
	// see their own. The project rollups have no apiKeyId column, so they cannot
	// answer either question.
	if (apiKeyId || keyScoped) {
		// Query aggregated data from apiKeyHourlyStats table
		const hourlyAggregates = await db
			.select({
				date: bucketDate(
					apiKeyHourlyStats.hourTimestamp,
					timeZone,
					isHourly,
				).as("date"),
				requestCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
						"requestCount",
					),
				inputTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.inputTokens} AS NUMERIC)), 0)`.as(
						"inputTokens",
					),
				outputTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.outputTokens} AS NUMERIC)), 0)`.as(
						"outputTokens",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cost} as double precision)), 0)`.as(
					"cost",
				),
				inputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.inputCost} as double precision)), 0)`.as(
						"inputCost",
					),
				outputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.outputCost} as double precision)), 0)`.as(
						"outputCost",
					),
				requestCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.requestCost} as double precision)), 0)`.as(
						"requestCost",
					),
				dataStorageCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.dataStorageCost} as double precision)), 0)`.as(
						"dataStorageCost",
					),
				errorCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.errorCount}), 0)`.as(
						"errorCount",
					),
				cacheCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cacheCount}), 0)`.as(
						"cacheCount",
					),
				discountSavings:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.discountSavings} as double precision)), 0)`.as(
						"discountSavings",
					),
				imageInputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.imageInputCost} as double precision)), 0)`.as(
						"imageInputCost",
					),
				audioInputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.audioInputCost} as double precision)), 0)`.as(
						"audioInputCost",
					),
				audioOutputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.audioOutputCost} as double precision)), 0)`.as(
						"audioOutputCost",
					),
				imageOutputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.imageOutputCost} as double precision)), 0)`.as(
						"imageOutputCost",
					),
				videoOutputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.videoOutputCost} as double precision)), 0)`.as(
						"videoOutputCost",
					),
				cachedTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.cachedTokens} AS NUMERIC)), 0)`.as(
						"cachedTokens",
					),
				cacheWriteTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.cacheWriteTokens} AS NUMERIC)), 0)`.as(
						"cacheWriteTokens",
					),
				cachedInputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cachedInputCost} as double precision)), 0)`.as(
						"cachedInputCost",
					),
				cacheWriteInputCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cacheWriteInputCost} as double precision)), 0)`.as(
						"cacheWriteInputCost",
					),
				creditsRequestCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.creditsRequestCount}), 0)`.as(
						"creditsRequestCount",
					),
				apiKeysRequestCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.apiKeysRequestCount}), 0)`.as(
						"apiKeysRequestCount",
					),
				creditsCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.creditsCost} as double precision)), 0)`.as(
						"creditsCost",
					),
				apiKeysCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.apiKeysCost} as double precision)), 0)`.as(
						"apiKeysCost",
					),
				creditsDataStorageCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.creditsDataStorageCost} as double precision)), 0)`.as(
						"creditsDataStorageCost",
					),
				apiKeysDataStorageCost:
					sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.apiKeysDataStorageCost} as double precision)), 0)`.as(
						"apiKeysDataStorageCost",
					),
			})
			.from(apiKeyHourlyStats)
			.where(
				and(
					apiKeyId ? eq(apiKeyHourlyStats.apiKeyId, apiKeyId) : undefined,
					scopeFilter(apiKeyHourlyStats.projectId, apiKeyHourlyStats.apiKeyId),
					inArray(apiKeyHourlyStats.projectId, projectIds),
					gte(apiKeyHourlyStats.hourTimestamp, startDate),
					lte(apiKeyHourlyStats.hourTimestamp, endDate),
				),
			)
			.groupBy(sql`1`)
			.orderBy(sql`1 ASC`);

		// Query model breakdown from apiKeyHourlyModelStats table
		const modelBreakdowns = await db
			.select({
				date: bucketDate(
					apiKeyHourlyModelStats.hourTimestamp,
					timeZone,
					isHourly,
				).as("date"),
				usedModel: apiKeyHourlyModelStats.usedModel,
				usedProvider: apiKeyHourlyModelStats.usedProvider,
				requestCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyModelStats.requestCount}), 0)`.as(
						"requestCount",
					),
				inputTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.inputTokens} AS NUMERIC)), 0)`.as(
						"inputTokens",
					),
				outputTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.outputTokens} AS NUMERIC)), 0)`.as(
						"outputTokens",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyModelStats.cost} as double precision)), 0)`.as(
					"cost",
				),
				...modeSplitFields(apiKeyHourlyModelStats),
			})
			.from(apiKeyHourlyModelStats)
			.where(
				and(
					apiKeyId ? eq(apiKeyHourlyModelStats.apiKeyId, apiKeyId) : undefined,
					scopeFilter(
						apiKeyHourlyModelStats.projectId,
						apiKeyHourlyModelStats.apiKeyId,
					),
					inArray(apiKeyHourlyModelStats.projectId, projectIds),
					gte(apiKeyHourlyModelStats.hourTimestamp, startDate),
					lte(apiKeyHourlyModelStats.hourTimestamp, endDate),
				),
			)
			.groupBy(
				sql`1, ${apiKeyHourlyModelStats.usedModel}, ${apiKeyHourlyModelStats.usedProvider}`,
			)
			.orderBy(sql`1 ASC, ${apiKeyHourlyModelStats.usedModel} ASC`);

		const modelBreakdownByDate = new Map<
			string,
			z.infer<typeof modelUsageSchema>[]
		>();
		for (const breakdown of modelBreakdowns) {
			if (!modelBreakdownByDate.has(breakdown.date)) {
				modelBreakdownByDate.set(breakdown.date, []);
			}
			modelBreakdownByDate.get(breakdown.date)!.push({
				id: breakdown.usedModel || "unknown",
				provider: breakdown.usedProvider || "unknown",
				requestCount: Number(breakdown.requestCount),
				inputTokens: Number(breakdown.inputTokens),
				outputTokens: Number(breakdown.outputTokens),
				totalTokens: Number(breakdown.totalTokens),
				cost: Number(breakdown.cost),
				...mapModeSplit(breakdown),
			});
		}

		// A key-scoped caller asking for the api-key breakdown still gets one, over
		// the keys they are allowed to see.
		const apiKeyBreakdownByDate = new Map<
			string,
			z.infer<typeof apiKeyUsageSchema>[]
		>();
		if (breakdownDimension === "apiKey") {
			const apiKeyBreakdowns = await db
				.select({
					date: bucketDate(
						apiKeyHourlyStats.hourTimestamp,
						timeZone,
						isHourly,
					).as("date"),
					apiKeyId: apiKeyHourlyStats.apiKeyId,
					description: apiKey.description,
					requestCount:
						sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
							"requestCount",
						),
					inputTokens:
						sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.inputTokens} AS NUMERIC)), 0)`.as(
							"inputTokens",
						),
					outputTokens:
						sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.outputTokens} AS NUMERIC)), 0)`.as(
							"outputTokens",
						),
					totalTokens:
						sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
							"totalTokens",
						),
					cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cost} as double precision)), 0)`.as(
						"cost",
					),
					...modeSplitFields(apiKeyHourlyStats),
				})
				.from(apiKeyHourlyStats)
				.leftJoin(apiKey, eq(apiKey.id, apiKeyHourlyStats.apiKeyId))
				.where(
					and(
						apiKeyId ? eq(apiKeyHourlyStats.apiKeyId, apiKeyId) : undefined,
						scopeFilter(
							apiKeyHourlyStats.projectId,
							apiKeyHourlyStats.apiKeyId,
						),
						inArray(apiKeyHourlyStats.projectId, projectIds),
						inArray(apiKey.keyType, ["user", "end_user_customer"]),
						gte(apiKeyHourlyStats.hourTimestamp, startDate),
						lte(apiKeyHourlyStats.hourTimestamp, endDate),
					),
				)
				.groupBy(sql`1, ${apiKeyHourlyStats.apiKeyId}, ${apiKey.description}`)
				.orderBy(sql`1 ASC, ${apiKeyHourlyStats.apiKeyId} ASC`);

			for (const breakdown of apiKeyBreakdowns) {
				if (!apiKeyBreakdownByDate.has(breakdown.date)) {
					apiKeyBreakdownByDate.set(breakdown.date, []);
				}
				apiKeyBreakdownByDate.get(breakdown.date)!.push({
					id: breakdown.apiKeyId,
					description: breakdown.description ?? "Deleted key",
					requestCount: Number(breakdown.requestCount),
					inputTokens: Number(breakdown.inputTokens),
					outputTokens: Number(breakdown.outputTokens),
					totalTokens: Number(breakdown.totalTokens),
					cost: Number(breakdown.cost),
					...mapModeSplit(breakdown),
				});
			}
		}

		// Process daily aggregates and add calculated fields
		const activityData = hourlyAggregates.map((day) => {
			const requestCount = Number(day.requestCount);
			const inputTokens = Number(day.inputTokens);
			const outputTokens = Number(day.outputTokens);
			const cachedTokens = Number(day.cachedTokens);
			const cacheWriteTokens = Number(day.cacheWriteTokens);
			const totalTokens = Number(day.totalTokens);
			const cost = Number(day.cost);
			const inputCost = Number(day.inputCost);
			const outputCost = Number(day.outputCost);
			const requestCost = Number(day.requestCost);
			const dataStorageCost = Number(day.dataStorageCost);
			const errorCount = Number(day.errorCount);
			const cacheCount = Number(day.cacheCount);
			const discountSavings = Number(day.discountSavings);
			const imageInputCost = Number(day.imageInputCost);
			const audioInputCost = Number(day.audioInputCost);
			const audioOutputCost = Number(day.audioOutputCost);
			const imageOutputCost = Number(day.imageOutputCost);
			const videoOutputCost = Number(day.videoOutputCost);
			const cachedInputCost = Number(day.cachedInputCost);
			const cacheWriteInputCost = Number(day.cacheWriteInputCost);

			const creditsRequestCount = Number(day.creditsRequestCount);
			const apiKeysRequestCount = Number(day.apiKeysRequestCount);
			const creditsCost = Number(day.creditsCost);
			const apiKeysCost = Number(day.apiKeysCost);
			const creditsDataStorageCost = Number(day.creditsDataStorageCost);
			const apiKeysDataStorageCost = Number(day.apiKeysDataStorageCost);

			const errorRate =
				requestCount > 0 ? (errorCount / requestCount) * 100 : 0;
			const cacheRate =
				requestCount > 0 ? (cacheCount / requestCount) * 100 : 0;

			return {
				date: day.date,
				requestCount,
				inputTokens,
				outputTokens,
				cachedTokens,
				cacheWriteTokens,
				totalTokens,
				cost,
				inputCost,
				outputCost,
				requestCost,
				dataStorageCost,
				imageInputCost,
				audioInputCost,
				audioOutputCost,
				imageOutputCost,
				videoOutputCost,
				cachedInputCost,
				cacheWriteInputCost,
				errorCount,
				errorRate,
				cacheCount,
				cacheRate,
				discountSavings,
				creditsRequestCount,
				apiKeysRequestCount,
				creditsCost,
				apiKeysCost,
				creditsDataStorageCost,
				apiKeysDataStorageCost,
				modelBreakdown:
					breakdownDimension === "model"
						? (modelBreakdownByDate.get(day.date) ?? [])
						: [],
				apiKeyBreakdown: apiKeyBreakdownByDate.get(day.date) ?? [],
				userBreakdown: [],
			};
		});

		const paddedActivity =
			timeRange || (from && to)
				? padActivity(activityData, startDate, endDate, isHourly, timeZone)
				: activityData;

		return c.json({
			activity: paddedActivity,
			...(timeRange ? { granularity } : {}),
		});
	}

	// Whole-project rollups. Only reachable when the caller is owner/admin in every
	// project in scope — the branch above handles anyone restricted to their own
	// keys, since these tables have no apiKeyId to filter on.
	const hourlyAggregates = await db
		.select({
			date: bucketDate(projectHourlyStats.hourTimestamp, timeZone, isHourly).as(
				"date",
			),
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlyStats.requestCount}), 0)`.as(
					"requestCount",
				),
			inputTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.inputTokens} AS NUMERIC)), 0)`.as(
					"inputTokens",
				),
			outputTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.outputTokens} AS NUMERIC)), 0)`.as(
					"outputTokens",
				),
			cachedTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.cachedTokens} AS NUMERIC)), 0)`.as(
					"cachedTokens",
				),
			cacheWriteTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.cacheWriteTokens} AS NUMERIC)), 0)`.as(
					"cacheWriteTokens",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
					"totalTokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cost} as double precision)), 0)`.as(
				"cost",
			),
			inputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.inputCost} as double precision)), 0)`.as(
					"inputCost",
				),
			outputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.outputCost} as double precision)), 0)`.as(
					"outputCost",
				),
			requestCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.requestCost} as double precision)), 0)`.as(
					"requestCost",
				),
			dataStorageCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.dataStorageCost} as double precision)), 0)`.as(
					"dataStorageCost",
				),
			imageInputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.imageInputCost} as double precision)), 0)`.as(
					"imageInputCost",
				),
			audioInputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.audioInputCost} as double precision)), 0)`.as(
					"audioInputCost",
				),
			audioOutputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.audioOutputCost} as double precision)), 0)`.as(
					"audioOutputCost",
				),
			imageOutputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.imageOutputCost} as double precision)), 0)`.as(
					"imageOutputCost",
				),
			videoOutputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.videoOutputCost} as double precision)), 0)`.as(
					"videoOutputCost",
				),
			cachedInputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cachedInputCost} as double precision)), 0)`.as(
					"cachedInputCost",
				),
			cacheWriteInputCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.cacheWriteInputCost} as double precision)), 0)`.as(
					"cacheWriteInputCost",
				),
			errorCount:
				sql<number>`COALESCE(SUM(${projectHourlyStats.errorCount}), 0)`.as(
					"errorCount",
				),
			cacheCount:
				sql<number>`COALESCE(SUM(${projectHourlyStats.cacheCount}), 0)`.as(
					"cacheCount",
				),
			discountSavings:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.discountSavings} as double precision)), 0)`.as(
					"discountSavings",
				),
			creditsRequestCount:
				sql<number>`COALESCE(SUM(${projectHourlyStats.creditsRequestCount}), 0)`.as(
					"creditsRequestCount",
				),
			apiKeysRequestCount:
				sql<number>`COALESCE(SUM(${projectHourlyStats.apiKeysRequestCount}), 0)`.as(
					"apiKeysRequestCount",
				),
			creditsCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.creditsCost} as double precision)), 0)`.as(
					"creditsCost",
				),
			apiKeysCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.apiKeysCost} as double precision)), 0)`.as(
					"apiKeysCost",
				),
			creditsDataStorageCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.creditsDataStorageCost} as double precision)), 0)`.as(
					"creditsDataStorageCost",
				),
			apiKeysDataStorageCost:
				sql<number>`COALESCE(SUM(cast(${projectHourlyStats.apiKeysDataStorageCost} as double precision)), 0)`.as(
					"apiKeysDataStorageCost",
				),
		})
		.from(projectHourlyStats)
		.where(
			and(
				inArray(projectHourlyStats.projectId, projectIds),
				gte(projectHourlyStats.hourTimestamp, startDate),
				lte(projectHourlyStats.hourTimestamp, endDate),
			),
		)
		.groupBy(sql`1`)
		.orderBy(sql`1 ASC`);

	// Create a map to organize model breakdowns by date.
	// Only query for the requested dimension — saves an aggregate scan for
	// callers that opt into one of the other breakdowns.
	const modelBreakdownByDate = new Map<
		string,
		z.infer<typeof modelUsageSchema>[]
	>();
	if (breakdownDimension === "model") {
		const modelBreakdowns = await db
			.select({
				date: bucketDate(
					projectHourlyModelStats.hourTimestamp,
					timeZone,
					isHourly,
				).as("date"),
				usedModel: projectHourlyModelStats.usedModel,
				usedProvider: projectHourlyModelStats.usedProvider,
				requestCount:
					sql<number>`COALESCE(SUM(${projectHourlyModelStats.requestCount}), 0)`.as(
						"requestCount",
					),
				inputTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.inputTokens} AS NUMERIC)), 0)`.as(
						"inputTokens",
					),
				outputTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.outputTokens} AS NUMERIC)), 0)`.as(
						"outputTokens",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${projectHourlyModelStats.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				cost: sql<number>`COALESCE(SUM(cast(${projectHourlyModelStats.cost} as double precision)), 0)`.as(
					"cost",
				),
				...modeSplitFields(projectHourlyModelStats),
			})
			.from(projectHourlyModelStats)
			.where(
				and(
					inArray(projectHourlyModelStats.projectId, projectIds),
					gte(projectHourlyModelStats.hourTimestamp, startDate),
					lte(projectHourlyModelStats.hourTimestamp, endDate),
				),
			)
			.groupBy(
				sql`1, ${projectHourlyModelStats.usedModel}, ${projectHourlyModelStats.usedProvider}`,
			)
			.orderBy(sql`1 ASC, ${projectHourlyModelStats.usedModel} ASC`);

		for (const breakdown of modelBreakdowns) {
			if (!modelBreakdownByDate.has(breakdown.date)) {
				modelBreakdownByDate.set(breakdown.date, []);
			}
			modelBreakdownByDate.get(breakdown.date)!.push({
				id: breakdown.usedModel || "unknown",
				provider: breakdown.usedProvider || "unknown",
				requestCount: Number(breakdown.requestCount),
				inputTokens: Number(breakdown.inputTokens),
				outputTokens: Number(breakdown.outputTokens),
				totalTokens: Number(breakdown.totalTokens),
				cost: Number(breakdown.cost),
				...mapModeSplit(breakdown),
			});
		}
	}

	// Query api key breakdown only when the caller asks for it.
	const apiKeyBreakdownByDate = new Map<
		string,
		z.infer<typeof apiKeyUsageSchema>[]
	>();
	if (breakdownDimension === "apiKey") {
		const apiKeyBreakdowns = await db
			.select({
				date: bucketDate(
					apiKeyHourlyStats.hourTimestamp,
					timeZone,
					isHourly,
				).as("date"),
				apiKeyId: apiKeyHourlyStats.apiKeyId,
				description: apiKey.description,
				requestCount:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCount}), 0)`.as(
						"requestCount",
					),
				inputTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.inputTokens} AS NUMERIC)), 0)`.as(
						"inputTokens",
					),
				outputTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.outputTokens} AS NUMERIC)), 0)`.as(
						"outputTokens",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				cost: sql<number>`COALESCE(SUM(cast(${apiKeyHourlyStats.cost} as double precision)), 0)`.as(
					"cost",
				),
				...modeSplitFields(apiKeyHourlyStats),
			})
			.from(apiKeyHourlyStats)
			.leftJoin(apiKey, eq(apiKey.id, apiKeyHourlyStats.apiKeyId))
			.where(
				and(
					inArray(apiKeyHourlyStats.projectId, projectIds),
					inArray(apiKey.keyType, ["user", "end_user_customer"]),
					gte(apiKeyHourlyStats.hourTimestamp, startDate),
					lte(apiKeyHourlyStats.hourTimestamp, endDate),
				),
			)
			.groupBy(sql`1, ${apiKeyHourlyStats.apiKeyId}, ${apiKey.description}`)
			.orderBy(sql`1 ASC, ${apiKeyHourlyStats.apiKeyId} ASC`);

		for (const breakdown of apiKeyBreakdowns) {
			if (!apiKeyBreakdownByDate.has(breakdown.date)) {
				apiKeyBreakdownByDate.set(breakdown.date, []);
			}
			apiKeyBreakdownByDate.get(breakdown.date)!.push({
				id: breakdown.apiKeyId,
				description: breakdown.description ?? "Deleted key",
				requestCount: Number(breakdown.requestCount),
				inputTokens: Number(breakdown.inputTokens),
				outputTokens: Number(breakdown.outputTokens),
				totalTokens: Number(breakdown.totalTokens),
				cost: Number(breakdown.cost),
				...mapModeSplit(breakdown),
			});
		}
	}

	// Query the per-member breakdown only when the caller asks for it.
	const userBreakdownByDate = new Map<
		string,
		z.infer<typeof userUsageSchema>[]
	>();
	if (breakdownDimension === "user") {
		const userBreakdowns = await getUserUsageBreakdown({
			projectIds,
			startDate,
			endDate,
			timeZone,
			isHourly,
		});

		for (const breakdown of userBreakdowns) {
			if (!userBreakdownByDate.has(breakdown.date)) {
				userBreakdownByDate.set(breakdown.date, []);
			}
			userBreakdownByDate.get(breakdown.date)!.push({
				id: breakdown.userId,
				name: breakdown.name,
				requestCount: breakdown.requestCount,
				inputTokens: breakdown.inputTokens,
				outputTokens: breakdown.outputTokens,
				totalTokens: breakdown.totalTokens,
				cost: breakdown.cost,
				creditsRequestCount: breakdown.creditsRequestCount,
				apiKeysRequestCount: breakdown.apiKeysRequestCount,
				creditsCost: breakdown.creditsCost,
				apiKeysCost: breakdown.apiKeysCost,
			});
		}
	}

	// Process hourly aggregates (summed to daily) and add calculated fields
	const activityData = hourlyAggregates.map((day) => {
		// Convert database strings to numbers
		const requestCount = Number(day.requestCount);
		const inputTokens = Number(day.inputTokens);
		const outputTokens = Number(day.outputTokens);
		const cachedTokens = Number(day.cachedTokens);
		const cacheWriteTokens = Number(day.cacheWriteTokens);
		const totalTokens = Number(day.totalTokens);
		const cost = Number(day.cost);
		const inputCost = Number(day.inputCost);
		const outputCost = Number(day.outputCost);
		const requestCost = Number(day.requestCost);
		const dataStorageCost = Number(day.dataStorageCost);
		const imageInputCost = Number(day.imageInputCost);
		const audioInputCost = Number(day.audioInputCost);
		const audioOutputCost = Number(day.audioOutputCost);
		const imageOutputCost = Number(day.imageOutputCost);
		const videoOutputCost = Number(day.videoOutputCost);
		const cachedInputCost = Number(day.cachedInputCost);
		const cacheWriteInputCost = Number(day.cacheWriteInputCost);
		const errorCount = Number(day.errorCount);
		const cacheCount = Number(day.cacheCount);
		const discountSavings = Number(day.discountSavings);

		const creditsRequestCount = Number(day.creditsRequestCount);
		const apiKeysRequestCount = Number(day.apiKeysRequestCount);
		const creditsCost = Number(day.creditsCost);
		const apiKeysCost = Number(day.apiKeysCost);
		const creditsDataStorageCost = Number(day.creditsDataStorageCost);
		const apiKeysDataStorageCost = Number(day.apiKeysDataStorageCost);

		const errorRate = requestCount > 0 ? (errorCount / requestCount) * 100 : 0;
		const cacheRate = requestCount > 0 ? (cacheCount / requestCount) * 100 : 0;

		return {
			date: day.date,
			requestCount,
			inputTokens,
			outputTokens,
			cachedTokens,
			cacheWriteTokens,
			totalTokens,
			cost,
			inputCost,
			outputCost,
			requestCost,
			dataStorageCost,
			imageInputCost,
			audioInputCost,
			audioOutputCost,
			imageOutputCost,
			videoOutputCost,
			cachedInputCost,
			cacheWriteInputCost,
			errorCount,
			errorRate,
			cacheCount,
			cacheRate,
			discountSavings,
			creditsRequestCount,
			apiKeysRequestCount,
			creditsCost,
			apiKeysCost,
			creditsDataStorageCost,
			apiKeysDataStorageCost,
			modelBreakdown: modelBreakdownByDate.get(day.date) ?? [],
			apiKeyBreakdown: apiKeyBreakdownByDate.get(day.date) ?? [],
			userBreakdown: userBreakdownByDate.get(day.date) ?? [],
		};
	});

	const paddedActivity =
		timeRange || (from && to)
			? padActivity(activityData, startDate, endDate, isHourly, timeZone)
			: activityData;

	return c.json({
		activity: paddedActivity,
		...(timeRange ? { granularity } : {}),
	});
});

// Response schema for per-source usage aggregation
const sourceUsageSchema = z.object({
	source: z.string(),
	requestCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	...modeSplitSchema,
	lastUsedAt: z.string().nullable(),
});

// Aggregated source usage for a single project, read from the per-project
// hourly source rollup. Powers the agents dashboard. Supports 1h/4h/24h/7d/30d
// ranges.
const sourceActivityRangeHours = {
	"1h": 1,
	"4h": 4,
	"24h": 24,
	"7d": 7 * 24,
	"30d": 30 * 24,
} as const;

const getSourceActivity = createRoute({
	method: "get",
	path: "/sources",
	request: {
		query: z.object({
			projectId: z.string(),
			timeRange: z.enum(["1h", "4h", "24h", "7d", "30d"]).optional(),
			from: z.string().optional(),
			to: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						sources: z.array(sourceUsageSchema),
					}),
				},
			},
			description: "Aggregated usage grouped by source for a project",
		},
	},
});

activity.openapi(getSourceActivity, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { projectId, timeRange, from, to } = c.req.valid("query");

	let startDate: Date;
	let endDate: Date;
	if (from && to) {
		// Parse without a timezone suffix to match the sibling GET / handler.
		startDate = new Date(from + "T00:00:00");
		endDate = new Date(to + "T23:59:59.999");
	} else {
		endDate = new Date();
		const windowMs =
			sourceActivityRangeHours[timeRange ?? "7d"] * 60 * 60 * 1000;
		startDate = new Date(endDate.getTime() - windowMs);
	}

	if (!(await userHasProjectAccess(user.id, projectId))) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	// projectHourlySourceStats has no apiKeyId column, so a developer's own
	// sources cannot be separated from their teammates'. Rather than serve them
	// the whole project's agent traffic, refuse — the Agents page is not part of
	// the developer navigation anyway.
	if (isKeyScoped(await getApiKeyScope(user.id, [projectId]))) {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can view project sources",
		});
	}

	const project = await db.query.project.findFirst({
		where: {
			id: projectId,
			status: { ne: "deleted" },
		},
	});

	if (!project) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	const rows = await db
		.select({
			source: projectHourlySourceStats.source,
			requestCount:
				sql<number>`COALESCE(SUM(${projectHourlySourceStats.requestCount}), 0)`.as(
					"requestCount",
				),
			inputTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlySourceStats.inputTokens} AS NUMERIC)), 0)`.as(
					"inputTokens",
				),
			outputTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlySourceStats.outputTokens} AS NUMERIC)), 0)`.as(
					"outputTokens",
				),
			totalTokens:
				sql<number>`COALESCE(SUM(CAST(${projectHourlySourceStats.totalTokens} AS NUMERIC)), 0)`.as(
					"totalTokens",
				),
			cost: sql<number>`COALESCE(SUM(cast(${projectHourlySourceStats.cost} as double precision)), 0)`.as(
				"cost",
			),
			...modeSplitFields(projectHourlySourceStats),
			lastUsedAt: sql<
				string | null
			>`to_char(MAX(${projectHourlySourceStats.hourTimestamp}), 'YYYY-MM-DD"T"HH24:MI:SS')`.as(
				"lastUsedAt",
			),
		})
		.from(projectHourlySourceStats)
		.where(
			and(
				eq(projectHourlySourceStats.projectId, projectId),
				gte(projectHourlySourceStats.hourTimestamp, startDate),
				lte(projectHourlySourceStats.hourTimestamp, endDate),
			),
		)
		.groupBy(projectHourlySourceStats.source)
		.orderBy(
			desc(
				sql`COALESCE(SUM(cast(${projectHourlySourceStats.cost} as double precision)), 0)`,
			),
		);

	return c.json({
		sources: rows.map((r) => ({
			source: r.source,
			requestCount: Number(r.requestCount),
			inputTokens: Number(r.inputTokens),
			outputTokens: Number(r.outputTokens),
			totalTokens: Number(r.totalTokens),
			cost: Number(r.cost),
			...mapModeSplit(r),
			lastUsedAt: r.lastUsedAt
				? new Date(r.lastUsedAt + "Z").toISOString()
				: null,
		})),
	});
});
