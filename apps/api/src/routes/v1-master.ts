import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	MAX_ORG_ACTIVITY_RANGE_DAYS,
	rangeDaysInclusive,
	resolveDateRange,
} from "@/lib/date-range.js";
import {
	createIamRuleSchema,
	iamRuleStatusEnum,
	iamRuleTypeEnum,
	iamRuleValueSchema,
	validateIamRuleInput,
} from "@/lib/iam-rules.js";
import { getOrgProjectIds } from "@/lib/org-projects.js";
import { assertOrganizationProviderKey } from "@/lib/organization-provider-key.js";
import {
	getUsageReport,
	USAGE_DIMENSIONS,
	USAGE_GRANULARITIES,
	usageReportRowSchema,
	usageReportToCsv,
	type UsageDimension,
} from "@/lib/usage-report.js";
import {
	applyCustomModelUpdate,
	createCustomModelSchema,
	customModelSchema,
	insertCustomModel,
	softDeleteCustomModel,
	updateCustomModelSchema,
} from "@/routes/custom-models.js";
import {
	buildApiKeyLimitAuditChanges,
	createApiKeyForProject,
	hasPeriodConfigChanged,
	iamRuleSchema,
	isPlaygroundApiKey,
	mergeApiKeyLimitConfig,
	parseApiKeyPeriodConfig,
	type PartialApiKeyLimitConfig,
} from "@/routes/keys-api.js";
import {
	assertCustomProviderNameAvailable,
	assertProviderBaseUrlAllowed,
	complianceAttestationSchema,
	customProviderNameSchema,
	isValidProviderToken,
	providerKeyPublicSchema,
	stampComplianceAttestation,
	toPublicProviderKey,
} from "@/routes/keys-provider.js";
import { createProjectForOrg } from "@/routes/projects.js";
import { memberIamRuleSchema } from "@/routes/team.js";
import { timezoneQueryField } from "@/utils/timezone.js";

import { encryptProviderKey, readProviderKey } from "@llmgateway/actions";
import { logAuditEvent } from "@llmgateway/audit";
import {
	cdb,
	db,
	eq,
	getApiKeyCurrentPeriodState,
	shortid,
	tables,
} from "@llmgateway/db";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";
import { maskToken } from "@llmgateway/shared/mask-token";

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
		with: {
			project: true,
			creator: { columns: { email: true } },
		},
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
	creator?: { email: string } | null;
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
		createdByEmail: apiKey.creator?.email ?? null,
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

	const [updated] = await cdb
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

	await cdb
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
	createdByEmail: z.string().nullable(),
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

	const [updated] = await cdb
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

	return c.json({
		apiKey: serializeApiKeyForMaster({
			...updated,
			creator: existing.creator,
		}),
	});
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
		with: { creator: { columns: { email: true } } },
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

	await cdb
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

	const [rule] = await cdb
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

	const [updated] = await cdb
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

	await cdb
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

// Resolve a member reference to the membership row in this org. The reference
// is a userOrganization id, or a user email when it contains "@" (generated
// ids never do). Email lookups still require the user to be a member of the
// master key's organization.
async function loadMemberForOrg(memberRef: string, organizationId: string) {
	// Personal orgs have no team management (mirrors the team routes); the
	// master-key middleware only checks plan, not kind, so guard here too.
	const organization = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
		columns: { kind: true },
	});
	if (organization?.kind === "devpass" || organization?.kind === "chat") {
		throw new HTTPException(403, {
			message: "Team management is not available for personal organizations.",
		});
	}

	let membership;
	if (memberRef.includes("@")) {
		const user = await db.query.user.findFirst({
			where: { email: { eq: memberRef.toLowerCase() } },
		});
		membership = user
			? await db.query.userOrganization.findFirst({
					where: {
						userId: { eq: user.id },
						organizationId: { eq: organizationId },
					},
					with: { user: { columns: { id: true, email: true } } },
				})
			: undefined;
	} else {
		membership = await db.query.userOrganization.findFirst({
			where: {
				id: { eq: memberRef },
				organizationId: { eq: organizationId },
			},
			with: { user: { columns: { id: true, email: true } } },
		});
	}

	if (!membership) {
		throw new HTTPException(404, {
			message: "Member not found in this organization",
		});
	}

	return membership;
}

