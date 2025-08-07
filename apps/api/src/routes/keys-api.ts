import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { eq, db, shortid, tables } from "@llmgateway/db";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { maskToken } from "../lib/maskToken";

import type { ServerTypes } from "../vars";

export const keysApi = new OpenAPIHono<ServerTypes>();

// Create a schema for API key responses
// Using z.object directly instead of createSelectSchema due to compatibility issues
const apiKeySchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	token: z.string(),
	description: z.string(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	usageLimit: z.string().nullable(),
	usage: z.string(),
	projectId: z.string(),
});

// Schema for creating a new API key
const createApiKeySchema = z.object({
	description: z.string().min(1).max(255),
	projectId: z.string().min(1),
	usageLimit: z.string().nullable(),
});

// Schema for listing API keys
const listApiKeysQuerySchema = z.object({
	projectId: z.string().optional().openapi({
		description: "Filter API keys by project ID",
	}),
});

// Schema for updating an API key status
const updateApiKeyStatusSchema = z.object({
	status: z.enum(["active", "inactive"]),
});

// Schema for updating an API key usage limit
const updateApiKeyUsageLimitSchema = z.object({
	usageLimit: z.string().nullable(),
});

// Create a new API key
const create = createRoute({
	method: "post",
	path: "/api",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createApiKeySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						apiKey: apiKeySchema
							.omit({ token: true })
							.extend({
								token: z.string(),
							})
							.openapi({}),
					}),
				},
			},
			description: "API key created successfully.",
		},
	},
});

keysApi.openapi(create, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { description, projectId, usageLimit } = c.req.valid("json");

	// Get the user's organizations
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: user.id,
			},
		},
		with: {
			organization: {
				with: {
					projects: true,
				},
			},
		},
	});

	if (!userOrgs.length) {
		throw new HTTPException(400, {
			message: "No organizations found for user",
		});
	}

	// Get all project IDs the user has access to
	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	if (!projectIds.includes(projectId)) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	// Generate a token with a prefix for better identification
	const prefix =
		process.env.NODE_ENV === "development" ? `llmgdev_` : "llmgtwy_";
	const token = prefix + shortid(40);

	// Create the API key
	const [apiKey] = await db
		.insert(tables.apiKey)
		.values({
			token,
			projectId,
			description,
			usageLimit,
		})
		.returning();

	return c.json({
		apiKey: {
			...apiKey,
			token, // Include the token in the response
		},
	});
});

// List all API keys
const list = createRoute({
	method: "get",
	path: "/api",
	request: {
		query: listApiKeysQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						apiKeys: z
							.array(
								apiKeySchema.omit({ token: true }).extend({
									// Only return a masked version of the token
									maskedToken: z.string(),
								}),
							)
							.openapi({}),
					}),
				},
			},
			description: "List of API keys.",
		},
	},
});

keysApi.openapi(list, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const query = c.req.valid("query");
	const { projectId } = query;

	// Get the user's projects
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: user.id,
			},
		},
		with: {
			organization: {
				with: {
					projects: true,
				},
			},
		},
	});

	if (!userOrgs.length) {
		return c.json({ apiKeys: [] });
	}

	// Get all project IDs the user has access to
	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	if (projectId && !projectIds.includes(projectId)) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	// Get API keys for the specified project or all accessible projects
	const apiKeys = await db.query.apiKey.findMany({
		where: {
			projectId: {
				in: projectId ? [projectId] : projectIds,
			},
		},
	});

	return c.json({
		apiKeys: apiKeys.map((key) => ({
			...key,
			maskedToken: maskToken(key.token),
			token: undefined,
		})),
	});
});

// Soft-delete an API key
const deleteKey = createRoute({
	method: "delete",
	path: "/api/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "API key deleted successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "API key not found.",
		},
	},
});

keysApi.openapi(deleteKey, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	// Get the user's projects
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: user.id,
			},
		},
		with: {
			organization: {
				with: {
					projects: true,
				},
			},
		},
	});

	// Get all project IDs the user has access to
	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	// Find the API key
	const apiKey = await db.query.apiKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			projectId: {
				in: projectIds,
			},
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	await db
		.update(tables.apiKey)
		.set({
			status: "deleted",
		})
		.where(eq(tables.apiKey.id, id));

	return c.json({
		message: "API key deleted successfully",
	});
});

// Update API key status
const updateStatus = createRoute({
	method: "patch",
	path: "/api/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateApiKeyStatusSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						apiKey: apiKeySchema
							.omit({ token: true })
							.extend({
								maskedToken: z.string(),
							})
							.openapi({}),
					}),
				},
			},
			description: "API key status updated successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "API key not found.",
		},
	},
});

keysApi.openapi(updateStatus, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();
	const { status } = c.req.valid("json");

	// Get the user's projects
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: user.id,
			},
		},
		with: {
			organization: {
				with: {
					projects: true,
				},
			},
		},
	});

	// Get all project IDs the user has access to
	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	// Find the API key
	const apiKey = await db.query.apiKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			projectId: {
				in: projectIds,
			},
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	// Update the API key status
	const [updatedApiKey] = await db
		.update(tables.apiKey)
		.set({
			status,
		})
		.where(eq(tables.apiKey.id, id))
		.returning();

	return c.json({
		message: `API key status updated to ${status}`,
		apiKey: {
			...updatedApiKey,
			maskedToken: maskToken(updatedApiKey.token),
			token: undefined,
		},
	});
});

// Update API key usage limit
const updateUsageLimit = createRoute({
	method: "patch",
	path: "/api/limit/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateApiKeyUsageLimitSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
						apiKey: apiKeySchema
							.omit({ token: true })
							.extend({
								maskedToken: z.string(),
							})
							.openapi({}),
					}),
				},
			},
			description: "API key usage limit updated successfully.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({
						message: z.string(),
					}),
				},
			},
			description: "API key not found.",
		},
	},
});

keysApi.openapi(updateUsageLimit, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();
	const { usageLimit } = c.req.valid("json");

	// Get the user's projects
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: user.id,
			},
		},
		with: {
			organization: {
				with: {
					projects: true,
				},
			},
		},
	});

	// Get all project IDs the user has access to
	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	// Find the API key
	const apiKey = await db.query.apiKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			projectId: {
				in: projectIds,
			},
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	// Update the API key usage limit
	const [updatedApiKey] = await db
		.update(tables.apiKey)
		.set({
			usageLimit,
		})
		.where(eq(tables.apiKey.id, id))
		.returning();

	return c.json({
		message: `API key usage limit updated to ${usageLimit}`,
		apiKey: {
			...updatedApiKey,
			maskedToken: maskToken(updatedApiKey.token),
			token: undefined,
		},
	});
});

export default keysApi;
