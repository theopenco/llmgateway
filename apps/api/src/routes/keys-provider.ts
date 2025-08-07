import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { db, eq, tables } from "@llmgateway/db";
import { providers, validateProviderKey } from "@llmgateway/models";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { maskToken } from "../lib/maskToken";

import type { ServerTypes } from "../vars";
import type { ProviderId } from "@llmgateway/models";

export const keysProvider = new OpenAPIHono<ServerTypes>();

// Create a schema for provider key responses
// Using z.object directly instead of createSelectSchema due to compatibility issues
const providerKeySchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	token: z.string(),
	provider: z.string(),
	name: z.string().nullable(),
	baseUrl: z.string().nullable(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	organizationId: z.string(),
});

// Schema for creating a new provider key
const createProviderKeySchema = z.object({
	provider: z
		.string()
		.refine((val) => providers.some((p) => p.id === val) || val === "custom", {
			message:
				"Invalid provider. Must be one of the supported providers or 'custom'.",
		}),
	token: z.string().min(1, "API key is required"),
	name: z
		.string()
		.regex(/^[a-z]+$/, "Name must contain only lowercase letters a-z")
		.optional(),
	baseUrl: z.string().url().optional(),
	organizationId: z.string().min(1, "Organization ID is required"),
});

// Schema for updating a provider key status
const updateProviderKeyStatusSchema = z.object({
	status: z.enum(["active", "inactive"]),
});

// Create a new provider key
const create = createRoute({
	method: "post",
	path: "/provider",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createProviderKeySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						providerKey: providerKeySchema
							.omit({ token: true })
							.extend({
								token: z.string(),
							})
							.openapi({}),
					}),
				},
			},
			description: "Provider key created successfully.",
		},
	},
});

keysProvider.openapi(create, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const {
		provider,
		token: userToken,
		name,
		baseUrl,
		organizationId,
	} = c.req.valid("json");

	// Verify the user has access to this organization
	const userOrgs = await db.query.userOrganization.findMany({
		where: {
			userId: {
				eq: user.id,
			},
			organizationId: {
				eq: organizationId,
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

	const activeProjects = userOrgs[0]?.organization?.projects.filter(
		(project) => project.status !== "deleted",
	);

	if (!userOrgs.length || !activeProjects?.length) {
		throw new HTTPException(403, {
			message:
				"You don't have access to this organization or it has no projects",
		});
	}

	const organization = userOrgs[0].organization;

	// Check if organization has pro plan for provider keys (only if PAID_MODE is enabled)
	if (process.env.PAID_MODE === "true" && organization?.plan !== "pro") {
		throw new HTTPException(403, {
			message:
				"Provider keys are only available on the Pro plan. Please upgrade to Pro or use Credits mode.",
		});
	}

	// Check if custom provider is allowed (only for pro plan or self-hosted mode)
	if (provider === "custom") {
		const isHosted = process.env.HOSTED === "true";
		const isPaidMode = process.env.PAID_MODE === "true";
		const isProPlan = organization?.plan === "pro";

		// Custom providers are allowed if:
		// 1. Self-hosted mode (HOSTED !== "true")
		// 2. Pro plan in hosted mode
		if (isHosted && isPaidMode && !isProPlan) {
			throw new HTTPException(403, {
				message:
					"Custom providers are only available on the Pro plan. Please upgrade to Pro or use Credits mode with standard providers.",
			});
		}
	}

	// Check if a provider key already exists for this provider and organization
	const existingKey = await db.query.providerKey.findFirst({
		where: {
			status: {
				ne: "deleted",
			},
			provider: {
				eq: provider,
			},
			organizationId: {
				eq: organizationId,
			},
		},
	});

	if (existingKey) {
		throw new HTTPException(400, {
			message: `A key for provider '${provider}' already exists for this project`,
		});
	}

	let validationResult;
	try {
		const isTestEnv =
			process.env.NODE_ENV === "test" && process.env.E2E_TEST !== "true";
		// Validate that provider is one of the allowed provider IDs
		if (!providers.some((p) => p.id === provider) && provider !== "custom") {
			throw new Error(`Invalid provider: ${provider}`);
		}

		// Skip validation for custom providers as they don't have predefined models
		if (provider === "custom") {
			validationResult = { valid: true };
		} else {
			validationResult = await validateProviderKey(
				provider as ProviderId,
				userToken,
				baseUrl,
				isTestEnv,
			);
		}
	} catch (error) {
		throw new HTTPException(500, {
			message:
				error instanceof Error ? error.message : "Failed to validate API key",
			cause: error,
		});
	}

	if (validationResult.error) {
		const errorMessage = validationResult.error || "Upstream server error";
		throw new HTTPException(500, {
			message: `Error from provider: ${errorMessage} and status code ${validationResult.statusCode}. Please try again later or contact support.`,
		});
	}

	if (!validationResult.valid) {
		throw new HTTPException(400, {
			message: `Invalid API key. Please make sure the key is correct.`,
		});
	}

	// Use the user-provided token
	// Create the provider key
	const [providerKey] = await db
		.insert(tables.providerKey)
		.values({
			token: userToken,
			organizationId,
			provider,
			name,
			baseUrl,
		})
		.returning();

	return c.json({
		providerKey: {
			...providerKey,
			token: userToken, // Include the token in the response
		},
	});
});

// List all provider keys
const list = createRoute({
	method: "get",
	path: "/provider",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						providerKeys: z
							.array(
								providerKeySchema.omit({ token: true }).extend({
									// Only return a masked version of the token
									maskedToken: z.string(),
								}),
							)
							.openapi({}),
					}),
				},
			},
			description: "List of provider keys.",
		},
	},
});

