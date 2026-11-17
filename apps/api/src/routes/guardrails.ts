import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { userHasProjectAccess } from "@/utils/authorization.js";
import { createRoute } from "@/utils/create-route.js";

import {
	and,
	db,
	desc,
	eq,
	gte,
	isNull,
	lt,
	lte,
	tables,
	guardrailActionsTaken,
	customRuleTypes,
	defaultSystemRulesConfig,
	defaultAllowedFileTypes,
	defaultGuardrailClassifierModel,
	piiEntities,
	withDefaultSystemRules,
} from "@llmgateway/db";
import {
	checkGuardrails,
	presetTopics,
	systemRuleCatalog,
} from "@llmgateway/guardrails";
import { isDecisionModelRef } from "@llmgateway/models";
import { hasOrganizationEnterpriseAccess } from "@llmgateway/shared/enterprise-license";
import {
	canManageProject,
	isOrganizationAdmin,
} from "@llmgateway/shared/organization-roles";

import type { ServerTypes } from "@/vars.js";
import type {
	SystemRulesConfig,
	GuardrailAction,
	CustomRuleConfig,
	CustomRuleType,
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
	projectId?: string,
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

	if (
		projectId
			? !canManageProject(userOrg.role) ||
				!(await userHasProjectAccess(userId, projectId))
			: !isOrganizationAdmin(userOrg.role)
	) {
		throw new HTTPException(403, {
			message: "Only admins of this scope can manage guardrails",
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

	await checkEnterpriseAccess(userId, project.organizationId, projectId);

	return { organizationId: project.organizationId, projectId };
}

/** Stored configs predate later rules; fill them with defaults on read. */
function normalizeConfig<T extends { systemRules: SystemRulesConfig | null }>(
	config: T,
): T & { systemRules: SystemRulesConfig } {
	return { ...config, systemRules: withDefaultSystemRules(config.systemRules) };
}

async function findScopedConfig(scope: GuardrailScopeContext) {
	const config = await db.query.guardrailConfig.findFirst({
		where: scope.projectId
			? { projectId: { eq: scope.projectId } }
			: {
					organizationId: { eq: scope.organizationId },
					projectId: { isNull: true },
				},
	});
	return config ? normalizeConfig(config) : undefined;
}

const REDACTABLE_SYSTEM_RULES = new Set(
	systemRuleCatalog.filter((rule) => rule.redactable).map((rule) => rule.id),
);
const REDACTABLE_RULE_TYPES = new Set<CustomRuleType>([
	"blocked_terms",
	"custom_regex",
	"sensitive_data",
]);

function assertSystemRulesSupported(systemRules: Partial<SystemRulesConfig>) {
	for (const [key, rule] of Object.entries(systemRules)) {
		if (
			rule?.action === "redact" &&
			!REDACTABLE_SYSTEM_RULES.has(`system:${key as keyof SystemRulesConfig}`)
		) {
			throw new HTTPException(400, {
				message: `Rule ${key} cannot redact; use block or warn`,
			});
		}
	}
}

function assertCustomRuleSupported(
	type: CustomRuleType,
	config: CustomRuleConfig,
	action: GuardrailAction,
) {
	if (config.type !== type) {
		throw new HTTPException(400, {
			message: `Rule config type ${config.type} does not match rule type ${type}`,
		});
	}
	if (action === "redact" && !REDACTABLE_RULE_TYPES.has(type)) {
		throw new HTTPException(400, {
			message: `${type} rules cannot redact; use block or warn`,
		});
	}
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
const thresholdSchema = z
	.number()
	.gt(0)
	.lt(1)
	.describe(
		"Classifier score (0–1) above which the rule matches. Defaults to 0.8.",
	);

const systemRuleConfigSchema = z.object({
	enabled: z.boolean(),
	action: z.enum(["block", "redact", "warn", "allow"]),
	classifier: z
		.boolean()
		.optional()
		.describe(
			"Prompt injection and jailbreak: also score with the ML classifier, billed as a separate decision request.",
		),
	threshold: thresholdSchema.optional(),
	entities: z
		.array(z.enum(piiEntities))
		.optional()
		.describe("PII detection: entities to detect. Unset detects all."),
});

const systemRulesConfigSchema = z.object({
	prompt_injection: systemRuleConfigSchema,
	jailbreak: systemRuleConfigSchema,
	pii_detection: systemRuleConfigSchema,
	secrets: systemRuleConfigSchema,
	file_types: systemRuleConfigSchema,
	document_leakage: systemRuleConfigSchema,
	harmful_content: systemRuleConfigSchema,
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
	classifierModel: z.string(),
	piiAction: z
		.enum(["block", "redact", "warn", "allow"])
		.nullable()
		.describe("Deprecated: mirrors systemRules.pii_detection.action."),
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
	allowedTopics: z
		.array(z.string())
		.optional()
		.describe(
			"Classifier mode only: anything outside these topics is a violation.",
		),
	classifier: z
		.boolean()
		.optional()
		.describe(
			"Judge topics with the ML classifier instead of keyword lists. Billed as a separate decision request.",
		),
	threshold: thresholdSchema.optional(),
});

const sensitiveDataConfigSchema = z.object({
	type: z.literal("sensitive_data"),
	entities: z.array(z.enum(piiEntities)).min(1),
});

const classifierConfigSchema = z.object({
	type: z.literal("classifier"),
	instructions: z
		.string()
		.trim()
		.min(1)
		.max(2000)
		.describe(
			'What the rule detects, as a statement the classifier scores, e.g. "The text asks for legal advice."',
		),
	threshold: thresholdSchema.optional(),
});

const customRuleConfigSchema = z.discriminatedUnion("type", [
	blockedTermsConfigSchema,
	customRegexConfigSchema,
	topicRestrictionConfigSchema,
	sensitiveDataConfigSchema,
	classifierConfigSchema,
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

guardrails.openapi(
	createRoute({
		method: "get",
		path: "/projects/{projectId}/inherited",
		request: { params: z.object({ projectId: z.string() }) },
		responses: {
			200: {
				description: "Organization guardrails inherited by this project",
				content: {
					"application/json": {
						schema: z.object({
							config: guardrailConfigSchema.nullable(),
							rules: z.array(guardrailRuleSchema),
						}),
					},
				},
			},
		},
	}),
	async (c) => {
		const user = c.get("user");
		if (!user) {
			throw new HTTPException(401, { message: "Unauthorized" });
		}
		const projectScope = await requireProjectScope(
			user.id,
			c.req.param("projectId"),
		);
		const orgScope = { ...projectScope, projectId: null };
		const [config, rules] = await Promise.all([
			findScopedConfig(orgScope),
			findScopedRules(orgScope),
		]);
		return c.json({ config: config ?? null, rules });
	},
);

const updateConfigBodySchema = z.object({
	enabled: z.boolean().optional(),
	systemRules: systemRulesConfigSchema
		.partial()
		.optional()
		.describe("Rules to change; omitted rules keep their current settings."),
	maxFileSizeMb: z.number().int().min(1).max(100).optional(),
	allowedFileTypes: z
		.array(z.string().trim().min(1))
		.optional()
		.describe(
			"MIME types (image/png, image/*) or extensions (pdf). Empty allows every type.",
		),
	classifierModel: z
		.string()
		.trim()
		.min(1)
		.max(128)
		.refine((model) => isDecisionModelRef(model), {
			message: "Must be a decision model, optionally provider-prefixed",
		})
		.optional()
		.describe("Decision model the ML classifier rules run on."),
	piiAction: z
		.enum(["block", "redact", "warn", "allow"])
		.optional()
		.describe(
			"Deprecated: sets systemRules.pii_detection.action when systemRules does not.",
		),
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
	// Partial updates merge into the stored rules, so lock the row to keep
	// concurrent edits of different rules from overwriting each other.
	return await db.transaction(async (tx) => {
		const [locked] = await tx
			.select()
			.from(tables.guardrailConfig)
			.where(
				scope.projectId
					? eq(tables.guardrailConfig.projectId, scope.projectId)
					: and(
							eq(tables.guardrailConfig.organizationId, scope.organizationId),
							isNull(tables.guardrailConfig.projectId),
						),
			)
			.for("update")
			.limit(1);
		const existing = locked ? normalizeConfig(locked) : undefined;

		const systemRules = withDefaultSystemRules({
			...(existing?.systemRules ?? defaultSystemRulesConfig),
			...(body.systemRules as Partial<SystemRulesConfig> | undefined),
		});
		if (body.piiAction && !body.systemRules?.pii_detection) {
			systemRules.pii_detection = {
				...systemRules.pii_detection,
				action: body.piiAction,
			};
		}
		// Only rules in this request: a stored legacy "redact" on a rule that
		// cannot redact must not block unrelated edits such as disabling.
		assertSystemRulesSupported(
			(body.systemRules ?? {}) as Partial<SystemRulesConfig>,
		);
		// Kept in sync for readers of the deprecated column.
		const piiAction = systemRules.pii_detection.action;

		if (existing) {
			const [updated] = await tx
				.update(tables.guardrailConfig)
				.set({
					inheritOrganization:
						body.inheritOrganization ?? existing.inheritOrganization,
					enabled: body.enabled ?? existing.enabled,
					systemRules,
					maxFileSizeMb: body.maxFileSizeMb ?? existing.maxFileSizeMb,
					allowedFileTypes: body.allowedFileTypes ?? existing.allowedFileTypes,
					classifierModel: body.classifierModel ?? existing.classifierModel,
					piiAction,
				})
				.where(eq(tables.guardrailConfig.id, existing.id))
				.returning();
			return normalizeConfig(updated);
		}

		const [created] = await tx
			.insert(tables.guardrailConfig)
			.values({
				organizationId: scope.organizationId,
				projectId: scope.projectId,
				inheritOrganization: body.inheritOrganization ?? true,
				enabled: body.enabled ?? true,
				systemRules,
				maxFileSizeMb: body.maxFileSizeMb ?? 10,
				allowedFileTypes: body.allowedFileTypes ?? defaultAllowedFileTypes,
				classifierModel:
					body.classifierModel ?? defaultGuardrailClassifierModel,
				piiAction,
			})
			.returning();

		return normalizeConfig(created);
	});
}

const guardrailConfigDefaults = {
	inheritOrganization: true,
	enabled: true,
	systemRules: defaultSystemRulesConfig,
	maxFileSizeMb: 10,
	allowedFileTypes: defaultAllowedFileTypes,
	classifierModel: defaultGuardrailClassifierModel,
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
		return normalizeConfig(updated);
	}

	const [created] = await db
		.insert(tables.guardrailConfig)
		.values({
			organizationId: scope.organizationId,
			projectId: scope.projectId,
			...guardrailConfigDefaults,
		})
		.returning();

	return normalizeConfig(created);
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
	assertCustomRuleSupported(
		body.type,
		body.config as CustomRuleConfig,
		(body.action as GuardrailAction) ?? "block",
	);

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
	// Disabling or renaming a stored rule must work even if it predates the
	// action validation; the engine treats such a "redact" as "block".
	if (
		body.config !== undefined ||
		body.action !== undefined ||
		body.enabled === true
	) {
		assertCustomRuleSupported(
			existing.type,
			(body.config as CustomRuleConfig) ?? existing.config,
			(body.action as GuardrailAction) ?? existing.action,
		);
	}

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
						classifier: z
							.object({
								questions: z.number(),
								skipped: z.boolean().optional(),
								error: z.string().optional(),
							})
							.optional()
							.describe(
								"Classifier-backed rules. The dashboard test skips them (skipped: true); they run on gateway requests.",
							),
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
		classifier: result.classifier,
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
						classifier: z
							.object({
								questions: z.number(),
								skipped: z.boolean().optional(),
								error: z.string().optional(),
							})
							.optional()
							.describe(
								"Classifier-backed rules. The dashboard test skips them (skipped: true); they run on gateway requests.",
							),
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
		classifier: result.classifier,
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
								redactable: z.boolean(),
								detection: z.enum([
									"pattern",
									"pattern+classifier",
									"classifier",
								]),
							}),
						),
						piiEntities: z.array(z.enum(piiEntities)),
						presetTopics: z.array(z.string()),
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

	return c.json({
		rules: systemRuleCatalog,
		piiEntities: [...piiEntities],
		presetTopics,
	});
});
