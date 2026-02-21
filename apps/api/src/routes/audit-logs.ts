import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	and,
	db,
	desc,
	eq,
	gte,
	lt,
	lte,
	tables,
	auditLogActions,
	auditLogResourceTypes,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const auditLogs = new OpenAPIHono<ServerTypes>();

const auditLogSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	organizationId: z.string(),
	userId: z.string(),
	action: z.enum(auditLogActions),
	resourceType: z.enum(auditLogResourceTypes),
	resourceId: z.string().nullable(),
	metadata: z.any().nullable(),
	user: z
		.object({
			id: z.string(),
			email: z.string(),
			name: z.string().nullable(),
		})
		.optional(),
});

const querySchema = z.object({
	cursor: z.string().optional().openapi({
		description: "Cursor for pagination (audit log ID to start after)",
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
	startDate: z.string().datetime({ offset: true }).optional().openapi({
		description: "Filter logs created after this date (ISO 8601 string)",
	}),
	endDate: z.string().datetime({ offset: true }).optional().openapi({
		description: "Filter logs created before this date (ISO 8601 string)",
	}),
	action: z.string().optional().openapi({
		description: "Filter logs by action type",
	}),
	resourceType: z.string().optional().openapi({
		description: "Filter logs by resource type",
	}),
	userId: z.string().optional().openapi({
		description: "Filter logs by user ID who performed the action",
	}),
});

const getAuditLogs = createRoute({
	method: "get",
	path: "/{organizationId}",
	request: {
		params: z.object({
			organizationId: z.string().openapi({
				description: "Organization ID to get audit logs for",
			}),
		}),
		query: querySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						auditLogs: z.array(auditLogSchema).openapi({
							description: "Array of audit log entries",
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
			description: "Audit logs for the organization",
		},
	},
});

auditLogs.openapi(getAuditLogs, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId } = c.req.param();
	const query = c.req.valid("query");
	const {
		cursor,
		limit: queryLimit,
		startDate,
		endDate,
		action,
		resourceType,
		userId,
	} = query;

	// Set default limit if not provided
	const limit = queryLimit ? Math.min(queryLimit, 100) : 50;

	// Check user access and role
	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: user.id },
			organizationId: { eq: organizationId },
		},
		with: {
			organization: true,
		},
	});

	if (!userOrg) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// Check if user is owner or admin
	if (userOrg.role !== "owner" && userOrg.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can view audit logs",
		});
	}

	// Check if organization has enterprise plan
	if (userOrg.organization?.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Audit logs require an enterprise plan",
		});
	}

	// Build where conditions
	const whereConditions = [eq(tables.auditLog.organizationId, organizationId)];

	if (startDate) {
		whereConditions.push(gte(tables.auditLog.createdAt, new Date(startDate)));
	}
	if (endDate) {
		whereConditions.push(lte(tables.auditLog.createdAt, new Date(endDate)));
	}
	if (
		action &&
		auditLogActions.includes(action as (typeof auditLogActions)[number])
	) {
		whereConditions.push(
			eq(tables.auditLog.action, action as (typeof auditLogActions)[number]),
		);
	}
	if (
		resourceType &&
		auditLogResourceTypes.includes(
			resourceType as (typeof auditLogResourceTypes)[number],
		)
	) {
		whereConditions.push(
			eq(
				tables.auditLog.resourceType,
				resourceType as (typeof auditLogResourceTypes)[number],
			),
		);
	}
	if (userId) {
		whereConditions.push(eq(tables.auditLog.userId, userId));
	}

	// Cursor-based pagination
	if (cursor) {
		const cursorLog = await db.query.auditLog.findFirst({
			where: { id: { eq: cursor } },
		});
		if (cursorLog) {
			whereConditions.push(lt(tables.auditLog.createdAt, cursorLog.createdAt));
		}
	}

	// Build the final where clause
	const finalWhereClause =
		whereConditions.length > 0 ? and(...whereConditions) : undefined;

	// Execute query using SQL builder with left join for user
	const logsQuery = db
		.select({
			id: tables.auditLog.id,
			createdAt: tables.auditLog.createdAt,
			organizationId: tables.auditLog.organizationId,
			userId: tables.auditLog.userId,
			action: tables.auditLog.action,
			resourceType: tables.auditLog.resourceType,
			resourceId: tables.auditLog.resourceId,
			metadata: tables.auditLog.metadata,
			userName: tables.user.name,
			userEmail: tables.user.email,
		})
		.from(tables.auditLog)
		.leftJoin(tables.user, eq(tables.auditLog.userId, tables.user.id))
		.orderBy(desc(tables.auditLog.createdAt))
		.limit(limit + 1);

	const logs = finalWhereClause
		? await logsQuery.where(finalWhereClause)
		: await logsQuery;

	// Check if there are more results
	const hasMore = logs.length > limit;
	const paginatedLogs = hasMore ? logs.slice(0, limit) : logs;

	// Determine the next cursor
	const nextCursor =
		hasMore && paginatedLogs.length > 0
			? paginatedLogs[paginatedLogs.length - 1].id
			: null;

	// Transform logs to include nested user object
	const transformedLogs = paginatedLogs.map((log) => ({
		id: log.id,
		createdAt: log.createdAt,
		organizationId: log.organizationId,
		userId: log.userId,
		action: log.action,
		resourceType: log.resourceType,
		resourceId: log.resourceId,
		metadata: log.metadata,
		user: log.userEmail
			? {
					id: log.userId,
					email: log.userEmail,
					name: log.userName,
				}
			: undefined,
	}));

	return c.json({
		auditLogs: transformedLogs,
		pagination: {
			nextCursor,
			hasMore,
			limit,
		},
	});
});

