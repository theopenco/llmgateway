import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { maskToken } from "@/lib/maskToken.js";
import {
	buildApiKeyLimitAuditChanges,
	createApiKeyForProject,
	createIamRuleSchema,
	hasPeriodConfigChanged,
	iamRuleSchema,
	iamRuleStatusEnum,
	iamRuleTypeEnum,
	iamRuleValueSchema,
	isPlaygroundApiKey,
	mergeApiKeyLimitConfig,
	parseApiKeyPeriodConfig,
	validateIamRuleInput,
	type PartialApiKeyLimitConfig,
} from "@/routes/keys-api.js";
import { createProjectForOrg } from "@/routes/projects.js";

import { logAuditEvent } from "@llmgateway/audit";
import { db, eq, getApiKeyCurrentPeriodState, tables } from "@llmgateway/db";
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

async function loadApiKeyForOrg(apiKeyId: string, organizationId: string) {
	const apiKey = await db.query.apiKey.findFirst({
		where: { id: { eq: apiKeyId } },
		with: { project: true },
	});

	if (
		!apiKey ||
		apiKey.status === "deleted" ||
		!apiKey.project ||
		apiKey.project.organizationId !== organizationId
	) {
		throw new HTTPException(404, {
			message: "API key not found in this organization",
		});
	}

	return apiKey as typeof apiKey & {
		project: NonNullable<typeof apiKey.project>;
	};
}

interface SerializableApiKey {
	id: string;
	createdAt: Date;
	updatedAt: Date;
	description: string;
	status: "active" | "inactive" | "deleted" | null;
	projectId: string;
	createdBy: string;
	token: string;
	usageLimit: string | null;
	usage: string;
	periodUsageLimit: string | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: "hour" | "day" | "week" | "month" | null;
	currentPeriodUsage: string;
	currentPeriodStartedAt: Date | null;
}

/**
 * Shape a gateway API key row for the master API, exposing the configured
 * limits alongside the values consumed so far and — for a windowed limit —
 * the time the current period resets. Never leaks the plain token.
 */
function serializeApiKeyForMaster(apiKey: SerializableApiKey) {
	const currentPeriod = getApiKeyCurrentPeriodState(apiKey);

	return {
		id: apiKey.id,
		createdAt: apiKey.createdAt,
		updatedAt: apiKey.updatedAt,
		description: apiKey.description,
		status: apiKey.status,
		projectId: apiKey.projectId,
		createdBy: apiKey.createdBy,
		maskedToken: maskToken(apiKey.token),
		usageLimit: apiKey.usageLimit,
		usage: apiKey.usage,
		periodUsageLimit: apiKey.periodUsageLimit,
		periodUsageDurationValue: apiKey.periodUsageDurationValue,
		periodUsageDurationUnit: apiKey.periodUsageDurationUnit,
		currentPeriodUsage: currentPeriod.usage,
		currentPeriodStartedAt: currentPeriod.startedAt,
		currentPeriodResetAt: currentPeriod.resetAt,
	};
}

const projectModeEnum = z.enum(["api-keys", "credits", "hybrid"]);

const projectSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	name: z.string(),
	organizationId: z.string(),
	cachingEnabled: z.boolean(),
	cacheDurationSeconds: z.number(),
	providerCacheControlEnabled: z.boolean(),
	mode: projectModeEnum,
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
});

