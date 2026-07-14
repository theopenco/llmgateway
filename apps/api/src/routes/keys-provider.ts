import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { maskToken } from "@/lib/maskToken.js";
import { getAdminOrganizationIds } from "@/utils/authorization.js";

import { validateProviderKey } from "@llmgateway/actions";
import { logAuditEvent } from "@llmgateway/audit";
import { cdb, db, eq, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { isStealthProvider, providers } from "@llmgateway/models";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import type { ServerTypes } from "@/vars.js";
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
	options: z
		.object({
			aws_bedrock_region_prefix: z
				.enum(["us.", "global.", "eu.", "apac."])
				.optional(),
			aws_bedrock_region: z
				.enum([
					"global",
					"us",
					"eu",
					"apac",
					"us-east-1",
					"us-east-2",
					"us-west-2",
					"eu-central-1",
					"eu-west-1",
					"ap-northeast-1",
					"ap-southeast-1",
					"ap-southeast-2",
				])
				.optional(),
			azure_resource: z.string().optional(),
			azure_api_version: z.string().optional(),
			azure_deployment_type: z.enum(["openai", "ai-foundry"]).optional(),
			azure_validation_model: z.string().optional(),
			azure_deployment_name: z.string().optional(),
			azure_ai_foundry_resource: z.string().optional(),
			azure_ai_foundry_api_version: z.string().optional(),
			alibaba_region: z
				.enum(["singapore", "us-virginia", "cn-beijing"])
				.optional(),
			vertex_openai_project_id: z.string().optional(),
		})
		.nullable(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	customModelsOnly: z.boolean(),
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
	token: z
		.string()
		.min(1, "API key is required")
		.regex(
			/^[\x21-\x7E]+$/,
			"API key contains invalid characters. Make sure you copied the actual key, not a masked version.",
		),
	name: z
		.string()
		.regex(
			/^[a-z]+(-[a-z]+)*$/,
			"Name must contain only lowercase letters a-z and single hyphens between them",
		)
		.optional(),
	baseUrl: z.string().url().optional(),
	options: z
		.object({
			aws_bedrock_region_prefix: z
				.enum(["us.", "global.", "eu.", "apac."])
				.optional(),
			aws_bedrock_region: z
				.enum([
					"global",
					"us",
					"eu",
					"apac",
					"us-east-1",
					"us-east-2",
					"us-west-2",
					"eu-central-1",
					"eu-west-1",
					"ap-northeast-1",
					"ap-southeast-1",
					"ap-southeast-2",
				])
				.optional(),
			azure_resource: z.string().optional(),
			azure_api_version: z.string().optional(),
			azure_deployment_type: z.enum(["openai", "ai-foundry"]).optional(),
			azure_validation_model: z.string().optional(),
			azure_deployment_name: z.string().min(1).optional(),
			azure_ai_foundry_resource: z.string().optional(),
			azure_ai_foundry_api_version: z.string().optional(),
			alibaba_region: z
				.enum(["singapore", "us-virginia", "cn-beijing"])
				.optional(),
			google_vertex_project_id: z.string().optional(),
			vertex_openai_project_id: z.string().optional(),
		})
		.optional(),
	organizationId: z.string().min(1, "Organization ID is required"),
});

