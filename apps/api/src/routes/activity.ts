import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { db } from "@llmgateway/db";

import type { ServerTypes } from "@/vars";

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
	errorCount: z.number(),
	errorRate: z.number(),
	cacheCount: z.number(),
	cacheRate: z.number(),
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
	const { days, projectId } = c.req.valid("query");

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

	// Query logs for all projects in range
	const rawLogs = await db.query.log.findMany({
		where: {
			projectId: { in: projectIds },
			createdAt: {
				gte: startDate,
				lte: endDate,
			},
		},
	});

	// Process the raw logs to create the activity response
	const activityMap = new Map<string, typeof dailyActivitySchema._type>();
	// Map to track model breakdown aggregation per day: dateStr -> modelKey -> aggregated data
	const modelBreakdownMap = new Map<
		string,
		Map<string, typeof modelUsageSchema._type>
	>();

	for (const log of rawLogs) {
		const promptTokens = Number(log.promptTokens || 0);
		const completionTokens = Number(log.completionTokens || 0);
		const totalTokens = Number(log.totalTokens || 0);
		const requestCount = 1;
		const totalCost = Number(log.cost || 0);
		const inputCost = Number(log.inputCost || 0);
		const outputCost = Number(log.outputCost || 0);
		const requestCost = Number(log.requestCost || 0);

		const dateStr = log.createdAt.toISOString().split("T")[0];

		// Create or update the day entry
		if (!activityMap.has(dateStr)) {
			activityMap.set(dateStr, {
				date: dateStr,
				requestCount: 0,
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				cost: 0,
				inputCost: 0,
				outputCost: 0,
				requestCost: 0,
				errorCount: 0,
				errorRate: 0,
				cacheCount: 0,
				cacheRate: 0,
				modelBreakdown: [],
			});
			modelBreakdownMap.set(dateStr, new Map());
		}

		const dayData = activityMap.get(dateStr)!;
		const dayModelMap = modelBreakdownMap.get(dateStr)!;

		// Update the day totals
		dayData.requestCount += requestCount;
		dayData.inputTokens += promptTokens;
		dayData.outputTokens += completionTokens;
		dayData.totalTokens += totalTokens;
		dayData.cost += totalCost;
		dayData.inputCost += inputCost;
		dayData.outputCost += outputCost;
		dayData.requestCost += requestCost;
		dayData.errorCount += log.hasError ? 1 : 0;
		dayData.cacheCount += log.cached ? 1 : 0;
		dayData.errorRate =
			dayData.requestCount > 0
				? (dayData.errorCount / dayData.requestCount) * 100
				: 0;
		dayData.cacheRate =
			dayData.requestCount > 0
				? (dayData.cacheCount / dayData.requestCount) * 100
				: 0;

		// Aggregate model breakdown data
		const model = log.usedModel || "unknown";
		const provider = log.usedProvider || "unknown";
		const modelKey = `${model}:${provider}`;

		if (!dayModelMap.has(modelKey)) {
			dayModelMap.set(modelKey, {
				id: model,
				provider,
				requestCount: 0,
				inputTokens: 0,
				outputTokens: 0,
				totalTokens: 0,
				cost: 0,
			});
		}

		const modelData = dayModelMap.get(modelKey)!;
		modelData.requestCount += requestCount;
		modelData.inputTokens += promptTokens;
		modelData.outputTokens += completionTokens;
		modelData.totalTokens += totalTokens;
		modelData.cost += totalCost;
	}

	// Convert aggregated model data to arrays
	for (const [dateStr, dayModelMap] of modelBreakdownMap) {
		const dayData = activityMap.get(dateStr)!;
		dayData.modelBreakdown = Array.from(dayModelMap.values());
	}

	// Convert the map to an array and sort by date
	const activityData = Array.from(activityMap.values()).sort((a, b) => {
		return new Date(a.date).getTime() - new Date(b.date).getTime();
	});

	return c.json({
		activity: activityData,
	});
});
