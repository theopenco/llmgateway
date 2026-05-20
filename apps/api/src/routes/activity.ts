import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getUserOrganizationIds } from "@/utils/authorization.js";

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
});

type ActivityRow = z.infer<typeof dailyActivitySchema>;

function generateTimeSlots(
	startDate: Date,
	endDate: Date,
	isHourly: boolean,
): string[] {
	const slots: string[] = [];
	if (isHourly) {
		const cur = new Date(
			Date.UTC(
				startDate.getUTCFullYear(),
				startDate.getUTCMonth(),
				startDate.getUTCDate(),
				startDate.getUTCHours(),
			),
		);
		const end = new Date(
			Date.UTC(
				endDate.getUTCFullYear(),
				endDate.getUTCMonth(),
				endDate.getUTCDate(),
				endDate.getUTCHours(),
			),
		);
		while (cur.getTime() <= end.getTime()) {
			slots.push(cur.toISOString().slice(0, 19));
			cur.setUTCHours(cur.getUTCHours() + 1);
		}
	} else {
		const cur = new Date(
			Date.UTC(
				startDate.getUTCFullYear(),
				startDate.getUTCMonth(),
				startDate.getUTCDate(),
			),
		);
		const end = new Date(
			Date.UTC(
				endDate.getUTCFullYear(),
				endDate.getUTCMonth(),
				endDate.getUTCDate(),
			),
		);
		while (cur.getTime() <= end.getTime()) {
			slots.push(cur.toISOString().slice(0, 10));
			cur.setUTCDate(cur.getUTCDate() + 1);
		}
	}
	return slots;
}

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
	};
}