const memberParamDescription =
	"Member reference: a membership id or the member's email address";

const createMemberIamRule = createRoute({
	method: "post",
	path: "/members/{member}/iam",
	request: {
		params: z.object({
			member: z.string().openapi({ description: memberParamDescription }),
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
		201: {
			content: {
				"application/json": {
					schema: z.object({ rule: memberIamRuleSchema.openapi({}) }),
				},
			},
			description: "Member IAM rule created successfully via master key.",
		},
	},
});

v1Master.openapi(createMemberIamRule, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { member } = c.req.param();
	const ruleData = c.req.valid("json");

	validateIamRuleInput(ruleData);

	const membership = await loadMemberForOrg(member, masterKey.organizationId);

	const [rule] = await cdb
		.insert(tables.userIamRule)
		.values({
			userOrganizationId: membership.id,
			...ruleData,
		})
		.returning();

	await logAuditEvent({
		organizationId: masterKey.organizationId,
		userId: masterKey.createdBy,
		action: "team_member.iam_rule.create",
		resourceType: "iam_rule",
		resourceId: rule.id,
		metadata: {
			memberId: membership.id,
			targetUserId: membership.userId,
			targetUserEmail: membership.user?.email,
			ruleType: ruleData.ruleType,
			ruleValue: ruleData.ruleValue,
		},
	});

	return c.json({ rule }, 201);
});

const listMemberIamRules = createRoute({
	method: "get",
	path: "/members/{member}/iam",
	request: {
		params: z.object({
			member: z.string().openapi({ description: memberParamDescription }),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						rules: z.array(memberIamRuleSchema).openapi({}),
					}),
				},
			},
			description: "List IAM rules for an org member via master key.",
		},
	},
});

v1Master.openapi(listMemberIamRules, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { member } = c.req.param();

	const membership = await loadMemberForOrg(member, masterKey.organizationId);

	const rules = await db.query.userIamRule.findMany({
		where: { userOrganizationId: { eq: membership.id } },
	});

	return c.json({ rules });
});

const updateMemberIamRule = createRoute({
	method: "patch",
	path: "/members/{member}/iam/{ruleId}",
	request: {
		params: z.object({
			member: z.string().openapi({ description: memberParamDescription }),
			ruleId: z.string(),
		}),
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
					schema: z.object({ rule: memberIamRuleSchema.openapi({}) }),
				},
			},
			description: "Member IAM rule updated successfully via master key.",
		},
	},
});

v1Master.openapi(updateMemberIamRule, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { member, ruleId } = c.req.param();
	const updates = c.req.valid("json");

	const membership = await loadMemberForOrg(member, masterKey.organizationId);

	const existingRule = await db.query.userIamRule.findFirst({
		where: { id: { eq: ruleId }, userOrganizationId: { eq: membership.id } },
	});

	if (!existingRule) {
		throw new HTTPException(404, {
			message: "IAM rule not found for this member",
		});
	}

	if (updates.ruleType || updates.ruleValue) {
		validateIamRuleInput({
			ruleType: updates.ruleType ?? existingRule.ruleType,
			ruleValue: updates.ruleValue ?? existingRule.ruleValue,
		});
	}

	const [updated] = await cdb
		.update(tables.userIamRule)
		.set(updates)
		.where(eq(tables.userIamRule.id, ruleId))
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
			action: "team_member.iam_rule.update",
			resourceType: "iam_rule",
			resourceId: ruleId,
			metadata: {
				memberId: membership.id,
				targetUserId: membership.userId,
				targetUserEmail: membership.user?.email,
				changes,
			},
		});
	}

	return c.json({ rule: updated });
});

const deleteMemberIamRule = createRoute({
	method: "delete",
	path: "/members/{member}/iam/{ruleId}",
	request: {
		params: z.object({
			member: z.string().openapi({ description: memberParamDescription }),
			ruleId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Member IAM rule deleted successfully via master key.",
		},
	},
});

v1Master.openapi(deleteMemberIamRule, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { member, ruleId } = c.req.param();

	const membership = await loadMemberForOrg(member, masterKey.organizationId);

	const existingRule = await db.query.userIamRule.findFirst({
		where: { id: { eq: ruleId }, userOrganizationId: { eq: membership.id } },
	});

	if (!existingRule) {
		throw new HTTPException(404, {
			message: "IAM rule not found for this member",
		});
	}

	await cdb.delete(tables.userIamRule).where(eq(tables.userIamRule.id, ruleId));

	await logAuditEvent({
		organizationId: masterKey.organizationId,
		userId: masterKey.createdBy,
		action: "team_member.iam_rule.delete",
		resourceType: "iam_rule",
		resourceId: ruleId,
		metadata: {
			memberId: membership.id,
			targetUserId: membership.userId,
			targetUserEmail: membership.user?.email,
			ruleType: existingRule.ruleType,
		},
	});

	return c.json({ message: "Member IAM rule deleted successfully" });
});