// Get available filter options
const getFilterOptions = createRoute({
	method: "get",
	path: "/{organizationId}/filters",
	request: {
		params: z.object({
			organizationId: z.string().openapi({
				description: "Organization ID to get filter options for",
			}),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						actions: z.array(z.string()).openapi({
							description: "Available action types",
						}),
						resourceTypes: z.array(z.string()).openapi({
							description: "Available resource types",
						}),
						users: z
							.array(
								z.object({
									id: z.string(),
									email: z.string(),
									name: z.string().nullable(),
								}),
							)
							.openapi({
								description: "Users who have performed actions",
							}),
					}),
				},
			},
			description: "Filter options for audit logs",
		},
	},
});

auditLogs.openapi(getFilterOptions, async (c) => {
	const user = c.get("user");

	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { organizationId } = c.req.param();

	// Check user access and role
	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: user.id },
			organizationId: { eq: organizationId },
		},
		with: {
			organization: true,
		},
	});

	if (!userOrg) {
		throw new HTTPException(403, {
			message: "You do not have access to this organization",
		});
	}

	// Check if user is owner or admin
	if (userOrg.role !== "owner" && userOrg.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can view audit logs",
		});
	}

	// Check if organization has enterprise plan
	if (userOrg.organization?.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Audit logs require an enterprise plan",
		});
	}

	// Get unique users who have audit logs for this org
	const usersWithLogs = await db.query.auditLog.findMany({
		where: { organizationId: { eq: organizationId } },
		columns: { userId: true },
		with: {
			user: {
				columns: { id: true, email: true, name: true },
			},
		},
	});

	// Deduplicate users
	const uniqueUsers = new Map<
		string,
		{ id: string; email: string; name: string | null }
	>();
	for (const log of usersWithLogs) {
		if (log.user && !uniqueUsers.has(log.user.id)) {
			uniqueUsers.set(log.user.id, log.user);
		}
	}

	return c.json({
		actions: [...auditLogActions],
		resourceTypes: [...auditLogResourceTypes],
		users: Array.from(uniqueUsers.values()),
	});
});