keysProvider.openapi(list, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

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
		return c.json({ providerKeys: [] });
	}

	// Get all organization IDs the user has access to
	const organizationIds = userOrgs
		.filter((org) => org.organization?.status !== "deleted")
		.map((org) => org.organization!.id);

	// Get all provider keys for these organizations
	const providerKeys = await db.query.providerKey.findMany({
		where: {
			organizationId: {
				in: organizationIds,
			},
		},
	});

	return c.json({
		providerKeys: providerKeys.map((key) => ({
			...key,
			maskedToken: maskToken(key.token),
			token: undefined,
		})),
	});
});

// Soft-delete a provider key
const deleteKey = createRoute({
	method: "delete",
	path: "/provider/{id}",
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
			description: "Provider key deleted successfully.",
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
			description: "Provider key not found.",
		},
	},
});

keysProvider.openapi(deleteKey, async (c) => {
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

	// Get all organization IDs the user has access to
	const organizationIds = userOrgs
		.filter((org) => org.organization?.status !== "deleted")
		.map((org) => org.organization!.id);

	// Find the provider key
	const providerKey = await db.query.providerKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			organizationId: {
				in: organizationIds,
			},
		},
	});

	if (!providerKey) {
		throw new HTTPException(404, {
			message: "Provider key not found",
		});
	}

	await db
		.update(tables.providerKey)
		.set({
			status: "deleted",
		})
		.where(eq(tables.providerKey.id, id));

	return c.json({
		message: "Provider key deleted successfully",
	});
});

// Update provider key status
const updateStatus = createRoute({
	method: "patch",
	path: "/provider/{id}",
	request: {
		params: z.object({
			id: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateProviderKeyStatusSchema,
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
						providerKey: providerKeySchema
							.omit({ token: true })
							.extend({
								maskedToken: z.string(),
							})
							.openapi({}),
					}),
				},
			},
			description: "Provider key status updated successfully.",
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
			description: "Provider key not found.",
		},
	},
});

keysProvider.openapi(updateStatus, async (c) => {
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

	// Get all organization IDs the user has access to
	const organizationIds = userOrgs
		.filter((org) => org.organization?.status !== "deleted")
		.map((org) => org.organization!.id);

	// Find the provider key
	const providerKey = await db.query.providerKey.findFirst({
		where: {
			id: {
				eq: id,
			},
			organizationId: {
				in: organizationIds,
			},
		},
	});

	if (!providerKey) {
		throw new HTTPException(404, {
			message: "Provider key not found",
		});
	}

	// Update the provider key status
	const [updatedProviderKey] = await db
		.update(tables.providerKey)
		.set({
			status,
		})
		.where(eq(tables.providerKey.id, id))
		.returning();

	return c.json({
		message: `Provider key status updated to ${status}`,
		providerKey: {
			...updatedProviderKey,
			maskedToken: maskToken(updatedProviderKey.token),
			token: undefined,
		},
	});
});

export default keysProvider;
