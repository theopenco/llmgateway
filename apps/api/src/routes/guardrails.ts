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
	guardrailActionsTaken,
	customRuleTypes,
	defaultSystemRulesConfig,
	defaultAllowedFileTypes,
} from "@llmgateway/db";
import { checkGuardrails } from "@llmgateway/guardrails";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";

import type { ServerTypes } from "@/vars.js";
import type {
	SystemRulesConfig,
	GuardrailAction,
	CustomRuleConfig,
} from "@llmgateway/db";

export const guardrails = new OpenAPIHono<ServerTypes>();

/**
 * The scope a guardrail request operates on: the organization-level config
 * (`projectId: null`) or a single project's override.
 */
interface GuardrailScopeContext {
	organizationId: string;
	projectId: string | null;
}

// Helper to check enterprise access
async function checkEnterpriseAccess(
	userId: string,
	organizationId: string,
): Promise<{
	userOrg: { role: string; organization: { plan: string } | null };
}> {
	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
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

	if (userOrg.role !== "owner" && userOrg.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only owners and admins can manage guardrails",
		});
	}

	if (
		!hasOrganizationEnterpriseAccess(
			userOrg.organization?.id,
			userOrg.organization?.plan,
		)
	) {
		throw new HTTPException(403, {
			message: "Guardrails require an enterprise plan",
		});
	}

	return { userOrg };
}

async function requireOrgScope(
	userId: string,
	organizationId: string,
): Promise<GuardrailScopeContext> {
	await checkEnterpriseAccess(userId, organizationId);
	return { organizationId, projectId: null };
}

/**
 * Project guardrails are administered by the project's owners and admins.
 * Roles are organization-level, so this reuses the organization check against
 * the project's owning organization — project-scoped "developer" members are
 * excluded there.
 */
async function requireProjectScope(
	userId: string,
	projectId: string,
): Promise<GuardrailScopeContext> {
	const project = await db.query.project.findFirst({
		where: { id: { eq: projectId } },
	});

	if (!project || project.status === "deleted") {
		throw new HTTPException(404, { message: "Project not found" });
	}

	await checkEnterpriseAccess(userId, project.organizationId);

	return { organizationId: project.organizationId, projectId };
}

function findScopedConfig(scope: GuardrailScopeContext) {
	return db.query.guardrailConfig.findFirst({
		where: scope.projectId
			? { projectId: { eq: scope.projectId } }
			: {
					organizationId: { eq: scope.organizationId },
					projectId: { isNull: true },
				},
	});
}

function findScopedRules(scope: GuardrailScopeContext) {
	return db.query.guardrailRule.findMany({
		where: scope.projectId
			? { projectId: { eq: scope.projectId } }
			: {
					organizationId: { eq: scope.organizationId },
					projectId: { isNull: true },
				},
		orderBy: { priority: "desc" },
	});
}

// Schemas
const systemRuleConfigSchema = z.object({
	enabled: z.boolean(),
	action: z.enum(["block", "redact", "warn", "allow"]),
});

const systemRulesConfigSchema = z.object({
	prompt_injection: systemRuleConfigSchema,
	jailbreak: systemRuleConfigSchema,
	pii_detection: systemRuleConfigSchema,
	secrets: systemRuleConfigSchema,
	file_types: systemRuleConfigSchema,
	document_leakage: systemRuleConfigSchema,
});

const guardrailConfigSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	projectId: z.string().nullable(),
	inheritOrganization: z.boolean(),
	enabled: z.boolean(),
	systemRules: systemRulesConfigSchema.nullable(),
	maxFileSizeMb: z.number(),
	allowedFileTypes: z.array(z.string()),
	piiAction: z.enum(["block", "redact", "warn", "allow"]).nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const blockedTermsConfigSchema = z.object({
	type: z.literal("blocked_terms"),
	terms: z.array(z.string()),
	matchType: z.enum(["exact", "contains", "regex"]),
	caseSensitive: z.boolean(),
});

const customRegexConfigSchema = z.object({
	type: z.literal("custom_regex"),
	pattern: z.string(),
});

