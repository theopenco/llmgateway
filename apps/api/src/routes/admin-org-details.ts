import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { adminMiddleware } from "@/middleware/admin.js";

import {
	and,
	auditLogActions,
	auditLogResourceTypes,
	db,
	desc,
	eq,
	gte,
	sql,
	tables,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const adminOrgDetails = new OpenAPIHono<ServerTypes>();

adminOrgDetails.use("/*", adminMiddleware);

async function requireOrganization(orgId: string) {
	const org = await db.query.organization.findFirst({
		where: {
			id: { eq: orgId },
		},
	});

	if (!org) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	return org;
}

// ==================== Audit Logs ====================

const auditLogEntrySchema = z.object({
	id: z.string(),
	createdAt: z.string(),
	userId: z.string(),
	action: z.string(),
	resourceType: z.string(),
	resourceId: z.string().nullable(),
	metadata: z.unknown().nullable(),
	user: z
		.object({
			id: z.string(),
			email: z.string(),
			name: z.string().nullable(),
		})
		.nullable(),
});

const getOrganizationAuditLogs = createRoute({
	method: "get",
	path: "/organizations/{orgId}/audit-logs",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
		query: z.object({
			limit: z.coerce.number().min(1).max(100).default(25).optional(),
			offset: z.coerce.number().min(0).default(0).optional(),
			action: z.string().optional(),
			resourceType: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						auditLogs: z.array(auditLogEntrySchema),
						total: z.number(),
						limit: z.number(),
						offset: z.number(),
						filters: z.object({
							actions: z.array(z.string()),
							resourceTypes: z.array(z.string()),
						}),
					}),
				},
			},
			description: "Audit logs for the organization.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationAuditLogs, async (c) => {
	const { orgId } = c.req.valid("param");
	const query = c.req.valid("query");
	const limit = query.limit ?? 25;
	const offset = query.offset ?? 0;

	await requireOrganization(orgId);

	const whereConditions = [eq(tables.auditLog.organizationId, orgId)];

	if (
		query.action &&
		auditLogActions.includes(query.action as (typeof auditLogActions)[number])
	) {
		whereConditions.push(
			eq(
				tables.auditLog.action,
				query.action as (typeof auditLogActions)[number],
			),
		);
	}
	if (
		query.resourceType &&
		auditLogResourceTypes.includes(
			query.resourceType as (typeof auditLogResourceTypes)[number],
		)
	) {
		whereConditions.push(
			eq(
				tables.auditLog.resourceType,
				query.resourceType as (typeof auditLogResourceTypes)[number],
			),
		);
	}

	const whereClause = and(...whereConditions);

	const [countResult] = await db
		.select({
			count: sql<number>`COUNT(*)`.as("count"),
		})
		.from(tables.auditLog)
		.where(whereClause);

	const total = Number(countResult?.count ?? 0);

	const logs = await db
		.select({
			id: tables.auditLog.id,
			createdAt: tables.auditLog.createdAt,
			userId: tables.auditLog.userId,
			action: tables.auditLog.action,
			resourceType: tables.auditLog.resourceType,
			resourceId: tables.auditLog.resourceId,
			metadata: tables.auditLog.metadata,
			userName: tables.user.name,
			userEmail: tables.user.email,
		})
		.from(tables.auditLog)
		.leftJoin(tables.user, eq(tables.auditLog.userId, tables.user.id))
		.where(whereClause)
		// Same-transaction writes share a createdAt, so break ties on id to keep
		// offset pagination stable.
		.orderBy(desc(tables.auditLog.createdAt), desc(tables.auditLog.id))
		.limit(limit)
		.offset(offset);

	return c.json({
		auditLogs: logs.map((log) => ({
			id: log.id,
			createdAt: log.createdAt.toISOString(),
			userId: log.userId,
			action: log.action,
			resourceType: log.resourceType,
			resourceId: log.resourceId,
			metadata: log.metadata,
			user: log.userEmail
				? {
						id: log.userId,
						email: log.userEmail,
						name: log.userName,
					}
				: null,
		})),
		total,
		limit,
		offset,
		filters: {
			actions: [...auditLogActions],
			resourceTypes: [...auditLogResourceTypes],
		},
	});
});