const createProjectBody = z.object({
	name: z.string().min(1).max(255),
	cachingEnabled: z.boolean().optional(),
	cacheDurationSeconds: z.number().min(10).max(31536000).optional(),
	providerCacheControlEnabled: z.boolean().optional(),
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
		providerCacheControlEnabled: z.boolean().optional(),
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
	maskedToken: z.string(),
	usageLimit: z.string().nullable(),
	// Total spend accrued against `usageLimit` over the key's lifetime.
	usage: z.string(),
	periodUsageLimit: z.string().nullable(),
	periodUsageDurationValue: z.number().int().nullable(),
	periodUsageDurationUnit: apiKeyPeriodUnit.nullable(),
	// Spend accrued in the current window, and when that window resets. Both are
	// null / "0" when no period limit is configured or the window has lapsed.
	currentPeriodUsage: z.string(),
	currentPeriodStartedAt: z.date().nullable(),
	currentPeriodResetAt: z.date().nullable(),
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

	const existing = await loadApiKeyForOrg(id, masterKey.organizationId);

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

	return c.json({ apiKey: serializeApiKeyForMaster(updated) });
});

const listApiKeysQuery = z.object({
	projectId: z.string().min(1).optional(),
});

const listApiKeys = createRoute({
	method: "get",
	path: "/keys",
	request: {
		query: listApiKeysQuery,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						apiKeys: z.array(apiKeyDetailSchema).openapi({}),
					}),
				},
			},
			description:
				"List gateway API keys in the master key's organization, with configured limits, consumed usage, and the current-period reset time. Optionally filter by projectId.",
		},
	},
});

v1Master.openapi(listApiKeys, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId } = c.req.valid("query");

	const projects = await db.query.project.findMany({
		where: {
			organizationId: { eq: masterKey.organizationId },
			status: { ne: "deleted" },
		},
		columns: { id: true },
	});
	const projectIds = projects.map((p) => p.id);

	if (projectId && !projectIds.includes(projectId)) {
		throw new HTTPException(404, {
			message: "Project not found in this organization",
		});
	}

	if (projectIds.length === 0) {
		return c.json({ apiKeys: [] });
	}

	const apiKeys = await db.query.apiKey.findMany({
		where: {
			projectId: { in: projectId ? [projectId] : projectIds },
			// Only developer-created keys; hide platform and LLM SDK aggregate keys.
			keyType: { eq: "user" },
			status: { ne: "deleted" },
		},
		orderBy: { createdAt: "desc" },
	});

	return c.json({ apiKeys: apiKeys.map(serializeApiKeyForMaster) });
});

const getApiKey = createRoute({
	method: "get",
	path: "/keys/{id}",
	request: {
		params: z.object({ id: z.string() }),
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
			description:
				"Get a gateway API key with its configured limits, consumed usage, and the current-period reset time.",
		},
	},
});

v1Master.openapi(getApiKey, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const apiKey = await loadApiKeyForOrg(id, masterKey.organizationId);

	return c.json({ apiKey: serializeApiKeyForMaster(apiKey) });
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

	const existing = await loadApiKeyForOrg(id, masterKey.organizationId);

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

const updateIamRuleBody = z
	.object({
		ruleType: iamRuleTypeEnum.optional(),
		ruleValue: iamRuleValueSchema.optional(),
		status: iamRuleStatusEnum.optional(),
	})
	.refine((v) => Object.keys(v).length > 0, {
		message: "At least one field must be provided",
	});

const createIamRule = createRoute({
	method: "post",
	path: "/keys/{id}/iam",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: createIamRuleSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ rule: iamRuleSchema.openapi({}) }),
				},
			},
			description: "IAM rule created successfully via master key.",
		},
	},
});

v1Master.openapi(createIamRule, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const ruleData = c.req.valid("json");

	validateIamRuleInput(ruleData);

	const apiKey = await loadApiKeyForOrg(id, masterKey.organizationId);

	const [rule] = await db
		.insert(tables.apiKeyIamRule)
		.values({
			apiKeyId: apiKey.id,
			...ruleData,
		})
		.returning();

	await logAuditEvent({
		organizationId: masterKey.organizationId,
		userId: masterKey.createdBy,
		action: "api_key.iam_rule.create",
		resourceType: "iam_rule",
		resourceId: rule.id,
		metadata: {
			apiKeyId: apiKey.id,
			ruleType: ruleData.ruleType,
			ruleValue: ruleData.ruleValue,
		},
	});

	return c.json({ rule }, 201);
});