const topicRestrictionConfigSchema = z.object({
	type: z.literal("topic_restriction"),
	blockedTopics: z.array(z.string()),
	allowedTopics: z.array(z.string()).optional(),
});

const customRuleConfigSchema = z.union([
	blockedTermsConfigSchema,
	customRegexConfigSchema,
	topicRestrictionConfigSchema,
]);

const guardrailRuleSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	projectId: z.string().nullable(),
	name: z.string(),
	type: z.enum(customRuleTypes),
	config: customRuleConfigSchema,
	priority: z.number(),
	enabled: z.boolean(),
	action: z.enum(["block", "redact", "warn", "allow"]),
	createdAt: z.date(),
	updatedAt: z.date(),
});

const violationSchema = z.object({
	id: z.string(),
	organizationId: z.string(),
	logId: z.string().nullable(),
	ruleId: z.string(),
	ruleName: z.string(),
	category: z.string(),
	actionTaken: z.enum(guardrailActionsTaken),
	matchedPattern: z.string().nullable(),
	matchedContent: z.string().nullable(),
	contentHash: z.string().nullable(),
	apiKeyId: z.string().nullable(),
	model: z.string().nullable(),
	createdAt: z.date(),
});

// GET /guardrails/config/:organizationId - Get config
const getConfig = createRoute({
	method: "get",
	path: "/config/{organizationId}",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailConfigSchema.nullable(),
				},
			},
			description: "Guardrail configuration",
		},
	},
});

guardrails.openapi(getConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	const scope = await requireOrgScope(user.id, organizationId);

	return c.json((await findScopedConfig(scope)) ?? null);
});

// GET /guardrails/projects/:projectId/config - Get project config
const getProjectConfig = createRoute({
	method: "get",
	path: "/projects/{projectId}/config",
	request: {
		params: z.object({
			projectId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailConfigSchema.nullable(),
				},
			},
			description: "Project guardrail configuration",
		},
	},
});

guardrails.openapi(getProjectConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId } = c.req.param();
	const scope = await requireProjectScope(user.id, projectId);

	return c.json((await findScopedConfig(scope)) ?? null);
});

const updateConfigBodySchema = z.object({
	enabled: z.boolean().optional(),
	systemRules: systemRulesConfigSchema.optional(),
	maxFileSizeMb: z.number().optional(),
	allowedFileTypes: z.array(z.string()).optional(),
	piiAction: z.enum(["block", "redact", "warn", "allow"]).optional(),
});

// `inheritOrganization` only exists on project rows: while true the project
// falls back to the organization config, which is the default for new projects.
const updateProjectConfigBodySchema = updateConfigBodySchema.extend({
	inheritOrganization: z.boolean().optional(),
});

async function upsertScopedConfig(
	scope: GuardrailScopeContext,
	body: z.infer<typeof updateProjectConfigBodySchema>,
) {
	const existing = await findScopedConfig(scope);

	if (existing) {
		const [updated] = await db
			.update(tables.guardrailConfig)
			.set({
				inheritOrganization:
					body.inheritOrganization ?? existing.inheritOrganization,
				enabled: body.enabled ?? existing.enabled,
				systemRules:
					(body.systemRules as SystemRulesConfig) ?? existing.systemRules,
				maxFileSizeMb: body.maxFileSizeMb ?? existing.maxFileSizeMb,
				allowedFileTypes: body.allowedFileTypes ?? existing.allowedFileTypes,
				piiAction: (body.piiAction as GuardrailAction) ?? existing.piiAction,
			})
			.where(eq(tables.guardrailConfig.id, existing.id))
			.returning();
		return updated;
	}

	const [created] = await db
		.insert(tables.guardrailConfig)
		.values({
			organizationId: scope.organizationId,
			projectId: scope.projectId,
			inheritOrganization: body.inheritOrganization ?? true,
			enabled: body.enabled ?? true,
			systemRules:
				(body.systemRules as SystemRulesConfig) ?? defaultSystemRulesConfig,
			maxFileSizeMb: body.maxFileSizeMb ?? 10,
			allowedFileTypes: body.allowedFileTypes ?? defaultAllowedFileTypes,
			piiAction: (body.piiAction as GuardrailAction) ?? "redact",
		})
		.returning();

	return created;
}

