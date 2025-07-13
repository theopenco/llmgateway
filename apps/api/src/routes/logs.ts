import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { db, errorDetails } from "@llmgateway/db";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ServerTypes } from "../vars";

export const logs = new OpenAPIHono<ServerTypes>();

// Use the log schema directly from the database
// Using z.object directly instead of createSelectSchema due to compatibility issues
const logSchema = z.object({
	id: z.string(),
	requestId: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	organizationId: z.string(),
	projectId: z.string(),
	apiKeyId: z.string(),
	duration: z.number(),
	requestedModel: z.string(),
	requestedProvider: z.string().nullable(),
	usedModel: z.string(),
	usedProvider: z.string(),
	responseSize: z.number(),
	content: z.string().nullable(),
	unifiedFinishReason: z.string().nullable(),
	finishReason: z.string().nullable(),
	promptTokens: z.string().nullable(),
	completionTokens: z.string().nullable(),
	totalTokens: z.string().nullable(),
	reasoningTokens: z.string().nullable(),
	messages: z.any(),
	temperature: z.number().nullable(),
	maxTokens: z.number().nullable(),
	topP: z.number().nullable(),
	frequencyPenalty: z.number().nullable(),
	presencePenalty: z.number().nullable(),
	hasError: z.boolean().nullable(),
	errorDetails: errorDetails.nullable(),
	cost: z.number().nullable(),
	inputCost: z.number().nullable(),
	outputCost: z.number().nullable(),
	requestCost: z.number().nullable(),
	estimatedCost: z.boolean().nullable(),
	canceled: z.boolean().nullable(),
	streamed: z.boolean().nullable(),
	cached: z.boolean().nullable(),
	mode: z.enum(["api-keys", "credits", "hybrid"]),
	usedMode: z.enum(["api-keys", "credits"]),
});

const querySchema = z.object({
	apiKeyId: z.string().optional().openapi({
		description: "Filter logs by API key ID",
	}),
	providerKeyId: z.string().optional().openapi({
		description: "Filter logs by provider key ID",
	}),
	projectId: z.string().optional().openapi({
		description: "Filter logs by project ID",
	}),
	orgId: z.string().optional().openapi({
		description: "Filter logs by organization ID",
	}),
	startDate: z.string().optional().openapi({
		description: "Filter logs created after this date (ISO string)",
	}),
	endDate: z.string().optional().openapi({
		description: "Filter logs created before this date (ISO string)",
	}),
	finishReason: z.string().optional().openapi({
		description: "Filter logs by finish reason",
	}),
	unifiedFinishReason: z.string().optional().openapi({
		description: "Filter logs by unified finish reason",
	}),
	provider: z.string().optional().openapi({
		description: "Filter logs by provider",
	}),
	model: z.string().optional().openapi({
		description: "Filter logs by model",
	}),
	cursor: z.string().optional().openapi({
		description: "Cursor for pagination (log ID to start after)",
	}),
	orderBy: z.enum(["createdAt_asc", "createdAt_desc"]).optional().openapi({
		description: "Order results by creation date (default: createdAt_desc)",
		example: "createdAt_desc",
	}),
	limit: z
		.string()
		.optional()
		.transform((val) => (val ? parseInt(val, 10) : undefined))
		.pipe(z.number().int().min(1).max(100).optional())
		.openapi({
			description: "Number of items to return (default: 50, max: 100)",
			example: "50",
		}),
});

const get = createRoute({
	method: "get",
	path: "/",
	request: {
		query: querySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string().optional().openapi({
							description: "Optional message about the response",
						}),
						logs: z.array(logSchema).openapi({
							description: "Array of log entries",
						}),
						pagination: z
							.object({
								nextCursor: z.string().nullable().openapi({
									description:
										"Cursor to use for the next page of results, null if no more results",
								}),
								hasMore: z.boolean().openapi({
									description: "Whether there are more results available",
								}),
								limit: z.number().int().openapi({
									description: "Number of items requested per page",
								}),
							})
							.openapi({
								description: "Pagination metadata",
							}),
					}),
				},
			},
			description: "User logs response with pagination.",
		},
	},
});