// Custom providers are BYOK provider keys with `provider: "custom"`, addressed
// by the gateway as `custom/<name>/<model>`. Only custom keys are exposed here:
// catalog providers require an upstream credential check that isn't meaningful
// for unattended provisioning.
async function loadCustomProviderKeyForOrg(id: string, organizationId: string) {
	const providerKey = await db.query.providerKey.findFirst({
		where: { id: { eq: id } },
	});

	if (
		!providerKey ||
		providerKey.status === "deleted" ||
		providerKey.organizationId !== organizationId ||
		providerKey.provider !== "custom"
	) {
		throw new HTTPException(404, {
			message: "Custom provider not found in this organization",
		});
	}

	// Narrows organizationId to non-null for consumers (insertCustomModel etc.).
	// Guaranteed by the org check above: platform-managed rows have a NULL
	// organizationId and can never match a master key's organization.
	assertOrganizationProviderKey(providerKey);

	return providerKey;
}

async function loadCustomModelForOrg(id: string, organizationId: string) {
	const customModel = await db.query.customModel.findFirst({
		where: {
			id: { eq: id },
			organizationId: { eq: organizationId },
			status: { ne: "deleted" },
		},
	});

	if (!customModel) {
		throw new HTTPException(404, {
			message: "Custom model not found in this organization",
		});
	}

	return customModel;
}

const providerTokenField = z
	.string()
	.min(1, "API key is required")
	.refine(isValidProviderToken, {
		message:
			"API key contains invalid characters. Make sure you copied the actual key, not a masked version.",
	});

const createCustomProviderBody = z.object({
	name: customProviderNameSchema,
	baseUrl: z.string().url(),
	token: providerTokenField,
	customModelsOnly: z.boolean().optional(),
	complianceAttestation: complianceAttestationSchema.optional(),
});

const updateCustomProviderBody = z
	.object({
		baseUrl: z.string().url().optional(),
		token: providerTokenField.optional(),
		status: z.enum(["active", "inactive"]).optional(),
		customModelsOnly: z.boolean().optional(),
		complianceAttestation: complianceAttestationSchema.nullable().optional(),
	})
	.refine((v) => Object.keys(v).length > 0, {
		message: "At least one field must be provided",
	});

const createCustomProvider = createRoute({
	method: "post",
	path: "/custom-providers",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createCustomProviderBody,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({
						customProvider: providerKeyPublicSchema.openapi({}),
					}),
				},
			},
			description: "Custom provider created successfully via master key.",
		},
	},
});

v1Master.openapi(createCustomProvider, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { name, baseUrl, token, customModelsOnly, complianceAttestation } =
		c.req.valid("json");

	await assertProviderBaseUrlAllowed(baseUrl);
	await assertCustomProviderNameAvailable(masterKey.organizationId, name);

	// Generate the id up front so the AAD — which binds the ciphertext to the
	// row id and the organization id — can be computed before the INSERT.
	const providerKeyId = shortid();
	const [providerKey] = await cdb
		.insert(tables.providerKey)
		.values({
			id: providerKeyId,
			organizationId: masterKey.organizationId,
			provider: "custom",
			name,
			baseUrl,
			token: null,
			tokenCiphertext: encryptProviderKey(
				token,
				providerKeyId,
				masterKey.organizationId,
			),
			tokenMasked: maskToken(token),
			tokenHash: getApiKeyFingerprint(token),
			customModelsOnly: customModelsOnly ?? false,
			complianceAttestation: complianceAttestation
				? stampComplianceAttestation(complianceAttestation, masterKey.createdBy)
				: null,
		})
		.returning();

	await logAuditEvent({
		organizationId: masterKey.organizationId,
		userId: masterKey.createdBy,
		action: "provider_key.create",
		resourceType: "provider_key",
		resourceId: providerKey.id,
		metadata: { provider: "custom", resourceName: name },
	});

	return c.json({ customProvider: toPublicProviderKey(providerKey) }, 201);
});