const listIamRules = createRoute({
	method: "get",
	path: "/keys/{id}/iam",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						rules: z.array(iamRuleSchema).openapi({}),
					}),
				},
			},
			description: "List IAM rules for an API key via master key.",
		},
	},
});

v1Master.openapi(listIamRules, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const apiKey = await loadApiKeyForOrg(id, masterKey.organizationId);

	const rules = await db.query.apiKeyIamRule.findMany({
		where: { apiKeyId: { eq: apiKey.id } },
	});

	return c.json({ rules });
});

const updateIamRule = createRoute({
	method: "patch",
	path: "/keys/{id}/iam/{ruleId}",
	request: {
		params: z.object({ id: z.string(), ruleId: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateIamRuleBody,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ rule: iamRuleSchema.openapi({}) }),
				},
			},
			description: "IAM rule updated successfully via master key.",
		},
	},
});

v1Master.openapi(updateIamRule, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id, ruleId } = c.req.param();
	const updates = c.req.valid("json");

	validateIamRuleInput(updates);

	const apiKey = await loadApiKeyForOrg(id, masterKey.organizationId);

	const existingRule = await db.query.apiKeyIamRule.findFirst({
		where: { id: { eq: ruleId }, apiKeyId: { eq: apiKey.id } },
	});

	if (!existingRule) {
		throw new HTTPException(404, {
			message: "IAM rule not found for this API key",
		});
	}

	if (updates.ruleType || updates.ruleValue) {
		validateIamRuleInput({
			ruleType: updates.ruleType ?? existingRule.ruleType,
			ruleValue: updates.ruleValue ?? existingRule.ruleValue,
		});
	}

	const [updated] = await db
		.update(tables.apiKeyIamRule)
		.set(updates)
		.where(eq(tables.apiKeyIamRule.id, ruleId))
		.returning();

	const changes: Record<string, { old: unknown; new: unknown }> = {};
	for (const [key, value] of Object.entries(updates)) {
		const before = (existingRule as Record<string, unknown>)[key];
		if (JSON.stringify(before) !== JSON.stringify(value)) {
			changes[key] = { old: before, new: value };
		}
	}

	if (Object.keys(changes).length > 0) {
		await logAuditEvent({
			organizationId: masterKey.organizationId,
			userId: masterKey.createdBy,
			action: "api_key.iam_rule.update",
			resourceType: "iam_rule",
			resourceId: ruleId,
			metadata: { apiKeyId: apiKey.id, changes },
		});
	}

	return c.json({ rule: updated });
});

const deleteIamRule = createRoute({
	method: "delete",
	path: "/keys/{id}/iam/{ruleId}",
	request: {
		params: z.object({ id: z.string(), ruleId: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "IAM rule deleted successfully via master key.",
		},
	},
});

v1Master.openapi(deleteIamRule, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id, ruleId } = c.req.param();

	const apiKey = await loadApiKeyForOrg(id, masterKey.organizationId);

	const existingRule = await db.query.apiKeyIamRule.findFirst({
		where: { id: { eq: ruleId }, apiKeyId: { eq: apiKey.id } },
	});

	if (!existingRule) {
		throw new HTTPException(404, {
			message: "IAM rule not found for this API key",
		});
	}

	await db
		.delete(tables.apiKeyIamRule)
		.where(eq(tables.apiKeyIamRule.id, ruleId));

	await logAuditEvent({
		organizationId: masterKey.organizationId,
		userId: masterKey.createdBy,
		action: "api_key.iam_rule.delete",
		resourceType: "iam_rule",
		resourceId: ruleId,
		metadata: {
			apiKeyId: apiKey.id,
			ruleType: existingRule.ruleType,
		},
	});

	return c.json({ message: "IAM rule deleted successfully" });
});

export default v1Master;