// ==================== Organization Settings ====================

const compliancePolicySchema = z.object({
	enabled: z.boolean(),
	requireSoc2: z.boolean().optional(),
	requireSoc2Type2: z.boolean().optional(),
	requireIso27001: z.boolean().optional(),
	requireSoc2OrIso27001: z.boolean().optional(),
	requireGdpr: z.boolean().optional(),
	blockApiTraining: z.boolean().optional(),
	blockPromptLogging: z.boolean().optional(),
	blockStealthProviders: z.boolean().optional(),
	allowedCountries: z.array(z.string()).optional(),
	blockedProviders: z.array(z.string()).optional(),
	allowedProviders: z.array(z.string()).optional(),
	blockedModels: z.array(z.string()).optional(),
	allowedModels: z.array(z.string()).optional(),
});

const complianceAttestationSchema = z.object({
	soc2: z.union([z.literal(1), z.literal(2)]).nullish(),
	iso27001: z.boolean().nullish(),
	gdpr: z.boolean().nullish(),
	apiTraining: z.boolean().nullish(),
	promptLogging: z.boolean().nullish(),
	retentionPeriod: z.string().nullish(),
	headquarters: z.string().nullish(),
	attestedAt: z.string().optional(),
	attestedByUserId: z.string().optional(),
});

const getOrganizationSettings = createRoute({
	method: "get",
	path: "/organizations/{orgId}/settings",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						organization: z.object({
							id: z.string(),
							name: z.string(),
							safetyIdentifier: z.string(),
							billingEmail: z.string(),
							createdAt: z.string(),
							plan: z.string(),
							planExpiresAt: z.string().nullable(),
							planStartedAt: z.string().nullable(),
							kind: z.string(),
							devPlan: z.string(),
							status: z.string().nullable(),
							retentionLevel: z.string(),
							ssoAutoJoinDomain: z.string().nullable(),
							seats: z.number().nullable(),
							apiKeyLimit: z.number().nullable(),
							projectLimit: z.number().nullable(),
							subscriptionCancelled: z.boolean(),
							isTrialActive: z.boolean(),
							trialStartDate: z.string().nullable(),
							trialEndDate: z.string().nullable(),
							referralBonusEnabled: z.boolean(),
							autoTopUpEnabled: z.boolean(),
							providerCompliancePolicy: compliancePolicySchema.nullable(),
							billingCompany: z.string().nullable(),
							billingAddress: z.string().nullable(),
							billingTaxId: z.string().nullable(),
							billingNotes: z.string().nullable(),
							stripeCustomerId: z.string().nullable(),
							stripeSubscriptionId: z.string().nullable(),
							credits: z.string(),
							autoTopUpThreshold: z.string().nullable(),
							autoTopUpAmount: z.string().nullable(),
							lastTopUpAmount: z.string().nullable(),
							paymentFailureCount: z.number(),
							lastPaymentFailureAt: z.string().nullable(),
							paymentFailureStartedAt: z.string().nullable(),
						}),
						customProviders: z.array(
							z.object({
								id: z.string(),
								name: z.string().nullable(),
								status: z.string().nullable(),
								customModelsOnly: z.boolean(),
								complianceAttestation: complianceAttestationSchema.nullable(),
								createdAt: z.string(),
							}),
						),
					}),
				},
			},
			description:
				"Organization policy and settings overview, including the provider compliance policy and custom provider attestations.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationSettings, async (c) => {
	const { orgId } = c.req.valid("param");

	const org = await requireOrganization(orgId);

	const customProviders = await db.query.providerKey.findMany({
		where: {
			organizationId: { eq: orgId },
			provider: { eq: "custom" },
			status: { ne: "deleted" },
		},
	});

	return c.json({
		organization: {
			id: org.id,
			name: org.name,
			safetyIdentifier: org.safetyIdentifier,
			billingEmail: org.billingEmail,
			createdAt: org.createdAt.toISOString(),
			plan: org.plan,
			planExpiresAt: org.planExpiresAt?.toISOString() ?? null,
			planStartedAt: org.planStartedAt?.toISOString() ?? null,
			kind: org.kind,
			devPlan: org.devPlan,
			status: org.status,
			retentionLevel: org.retentionLevel,
			ssoAutoJoinDomain: org.ssoAutoJoinDomain,
			seats: org.seats,
			apiKeyLimit: org.apiKeyLimit,
			projectLimit: org.projectLimit,
			subscriptionCancelled: org.subscriptionCancelled,
			isTrialActive: org.isTrialActive,
			trialStartDate: org.trialStartDate?.toISOString() ?? null,
			trialEndDate: org.trialEndDate?.toISOString() ?? null,
			referralBonusEnabled: org.referralBonusEnabled,
			autoTopUpEnabled: org.autoTopUpEnabled,
			providerCompliancePolicy: org.providerCompliancePolicy ?? null,
			billingCompany: org.billingCompany,
			billingAddress: org.billingAddress,
			billingTaxId: org.billingTaxId,
			billingNotes: org.billingNotes,
			stripeCustomerId: org.stripeCustomerId,
			stripeSubscriptionId: org.stripeSubscriptionId,
			credits: String(org.credits),
			autoTopUpThreshold: org.autoTopUpThreshold,
			autoTopUpAmount: org.autoTopUpAmount,
			lastTopUpAmount: org.lastTopUpAmount,
			paymentFailureCount: org.paymentFailureCount,
			lastPaymentFailureAt: org.lastPaymentFailureAt?.toISOString() ?? null,
			paymentFailureStartedAt:
				org.paymentFailureStartedAt?.toISOString() ?? null,
		},
		customProviders: customProviders.map((key) => ({
			id: key.id,
			name: key.name,
			status: key.status,
			customModelsOnly: key.customModelsOnly,
			complianceAttestation: key.complianceAttestation ?? null,
			createdAt: key.createdAt.toISOString(),
		})),
	});
});