const listCustomProviders = createRoute({
	method: "get",
	path: "/custom-providers",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						customProviders: z.array(providerKeyPublicSchema).openapi({}),
					}),
				},
			},
			description:
				"List the non-deleted custom providers in the master key's organization.",
		},
	},
});

v1Master.openapi(listCustomProviders, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const providerKeys = await db.query.providerKey.findMany({
		where: {
			organizationId: { eq: masterKey.organizationId },
			provider: { eq: "custom" },
			status: { ne: "deleted" },
		},
		orderBy: { createdAt: "asc" },
	});

	return c.json({ customProviders: providerKeys.map(toPublicProviderKey) });
});

const getCustomProvider = createRoute({
	method: "get",
	path: "/custom-providers/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						customProvider: providerKeyPublicSchema.openapi({}),
					}),
				},
			},
			description: "Get a single custom provider via master key.",
		},
	},
});

v1Master.openapi(getCustomProvider, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const providerKey = await loadCustomProviderKeyForOrg(
		id,
		masterKey.organizationId,
	);

	return c.json({ customProvider: toPublicProviderKey(providerKey) });
});

const updateCustomProvider = createRoute({
	method: "patch",
	path: "/custom-providers/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateCustomProviderBody,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						customProvider: providerKeyPublicSchema.openapi({}),
					}),
				},
			},
			description: "Custom provider updated successfully via master key.",
		},
	},
});

v1Master.openapi(updateCustomProvider, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const { baseUrl, token, status, customModelsOnly, complianceAttestation } =
		c.req.valid("json");

	const existing = await loadCustomProviderKeyForOrg(
		id,
		masterKey.organizationId,
	);

	if (baseUrl !== undefined) {
		await assertProviderBaseUrlAllowed(baseUrl);
	}

	const updates: Partial<typeof tables.providerKey.$inferInsert> = {};
	if (baseUrl !== undefined) {
		updates.baseUrl = baseUrl;
	}
	if (token !== undefined) {
		updates.token = null;
		updates.tokenCiphertext = encryptProviderKey(
			token,
			existing.id,
			masterKey.organizationId,
		);
		updates.tokenMasked = maskToken(token);
		updates.tokenHash = getApiKeyFingerprint(token);
	}
	if (status !== undefined) {
		updates.status = status;
	}
	if (customModelsOnly !== undefined) {
		updates.customModelsOnly = customModelsOnly;
	}
	if (complianceAttestation !== undefined) {
		updates.complianceAttestation = stampComplianceAttestation(
			complianceAttestation,
			masterKey.createdBy,
		);
	}

	const [updated] = await cdb
		.update(tables.providerKey)
		.set(updates)
		.where(eq(tables.providerKey.id, id))
		.returning();

	const changes: Record<string, { old: unknown; new: unknown }> = {};
	if (baseUrl !== undefined && existing.baseUrl !== baseUrl) {
		changes.baseUrl = { old: existing.baseUrl, new: baseUrl };
	}
	// The token itself is never written to the audit log, only the fact it
	// rotated. Compare via readProviderKey: the plaintext column is NULL for
	// encrypted rows, so a raw column comparison would log every no-op
	// resubmission of the same token as a rotation.
	if (token !== undefined && readProviderKey(existing) !== token) {
		changes.token = { old: "<redacted>", new: "<rotated>" };
	}
	if (status !== undefined && existing.status !== status) {
		changes.status = { old: existing.status, new: status };
	}
	if (
		customModelsOnly !== undefined &&
		existing.customModelsOnly !== customModelsOnly
	) {
		changes.customModelsOnly = {
			old: existing.customModelsOnly,
			new: customModelsOnly,
		};
	}
	if (complianceAttestation !== undefined) {
		changes.complianceAttestation = {
			old: existing.complianceAttestation ?? null,
			new: updates.complianceAttestation ?? null,
		};
	}

	if (Object.keys(changes).length > 0) {
		await logAuditEvent({
			organizationId: masterKey.organizationId,
			userId: masterKey.createdBy,
			action: "provider_key.update",
			resourceType: "provider_key",
			resourceId: id,
			metadata: {
				provider: "custom",
				resourceName: existing.name ?? undefined,
				changes,
			},
		});
	}

	return c.json({ customProvider: toPublicProviderKey(updated) });
});

