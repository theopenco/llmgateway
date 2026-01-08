import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db, sql, tables, inArray, and, gte, lte, eq } from "@llmgateway/db";

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

	// Find all organizations the user belongs to
	const userOrganizations = await db.query.userOrganization.findMany({
		where: {
			userId: user.id,
		},
		with: {
			organization: true,
		},
	});

	if (!userOrganizations.length) {
		return c.json({
			activity: [],
		});
	}

	// Get all organizations the user is a member of
	const organizationIds = userOrganizations.map((uo) => uo.organizationId);

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

	// Query daily aggregated data using database-level aggregation
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
			requestCost: sql<number>`COALESCE(SUM(${tables.log.requestCost}), 0)`.as(
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
				...(apiKeyId ? [eq(tables.log.apiKeyId, apiKeyId)] : []),
			),
		)
		.groupBy(sql`DATE(${tables.log.createdAt})`)
		.orderBy(sql`DATE(${tables.log.createdAt}) ASC`);

	// Query model breakdown data using database-level aggregation
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
				...(apiKeyId ? [eq(tables.log.apiKeyId, apiKeyId)] : []),
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