// ==================== Guardrails ====================

const guardrailSystemRuleSchema = z.object({
	enabled: z.boolean(),
	action: z.enum(["block", "redact", "warn", "allow"]),
});

const guardrailSystemRulesSchema = z.object({
	prompt_injection: guardrailSystemRuleSchema,
	jailbreak: guardrailSystemRuleSchema,
	pii_detection: guardrailSystemRuleSchema,
	secrets: guardrailSystemRuleSchema,
	file_types: guardrailSystemRuleSchema,
	document_leakage: guardrailSystemRuleSchema,
});

const guardrailCustomRuleConfigSchema = z.union([
	z.object({
		type: z.literal("blocked_terms"),
		terms: z.array(z.string()),
		matchType: z.enum(["exact", "contains", "regex"]),
		caseSensitive: z.boolean(),
	}),
	z.object({
		type: z.literal("custom_regex"),
		pattern: z.string(),
	}),
	z.object({
		type: z.literal("topic_restriction"),
		blockedTopics: z.array(z.string()),
		allowedTopics: z.array(z.string()).optional(),
	}),
]);

const getOrganizationGuardrails = createRoute({
	method: "get",
	path: "/organizations/{orgId}/guardrails",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						config: z
							.object({
								id: z.string(),
								enabled: z.boolean(),
								systemRules: guardrailSystemRulesSchema.nullable(),
								maxFileSizeMb: z.number(),
								allowedFileTypes: z.array(z.string()),
								piiAction: z.string().nullable(),
								createdAt: z.string(),
								updatedAt: z.string(),
							})
							.nullable(),
						rules: z.array(
							z.object({
								id: z.string(),
								name: z.string(),
								type: z.string(),
								config: guardrailCustomRuleConfigSchema,
								priority: z.number(),
								enabled: z.boolean(),
								action: z.string(),
								createdAt: z.string(),
								updatedAt: z.string(),
							}),
						),
						violations: z.object({
							total: z.number(),
							last30Days: z.number(),
							recent: z.array(
								z.object({
									id: z.string(),
									createdAt: z.string(),
									ruleName: z.string(),
									category: z.string(),
									actionTaken: z.string(),
									model: z.string().nullable(),
								}),
							),
						}),
					}),
				},
			},
			description: "Guardrail configuration, custom rules and violations.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationGuardrails, async (c) => {
	const { orgId } = c.req.valid("param");

	await requireOrganization(orgId);

	const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
	const thirtyDaysAgo = new Date(Date.now() - thirtyDaysMs);

	const [config, rules, [totalResult], [recentResult], recentViolations] =
		await Promise.all([
			db.query.guardrailConfig.findFirst({
				where: {
					organizationId: { eq: orgId },
					projectId: { isNull: true },
				},
			}),
			// Org-level rules only, to match the org-level config above — project
			// overrides are configured and enforced separately.
			db.query.guardrailRule.findMany({
				where: {
					organizationId: { eq: orgId },
					projectId: { isNull: true },
				},
				orderBy: {
					priority: "asc",
				},
			}),
			db
				.select({
					count: sql<number>`COUNT(*)`.as("count"),
				})
				.from(tables.guardrailViolation)
				.where(eq(tables.guardrailViolation.organizationId, orgId)),
			db
				.select({
					count: sql<number>`COUNT(*)`.as("count"),
				})
				.from(tables.guardrailViolation)
				.where(
					and(
						eq(tables.guardrailViolation.organizationId, orgId),
						gte(tables.guardrailViolation.createdAt, thirtyDaysAgo),
					),
				),
			db.query.guardrailViolation.findMany({
				where: {
					organizationId: { eq: orgId },
				},
				orderBy: {
					createdAt: "desc",
				},
				limit: 10,
			}),
		]);

	return c.json({
		config: config
			? {
					id: config.id,
					enabled: config.enabled,
					systemRules: config.systemRules ?? null,
					maxFileSizeMb: config.maxFileSizeMb,
					allowedFileTypes: config.allowedFileTypes,
					piiAction: config.piiAction,
					createdAt: config.createdAt.toISOString(),
					updatedAt: config.updatedAt.toISOString(),
				}
			: null,
		rules: rules.map((rule) => ({
			id: rule.id,
			name: rule.name,
			type: rule.type,
			config: rule.config,
			priority: rule.priority,
			enabled: rule.enabled,
			action: rule.action,
			createdAt: rule.createdAt.toISOString(),
			updatedAt: rule.updatedAt.toISOString(),
		})),
		violations: {
			total: Number(totalResult?.count ?? 0),
			last30Days: Number(recentResult?.count ?? 0),
			recent: recentViolations.map((violation) => ({
				id: violation.id,
				createdAt: violation.createdAt.toISOString(),
				ruleName: violation.ruleName,
				category: violation.category,
				actionTaken: violation.actionTaken,
				model: violation.model,
			})),
		},
	});
});

