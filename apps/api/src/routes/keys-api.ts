import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { maskToken } from "@/lib/maskToken.js";

import { eq, db, shortid, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

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
	createdBy: z.string(),
	creator: z
		.object({
			id: z.string(),
			name: z.string().nullable(),
			email: z.string(),
		})
		.nullable()
		.optional(),
	iamRules: z
		.array(
			z.object({
				id: z.string(),
				createdAt: z.date(),
				updatedAt: z.date(),
				ruleType: z.enum([
					"allow_models",
					"deny_models",
					"allow_pricing",
					"deny_pricing",
					"allow_providers",
					"deny_providers",
				]),
				ruleValue: z.object({
					models: z.array(z.string()).optional(),
					providers: z.array(z.string()).optional(),
					pricingType: z.enum(["free", "paid"]).optional(),
					maxInputPrice: z.number().optional(),
					maxOutputPrice: z.number().optional(),
				}),
				status: z.enum(["active", "inactive"]),
			}),
		)
		.optional(),
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
	filter: z.enum(["mine", "all"]).optional().openapi({
		description:
			"Filter by creator: 'mine' for your keys, 'all' for all keys (admins/owners only)",
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

// Schema for IAM rule
const iamRuleSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	apiKeyId: z.string(),
	ruleType: z.enum([
		"allow_models",
		"deny_models",
		"allow_pricing",
		"deny_pricing",
		"allow_providers",
		"deny_providers",
	]),
	ruleValue: z.object({
		models: z.array(z.string()).optional(),
		providers: z.array(z.string()).optional(),
		pricingType: z.enum(["free", "paid"]).optional(),
		maxInputPrice: z.number().optional(),
		maxOutputPrice: z.number().optional(),
	}),
	status: z.enum(["active", "inactive"]),
});

// Schema for creating/updating IAM rules
const createIamRuleSchema = z.object({
	ruleType: z.enum([
		"allow_models",
		"deny_models",
		"allow_pricing",
		"deny_pricing",
		"allow_providers",
		"deny_providers",
	]),
	ruleValue: z.object({
		models: z.array(z.string()).optional(),
		providers: z.array(z.string()).optional(),
		pricingType: z.enum(["free", "paid"]).optional(),
		maxInputPrice: z.number().optional(),
		maxOutputPrice: z.number().optional(),
	}),
	status: z.enum(["active", "inactive"]).default("active"),
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

	// Get the organization for the project to check plan limits
	const project = await db.query.project.findFirst({
		where: {
			id: {
				eq: projectId,
			},
		},
		with: {
			organization: true,
		},
	});

	if (!project?.organization) {
		throw new HTTPException(404, {
			message: "Project or organization not found",
		});
	}

	// Count existing active API keys for this project
	const existingApiKeys = await db.query.apiKey.findMany({
		where: {
			projectId: {
				eq: projectId,
			},
			status: {
				ne: "deleted",
			},
		},
	});

	// Check plan limits
	const maxApiKeys = project.organization.plan === "pro" ? 20 : 5;

	if (existingApiKeys.length >= maxApiKeys) {
		const planName = project.organization.plan === "pro" ? "Pro" : "Free";
		throw new HTTPException(400, {
			message: `API key limit reached. ${planName} plan allows maximum ${maxApiKeys} API keys per project.`,
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
			createdBy: user.id,
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
						planLimits: z
							.object({
								currentCount: z.number(),
								maxKeys: z.number(),
								plan: z.enum(["free", "pro"]),
							})
							.optional(),
						userRole: z.enum(["owner", "admin", "developer"]),
					}),
				},
			},
			description: "List of API keys with plan limits and user role.",
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
	const { projectId, filter } = query;

	// Get the user's projects and role
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
		return c.json({ apiKeys: [], userRole: "developer" });
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

	// Determine user's role for the relevant organization
	let userRole: "owner" | "admin" | "developer" = "developer";
	if (projectId) {
		const project = await db.query.project.findFirst({
			where: {
				id: {
					eq: projectId,
				},
			},
		});

		if (project) {
			const userOrg = userOrgs.find(
				(org) => org.organizationId === project.organizationId,
			);
			if (userOrg) {
				userRole = userOrg.role as "owner" | "admin" | "developer";
			}
		}
	}

	// All users can see all keys, but can still filter to "mine"
	const shouldFilterByCreator = filter === "mine";

	// Get API keys for the specified project or all accessible projects
	const apiKeys = await db.query.apiKey.findMany({
		where: {
			projectId: {
				in: projectId ? [projectId] : projectIds,
			},
			...(shouldFilterByCreator && {
				createdBy: {
					eq: user.id,
				},
			}),
		},
		with: {
			iamRules: true,
			creator: {
				columns: {
					id: true,
					name: true,
					email: true,
				},
			},
		},
	});

	// Get organization plan info if projectId is specified
	let currentCount = 0;
	let maxKeys = 0;
	let plan: "free" | "pro" = "free";

	if (projectId) {
		const project = await db.query.project.findFirst({
			where: {
				id: {
					eq: projectId,
				},
			},
			with: {
				organization: true,
			},
		});

		if (project?.organization) {
			plan = project.organization.plan as "free" | "pro";
			maxKeys = plan === "pro" ? 20 : 5;
			currentCount = apiKeys.filter((key) => key.status !== "deleted").length;
		}
	}

	return c.json({
		apiKeys: apiKeys.map((key) => ({
			...key,
			maskedToken: maskToken(key.token),
			token: undefined,
		})),
		planLimits: projectId
			? {
					currentCount,
					maxKeys,
					plan,
				}
			: undefined,
		userRole,
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
		with: {
			project: true,
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	if (!apiKey.project) {
		throw new HTTPException(404, {
			message: "Project not found for API key",
		});
	}

	// Check user role and permissions
	const projectOrgId = apiKey.project.organizationId;
	const userOrg = userOrgs.find((org) => org.organizationId === projectOrgId);
	const userRole = userOrg?.role as "owner" | "admin" | "developer" | undefined;

	// Developers can only delete their own API keys
	// Owners and admins can delete any API key
	if (userRole === "developer" && apiKey.createdBy !== user.id) {
		throw new HTTPException(403, {
			message: "You don't have permission to delete this API key",
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
		with: {
			project: true,
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	if (!apiKey.project) {
		throw new HTTPException(404, {
			message: "Project not found for API key",
		});
	}

	// Check user role and permissions
	const projectOrgId = apiKey.project.organizationId;
	const userOrg = userOrgs.find((org) => org.organizationId === projectOrgId);
	const userRole = userOrg?.role as "owner" | "admin" | "developer" | undefined;

	// Developers can only modify their own API keys
	// Owners and admins can modify any API key
	if (userRole === "developer" && apiKey.createdBy !== user.id) {
		throw new HTTPException(403, {
			message: "You don't have permission to modify this API key",
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
		with: {
			project: true,
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	if (!apiKey.project) {
		throw new HTTPException(404, {
			message: "Project not found for API key",
		});
	}

	// Check user role and permissions
	const projectOrgId = apiKey.project.organizationId;
	const userOrg = userOrgs.find((org) => org.organizationId === projectOrgId);
	const userRole = userOrg?.role as "owner" | "admin" | "developer" | undefined;

	// Developers can only modify their own API keys
	// Owners and admins can modify any API key
	if (userRole === "developer" && apiKey.createdBy !== user.id) {
		throw new HTTPException(403, {
			message: "You don't have permission to modify this API key",
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

// Create IAM rule for API key
const createIamRule = createRoute({
	method: "post",
	path: "/api/{id}/iam",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createIamRuleSchema,
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
						rule: iamRuleSchema,
					}),
				},
			},
			description: "IAM rule created successfully.",
		},
	},
});

keysApi.openapi(createIamRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();
	const ruleData = c.req.valid("json");

	// Verify user has access to the API key
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

	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	const apiKey = await db.query.apiKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			projectId: {
				in: projectIds,
			},
		},
		with: {
			project: true,
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	if (!apiKey.project) {
		throw new HTTPException(404, {
			message: "Project not found for API key",
		});
	}

	// Check user role and permissions
	const projectOrgId = apiKey.project.organizationId;
	const userOrg = userOrgs.find((org) => org.organizationId === projectOrgId);
	const userRole = userOrg?.role as "owner" | "admin" | "developer" | undefined;

	// Developers can only manage IAM rules for their own API keys
	// Owners and admins can manage IAM rules for any API key
	if (userRole === "developer" && apiKey.createdBy !== user.id) {
		throw new HTTPException(403, {
			message: "You don't have permission to manage IAM rules for this API key",
		});
	}

	// Create the IAM rule
	const [rule] = await db
		.insert(tables.apiKeyIamRule)
		.values({
			apiKeyId: id,
			...ruleData,
		})
		.returning();

	return c.json({
		message: "IAM rule created successfully",
		rule,
	});
});

// List IAM rules for an API key
const listIamRules = createRoute({
	method: "get",
	path: "/api/{id}/iam",
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
						rules: z.array(iamRuleSchema),
					}),
				},
			},
			description: "List of IAM rules for the API key.",
		},
	},
});

keysApi.openapi(listIamRules, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	// Verify user has access to the API key
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

	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	const apiKey = await db.query.apiKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			projectId: {
				in: projectIds,
			},
		},
		with: {
			project: true,
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	if (!apiKey.project) {
		throw new HTTPException(404, {
			message: "Project not found for API key",
		});
	}

	// Get all IAM rules for this API key
	const rules = await db.query.apiKeyIamRule.findMany({
		where: {
			apiKeyId: {
				eq: id,
			},
		},
	});

	return c.json({ rules });
});

// Update IAM rule
const updateIamRule = createRoute({
	method: "patch",
	path: "/api/{id}/iam/{ruleId}",
	request: {
		params: z.object({
			id: z.string(),
			ruleId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createIamRuleSchema.partial(),
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
						rule: iamRuleSchema,
					}),
				},
			},
			description: "IAM rule updated successfully.",
		},
	},
});