const guardrailConfigDefaults = {
	inheritOrganization: true,
	enabled: true,
	systemRules: defaultSystemRulesConfig,
	maxFileSizeMb: 10,
	allowedFileTypes: defaultAllowedFileTypes,
	piiAction: "redact" as GuardrailAction,
};

async function resetScopedConfig(scope: GuardrailScopeContext) {
	const existing = await findScopedConfig(scope);

	// Update in place rather than delete-then-insert: the gap between the two
	// statements would leave the scope with no config at all, which the gateway
	// reads as "no guardrails", and concurrent resets would race the partial
	// unique index.
	if (existing) {
		const [updated] = await db
			.update(tables.guardrailConfig)
			.set(guardrailConfigDefaults)
			.where(eq(tables.guardrailConfig.id, existing.id))
			.returning();
		return updated;
	}

	const [created] = await db
		.insert(tables.guardrailConfig)
		.values({
			organizationId: scope.organizationId,
			projectId: scope.projectId,
			...guardrailConfigDefaults,
		})
		.returning();

	return created;
}

// PUT /guardrails/config/:organizationId - Update or create config
const updateConfig = createRoute({
	method: "put",
	path: "/config/{organizationId}",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateConfigBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailConfigSchema,
				},
			},
			description: "Updated guardrail configuration",
		},
	},
});

guardrails.openapi(updateConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	const scope = await requireOrgScope(user.id, organizationId);

	return c.json(await upsertScopedConfig(scope, c.req.valid("json")));
});

// GET /guardrails/config/:organizationId/project-overrides - Projects that
// have opted out of the organization config
const listProjectOverrides = createRoute({
	method: "get",
	path: "/config/{organizationId}/project-overrides",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						projects: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								enabled: z.boolean(),
							}),
						),
					}),
				},
			},
			description: "Projects overriding the organization guardrails",
		},
	},
});

guardrails.openapi(listProjectOverrides, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	await requireOrgScope(user.id, organizationId);

	const configs = await db.query.guardrailConfig.findMany({
		where: {
			organizationId: { eq: organizationId },
			projectId: { isNotNull: true },
			inheritOrganization: { eq: false },
		},
		with: { project: true },
	});

	return c.json({
		projects: configs
			.filter((config) => config.project?.status !== "deleted")
			.map((config) => ({
				id: config.projectId!,
				name: config.project?.name ?? "Unknown project",
				enabled: config.enabled,
			})),
	});
});

// PUT /guardrails/projects/:projectId/config - Update or create project config
const updateProjectConfig = createRoute({
	method: "put",
	path: "/projects/{projectId}/config",
	request: {
		params: z.object({
			projectId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateProjectConfigBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailConfigSchema,
				},
			},
			description: "Updated project guardrail configuration",
		},
	},
});

guardrails.openapi(updateProjectConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId } = c.req.param();
	const scope = await requireProjectScope(user.id, projectId);

	return c.json(await upsertScopedConfig(scope, c.req.valid("json")));
});

// POST /guardrails/config/:organizationId/reset - Reset to defaults
const resetConfig = createRoute({
	method: "post",
	path: "/config/{organizationId}/reset",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailConfigSchema,
				},
			},
			description: "Reset guardrail configuration",
		},
	},
});

guardrails.openapi(resetConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	const scope = await requireOrgScope(user.id, organizationId);

	return c.json(await resetScopedConfig(scope));
});

// POST /guardrails/projects/:projectId/config/reset - Reset project to defaults
const resetProjectConfig = createRoute({
	method: "post",
	path: "/projects/{projectId}/config/reset",
	request: {
		params: z.object({
			projectId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailConfigSchema,
				},
			},
			description: "Reset project guardrail configuration",
		},
	},
});

