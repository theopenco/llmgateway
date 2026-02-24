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
	projectHourlyStats,
	projectHourlyModelStats,
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

// Define the response schema for daily activity
const dailyActivitySchema = z.object({
	date: z.string(),
	requestCount: z.number(),
	inputTokens: z.number(),
	outputTokens: z.number(),
	cachedTokens: z.number(),
	totalTokens: z.number(),
	cost: z.number(),
	inputCost: z.number(),
	outputCost: z.number(),
	requestCost: z.number(),
	dataStorageCost: z.number(),
	imageInputCost: z.number(),
	imageOutputCost: z.number(),
	cachedInputCost: z.number(),
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
});

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
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						activity: z.array(dailyActivitySchema),
					}),
				},
			},
			description: "Activity data grouped by day",
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
	const { days, from, to, projectId, apiKeyId } = c.req.valid("query");

	// Calculate the date range
	let startDate: Date;
	let endDate: Date;

	if (from && to) {
		startDate = new Date(from + "T00:00:00");
		endDate = new Date(to + "T23:59:59.999");
	} else {
		const effectiveDays = days ?? 7;
		endDate = new Date();
		startDate = new Date();
		startDate.setDate(startDate.getDate() - effectiveDays);
	}

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
		// Query daily aggregated data from apiKeyHourlyStats table
		const hourlyAggregates = await db
			.select({
				date: sql<string>`DATE(${apiKeyHourlyStats.hourTimestamp})`.as("date"),
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
				imageOutputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.imageOutputCost}), 0)`.as(
						"imageOutputCost",
					),
				cachedTokens:
					sql<number>`COALESCE(SUM(CAST(${apiKeyHourlyStats.cachedTokens} AS NUMERIC)), 0)`.as(
						"cachedTokens",
					),
				cachedInputCost:
					sql<number>`COALESCE(SUM(${apiKeyHourlyStats.cachedInputCost}), 0)`.as(
						"cachedInputCost",
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
			.groupBy(sql`DATE(${apiKeyHourlyStats.hourTimestamp})`)
			.orderBy(sql`DATE(${apiKeyHourlyStats.hourTimestamp}) ASC`);

		// Query model breakdown from apiKeyHourlyModelStats table
		const modelBreakdowns = await db
			.select({
				date: sql<string>`DATE(${apiKeyHourlyModelStats.hourTimestamp})`.as(
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
				sql`DATE(${apiKeyHourlyModelStats.hourTimestamp}), ${apiKeyHourlyModelStats.usedModel}, ${apiKeyHourlyModelStats.usedProvider}`,
			)
			.orderBy(
				sql`DATE(${apiKeyHourlyModelStats.hourTimestamp}) ASC, ${apiKeyHourlyModelStats.usedModel} ASC`,
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
			const imageOutputCost = Number(day.imageOutputCost);
			const cachedInputCost = Number(day.cachedInputCost);

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
				totalTokens,
				cost,
				inputCost,
				outputCost,
				requestCost,
				dataStorageCost,
				imageInputCost,
				imageOutputCost,
				cachedInputCost,
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
			};
		});

		return c.json({
			activity: activityData,
		});
	}

	// Use aggregation tables for fast queries (when not filtering by apiKeyId)
	// Query hourly aggregated data from projectHourlyStats table
	const hourlyAggregates = await db
		.select({
			date: sql<string>`DATE(${projectHourlyStats.hourTimestamp})`.as("date"),
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
			imageOutputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.imageOutputCost}), 0)`.as(
					"imageOutputCost",
				),
			cachedInputCost:
				sql<number>`COALESCE(SUM(${projectHourlyStats.cachedInputCost}), 0)`.as(
					"cachedInputCost",
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
		.groupBy(sql`DATE(${projectHourlyStats.hourTimestamp})`)
		.orderBy(sql`DATE(${projectHourlyStats.hourTimestamp}) ASC`);

	// Query model breakdown from projectHourlyModelStats table
	const modelBreakdowns = await db
		.select({
			date: sql<string>`DATE(${projectHourlyModelStats.hourTimestamp})`.as(
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
			sql`DATE(${projectHourlyModelStats.hourTimestamp}), ${projectHourlyModelStats.usedModel}, ${projectHourlyModelStats.usedProvider}`,
		)
		.orderBy(
			sql`DATE(${projectHourlyModelStats.hourTimestamp}) ASC, ${projectHourlyModelStats.usedModel} ASC`,
		);

	// Create a map to organize model breakdowns by date
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

	// Process hourly aggregates (summed to daily) and add calculated fields
	const activityData = hourlyAggregates.map((day) => {
		// Convert database strings to numbers
		const requestCount = Number(day.requestCount);
		const inputTokens = Number(day.inputTokens);
		const outputTokens = Number(day.outputTokens);
		const cachedTokens = Number(day.cachedTokens);
		const totalTokens = Number(day.totalTokens);
		const cost = Number(day.cost);
		const inputCost = Number(day.inputCost);
		const outputCost = Number(day.outputCost);
		const requestCost = Number(day.requestCost);
		const dataStorageCost = Number(day.dataStorageCost);
		const imageInputCost = Number(day.imageInputCost);
		const imageOutputCost = Number(day.imageOutputCost);
		const cachedInputCost = Number(day.cachedInputCost);
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
			totalTokens,
			cost,
			inputCost,
			outputCost,
			requestCost,
			dataStorageCost,
			imageInputCost,
			imageOutputCost,
			cachedInputCost,
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
		};
	});

	return c.json({
		activity: activityData,
	});
});
