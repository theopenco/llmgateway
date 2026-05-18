import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	buildApiKeyLimitAuditChanges,
	createApiKeyForProject,
	hasPeriodConfigChanged,
	isPlaygroundApiKey,
	mergeApiKeyLimitConfig,
	parseApiKeyPeriodConfig,
	type PartialApiKeyLimitConfig,
} from "@/routes/keys-api.js";
import { createProjectForOrg } from "@/routes/projects.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, tables } from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";

import type { ServerTypes } from "@/vars.js";

export const v1Master = new OpenAPIHono<ServerTypes>();

interface AuthenticatedMasterKey {
	id: string;
	organizationId: string;
	createdBy: string;
}

declare module "hono" {
	interface ContextVariableMap {
		masterKey?: AuthenticatedMasterKey;
	}
}

v1Master.use("*", async (c, next) => {
	const authHeader = c.req.header("Authorization");
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		throw new HTTPException(401, {
			message: "Missing or invalid Authorization header",
		});
	}

	const token = authHeader.slice("Bearer ".length).trim();
	if (!token) {
		throw new HTTPException(401, { message: "Missing bearer token" });
	}

	const tokenHash = getApiKeyFingerprint(token);

	const row = await db.query.masterKey.findFirst({
		where: { tokenHash: { eq: tokenHash }, status: { eq: "active" } },
		with: { organization: true },
	});

	if (!row) {
		throw new HTTPException(401, { message: "Invalid master key" });
	}

	if (row.organization?.status === "deleted") {
		throw new HTTPException(403, { message: "Organization is not active" });
	}

	if (row.organization?.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Master keys require an enterprise plan",
		});
	}

	c.set("masterKey", {
		id: row.id,
		organizationId: row.organizationId,
		createdBy: row.createdBy,
	});

	void db
		.update(tables.masterKey)
		.set({ lastUsedAt: new Date() })
		.where(eq(tables.masterKey.id, row.id))
		.catch(() => {
			// best-effort; don't fail the request if the touch fails
		});

	await next();
});

const projectModeEnum = z.enum(["api-keys", "credits", "hybrid"]);

const projectSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	organizationId: z.string(),
	cachingEnabled: z.boolean(),
	cacheDurationSeconds: z.number(),
	mode: projectModeEnum,
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
});

const createProjectBody = z.object({
	name: z.string().min(1).max(255),
	cachingEnabled: z.boolean().optional(),
	cacheDurationSeconds: z.number().min(10).max(31536000).optional(),
	mode: projectModeEnum.optional(),
});

const createProject = createRoute({
	method: "post",
	path: "/projects",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createProjectBody,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ project: projectSchema.openapi({}) }),
				},
			},
			description: "Project created successfully via master key.",
		},
	},
});

const listProjects = createRoute({
	method: "get",
	path: "/projects",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						projects: z.array(projectSchema).openapi({}),
					}),
				},
			},
			description:
				"List all non-deleted projects in the master key's organization.",
		},
	},
});

v1Master.openapi(listProjects, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const projects = await db.query.project.findMany({
		where: {
			organizationId: { eq: masterKey.organizationId },
			status: { ne: "deleted" },
		},
	});

	return c.json({ projects });
});

v1Master.openapi(createProject, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const input = c.req.valid("json");

	const project = await createProjectForOrg(
		masterKey.organizationId,
		masterKey.createdBy,
		input,
		{ skipAccessCheck: true },
	);

	return c.json({ project }, 201);
});

const apiKeyPeriodUnit = z.enum(["hour", "day", "week", "month"]);

const nonNegativeDecimal = z
	.string()
	.regex(/^\d+(?:\.\d+)?$/, "must be a non-negative number");

const createApiKeyBody = z.object({
	projectId: z.string().min(1),
	description: z.string().min(1).max(255),
	usageLimit: nonNegativeDecimal.nullable().optional(),
	periodUsageLimit: nonNegativeDecimal.nullable().optional(),
	periodUsageDurationValue: z.number().int().positive().nullable().optional(),
	periodUsageDurationUnit: apiKeyPeriodUnit.nullable().optional(),
});

const apiKeyResponseSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	token: z.string(),
	description: z.string(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	projectId: z.string(),
	createdBy: z.string(),
});

const createApiKey = createRoute({
	method: "post",
	path: "/keys",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createApiKeyBody,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						apiKey: apiKeyResponseSchema.openapi({}),
					}),
				},
			},
			description:
				"Gateway API key created successfully via master key. The plain token is returned only once.",
		},
	},
});