keysApi.openapi(updateIamRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id, ruleId } = c.req.param();
	const updateData = c.req.valid("json");

	// Verify user has access to the API key and rule
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

	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	const apiKey = await db.query.apiKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			projectId: {
				in: projectIds,
			},
		},
		with: {
			project: true,
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	if (!apiKey.project) {
		throw new HTTPException(404, {
			message: "Project not found for API key",
		});
	}

	// Check user role and permissions
	const projectOrgId = apiKey.project.organizationId;
	const userOrg = userOrgs.find((org) => org.organizationId === projectOrgId);
	const userRole = userOrg?.role as "owner" | "admin" | "developer" | undefined;

	// Developers can only manage IAM rules for their own API keys
	// Owners and admins can manage IAM rules for any API key
	if (userRole === "developer" && apiKey.createdBy !== user.id) {
		throw new HTTPException(403, {
			message: "You don't have permission to manage IAM rules for this API key",
		});
	}

	// Update the IAM rule
	const [updatedRule] = await db
		.update(tables.apiKeyIamRule)
		.set(updateData)
		.where(eq(tables.apiKeyIamRule.id, ruleId))
		.returning();

	if (!updatedRule) {
		throw new HTTPException(404, {
			message: "IAM rule not found",
		});
	}

	return c.json({
		message: "IAM rule updated successfully",
		rule: updatedRule,
	});
});