function padActivity(
	rows: ActivityRow[],
	startDate: Date,
	endDate: Date,
	isHourly: boolean,
): ActivityRow[] {
	const slots = generateTimeSlots(startDate, endDate, isHourly);
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
			timeRange: z.enum(["1h", "4h", "24h", "7d", "30d"]).optional(),
			groupBy: z.enum(["model", "apiKey"]).optional(),
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
	const { days, from, to, projectId, apiKeyId, timeRange, groupBy } =
		c.req.valid("query");
	const breakdownByApiKey = groupBy === "apiKey";

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
		}
	} else if (from && to) {
		startDate = new Date(from + "T00:00:00");
		endDate = new Date(to + "T23:59:59.999");
	} else {
		const effectiveDays = days ?? 7;
		endDate = new Date();
		startDate = new Date();
		startDate.setDate(startDate.getDate() - effectiveDays);
	}

	// SQL expressions that change based on granularity
	const isHourly = granularity === "hourly";

	// Get all organizations the user is a member of
	const organizationIds = await getUserOrganizationIds(user.id);

	if (!organizationIds.length) {
		return c.json({
			activity: [],
		});
	}

	// Get all projects associated with the user's organizations
	const projects = await db.query.project.findMany({
		where: {
			organizationId: {
				in: organizationIds,
			},
			status: {
				ne: "deleted",
			},
			...(projectId ? { id: projectId } : {}),
		},
	});

	if (!projects.length) {
		return c.json({
			activity: [],
		});
	}

	const projectIds = projects.map((project) => project.id);

	if (projectId && !projectIds.includes(projectId)) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	// If filtering by apiKeyId, use the apiKeyHourlyStats aggregation table
	if (apiKeyId) {
		// Query aggregated data from apiKeyHourlyStats table
		const hourlyAggregates = await db
			.select({
				date: isHourly
					? sql<string>`to_char(${apiKeyHourlyStats.hourTimestamp}, 'YYYY-MM-DD"T"HH24:MI:SS')`.as(
							"date",
						)
					: sql<string>`DATE(${apiKeyHourlyStats.hourTimestamp})`.as("date"),
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
				cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as(
					"cost",
				),
				inputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.inputCost}), 0)`.as(
						"inputCost",
					),
				outputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.outputCost}), 0)`.as(
						"outputCost",
					),
				requestCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.requestCost}), 0)`.as(
						"requestCost",
					),
				dataStorageCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.dataStorageCost}), 0)`.as(
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
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.discountSavings}), 0)`.as(
						"discountSavings",
					),
				imageInputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.imageInputCost}), 0)`.as(
						"imageInputCost",
					),
				audioInputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.audioInputCost}), 0)`.as(
						"audioInputCost",
					),
				imageOutputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.imageOutputCost}), 0)`.as(
						"imageOutputCost",
					),
				videoOutputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.videoOutputCost}), 0)`.as(
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
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cachedInputCost}), 0)`.as(
						"cachedInputCost",
					),
				cacheWriteInputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cacheWriteInputCost}), 0)`.as(
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
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.creditsCost}), 0)`.as(
						"creditsCost",
					),
				apiKeysCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.apiKeysCost}), 0)`.as(
						"apiKeysCost",
					),
				creditsDataStorageCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.creditsDataStorageCost}), 0)`.as(
						"creditsDataStorageCost",
					),
				apiKeysDataStorageCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.apiKeysDataStorageCost}), 0)`.as(
						"apiKeysDataStorageCost",
					),
			})
			.from(apiKeyHourlyStats)
			.where(
				and(
					eq(apiKeyHourlyStats.apiKeyId, apiKeyId),
					inArray(apiKeyHourlyStats.projectId, projectIds),
					gte(apiKeyHourlyStats.hourTimestamp, startDate),
					lte(apiKeyHourlyStats.hourTimestamp, endDate),
				),
			)
			.groupBy(
				isHourly
					? sql`${apiKeyHourlyStats.hourTimestamp}`
					: sql`DATE(${apiKeyHourlyStats.hourTimestamp})`,
			)
			.orderBy(
				isHourly
					? sql`${apiKeyHourlyStats.hourTimestamp} ASC`
					: sql`DATE(${apiKeyHourlyStats.hourTimestamp}) ASC`,
			);

		// Query model breakdown from apiKeyHourlyModelStats table
		const modelBreakdowns = await db
			.select({
				date: isHourly
					? sql<string>`to_char(${apiKeyHourlyModelStats.hourTimestamp}, 'YYYY-MM-DD"T"HH24:MI:SS')`.as(
							"date",
						)
					: sql<string>`DATE(${apiKeyHourlyModelStats.hourTimestamp})`.as(
							"date",
						),
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
				cost: sql<number>`COALESCE(SUM(${apiKeyHourlyModelStats.cost}), 0)`.as(
					"cost",
				),
			})
			.from(apiKeyHourlyModelStats)
			.where(
				and(
					eq(apiKeyHourlyModelStats.apiKeyId, apiKeyId),
					inArray(apiKeyHourlyModelStats.projectId, projectIds),
					gte(apiKeyHourlyModelStats.hourTimestamp, startDate),
					lte(apiKeyHourlyModelStats.hourTimestamp, endDate),
				),
			)
			.groupBy(
				isHourly
					? sql`${apiKeyHourlyModelStats.hourTimestamp}, ${apiKeyHourlyModelStats.usedModel}, ${apiKeyHourlyModelStats.usedProvider}`
					: sql`DATE(${apiKeyHourlyModelStats.hourTimestamp}), ${apiKeyHourlyModelStats.usedModel}, ${apiKeyHourlyModelStats.usedProvider}`,
			)
			.orderBy(
				isHourly
					? sql`${apiKeyHourlyModelStats.hourTimestamp} ASC, ${apiKeyHourlyModelStats.usedModel} ASC`
					: sql`DATE(${apiKeyHourlyModelStats.hourTimestamp}) ASC, ${apiKeyHourlyModelStats.usedModel} ASC`,
			);

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
			});
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
				apiKeyBreakdown: [],
			};
		});

		const paddedActivity = timeRange
			? padActivity(activityData, startDate, endDate, isHourly)
			: activityData;

		return c.json({
			activity: paddedActivity,
			...(timeRange ? { granularity } : {}),
		});
	}

	// Use aggregation tables for fast queries (when not filtering by apiKeyId)
	// Query aggregated data from projectHourlyStats table
	const hourlyAggregates = await db
		.select({
			date: isHourly
				? sql<string>`to_char(${projectHourlyStats.hourTimestamp}, 'YYYY-MM-DD"T"HH24:MI:SS')`.as(
						"date",
					)
				: sql<string>`DATE(${projectHourlyStats.hourTimestamp})`.as("date"),
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
			cost: sql<number>`COALESCE(SUM(${projectHourlyStats.cost}), 0)`.as(
				"cost",
			),
			inputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.inputCost}), 0)`.as(
					"inputCost",
				),
			outputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.outputCost}), 0)`.as(
					"outputCost",
				),
			requestCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.requestCost}), 0)`.as(
					"requestCost",
				),
			dataStorageCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.dataStorageCost}), 0)`.as(
					"dataStorageCost",
				),
			imageInputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.imageInputCost}), 0)`.as(
					"imageInputCost",
				),
			audioInputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.audioInputCost}), 0)`.as(
					"audioInputCost",
				),
			imageOutputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.imageOutputCost}), 0)`.as(
					"imageOutputCost",
				),
			videoOutputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.videoOutputCost}), 0)`.as(
					"videoOutputCost",
				),
			cachedInputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.cachedInputCost}), 0)`.as(
					"cachedInputCost",
				),
			cacheWriteInputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.cacheWriteInputCost}), 0)`.as(
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
				sql<number>`COALESCE(SUM(${projectHourlyStats.discountSavings}), 0)`.as(
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
				sql<number>`COALESCE(SUM(${projectHourlyStats.creditsCost}), 0)`.as(
					"creditsCost",
				),
			apiKeysCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.apiKeysCost}), 0)`.as(
					"apiKeysCost",
				),
			creditsDataStorageCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.creditsDataStorageCost}), 0)`.as(
					"creditsDataStorageCost",
				),
			apiKeysDataStorageCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.apiKeysDataStorageCost}), 0)`.as(
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
		.groupBy(
			isHourly
				? sql`${projectHourlyStats.hourTimestamp}`
				: sql`DATE(${projectHourlyStats.hourTimestamp})`,
		)
		.orderBy(
			isHourly
				? sql`${projectHourlyStats.hourTimestamp} ASC`
				: sql`DATE(${projectHourlyStats.hourTimestamp}) ASC`,
		);

	// Create a map to organize model breakdowns by date.
	// Only query when not breaking down by api key — saves an aggregate scan
	// for callers that opt into the api-key breakdown.
	const modelBreakdownByDate = new Map<
		string,
		z.infer<typeof modelUsageSchema>[]
	>();
	if (!breakdownByApiKey) {
		const modelBreakdowns = await db
			.select({
				date: isHourly
					? sql<string>`to_char(${projectHourlyModelStats.hourTimestamp}, 'YYYY-MM-DD"T"HH24:MI:SS')`.as(
							"date",
						)
					: sql<string>`DATE(${projectHourlyModelStats.hourTimestamp})`.as(
							"date",
						),
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
				cost: sql<number>`COALESCE(SUM(${projectHourlyModelStats.cost}), 0)`.as(
					"cost",
				),
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
				isHourly
					? sql`${projectHourlyModelStats.hourTimestamp}, ${projectHourlyModelStats.usedModel}, ${projectHourlyModelStats.usedProvider}`
					: sql`DATE(${projectHourlyModelStats.hourTimestamp}), ${projectHourlyModelStats.usedModel}, ${projectHourlyModelStats.usedProvider}`,
			)
			.orderBy(
				isHourly
					? sql`${projectHourlyModelStats.hourTimestamp} ASC, ${projectHourlyModelStats.usedModel} ASC`
					: sql`DATE(${projectHourlyModelStats.hourTimestamp}) ASC, ${projectHourlyModelStats.usedModel} ASC`,
			);

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
			});
		}
	}

	// Query api key breakdown only when the caller asks for it.
	const apiKeyBreakdownByDate = new Map<
		string,
		z.infer<typeof apiKeyUsageSchema>[]
	>();
	if (breakdownByApiKey) {
		const apiKeyBreakdowns = await db
			.select({
				date: isHourly
					? sql<string>`to_char(${apiKeyHourlyStats.hourTimestamp}, 'YYYY-MM-DD"T"HH24:MI:SS')`.as(
							"date",
						)
					: sql<string>`DATE(${apiKeyHourlyStats.hourTimestamp})`.as("date"),
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
				cost: sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cost}), 0)`.as(
					"cost",
				),
			})
			.from(apiKeyHourlyStats)
			.leftJoin(apiKey, eq(apiKey.id, apiKeyHourlyStats.apiKeyId))
			.where(
				and(
					inArray(apiKeyHourlyStats.projectId, projectIds),
					gte(apiKeyHourlyStats.hourTimestamp, startDate),
					lte(apiKeyHourlyStats.hourTimestamp, endDate),
				),
			)
			.groupBy(
				isHourly
					? sql`${apiKeyHourlyStats.hourTimestamp}, ${apiKeyHourlyStats.apiKeyId}, ${apiKey.description}`
					: sql`DATE(${apiKeyHourlyStats.hourTimestamp}), ${apiKeyHourlyStats.apiKeyId}, ${apiKey.description}`,
			)
			.orderBy(
				isHourly
					? sql`${apiKeyHourlyStats.hourTimestamp} ASC, ${apiKeyHourlyStats.apiKeyId} ASC`
					: sql`DATE(${apiKeyHourlyStats.hourTimestamp}) ASC, ${apiKeyHourlyStats.apiKeyId} ASC`,
			);

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
		};
	});

	const paddedActivity = timeRange
		? padActivity(activityData, startDate, endDate, isHourly)
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
	lastUsedAt: z.string().nullable(),
});

// Aggregated source usage for a single project, read from the per-project
// hourly source rollup. Powers the agents dashboard. Limited to 7d/30d ranges.
const getSourceActivity = createRoute({
	method: "get",
	path: "/sources",
	request: {
		query: z.object({
			projectId: z.string(),
			timeRange: z.enum(["7d", "30d"]).optional(),
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
		startDate = new Date();
		startDate.setDate(startDate.getDate() - (timeRange === "30d" ? 30 : 7));
	}

	const organizationIds = await getUserOrganizationIds(user.id);

	if (!organizationIds.length) {
		return c.json({ sources: [] });
	}

	const project = await db.query.project.findFirst({
		where: {
			id: projectId,
			organizationId: { in: organizationIds },
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
			cost: sql<number>`COALESCE(SUM(${projectHourlySourceStats.cost}), 0)`.as(
				"cost",
			),
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
		.orderBy(desc(sql`COALESCE(SUM(${projectHourlySourceStats.cost}), 0)`));

	return c.json({
		sources: rows.map((r) => ({
			source: r.source,
			requestCount: Number(r.requestCount),
			inputTokens: Number(r.inputTokens),
			outputTokens: Number(r.outputTokens),
			totalTokens: Number(r.totalTokens),
			cost: Number(r.cost),
			lastUsedAt: r.lastUsedAt
				? new Date(r.lastUsedAt + "Z").toISOString()
				: null,
		})),
	});
});