v1Master.openapi(createApiKey, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId, ...rest } = c.req.valid("json");

	const project = await db.query.project.findFirst({
		where: { id: { eq: projectId } },
	});

	if (
		!project ||
		project.status === "deleted" ||
		project.organizationId !== masterKey.organizationId
	) {
		throw new HTTPException(404, {
			message: "Project not found in this organization",
		});
	}

	const { apiKey, token } = await createApiKeyForProject(
		projectId,
		masterKey.createdBy,
		rest,
		{ skipAccessCheck: true },
	);

	return c.json(
		{
			apiKey: {
				id: apiKey.id,
				createdAt: apiKey.createdAt,
				updatedAt: apiKey.updatedAt,
				token,
				description: apiKey.description,
				status: apiKey.status,
				projectId: apiKey.projectId,
				createdBy: apiKey.createdBy,
			},
		},
		201,
	);
});

const updateProjectBody = z
	.object({
		name: z.string().min(1).max(255).optional(),
		cachingEnabled: z.boolean().optional(),
		cacheDurationSeconds: z.number().min(10).max(31536000).optional(),
		mode: projectModeEnum.optional(),
		status: z.enum(["active", "inactive"]).optional(),
	})
	.refine((v) => Object.keys(v).length > 0, {
		message: "At least one field must be provided",
	});

const updateProject = createRoute({
	method: "patch",
	path: "/projects/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateProjectBody,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						project: projectSchema.openapi({}),
					}),
				},
			},
			description: "Project updated successfully via master key.",
		},
	},
});

v1Master.openapi(updateProject, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const updates = c.req.valid("json");

	const existing = await db.query.project.findFirst({
		where: { id: { eq: id } },
	});

	if (
		!existing ||
		existing.status === "deleted" ||
		existing.organizationId !== masterKey.organizationId
	) {
		throw new HTTPException(404, {
			message: "Project not found in this organization",
		});
	}

	const [updated] = await db
		.update(tables.project)
		.set(updates)
		.where(eq(tables.project.id, id))
		.returning();

	const changes: Record<string, { old: unknown; new: unknown }> = {};
	for (const [key, value] of Object.entries(updates)) {
		const before = (existing as Record<string, unknown>)[key];
		if (before !== value) {
			changes[key] = { old: before, new: value };
		}
	}
	if (Object.keys(changes).length > 0) {
		await logAuditEvent({
			organizationId: existing.organizationId,
			userId: masterKey.createdBy,
			action: "project.update",
			resourceType: "project",
			resourceId: id,
			metadata: { changes, resourceName: existing.name },
		});
	}

	return c.json({ project: updated });
});

const deleteProject = createRoute({
	method: "delete",
	path: "/projects/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Project deleted successfully via master key.",
		},
	},
});

v1Master.openapi(deleteProject, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const existing = await db.query.project.findFirst({
		where: { id: { eq: id } },
	});

	if (
		!existing ||
		existing.status === "deleted" ||
		existing.organizationId !== masterKey.organizationId
	) {
		throw new HTTPException(404, {
			message: "Project not found in this organization",
		});
	}

	// Mirror dashboard owner-only project deletion (projects.ts).
	// Admins can mint master keys, so we re-check the issuer's current role.
	const issuerOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: masterKey.createdBy },
			organizationId: { eq: masterKey.organizationId },
		},
		columns: { role: true },
	});

	if (!issuerOrg || issuerOrg.role !== "owner") {
		throw new HTTPException(403, {
			message: "Only master keys issued by an owner can delete projects",
		});
	}

	await db
		.update(tables.project)
		.set({ status: "deleted" })
		.where(eq(tables.project.id, id));

	await logAuditEvent({
		organizationId: existing.organizationId,
		userId: masterKey.createdBy,
		action: "project.delete",
		resourceType: "project",
		resourceId: id,
		metadata: { resourceName: existing.name },
	});

	return c.json({ message: "Project deleted successfully" });
});

const apiKeyDetailSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	description: z.string(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	projectId: z.string(),
	createdBy: z.string(),
	usageLimit: z.string().nullable(),
	periodUsageLimit: z.string().nullable(),
	periodUsageDurationValue: z.number().int().nullable(),
	periodUsageDurationUnit: apiKeyPeriodUnit.nullable(),
});

const updateApiKeyBody = z
	.object({
		description: z.string().min(1).max(255).optional(),
		status: z.enum(["active", "inactive"]).optional(),
		usageLimit: nonNegativeDecimal.nullable().optional(),
		periodUsageLimit: nonNegativeDecimal.nullable().optional(),
		periodUsageDurationValue: z.number().int().positive().nullable().optional(),
		periodUsageDurationUnit: apiKeyPeriodUnit.nullable().optional(),
	})
	.refine((v) => Object.keys(v).length > 0, {
		message: "At least one field must be provided",
	});

const updateApiKey = createRoute({
	method: "patch",
	path: "/keys/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateApiKeyBody,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						apiKey: apiKeyDetailSchema.openapi({}),
					}),
				},
			},
			description: "API key updated successfully via master key.",
		},
	},
});