// Schema for updating a provider key status / settings
const updateProviderKeyStatusSchema = z
	.object({
		status: z.enum(["active", "inactive"]).optional(),
		// Custom providers only: restrict requests to catalog-defined models.
		customModelsOnly: z.boolean().optional(),
	})
	.refine((v) => v.status !== undefined || v.customModelsOnly !== undefined, {
		message: "No updatable fields provided",
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
								maskedToken: z.string(),
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
		options,
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

	// Provider (BYOK) keys are an org-level resource; project-scoped "developer"
	// members cannot manage them.
	const creatorRole = userOrgs[0]?.role;
	if (creatorRole !== "owner" && creatorRole !== "admin") {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can manage provider keys",
		});
	}

	if (provider === "custom" && (!name || !baseUrl)) {
		throw new HTTPException(400, {
			message: "Custom providers require both a name and base URL",
		});
	}

	// Stealth providers have no default base URL and an undisclosed platform, so
	// users can't self-configure a working key for them. They are hidden from the
	// UI selector; reject here too as defense in depth against direct API calls.
	if (provider !== "custom" && isStealthProvider(provider as ProviderId)) {
		throw new HTTPException(400, {
			message: `Provider ${provider} cannot be configured with a provider key`,
		});
	}

	// SSRF guard: reject base URLs that resolve to internal/reserved addresses
	// before they are stored or used as an outbound fetch target. No-op unless
	// the hosted provider URL guard is enabled.
	if (baseUrl) {
		try {
			await assertSafeProviderUrl(baseUrl);
		} catch (error) {
			throw new HTTPException(400, {
				message:
					error instanceof Error
						? error.message
						: "Provider base URL is not allowed",
			});
		}
	}

	if (provider === "custom" && name) {
		const existingCustomProvider = await db.query.providerKey.findFirst({
			where: {
				status: {
					ne: "deleted",
				},
				provider: {
					eq: "custom",
				},
				name: {
					eq: name,
				},
				organizationId: {
					eq: organizationId,
				},
			},
		});

		if (existingCustomProvider) {
			throw new HTTPException(400, {
				message: `A custom provider named '${name}' already exists for this organization`,
			});
		}
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
				options,
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
		const errorMessage = validationResult.error ?? "Upstream server error";
		logger.warn("Provider key validation failed", {
			provider,
			model: validationResult.model ?? "unknown",
			statusCode: validationResult.statusCode ?? "none",
			error: errorMessage,
		});

		const statusPart = validationResult.statusCode
			? ` (status ${validationResult.statusCode})`
			: "";
		const modelPart = validationResult.model
			? ` using model ${validationResult.model}`
			: "";
		throw new HTTPException(400, {
			message: `Error from provider ${provider}: ${errorMessage}${statusPart}${modelPart}. Please try again later or contact support.`,
		});
	}

	if (!validationResult.valid) {
		throw new HTTPException(400, {
			message: `Invalid API key. Please make sure the key is correct.`,
		});
	}

	// Use the user-provided token
	// Create the provider key
	const [providerKey] = await cdb
		.insert(tables.providerKey)
		.values({
			token: userToken,
			organizationId,
			provider,
			name,
			baseUrl,
			options,
		})
		.returning();

	await logAuditEvent({
		organizationId,
		userId: user.id,
		action: "provider_key.create",
		resourceType: "provider_key",
		resourceId: providerKey.id,
		metadata: {
			provider,
			hasCustomBaseUrl: !!baseUrl,
		},
	});

	return c.json({
		providerKey: {
			...providerKey,
			maskedToken: maskToken(userToken),
			token: undefined,
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

	// Get all active organization IDs the user has access to
	const organizationIds = await getAdminOrganizationIds(user.id);

	if (!organizationIds.length) {
		return c.json({ providerKeys: [] });
	}

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

// List provider keys with minimal fields (provider + status only)
const listActive = createRoute({
	method: "get",
	path: "/provider/active",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						providerKeys: z
							.array(
								z.object({
									provider: z.string(),
									status: z.enum(["active", "inactive", "deleted"]).nullable(),
								}),
							)
							.openapi({}),
					}),
				},
			},
			description: "List of provider keys with minimal fields.",
		},
	},
});

keysProvider.openapi(listActive, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const organizationIds = await getAdminOrganizationIds(user.id);

	if (!organizationIds.length) {
		return c.json({ providerKeys: [] });
	}

	const providerKeys = await db.query.providerKey.findMany({
		where: {
			organizationId: {
				in: organizationIds,
			},
			status: {
				eq: "active",
			},
		},
		columns: {
			provider: true,
			status: true,
		},
	});

	return c.json({ providerKeys });
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

	// Get all active organization IDs the user has access to
	const organizationIds = await getAdminOrganizationIds(user.id);

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

	await cdb
		.update(tables.providerKey)
		.set({
			status: "deleted",
		})
		.where(eq(tables.providerKey.id, id));

	await logAuditEvent({
		organizationId: providerKey.organizationId,
		userId: user.id,
		action: "provider_key.delete",
		resourceType: "provider_key",
		resourceId: id,
		metadata: {
			provider: providerKey.provider,
		},
	});

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
	const { status, customModelsOnly } = c.req.valid("json");

	// Get all active organization IDs the user has access to
	const organizationIds = await getAdminOrganizationIds(user.id);

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
		with: {
			organization: true,
		},
	});

	if (!providerKey) {
		throw new HTTPException(404, {
			message: "Provider key not found",
		});
	}

	if (customModelsOnly !== undefined) {
		if (providerKey.provider !== "custom") {
			throw new HTTPException(400, {
				message: "customModelsOnly can only be set on custom provider keys",
			});
		}
		// Restricting to a custom catalog is an enterprise feature.
		if (providerKey.organization?.plan !== "enterprise") {
			throw new HTTPException(403, {
				message: "Custom models require an enterprise plan",
			});
		}
	}

	const updates: {
		status?: "active" | "inactive";
		customModelsOnly?: boolean;
	} = {};
	if (status !== undefined) {
		updates.status = status;
	}
	if (customModelsOnly !== undefined) {
		updates.customModelsOnly = customModelsOnly;
	}

	// Update the provider key
	const [updatedProviderKey] = await cdb
		.update(tables.providerKey)
		.set(updates)
		.where(eq(tables.providerKey.id, id))
		.returning();

	const changes: Record<string, { old: unknown; new: unknown }> = {};
	if (status !== undefined && providerKey.status !== status) {
		changes.status = { old: providerKey.status, new: status };
	}
	if (
		customModelsOnly !== undefined &&
		providerKey.customModelsOnly !== customModelsOnly
	) {
		changes.customModelsOnly = {
			old: providerKey.customModelsOnly,
			new: customModelsOnly,
		};
	}

	if (Object.keys(changes).length > 0) {
		await logAuditEvent({
			organizationId: providerKey.organizationId,
			userId: user.id,
			action: "provider_key.update",
			resourceType: "provider_key",
			resourceId: id,
			metadata: {
				provider: providerKey.provider,
				changes,
			},
		});
	}

	return c.json({
		message: "Provider key updated",
		providerKey: {
			...updatedProviderKey,
			maskedToken: maskToken(updatedProviderKey.token),
			token: undefined,
		},
	});
});

export default keysProvider;