guardrails.openapi(resetProjectConfig, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId } = c.req.param();
	const scope = await requireProjectScope(user.id, projectId);

	return c.json(await resetScopedConfig(scope));
});

// GET /guardrails/rules/:organizationId - List custom rules
const listRules = createRoute({
	method: "get",
	path: "/rules/{organizationId}",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						rules: z.array(guardrailRuleSchema),
					}),
				},
			},
			description: "List of custom guardrail rules",
		},
	},
});

guardrails.openapi(listRules, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	const scope = await requireOrgScope(user.id, organizationId);

	return c.json({ rules: await findScopedRules(scope) });
});

// GET /guardrails/projects/:projectId/rules - List project custom rules
const listProjectRules = createRoute({
	method: "get",
	path: "/projects/{projectId}/rules",
	request: {
		params: z.object({
			projectId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						rules: z.array(guardrailRuleSchema),
					}),
				},
			},
			description: "List of project custom guardrail rules",
		},
	},
});

guardrails.openapi(listProjectRules, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId } = c.req.param();
	const scope = await requireProjectScope(user.id, projectId);

	return c.json({ rules: await findScopedRules(scope) });
});

const createRuleBodySchema = z.object({
	name: z.string(),
	type: z.enum(customRuleTypes),
	config: customRuleConfigSchema,
	priority: z.number().optional(),
	enabled: z.boolean().optional(),
	action: z.enum(["block", "redact", "warn", "allow"]).optional(),
});

async function createScopedRule(
	scope: GuardrailScopeContext,
	body: z.infer<typeof createRuleBodySchema>,
) {
	const [created] = await db
		.insert(tables.guardrailRule)
		.values({
			organizationId: scope.organizationId,
			projectId: scope.projectId,
			name: body.name,
			type: body.type,
			config: body.config as CustomRuleConfig,
			priority: body.priority ?? 100,
			enabled: body.enabled ?? true,
			action: (body.action as GuardrailAction) ?? "block",
		})
		.returning();

	return created;
}

// POST /guardrails/rules/:organizationId - Create custom rule
const createRule = createRoute({
	method: "post",
	path: "/rules/{organizationId}",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createRuleBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailRuleSchema,
				},
			},
			description: "Created custom rule",
		},
	},
});

guardrails.openapi(createRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	const scope = await requireOrgScope(user.id, organizationId);

	return c.json(await createScopedRule(scope, c.req.valid("json")));
});

// POST /guardrails/projects/:projectId/rules - Create project custom rule
const createProjectRule = createRoute({
	method: "post",
	path: "/projects/{projectId}/rules",
	request: {
		params: z.object({
			projectId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: createRuleBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailRuleSchema,
				},
			},
			description: "Created project custom rule",
		},
	},
});

guardrails.openapi(createProjectRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId } = c.req.param();
	const scope = await requireProjectScope(user.id, projectId);

	return c.json(await createScopedRule(scope, c.req.valid("json")));
});

const updateRuleBodySchema = z.object({
	name: z.string().optional(),
	config: customRuleConfigSchema.optional(),
	priority: z.number().optional(),
	enabled: z.boolean().optional(),
	action: z.enum(["block", "redact", "warn", "allow"]).optional(),
});

/**
 * Look up a rule within its scope so an organization rule can never be edited
 * or deleted through a project route, and vice versa.
 */