v1Master.openapi(updateApiKey, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const updates = c.req.valid("json");

	const existing = await db.query.apiKey.findFirst({
		where: { id: { eq: id } },
		with: { project: true },
	});

	if (
		!existing ||
		existing.status === "deleted" ||
		!existing.project ||
		existing.project.organizationId !== masterKey.organizationId
	) {
		throw new HTTPException(404, {
			message: "API key not found in this organization",
		});
	}

	if (isPlaygroundApiKey(existing)) {
		if (
			updates.description !== undefined &&
			updates.description !== existing.description
		) {
			throw new HTTPException(403, {
				message:
					"Cannot rename the playground API key. This key is required for the playground to function.",
			});
		}
		if (updates.status === "inactive") {
			throw new HTTPException(403, {
				message:
					"Cannot deactivate the playground API key. This key is required for the playground to function.",
			});
		}
	}

	const limitUpdate: PartialApiKeyLimitConfig = {};
	if ("usageLimit" in updates) {
		limitUpdate.usageLimit = updates.usageLimit ?? null;
	}
	if ("periodUsageLimit" in updates) {
		limitUpdate.periodUsageLimit = updates.periodUsageLimit ?? null;
	}
	if ("periodUsageDurationValue" in updates) {
		limitUpdate.periodUsageDurationValue =
			updates.periodUsageDurationValue ?? null;
	}
	if ("periodUsageDurationUnit" in updates) {
		limitUpdate.periodUsageDurationUnit =
			updates.periodUsageDurationUnit ?? null;
	}

	const hasLimitUpdate = Object.keys(limitUpdate).length > 0;
	const nextLimitConfig = hasLimitUpdate
		? mergeApiKeyLimitConfig(existing, limitUpdate)
		: null;

	if (nextLimitConfig) {
		parseApiKeyPeriodConfig(nextLimitConfig);
	}

	const periodConfigChanged =
		nextLimitConfig !== null &&
		hasPeriodConfigChanged(existing, nextLimitConfig);

	const setPayload: Record<string, unknown> = {};
	if (updates.description !== undefined) {
		setPayload.description = updates.description;
	}
	if (updates.status !== undefined) {
		setPayload.status = updates.status;
	}
	if (nextLimitConfig) {
		setPayload.usageLimit = nextLimitConfig.usageLimit;
		setPayload.periodUsageLimit = nextLimitConfig.periodUsageLimit;
		setPayload.periodUsageDurationValue =
			nextLimitConfig.periodUsageDurationValue;
		setPayload.periodUsageDurationUnit =
			nextLimitConfig.periodUsageDurationUnit;
		if (periodConfigChanged) {
			setPayload.currentPeriodUsage = "0";
			setPayload.currentPeriodStartedAt = null;
		}
	}

	const [updated] = await db
		.update(tables.apiKey)
		.set(setPayload)
		.where(eq(tables.apiKey.id, id))
		.returning();

	const statusChanged =
		updates.status !== undefined && updates.status !== existing.status;
	const descriptionChanged =
		updates.description !== undefined &&
		updates.description !== existing.description;
	const limitChanges = nextLimitConfig
		? buildApiKeyLimitAuditChanges(existing, nextLimitConfig)
		: {};
	const limitChanged = Object.keys(limitChanges).length > 0;

	if (limitChanged || descriptionChanged || statusChanged) {
		const changes: Record<string, { old: unknown; new: unknown }> = {
			...limitChanges,
		};
		if (descriptionChanged) {
			changes.description = {
				old: existing.description,
				new: updates.description,
			};
		}
		if (statusChanged) {
			changes.status = { old: existing.status, new: updates.status };
		}

		const action = limitChanged
			? "api_key.update_limit"
			: descriptionChanged
				? "api_key.update_description"
				: "api_key.update_status";

		await logAuditEvent({
			organizationId: existing.project.organizationId,
			userId: masterKey.createdBy,
			action,
			resourceType: "api_key",
			resourceId: id,
			metadata: { resourceName: existing.description, changes },
		});
	}

	return c.json({ apiKey: updated });
});

const deleteApiKey = createRoute({
	method: "delete",
	path: "/keys/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "API key deleted successfully via master key.",
		},
	},
});

v1Master.openapi(deleteApiKey, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const existing = await db.query.apiKey.findFirst({
		where: { id: { eq: id } },
		with: { project: true },
	});

	if (
		!existing ||
		existing.status === "deleted" ||
		!existing.project ||
		existing.project.organizationId !== masterKey.organizationId
	) {
		throw new HTTPException(404, {
			message: "API key not found in this organization",
		});
	}

	if (isPlaygroundApiKey(existing)) {
		throw new HTTPException(403, {
			message:
				"Cannot delete the playground API key. This key is required for the playground to function.",
		});
	}

	await db
		.update(tables.apiKey)
		.set({ status: "deleted" })
		.where(eq(tables.apiKey.id, id));

	await logAuditEvent({
		organizationId: existing.project.organizationId,
		userId: masterKey.createdBy,
		action: "api_key.delete",
		resourceType: "api_key",
		resourceId: id,
		metadata: { resourceName: existing.description },
	});

	return c.json({ message: "API key deleted successfully" });
});

export default v1Master;
