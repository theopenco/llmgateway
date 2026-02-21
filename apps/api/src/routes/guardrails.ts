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

import type { ServerTypes } from "@/vars.js";
import type {
	SystemRulesConfig,
	GuardrailAction,
	CustomRuleConfig,
} from "@llmgateway/db";

export const guardrails = new OpenAPIHono<ServerTypes>();

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

	if (userOrg.organization?.plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "Guardrails require an enterprise plan",
		});
	}

	return { userOrg };
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
	await checkEnterpriseAccess(user.id, organizationId);

	const config = await db.query.guardrailConfig.findFirst({
		where: { organizationId: { eq: organizationId } },
	});

	return c.json(config ?? null);
});

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
					schema: z.object({
						enabled: z.boolean().optional(),
						systemRules: systemRulesConfigSchema.optional(),
						maxFileSizeMb: z.number().optional(),
						allowedFileTypes: z.array(z.string()).optional(),
						piiAction: z.enum(["block", "redact", "warn", "allow"]).optional(),
					}),
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
	await checkEnterpriseAccess(user.id, organizationId);

	const body = c.req.valid("json");

	// Check if config exists
	const existing = await db.query.guardrailConfig.findFirst({
		where: { organizationId: { eq: organizationId } },
	});

	if (existing) {
		// Update existing config
		const [updated] = await db
			.update(tables.guardrailConfig)
			.set({
				enabled: body.enabled ?? existing.enabled,
				systemRules:
					(body.systemRules as SystemRulesConfig) ?? existing.systemRules,
				maxFileSizeMb: body.maxFileSizeMb ?? existing.maxFileSizeMb,
				allowedFileTypes: body.allowedFileTypes ?? existing.allowedFileTypes,
				piiAction: (body.piiAction as GuardrailAction) ?? existing.piiAction,
			})
			.where(eq(tables.guardrailConfig.id, existing.id))
			.returning();
		return c.json(updated);
	}

	// Create new config
	const [created] = await db
		.insert(tables.guardrailConfig)
		.values({
			organizationId,
			enabled: body.enabled ?? true,
			systemRules:
				(body.systemRules as SystemRulesConfig) ?? defaultSystemRulesConfig,
			maxFileSizeMb: body.maxFileSizeMb ?? 10,
			allowedFileTypes: body.allowedFileTypes ?? defaultAllowedFileTypes,
			piiAction: (body.piiAction as GuardrailAction) ?? "redact",
		})
		.returning();

	return c.json(created);
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
	await checkEnterpriseAccess(user.id, organizationId);

	// Delete existing and create new with defaults
	await db
		.delete(tables.guardrailConfig)
		.where(eq(tables.guardrailConfig.organizationId, organizationId));

	const [created] = await db
		.insert(tables.guardrailConfig)
		.values({
			organizationId,
			enabled: true,
			systemRules: defaultSystemRulesConfig,
			maxFileSizeMb: 10,
			allowedFileTypes: defaultAllowedFileTypes,
			piiAction: "redact",
		})
		.returning();

	return c.json(created);
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
	await checkEnterpriseAccess(user.id, organizationId);

	const rules = await db.query.guardrailRule.findMany({
		where: { organizationId: { eq: organizationId } },
		orderBy: { priority: "desc" },
	});

	return c.json({ rules });
});

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
					schema: z.object({
						name: z.string(),
						type: z.enum(customRuleTypes),
						config: customRuleConfigSchema,
						priority: z.number().optional(),
						enabled: z.boolean().optional(),
						action: z.enum(["block", "redact", "warn", "allow"]).optional(),
					}),
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
	await checkEnterpriseAccess(user.id, organizationId);

	const body = c.req.valid("json");

	const [created] = await db
		.insert(tables.guardrailRule)
		.values({
			organizationId,
			name: body.name,
			type: body.type,
			config: body.config as CustomRuleConfig,
			priority: body.priority ?? 100,
			enabled: body.enabled ?? true,
			action: (body.action as GuardrailAction) ?? "block",
		})
		.returning();

	return c.json(created);
});

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
					schema: z.object({
						name: z.string().optional(),
						config: customRuleConfigSchema.optional(),
						priority: z.number().optional(),
						enabled: z.boolean().optional(),
						action: z.enum(["block", "redact", "warn", "allow"]).optional(),
					}),
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
	await checkEnterpriseAccess(user.id, organizationId);

	const body = c.req.valid("json");

	const existing = await db.query.guardrailRule.findFirst({
		where: {
			id: { eq: ruleId },
			organizationId: { eq: organizationId },
		},
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Rule not found" });
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
		.where(eq(tables.guardrailRule.id, ruleId))
		.returning();

	return c.json(updated);
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
	await checkEnterpriseAccess(user.id, organizationId);

	await db
		.delete(tables.guardrailRule)
		.where(
			and(
				eq(tables.guardrailRule.id, ruleId),
				eq(tables.guardrailRule.organizationId, organizationId),
			),
		);

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
						blocked: z.number(),
						redacted: z.number(),
						warned: z.number(),
						total: z.number(),
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
	const startDate = new Date();
	startDate.setDate(startDate.getDate() - days);

	const violations = await db.query.guardrailViolation.findMany({
		where: {
			organizationId: { eq: organizationId },
			createdAt: { gte: startDate },
		},
		columns: { actionTaken: true },
	});

	const stats = {
		blocked: 0,
		redacted: 0,
		warned: 0,
		total: violations.length,
	};

	for (const v of violations) {
		if (v.actionTaken === "blocked") {
			stats.blocked++;
		} else if (v.actionTaken === "redacted") {
			stats.redacted++;
		} else if (v.actionTaken === "warned") {
			stats.warned++;
		}
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
	await checkEnterpriseAccess(user.id, organizationId);

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