async function findScopedRule(scope: GuardrailScopeContext, ruleId: string) {
	const existing = await db.query.guardrailRule.findFirst({
		where: scope.projectId
			? { id: { eq: ruleId }, projectId: { eq: scope.projectId } }
			: {
					id: { eq: ruleId },
					organizationId: { eq: scope.organizationId },
					projectId: { isNull: true },
				},
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Rule not found" });
	}

	return existing;
}

async function updateScopedRule(
	scope: GuardrailScopeContext,
	ruleId: string,
	body: z.infer<typeof updateRuleBodySchema>,
) {
	const existing = await findScopedRule(scope, ruleId);

	const [updated] = await db
		.update(tables.guardrailRule)
		.set({
			name: body.name ?? existing.name,
			config: (body.config as CustomRuleConfig) ?? existing.config,
			priority: body.priority ?? existing.priority,
			enabled: body.enabled ?? existing.enabled,
			action: (body.action as GuardrailAction) ?? existing.action,
		})
		.where(eq(tables.guardrailRule.id, existing.id))
		.returning();

	return updated;
}

async function deleteScopedRule(scope: GuardrailScopeContext, ruleId: string) {
	const existing = await findScopedRule(scope, ruleId);

	await db
		.delete(tables.guardrailRule)
		.where(eq(tables.guardrailRule.id, existing.id));
}

// PATCH /guardrails/rules/:organizationId/:ruleId - Update custom rule
const updateRule = createRoute({
	method: "patch",
	path: "/rules/{organizationId}/{ruleId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			ruleId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateRuleBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailRuleSchema,
				},
			},
			description: "Updated custom rule",
		},
	},
});

guardrails.openapi(updateRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId, ruleId } = c.req.param();
	const scope = await requireOrgScope(user.id, organizationId);

	return c.json(await updateScopedRule(scope, ruleId, c.req.valid("json")));
});

// PATCH /guardrails/projects/:projectId/rules/:ruleId - Update project rule
const updateProjectRule = createRoute({
	method: "patch",
	path: "/projects/{projectId}/rules/{ruleId}",
	request: {
		params: z.object({
			projectId: z.string(),
			ruleId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: updateRuleBodySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: guardrailRuleSchema,
				},
			},
			description: "Updated project custom rule",
		},
	},
});

guardrails.openapi(updateProjectRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId, ruleId } = c.req.param();
	const scope = await requireProjectScope(user.id, projectId);

	return c.json(await updateScopedRule(scope, ruleId, c.req.valid("json")));
});

// DELETE /guardrails/rules/:organizationId/:ruleId - Delete custom rule
const deleteRule = createRoute({
	method: "delete",
	path: "/rules/{organizationId}/{ruleId}",
	request: {
		params: z.object({
			organizationId: z.string(),
			ruleId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Rule deleted",
		},
	},
});

guardrails.openapi(deleteRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId, ruleId } = c.req.param();
	const scope = await requireOrgScope(user.id, organizationId);
	await deleteScopedRule(scope, ruleId);

	return c.json({ success: true });
});

// DELETE /guardrails/projects/:projectId/rules/:ruleId - Delete project rule
const deleteProjectRule = createRoute({
	method: "delete",
	path: "/projects/{projectId}/rules/{ruleId}",
	request: {
		params: z.object({
			projectId: z.string(),
			ruleId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Project rule deleted",
		},
	},
});

guardrails.openapi(deleteProjectRule, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId, ruleId } = c.req.param();
	const scope = await requireProjectScope(user.id, projectId);
	await deleteScopedRule(scope, ruleId);

	return c.json({ success: true });
});

// GET /guardrails/violations/:organizationId - List violations
const listViolations = createRoute({
	method: "get",
	path: "/violations/{organizationId}",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
		query: z.object({
			cursor: z.string().optional(),
			limit: z
				.string()
				.optional()
				.transform((val) => (val ? parseInt(val, 10) : undefined))
				.pipe(z.number().int().min(1).max(100).optional()),
			startDate: z.string().datetime({ offset: true }).optional(),
			endDate: z.string().datetime({ offset: true }).optional(),
			actionTaken: z.string().optional(),
			category: z.string().optional(),
			ruleId: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						violations: z.array(violationSchema),
						pagination: z.object({
							nextCursor: z.string().nullable(),
							hasMore: z.boolean(),
							limit: z.number(),
						}),
					}),
				},
			},
			description: "List of guardrail violations",
		},
	},
});

