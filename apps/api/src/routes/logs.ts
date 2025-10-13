import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	and,
	asc,
	db,
	desc,
	eq,
	errorDetails,
	gt,
	gte,
	inArray,
	lt,
	lte,
	or,
	sql,
	tables,
	toolChoice,
	toolResults,
	tools,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

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
	reasoningContent: z.string().nullable(),
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
	reasoningEffort: z.string().nullable(),
	responseFormat: z.any().nullable(),
	tools: tools.nullable(),
	toolChoice: toolChoice.nullable(),
	toolResults: toolResults.nullable(),
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
	customHeaders: z.any().nullable(),
	mode: z.enum(["api-keys", "credits", "hybrid"]),
	usedMode: z.enum(["api-keys", "credits"]),
	source: z.string().nullable(),
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
	source: z.string().optional().openapi({
		description: "Filter logs by source",
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
	customHeaderKey: z.string().optional().openapi({
		description:
			"Filter logs by custom header key (without x-llmgateway- prefix)",
		example: "uid",
	}),
	customHeaderValue: z.string().optional().openapi({
		description: "Filter logs by custom header value",
		example: "12345",
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
		source,
		cursor,
		orderBy = "createdAt_desc",
		limit: queryLimit,
		customHeaderKey,
		customHeaderValue,
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
		source: sanitize(query.source),
		customHeaderKey: sanitize(query.customHeaderKey),
		customHeaderValue: sanitize(query.customHeaderValue),
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

	// Build where conditions for the select query
	const whereConditions = [];

	// Add project filter
	if (projectId) {
		whereConditions.push(eq(tables.log.projectId, projectId));
	} else {
		whereConditions.push(inArray(tables.log.projectId, projectIds));
	}

	// Add date range filters
	if (startDate) {
		whereConditions.push(gte(tables.log.createdAt, new Date(startDate)));
	}
	if (endDate) {
		whereConditions.push(lte(tables.log.createdAt, new Date(endDate)));
	}

	// Add model filter - match the model name part after the slash
	if (model) {
		whereConditions.push(
			sql`SPLIT_PART(${tables.log.usedModel}, '/', 2) = ${model}`,
		);
	}

	// Add provider filter
	if (provider) {
		whereConditions.push(eq(tables.log.usedProvider, provider));
	}

	// Add finish reason filter
	if (finishReason) {
		whereConditions.push(eq(tables.log.finishReason, finishReason));
	}

	// Add unified finish reason filter
	if (unifiedFinishReason) {
		whereConditions.push(
			eq(tables.log.unifiedFinishReason, unifiedFinishReason),
		);
	}

	// Add apiKeyId filter
	if (apiKeyId) {
		whereConditions.push(eq(tables.log.apiKeyId, apiKeyId));
	}

	// Add providerKeyId filter
	if (providerKeyId) {
		// whereConditions.push(eq(tables.log.providerKeyId, providerKeyId));
	}

	// Add custom header filter
	if (customHeaderKey && customHeaderValue) {
		whereConditions.push(
			sql`${tables.log.customHeaders}
			->>
			${customHeaderKey}
			=
			${customHeaderValue}`,
		);
	}

	// Add source filter if provided
	if (source) {
		whereConditions.push(eq(tables.log.source, source));
	}

	// Add cursor-based pagination conditions
	if (cursor) {
		const cursorLog = await db
			.select()
			.from(tables.log)
			.where(eq(tables.log.id, cursor))
			.limit(1);

		if (cursorLog.length > 0) {
			const cursorCreatedAt = cursorLog[0].createdAt;

			if (orderBy === "createdAt_asc") {
				whereConditions.push(
					or(
						gt(tables.log.createdAt, cursorCreatedAt),
						and(
							eq(tables.log.createdAt, cursorCreatedAt),
							gt(tables.log.id, cursor),
						),
					),
				);
			} else {
				whereConditions.push(
					or(
						lt(tables.log.createdAt, cursorCreatedAt),
						and(
							eq(tables.log.createdAt, cursorCreatedAt),
							lt(tables.log.id, cursor),
						),
					),
				);
			}
		}
	}

	// Build the final where clause
	const finalWhereClause =
		whereConditions.length > 0 ? and(...whereConditions) : undefined;

	// Build order by clauses
	const orderByClauses =
		orderBy === "createdAt_asc"
			? [asc(tables.log.createdAt), asc(tables.log.id)]
			: [desc(tables.log.createdAt), desc(tables.log.id)];

	// Execute the query using select
	let dbQuery = db.select().from(tables.log);

	if (finalWhereClause) {
		// @ts-ignore
		dbQuery = dbQuery.where(finalWhereClause);
	}

	const logs = await dbQuery.orderBy(...orderByClauses).limit(limit + 1); // Fetch one extra for pagination

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

const uniqueModelsGet = createRoute({
	method: "get",
	path: "/unique-models",
	request: {
		query: z.object({
			projectId: z.string().optional().openapi({
				description: "Filter models by project ID",
			}),
			orgId: z.string().optional().openapi({
				description: "Filter models by organization ID",
			}),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						models: z.array(z.string()).openapi({
							description:
								"Array of unique model names (extracted from provider/model)",
						}),
					}),
				},
			},
			description: "Unique models response.",
		},
	},
});

logs.openapi(uniqueModelsGet, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const query = c.req.valid("query");
	const { projectId, orgId } = query;

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
			models: [],
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
			models: [],
		});
	}

	const projectIds = projects.map((project) => project.id);

	// If projectId is provided but not found in user's projects, deny access
	if (projectId && !projectIds.includes(projectId)) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	// Build where conditions
	const whereConditions = [];
	if (projectId) {
		whereConditions.push(eq(tables.log.projectId, projectId));
	} else {
		whereConditions.push(inArray(tables.log.projectId, projectIds));
	}

	// Execute query to get distinct usedModel values
	const finalWhereClause =
		whereConditions.length > 0 ? and(...whereConditions) : undefined;

	let dbQuery = db
		.selectDistinct({ usedModel: tables.log.usedModel })
		.from(tables.log);

	if (finalWhereClause) {
		// @ts-ignore
		dbQuery = dbQuery.where(finalWhereClause);
	}

	const uniqueUsedModels = await dbQuery;

	// Extract model names (part after the slash) from usedModel field
	const modelNames = uniqueUsedModels
		.map((row) => {
			const usedModel = row.usedModel;
			const slashIndex = usedModel.indexOf("/");
			return slashIndex !== -1
				? usedModel.substring(slashIndex + 1)
				: usedModel;
		})
		.filter((model, index, array) => array.indexOf(model) === index) // Remove duplicates
		.sort();

	return c.json({
		models: modelNames,
	});
});