// ==================== SSO / SCIM ====================

const getOrganizationSso = createRoute({
	method: "get",
	path: "/organizations/{orgId}/sso",
	request: {
		params: z.object({
			orgId: z.string(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						ssoAutoJoinDomain: z.string().nullable(),
						connections: z.array(
							z.object({
								id: z.string(),
								issuer: z.string(),
								domain: z.string(),
								providerId: z.string(),
								providerType: z.string(),
								protocol: z.enum(["saml", "oidc", "unknown"]),
								enforced: z.boolean(),
								domainVerified: z.boolean(),
								createdAt: z.string(),
								updatedAt: z.string(),
							}),
						),
						scimTokens: z.array(
							z.object({
								id: z.string(),
								maskedToken: z.string(),
								ssoProviderId: z.string().nullable(),
								status: z.string(),
								lastUsedAt: z.string().nullable(),
								createdAt: z.string(),
							}),
						),
						roleMappings: z.array(
							z.object({
								id: z.string(),
								groupName: z.string(),
								role: z.string(),
								createdAt: z.string(),
							}),
						),
						defaultProjects: z.array(
							z.object({
								id: z.string(),
								projectId: z.string(),
								projectName: z.string().nullable(),
							}),
						),
						scimGroups: z.array(
							z.object({
								id: z.string(),
								displayName: z.string(),
								externalId: z.string().nullable(),
								memberCount: z.number(),
								createdAt: z.string(),
							}),
						),
					}),
				},
			},
			description: "SSO connections, SCIM provisioning and related settings.",
		},
		404: {
			description: "Organization not found.",
		},
	},
});