guardrails.openapi(listViolations, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	await checkEnterpriseAccess(user.id, organizationId);

	const query = c.req.valid("query");
	const {
		cursor,
		limit: queryLimit,
		startDate,
		endDate,
		actionTaken,
		category,
		ruleId,
	} = query;

	const limit = queryLimit ? Math.min(queryLimit, 100) : 50;

	const whereConditions = [
		eq(tables.guardrailViolation.organizationId, organizationId),
	];

	if (startDate) {
		whereConditions.push(
			gte(tables.guardrailViolation.createdAt, new Date(startDate)),
		);
	}
	if (endDate) {
		whereConditions.push(
			lte(tables.guardrailViolation.createdAt, new Date(endDate)),
		);
	}
	if (
		actionTaken &&
		guardrailActionsTaken.includes(
			actionTaken as (typeof guardrailActionsTaken)[number],
		)
	) {
		whereConditions.push(
			eq(
				tables.guardrailViolation.actionTaken,
				actionTaken as (typeof guardrailActionsTaken)[number],
			),
		);
	}
	if (category) {
		whereConditions.push(eq(tables.guardrailViolation.category, category));
	}
	if (ruleId) {
		whereConditions.push(eq(tables.guardrailViolation.ruleId, ruleId));
	}

	if (cursor) {
		const cursorViolation = await db.query.guardrailViolation.findFirst({
			where: { id: { eq: cursor } },
		});
		if (cursorViolation) {
			whereConditions.push(
				lt(tables.guardrailViolation.createdAt, cursorViolation.createdAt),
			);
		}
	}

	const violations = await db
		.select()
		.from(tables.guardrailViolation)
		.where(and(...whereConditions))
		.orderBy(desc(tables.guardrailViolation.createdAt))
		.limit(limit + 1);

	const hasMore = violations.length > limit;
	const paginatedViolations = hasMore ? violations.slice(0, limit) : violations;
	const nextCursor =
		hasMore && paginatedViolations.length > 0
			? paginatedViolations[paginatedViolations.length - 1].id
			: null;

	return c.json({
		violations: paginatedViolations,
		pagination: {
			nextCursor,
			hasMore,
			limit,
		},
	});
});

// GET /guardrails/stats/:organizationId - Get violation statistics
const getStats = createRoute({
	method: "get",
	path: "/stats/{organizationId}",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
		query: z.object({
			days: z
				.string()
				.optional()
				.transform((val) => (val ? parseInt(val, 10) : 7))
				.pipe(z.number().int().min(1).max(90)),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						totalViolations: z.number(),
						last24Hours: z.number(),
						last7Days: z.number(),
						byAction: z.object({
							blocked: z.number(),
							redacted: z.number(),
							warned: z.number(),
						}),
						byCategory: z.record(z.string(), z.number()),
					}),
				},
			},
			description: "Violation statistics",
		},
	},
});

guardrails.openapi(getStats, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	await checkEnterpriseAccess(user.id, organizationId);

	const { days } = c.req.valid("query");
	const windowStart = new Date();
	windowStart.setDate(windowStart.getDate() - days);

	const violations = await db.query.guardrailViolation.findMany({
		where: {
			organizationId: { eq: organizationId },
			createdAt: { gte: windowStart },
		},
		columns: { actionTaken: true, category: true, createdAt: true },
	});

	const now = Date.now();
	const dayMs = 24 * 60 * 60 * 1000;
	const weekMs = 7 * dayMs;
	const last24HoursStart = now - dayMs;
	const last7DaysStart = now - weekMs;

	const stats = {
		totalViolations: violations.length,
		last24Hours: 0,
		last7Days: 0,
		byAction: {
			blocked: 0,
			redacted: 0,
			warned: 0,
		},
		byCategory: {} as Record<string, number>,
	};

	for (const v of violations) {
		const createdAtMs = v.createdAt.getTime();
		if (createdAtMs >= last24HoursStart) {
			stats.last24Hours++;
		}
		if (createdAtMs >= last7DaysStart) {
			stats.last7Days++;
		}

		if (v.actionTaken === "blocked") {
			stats.byAction.blocked++;
		} else if (v.actionTaken === "redacted") {
			stats.byAction.redacted++;
		} else if (v.actionTaken === "warned") {
			stats.byAction.warned++;
		}

		stats.byCategory[v.category] = (stats.byCategory[v.category] ?? 0) + 1;
	}

	return c.json(stats);
});

