import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { getUserOrganizationIds } from "@/utils/authorization.js";

import {
	db,
	sql,
	tables,
	inArray,
	and,
	gte,
	lte,
	eq,
	projectHourlyStats,
	projectHourlyModelStats,
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
	totalTokens: z.number(),
	cost: z.number(),
	inputCost: z.number(),
	outputCost: z.number(),
	requestCost: z.number(),
	dataStorageCost: z.number(),
	errorCount: z.number(),
	errorRate: z.number(),
	cacheCount: z.number(),
	cacheRate: z.number(),
	discountSavings: z.number(),
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
				.pipe(z.number().int().positive()),
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

	// Get the days parameter from the query
	const { days, projectId, apiKeyId } = c.req.valid("query");

	// Calculate the date range
	const endDate = new Date();
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - days);

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

	// If filtering by apiKeyId, we need to fall back to raw log table queries
	// since aggregation tables don't track per-API-key stats
	if (apiKeyId) {
		// Query daily aggregated data from raw logs (fallback for apiKeyId filter)
		const dailyAggregates = await db
			.select({
				date: sql<string>`DATE(${tables.log.createdAt})`.as("date"),
				requestCount: sql<number>`COUNT(*)`.as("requestCount"),
				inputTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.promptTokens} AS NUMERIC)), 0)`.as(
						"inputTokens",
					),
				outputTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.completionTokens} AS NUMERIC)), 0)`.as(
						"outputTokens",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				cost: sql<number>`COALESCE(SUM(${tables.log.cost}), 0)`.as("cost"),
				inputCost: sql<number>`COALESCE(SUM(${tables.log.inputCost}), 0)`.as(
					"inputCost",
				),
				outputCost: sql<number>`COALESCE(SUM(${tables.log.outputCost}), 0)`.as(
					"outputCost",
				),
				requestCost:
					sql<number>`COALESCE(SUM(${tables.log.requestCost}), 0)`.as(
						"requestCost",
					),
				dataStorageCost:
					sql<number>`COALESCE(SUM(${tables.log.dataStorageCost}), 0)`.as(
						"dataStorageCost",
					),
				errorCount:
					sql<number>`SUM(CASE WHEN ${tables.log.hasError} = true THEN 1 ELSE 0 END)`.as(
						"errorCount",
					),
				cacheCount:
					sql<number>`SUM(CASE WHEN ${tables.log.cached} = true THEN 1 ELSE 0 END)`.as(
						"cacheCount",
					),
				discountSavings: sql<number>`COALESCE(
					SUM(
						CASE
							WHEN ${tables.log.discount} > 0 AND ${tables.log.discount} < 1
							THEN ${tables.log.cost} * ${tables.log.discount} / (1 - ${tables.log.discount})
							ELSE 0
						END
					),
					0
				)`.as("discountSavings"),
			})
			.from(tables.log)
			.where(
				and(
					inArray(tables.log.projectId, projectIds),
					gte(tables.log.createdAt, startDate),
					lte(tables.log.createdAt, endDate),
					eq(tables.log.apiKeyId, apiKeyId),
				),
			)
			.groupBy(sql`DATE(${tables.log.createdAt})`)
			.orderBy(sql`DATE(${tables.log.createdAt}) ASC`);

		// Query model breakdown data from raw logs
		const modelBreakdowns = await db
			.select({
				date: sql<string>`DATE(${tables.log.createdAt})`.as("date"),
				usedModel: tables.log.usedModel,
				usedProvider: tables.log.usedProvider,
				requestCount: sql<number>`COUNT(*)`.as("requestCount"),
				inputTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.promptTokens} AS NUMERIC)), 0)`.as(
						"inputTokens",
					),
				outputTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.completionTokens} AS NUMERIC)), 0)`.as(
						"outputTokens",
					),
				totalTokens:
					sql<number>`COALESCE(SUM(CAST(${tables.log.totalTokens} AS NUMERIC)), 0)`.as(
						"totalTokens",
					),
				cost: sql<number>`COALESCE(SUM(${tables.log.cost}), 0)`.as("cost"),
			})
			.from(tables.log)
			.where(
				and(
					inArray(tables.log.projectId, projectIds),
					gte(tables.log.createdAt, startDate),
					lte(tables.log.createdAt, endDate),
					eq(tables.log.apiKeyId, apiKeyId),
				),
			)
			.groupBy(
				sql`DATE(${tables.log.createdAt}), ${tables.log.usedModel}, ${tables.log.usedProvider}`,
			)
			.orderBy(
				sql`DATE(${tables.log.createdAt}) ASC, ${tables.log.usedModel} ASC`,
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

		// Process daily aggregates and add calculated fields
		const activityData = dailyAggregates.map((day) => {
			const requestCount = Number(day.requestCount);
			const inputTokens = Number(day.inputTokens);
			const outputTokens = Number(day.outputTokens);
			const totalTokens = Number(day.totalTokens);
			const cost = Number(day.cost);
			const inputCost = Number(day.inputCost);
			const outputCost = Number(day.outputCost);
			const requestCost = Number(day.requestCost);
			const dataStorageCost = Number(day.dataStorageCost);
			const errorCount = Number(day.errorCount);
			const cacheCount = Number(day.cacheCount);
			const discountSavings = Number(day.discountSavings);

			const errorRate =
				requestCount > 0 ? (errorCount / requestCount) * 100 : 0;
			const cacheRate =
				requestCount > 0 ? (cacheCount / requestCount) * 100 : 0;

			return {
				date: day.date,
				requestCount,
				inputTokens,
				outputTokens,
				totalTokens,
				cost,
				inputCost,
				outputCost,
				requestCost,
				dataStorageCost,
				errorCount,
				errorRate,
				cacheCount,
				cacheRate,
				discountSavings,
				modelBreakdown: modelBreakdownByDate.get(day.date) || [],
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
		const totalTokens = Number(day.totalTokens);
		const cost = Number(day.cost);
		const inputCost = Number(day.inputCost);
		const outputCost = Number(day.outputCost);
		const requestCost = Number(day.requestCost);
		const dataStorageCost = Number(day.dataStorageCost);
		const errorCount = Number(day.errorCount);
		const cacheCount = Number(day.cacheCount);
		const discountSavings = Number(day.discountSavings);

		const errorRate = requestCount > 0 ? (errorCount / requestCount) * 100 : 0;
		const cacheRate = requestCount > 0 ? (cacheCount / requestCount) * 100 : 0;

		return {
			date: day.date,
			requestCount,
			inputTokens,
			outputTokens,
			totalTokens,
			cost,
			inputCost,
			outputCost,
			requestCost,
			dataStorageCost,
			errorCount,
			errorRate,
			cacheCount,
			cacheRate,
			discountSavings,
			modelBreakdown: modelBreakdownByDate.get(day.date) || [],
		};
	});

	return c.json({
		activity: activityData,
	});
});