logs.openapi(get, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	// Get query parameters
	const query = c.req.valid("query");

	const sanitize = (value: string | undefined) =>
		value === "all" ? undefined : value;

	const {
		apiKeyId,
		providerKeyId,
		projectId,
		orgId,
		startDate,
		endDate,
		finishReason,
		unifiedFinishReason,
		provider,
		model,
		cursor,
		orderBy = "createdAt_desc",
		limit: queryLimit,
	} = {
		...query,
		apiKeyId: sanitize(query.apiKeyId),
		providerKeyId: sanitize(query.providerKeyId),
		projectId: sanitize(query.projectId),
		orgId: sanitize(query.orgId),
		startDate: sanitize(query.startDate),
		endDate: sanitize(query.endDate),
		finishReason: sanitize(query.finishReason),
		unifiedFinishReason: sanitize(query.unifiedFinishReason),
		provider: sanitize(query.provider),
		model: sanitize(query.model),
	};

	// Set default limit if not provided or enforce max limit
	const limit = queryLimit ? Math.min(queryLimit, 100) : 50;

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
			logs: [],
			message: "No organizations found",
			pagination: {
				nextCursor: null,
				hasMore: false,
				limit,
			},
		});
	}

	// Get all organizations the user is a member of
	const organizationIds = userOrganizations
		.filter((uo) => uo.organization?.status !== "deleted")
		.map((uo) => uo.organizationId);

	// If org filter is provided, check if user has access to it
	if (orgId && !organizationIds.includes(orgId)) {
		throw new HTTPException(403, {
			message: "You don't have access to this organization",
		});
	}

	// Get all projects associated with the user's organizations
	const projectsQuery: any = {
		where: {
			organizationId: {
				in: orgId ? [orgId] : organizationIds,
			},
			status: {
				ne: "deleted",
			},
		},
	};

	// If projectId is provided, check if it belongs to user's organizations
	if (projectId) {
		projectsQuery.where.id = projectId;
	}

	const projects = await db.query.project.findMany(projectsQuery);

	if (!projects.length) {
		return c.json({
			logs: [],
			message: "No projects found",
			pagination: {
				nextCursor: null,
				hasMore: false,
				limit,
			},
		});
	}

	const projectIds = projects.map((project) => project.id);

	// If projectId is provided but not found in user's projects, deny access
	if (projectId && !projectIds.includes(projectId)) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	// Check apiKeyId authorization if provided
	if (apiKeyId) {
		const apiKey = await db.query.apiKey.findFirst({
			where: {
				id: apiKeyId,
			},
		});

		if (!apiKey) {
			throw new HTTPException(404, {
				message: "API key not found",
			});
		}

		// Check if the API key belongs to one of the user's projects
		if (!projectIds.includes(apiKey.projectId)) {
			throw new HTTPException(403, {
				message: "You don't have access to this API key",
			});
		}
	}

	// Check providerKeyId authorization if provided
	if (providerKeyId) {
		const providerKey = await db.query.providerKey.findFirst({
			where: {
				id: providerKeyId,
			},
		});

		if (!providerKey) {
			throw new HTTPException(404, {
				message: "Provider key not found",
			});
		}

		// Check if the provider key belongs to one of the user's organizations
		if (!organizationIds.includes(providerKey.organizationId)) {
			throw new HTTPException(403, {
				message: "You don't have access to this provider key",
			});
		}
	}

	// Build the logs query with all applicable filters
	const logsWhere: any = {
		projectId: {
			in: projectId ? [projectId] : projectIds,
		},
	};

	// Add date range filters if provided
	if (startDate || endDate) {
		logsWhere.createdAt = {};
		if (startDate) {
			logsWhere.createdAt.gte = new Date(startDate);
		}
		if (endDate) {
			logsWhere.createdAt.lte = new Date(endDate);
		}
	}

	// Add model filter if provided
	if (model) {
		logsWhere.usedModel = model;
	}

	// Add provider filter if provided
	if (provider) {
		logsWhere.usedProvider = provider;
	}

	// Add finish reason filter if provided
	if (finishReason) {
		logsWhere.finishReason = finishReason;
	}

	// Add unified finish reason filter if provided
	if (unifiedFinishReason) {
		logsWhere.unifiedFinishReason = unifiedFinishReason;
	}

	// Add apiKeyId filter if provided
	if (apiKeyId) {
		logsWhere.apiKeyId = apiKeyId;
	}

	// Add providerKeyId filter if provided
	if (providerKeyId) {
		logsWhere.providerKeyId = providerKeyId;
	}

	// Add cursor-based pagination
	let cursorCondition: any = {};
	if (cursor) {
		// Find the log entry for the cursor to get its createdAt timestamp
		const cursorLog = await db.query.log.findFirst({
			where: {
				id: cursor,
			},
		});

		if (cursorLog) {
			// Add condition based on sort direction
			if (orderBy === "createdAt_asc") {
				// When sorting by createdAt ascending, get logs with createdAt > cursor's createdAt
				// or with the same createdAt but with ID > cursor's ID
				cursorCondition = {
					OR: [
						{
							createdAt: {
								gt: cursorLog.createdAt,
							},
						},
						{
							createdAt: {
								eq: cursorLog.createdAt,
							},
							id: {
								gt: cursorLog.id,
							},
						},
					],
				};
			} else {
				// When sorting by createdAt descending (default), get logs with createdAt < cursor's createdAt
				// or with the same createdAt but with ID < cursor's ID
				cursorCondition = {
					OR: [
						{
							createdAt: {
								lt: cursorLog.createdAt,
							},
						},
						{
							createdAt: {
								eq: cursorLog.createdAt,
							},
							id: {
								lt: cursorLog.id,
							},
						},
					],
				};
			}
		}
	}

	// Determine sort order based on orderBy parameter
	let sortField = "createdAt";
	let sortDirection = "desc";

	if (orderBy === "createdAt_asc") {
		sortField = "createdAt";
		sortDirection = "asc";
	} else if (orderBy === "createdAt_desc") {
		sortField = "createdAt";
		sortDirection = "desc";
	}

	// Query logs with all filters
	const logs = await db.query.log.findMany({
		where: {
			...logsWhere,
			...cursorCondition,
		},
		orderBy: {
			[sortField]: sortDirection as "asc" | "desc",
			id: sortDirection as "asc" | "desc", // Secondary sort by ID for stable pagination
		},
		limit: limit + 1, // Fetch one extra to determine if there are more results
	});

	// Check if there are more results
	const hasMore = logs.length > limit;
	// Remove the extra item if we fetched more than the limit
	const paginatedLogs = hasMore ? logs.slice(0, limit) : logs;

	// Determine the next cursor (ID of the last item)
	const nextCursor =
		hasMore && paginatedLogs.length > 0
			? paginatedLogs[paginatedLogs.length - 1].id
			: null;

	if (!paginatedLogs.length) {
		return c.json({
			logs: [],
			message: "No logs found",
			pagination: {
				nextCursor: null,
				hasMore: false,
				limit,
			},
		});
	}

	// Return the logs directly without any modifications

	return c.json({
		logs: paginatedLogs,
		pagination: {
			nextCursor,
			hasMore,
			limit,
		},
	});
});