const deleteCustomProvider = createRoute({
	method: "delete",
	path: "/custom-providers/{id}",
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
			description: "Custom provider deleted successfully via master key.",
		},
	},
});

v1Master.openapi(deleteCustomProvider, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const existing = await loadCustomProviderKeyForOrg(
		id,
		masterKey.organizationId,
	);

	await cdb
		.update(tables.providerKey)
		.set({ status: "deleted" })
		.where(eq(tables.providerKey.id, id));

	await logAuditEvent({
		organizationId: masterKey.organizationId,
		userId: masterKey.createdBy,
		action: "provider_key.delete",
		resourceType: "provider_key",
		resourceId: id,
		metadata: { provider: "custom", resourceName: existing.name ?? undefined },
	});

	return c.json({ message: "Custom provider deleted successfully" });
});

const createCustomModel = createRoute({
	method: "post",
	path: "/custom-models",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createCustomModelSchema,
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ customModel: customModelSchema.openapi({}) }),
				},
			},
			description: "Custom model created successfully via master key.",
		},
	},
});

v1Master.openapi(createCustomModel, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { providerKeyId, ...fields } = c.req.valid("json");

	const providerKey = await loadCustomProviderKeyForOrg(
		providerKeyId,
		masterKey.organizationId,
	);

	const customModel = await insertCustomModel(
		providerKey,
		masterKey.createdBy,
		fields,
	);

	return c.json({ customModel }, 201);
});

const listCustomModels = createRoute({
	method: "get",
	path: "/custom-models",
	request: {
		query: z.object({
			providerKeyId: z.string().min(1).optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						customModels: z.array(customModelSchema).openapi({}),
					}),
				},
			},
			description:
				"List the custom models in the master key's organization, with their context window, limits and per-token pricing. Optionally filter by providerKeyId.",
		},
	},
});

v1Master.openapi(listCustomModels, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { providerKeyId } = c.req.valid("query");

	if (providerKeyId) {
		await loadCustomProviderKeyForOrg(providerKeyId, masterKey.organizationId);
	}

	const customModels = await db.query.customModel.findMany({
		where: {
			organizationId: { eq: masterKey.organizationId },
			status: { ne: "deleted" },
			...(providerKeyId ? { providerKeyId: { eq: providerKeyId } } : {}),
		},
		orderBy: { createdAt: "asc" },
	});

	return c.json({ customModels });
});

const getCustomModel = createRoute({
	method: "get",
	path: "/custom-models/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ customModel: customModelSchema.openapi({}) }),
				},
			},
			description: "Get a single custom model via master key.",
		},
	},
});

v1Master.openapi(getCustomModel, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const customModel = await loadCustomModelForOrg(id, masterKey.organizationId);

	return c.json({ customModel });
});

const updateCustomModel = createRoute({
	method: "patch",
	path: "/custom-models/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: updateCustomModelSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ customModel: customModelSchema.openapi({}) }),
				},
			},
			description: "Custom model updated successfully via master key.",
		},
	},
});

v1Master.openapi(updateCustomModel, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();
	const fields = c.req.valid("json");

	const existing = await loadCustomModelForOrg(id, masterKey.organizationId);

	const customModel = await applyCustomModelUpdate(
		existing,
		masterKey.createdBy,
		fields,
	);

	return c.json({ customModel });
});

const deleteCustomModel = createRoute({
	method: "delete",
	path: "/custom-models/{id}",
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
			description: "Custom model deleted successfully via master key.",
		},
	},
});

v1Master.openapi(deleteCustomModel, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { id } = c.req.param();

	const existing = await loadCustomModelForOrg(id, masterKey.organizationId);

	await softDeleteCustomModel(existing, masterKey.createdBy);

	return c.json({ message: "Custom model deleted successfully" });
});

// Hourly buckets over a long window explode the row count (a year is ~8800
// buckets before any dimension fan-out), so hourly granularity gets a much
// tighter cap than the daily one.
const MAX_HOURLY_USAGE_RANGE_DAYS = 31;