// Delete IAM rule
const deleteIamRule = createRoute({
	method: "delete",
	path: "/api/{id}/iam/{ruleId}",
	request: {
		params: z.object({
			id: z.string(),
			ruleId: z.string(),
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
			description: "IAM rule deleted successfully.",
		},
	},
});

keysApi.openapi(deleteIamRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id, ruleId } = c.req.param();

	// Verify user has access to the API key
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

	const projectIds = userOrgs.flatMap((org) =>
		org
			.organization!.projects.filter((project) => project.status !== "deleted")
			.map((project) => project.id),
	);

	const apiKey = await db.query.apiKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			projectId: {
				in: projectIds,
			},
		},
		with: {
			project: true,
		},
	});

	if (!apiKey) {
		throw new HTTPException(404, {
			message: "API key not found",
		});
	}

	if (!apiKey.project) {
		throw new HTTPException(404, {
			message: "Project not found for API key",
		});
	}

	// Check user role and permissions
	const projectOrgId = apiKey.project.organizationId;
	const userOrg = userOrgs.find((org) => org.organizationId === projectOrgId);
	const userRole = userOrg?.role as "owner" | "admin" | "developer" | undefined;

	// Developers can only manage IAM rules for their own API keys
	// Owners and admins can manage IAM rules for any API key
	if (userRole === "developer" && apiKey.createdBy !== user.id) {
		throw new HTTPException(403, {
			message: "You don't have permission to manage IAM rules for this API key",
		});
	}

	// Delete the IAM rule
	const result = await db
		.delete(tables.apiKeyIamRule)
		.where(eq(tables.apiKeyIamRule.id, ruleId))
		.returning();

	if (!result.length) {
		throw new HTTPException(404, {
			message: "IAM rule not found",
		});
	}

	return c.json({
		message: "IAM rule deleted successfully",
	});
});

export default keysApi;