// POST /guardrails/test/:organizationId - Test content against rules
const testContent = createRoute({
	method: "post",
	path: "/test/{organizationId}",
	request: {
		params: z.object({
			organizationId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						content: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						passed: z.boolean(),
						blocked: z.boolean(),
						violations: z.array(
							z.object({
								ruleId: z.string(),
								ruleName: z.string(),
								category: z.string(),
								action: z.enum(["block", "redact", "warn", "allow"]),
								matchedPattern: z.string().optional(),
								matchedContent: z.string().optional(),
							}),
						),
						rulesChecked: z.number(),
					}),
				},
			},
			description: "Test result",
		},
	},
});

guardrails.openapi(testContent, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId } = c.req.param();
	await requireOrgScope(user.id, organizationId);

	const { content } = c.req.valid("json");

	const result = await checkGuardrails({
		organizationId,
		messages: [{ role: "user", content }],
	});

	return c.json({
		passed: result.passed,
		blocked: result.blocked,
		violations: result.violations,
		rulesChecked: result.rulesChecked,
	});
});

// POST /guardrails/projects/:projectId/test - Test content against project rules
const testProjectContent = createRoute({
	method: "post",
	path: "/projects/{projectId}/test",
	request: {
		params: z.object({
			projectId: z.string(),
		}),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						content: z.string(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						passed: z.boolean(),
						blocked: z.boolean(),
						violations: z.array(
							z.object({
								ruleId: z.string(),
								ruleName: z.string(),
								category: z.string(),
								action: z.enum(["block", "redact", "warn", "allow"]),
								matchedPattern: z.string().optional(),
								matchedContent: z.string().optional(),
							}),
						),
						rulesChecked: z.number(),
					}),
				},
			},
			description: "Test result",
		},
	},
});

guardrails.openapi(testProjectContent, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { projectId } = c.req.param();
	const scope = await requireProjectScope(user.id, projectId);

	const { content } = c.req.valid("json");

	const result = await checkGuardrails({
		organizationId: scope.organizationId,
		projectId,
		messages: [{ role: "user", content }],
	});

	return c.json({
		passed: result.passed,
		blocked: result.blocked,
		violations: result.violations,
		rulesChecked: result.rulesChecked,
	});
});

// GET /guardrails/system-rules - List all system rules with defaults
const listSystemRules = createRoute({
	method: "get",
	path: "/system-rules",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						rules: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								category: z.string(),
								defaultEnabled: z.boolean(),
								defaultAction: z.enum(["block", "redact", "warn", "allow"]),
							}),
						),
					}),
				},
			},
			description: "List of system rules",
		},
	},
});

guardrails.openapi(listSystemRules, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	// Return the system rules info
	const rules = [
		{
			id: "system:prompt_injection",
			name: "Prompt Injection Detection",
			category: "injection",
			defaultEnabled: true,
			defaultAction: "block" as const,
		},
		{
			id: "system:jailbreak",
			name: "Jailbreak Prevention",
			category: "jailbreak",
			defaultEnabled: true,
			defaultAction: "block" as const,
		},
		{
			id: "system:pii_detection",
			name: "PII Detection",
			category: "pii",
			defaultEnabled: true,
			defaultAction: "redact" as const,
		},
		{
			id: "system:secrets",
			name: "Secrets Detection",
			category: "secrets",
			defaultEnabled: true,
			defaultAction: "block" as const,
		},
		{
			id: "system:file_types",
			name: "File Type Restrictions",
			category: "files",
			defaultEnabled: true,
			defaultAction: "block" as const,
		},
		{
			id: "system:document_leakage",
			name: "Document Leakage Prevention",
			category: "document_leakage",
			defaultEnabled: false,
			defaultAction: "warn" as const,
		},
	];

	return c.json({ rules });
});