const usageQuery = z.object({
	from: z.string().optional(),
	to: z.string().optional(),
	timezone: timezoneQueryField,
	granularity: z.enum(USAGE_GRANULARITIES).optional(),
	groupBy: z.string().optional(),
	projectId: z.string().min(1).optional(),
	userId: z.string().min(1).optional(),
	apiKeyId: z.string().min(1).optional(),
	limit: z.coerce.number().int().min(1).max(10000).optional(),
	offset: z.coerce.number().int().min(0).optional(),
	format: z.enum(["json", "csv"]).optional(),
});

const usageResponseSchema = z.object({
	from: z.string(),
	to: z.string(),
	granularity: z.enum(USAGE_GRANULARITIES),
	groupBy: z.array(z.enum(USAGE_DIMENSIONS)),
	rows: z.array(usageReportRowSchema),
	pagination: z.object({
		limit: z.number(),
		offset: z.number(),
		hasMore: z.boolean(),
	}),
});

function parseGroupBy(raw: string | undefined): UsageDimension[] {
	if (raw === undefined) {
		return ["user", "model"];
	}
	const seen = new Set<UsageDimension>();
	for (const part of raw.split(",")) {
		const value = part.trim();
		if (!value) {
			continue;
		}
		if (!(USAGE_DIMENSIONS as readonly string[]).includes(value)) {
			throw new HTTPException(400, {
				message: `Invalid groupBy dimension "${value}" (expected any of: ${USAGE_DIMENSIONS.join(", ")})`,
			});
		}
		seen.add(value as UsageDimension);
	}
	return Array.from(seen);
}

const getUsage = createRoute({
	method: "get",
	path: "/usage",
	request: {
		query: usageQuery,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: usageResponseSchema.openapi({}),
				},
				"text/csv": {
					schema: z.any().openapi({ type: "string" }),
				},
			},
			description:
				"Usage and cost for the master key's organization, grouped by any combination of user, model, provider, project and API key, bucketed hourly, daily or not at all. Returns JSON, or CSV when format=csv.",
		},
	},
});

v1Master.openapi(getUsage, async (c) => {
	const masterKey = c.get("masterKey");
	if (!masterKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const query = c.req.valid("query");
	const timeZone = query.timezone || "UTC";
	const granularity = query.granularity ?? "day";
	const dimensions = parseGroupBy(query.groupBy);
	const limit = query.limit ?? 1000;
	const offset = query.offset ?? 0;

	const { startDate, endDate, fromStr, toStr } = resolveDateRange(
		query.from,
		query.to,
		timeZone,
	);

	const rangeDays = rangeDaysInclusive(fromStr, toStr);
	if (rangeDays > MAX_ORG_ACTIVITY_RANGE_DAYS) {
		throw new HTTPException(400, {
			message: `Date range too large (max ${MAX_ORG_ACTIVITY_RANGE_DAYS} days)`,
		});
	}
	if (granularity === "hour" && rangeDays > MAX_HOURLY_USAGE_RANGE_DAYS) {
		throw new HTTPException(400, {
			message: `Date range too large for hourly granularity (max ${MAX_HOURLY_USAGE_RANGE_DAYS} days)`,
		});
	}

	const orgProjectIds = await getOrgProjectIds(masterKey.organizationId);
	if (query.projectId && !orgProjectIds.includes(query.projectId)) {
		throw new HTTPException(404, {
			message: "Project not found in this organization",
		});
	}

	const { rows, hasMore } = await getUsageReport({
		projectIds: query.projectId ? [query.projectId] : orgProjectIds,
		startDate,
		endDate,
		timeZone,
		granularity,
		dimensions,
		userId: query.userId,
		apiKeyId: query.apiKeyId,
		limit,
		offset,
	});

	if (query.format === "csv") {
		c.header("Content-Type", "text/csv; charset=utf-8");
		c.header(
			"Content-Disposition",
			`attachment; filename="usage-${fromStr}-to-${toStr}.csv"`,
		);
		return c.body(usageReportToCsv(rows));
	}

	return c.json({
		from: fromStr,
		to: toStr,
		granularity,
		groupBy: dimensions,
		rows,
		pagination: { limit, offset, hasMore },
	});
});

export default v1Master;