adminOrgDetails.openapi(getOrganizationSso, async (c) => {
	const { orgId } = c.req.valid("param");

	const org = await requireOrganization(orgId);

	const [connections, scimTokens, roleMappings, defaultProjects, scimGroups] =
		await Promise.all([
			db.query.ssoProvider.findMany({
				where: {
					organizationId: { eq: orgId },
				},
				orderBy: {
					createdAt: "desc",
				},
			}),
			db.query.scimToken.findMany({
				where: {
					organizationId: { eq: orgId },
					status: { ne: "deleted" },
				},
				orderBy: {
					createdAt: "desc",
				},
			}),
			db.query.ssoRoleMapping.findMany({
				where: {
					organizationId: { eq: orgId },
				},
				orderBy: {
					groupName: "asc",
				},
			}),
			db
				.select({
					id: tables.ssoDefaultProject.id,
					projectId: tables.ssoDefaultProject.projectId,
					projectName: tables.project.name,
				})
				.from(tables.ssoDefaultProject)
				.leftJoin(
					tables.project,
					eq(tables.ssoDefaultProject.projectId, tables.project.id),
				)
				.where(eq(tables.ssoDefaultProject.organizationId, orgId)),
			db
				.select({
					id: tables.scimGroup.id,
					displayName: tables.scimGroup.displayName,
					externalId: tables.scimGroup.externalId,
					createdAt: tables.scimGroup.createdAt,
					memberCount: sql<number>`COUNT(${tables.scimGroupMember.id})`.as(
						"member_count",
					),
				})
				.from(tables.scimGroup)
				.leftJoin(
					tables.scimGroupMember,
					eq(tables.scimGroup.id, tables.scimGroupMember.scimGroupId),
				)
				.where(eq(tables.scimGroup.organizationId, orgId))
				.groupBy(tables.scimGroup.id)
				.orderBy(tables.scimGroup.displayName),
		]);

	return c.json({
		ssoAutoJoinDomain: org.ssoAutoJoinDomain,
		// The raw oidcConfig/samlConfig columns carry IdP secrets (client
		// secrets, certificates) and are deliberately not exposed; only which
		// protocol is configured is reported.
		connections: connections.map((connection) => ({
			id: connection.id,
			issuer: connection.issuer,
			domain: connection.domain,
			providerId: connection.providerId,
			providerType: connection.providerType,
			protocol: connection.samlConfig
				? ("saml" as const)
				: connection.oidcConfig
					? ("oidc" as const)
					: ("unknown" as const),
			enforced: connection.enforced,
			domainVerified: connection.domainVerified,
			createdAt: connection.createdAt.toISOString(),
			updatedAt: connection.updatedAt.toISOString(),
		})),
		scimTokens: scimTokens.map((token) => ({
			id: token.id,
			maskedToken: token.maskedToken,
			ssoProviderId: token.ssoProviderId,
			status: token.status,
			lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
			createdAt: token.createdAt.toISOString(),
		})),
		roleMappings: roleMappings.map((mapping) => ({
			id: mapping.id,
			groupName: mapping.groupName,
			role: mapping.role,
			createdAt: mapping.createdAt.toISOString(),
		})),
		defaultProjects,
		scimGroups: scimGroups.map((group) => ({
			id: group.id,
			displayName: group.displayName,
			externalId: group.externalId,
			memberCount: Number(group.memberCount ?? 0),
			createdAt: group.createdAt.toISOString(),
		})),
	});
});
