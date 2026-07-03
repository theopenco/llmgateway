import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import ipaddr from "ipaddr.js";
import { z } from "zod";

import { maskToken } from "@/lib/maskToken.js";
import { platformKeyMode } from "@/lib/platform-secret-auth.js";
import { getUserProjectIds } from "@/utils/authorization.js";

import { logAuditEvent } from "@llmgateway/audit";
import {
	apiKeyPeriodDurationMaxValues,
	apiKeyPeriodDurationUnits,
	cdb,
	db,
	eq,
	getApiKeyCurrentPeriodState,
	isValidApiKeyPeriodDuration,
	resolveEffectiveMemberBudget,
	shortid,
	tables,
	validateApiKeyLimitsWithinMemberBudget,
	type ApiKeyPeriodDurationUnit,
	type InferSelectModel,
} from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

export const keysApi = new OpenAPIHono<ServerTypes>();

export const PLAYGROUND_API_KEY_DESCRIPTION = "Auto-generated playground key";

export function isPlaygroundApiKey(apiKey: {
	description: string | null;
}): boolean {
	return apiKey.description === PLAYGROUND_API_KEY_DESCRIPTION;
}

type ApiKeyRecord = InferSelectModel<typeof tables.apiKey>;
export type ApiKeyLimitConfig = Pick<
	ApiKeyRecord,
	| "usageLimit"
	| "periodUsageLimit"
	| "periodUsageDurationValue"
	| "periodUsageDurationUnit"
>;
export type PartialApiKeyLimitConfig = Partial<ApiKeyLimitConfig>;
type ApiKeyResponseRecord = ApiKeyRecord & {
	creator?: {
		id: string;
		name: string | null;
		email: string;
	} | null;
	iamRules?: Array<{
		id: string;
		createdAt: Date;
		updatedAt: Date;
		apiKeyId: string;
		ruleType:
			| "allow_models"
			| "deny_models"
			| "allow_pricing"
			| "deny_pricing"
			| "allow_providers"
			| "deny_providers"
			| "allow_ip_cidrs"
			| "deny_ip_cidrs";
		ruleValue: {
			models?: string[];
			providers?: string[];
			pricingType?: "free" | "paid";
			maxInputPrice?: number;
			maxOutputPrice?: number;
			ipCidrs?: string[];
		};
		status: "active" | "inactive";
	}>;
};

const apiKeyPeriodDurationUnitSchema = z.enum(apiKeyPeriodDurationUnits);
const nonNegativeDecimalPattern = /^\d+(?:\.\d+)?$/;

function normalizeNullableString(value: unknown): unknown {
	if (value === undefined || value === null) {
		return null;
	}

	if (typeof value !== "string") {
		return value;
	}

	const trimmedValue = value.trim();
	return trimmedValue === "" ? null : trimmedValue;
}

function createNullableLimitSchema(fieldLabel: string) {
	return z.preprocess(
		normalizeNullableString,
		z
			.string()
			.refine((value) => nonNegativeDecimalPattern.test(value), {
				message: `${fieldLabel} must be a non-negative number.`,
			})
			.nullable(),
	);
}

const nullableApiKeyPeriodDurationValueSchema = z.number().int().nullable();
const nullableApiKeyPeriodDurationUnitSchema =
	apiKeyPeriodDurationUnitSchema.nullable();

const createApiKeyPeriodConfigFieldsSchema = {
	periodUsageLimit: createNullableLimitSchema("Period usage limit")
		.optional()
		.default(null),
	periodUsageDurationValue: nullableApiKeyPeriodDurationValueSchema
		.optional()
		.default(null),
	periodUsageDurationUnit: nullableApiKeyPeriodDurationUnitSchema
		.optional()
		.default(null),
} as const;

const updateApiKeyPeriodConfigFieldsSchema = {
	periodUsageLimit: createNullableLimitSchema("Period usage limit").optional(),
	periodUsageDurationValue: nullableApiKeyPeriodDurationValueSchema.optional(),
	periodUsageDurationUnit: nullableApiKeyPeriodDurationUnitSchema.optional(),
} as const;

const apiKeyPeriodConfigSchema = z
	.object({
		periodUsageLimit: createNullableLimitSchema("Period usage limit"),
		periodUsageDurationValue: nullableApiKeyPeriodDurationValueSchema,
		periodUsageDurationUnit: nullableApiKeyPeriodDurationUnitSchema,
	})
	.superRefine(validateApiKeyPeriodConfig);

function validateApiKeyPeriodConfig(
	value: {
		periodUsageLimit: string | null;
		periodUsageDurationValue: number | null;
		periodUsageDurationUnit: ApiKeyPeriodDurationUnit | null;
	},
	ctx: z.RefinementCtx,
) {
	const hasPeriodLimit = value.periodUsageLimit !== null;
	const hasDurationValue = value.periodUsageDurationValue !== null;
	const hasDurationUnit = value.periodUsageDurationUnit !== null;

	if (!hasPeriodLimit && (hasDurationValue || hasDurationUnit)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["periodUsageLimit"],
			message:
				"Period usage limit is required when a time window is configured.",
		});
	}

	if (hasPeriodLimit && (!hasDurationValue || !hasDurationUnit)) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["periodUsageDurationValue"],
			message:
				"Both a duration value and unit are required for period usage limits.",
		});
		return;
	}

	if (
		value.periodUsageDurationValue !== null &&
		value.periodUsageDurationUnit
	) {
		const maxValue =
			apiKeyPeriodDurationMaxValues[value.periodUsageDurationUnit];

		if (
			!isValidApiKeyPeriodDuration(
				value.periodUsageDurationValue,
				value.periodUsageDurationUnit,
			)
		) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["periodUsageDurationValue"],
				message: `Duration must be between 1 and ${maxValue} ${value.periodUsageDurationUnit}${maxValue === 1 ? "" : "s"}.`,
			});
		}
	}
}

function serializeApiKey<T extends ApiKeyResponseRecord>(apiKey: T) {
	const currentPeriod = getApiKeyCurrentPeriodState(apiKey);

	return {
		...apiKey,
		currentPeriodUsage: currentPeriod.usage,
		currentPeriodStartedAt: currentPeriod.startedAt,
		currentPeriodResetAt: currentPeriod.resetAt,
	};
}

export function hasPeriodConfigChanged(
	apiKey: ApiKeyRecord,
	config: {
		periodUsageLimit: string | null;
		periodUsageDurationValue: number | null;
		periodUsageDurationUnit: ApiKeyPeriodDurationUnit | null;
	},
): boolean {
	return (
		apiKey.periodUsageLimit !== config.periodUsageLimit ||
		apiKey.periodUsageDurationValue !== config.periodUsageDurationValue ||
		apiKey.periodUsageDurationUnit !== config.periodUsageDurationUnit
	);
}

export function buildApiKeyLimitAuditChanges(
	previous: ApiKeyLimitConfig,
	next: ApiKeyLimitConfig,
) {
	const changes: Record<string, { old: unknown; new: unknown }> = {};

	if (previous.usageLimit !== next.usageLimit) {
		changes.usageLimit = {
			old: previous.usageLimit,
			new: next.usageLimit,
		};
	}

	if (previous.periodUsageLimit !== next.periodUsageLimit) {
		changes.periodUsageLimit = {
			old: previous.periodUsageLimit,
			new: next.periodUsageLimit,
		};
	}

	if (previous.periodUsageDurationValue !== next.periodUsageDurationValue) {
		changes.periodUsageDurationValue = {
			old: previous.periodUsageDurationValue,
			new: next.periodUsageDurationValue,
		};
	}

	if (previous.periodUsageDurationUnit !== next.periodUsageDurationUnit) {
		changes.periodUsageDurationUnit = {
			old: previous.periodUsageDurationUnit,
			new: next.periodUsageDurationUnit,
		};
	}

	return changes;
}

export function mergeApiKeyLimitConfig(
	current: ApiKeyLimitConfig,
	update: PartialApiKeyLimitConfig,
): ApiKeyLimitConfig {
	return {
		usageLimit:
			update.usageLimit === undefined ? current.usageLimit : update.usageLimit,
		periodUsageLimit:
			update.periodUsageLimit === undefined
				? current.periodUsageLimit
				: update.periodUsageLimit,
		periodUsageDurationValue:
			update.periodUsageDurationValue === undefined
				? current.periodUsageDurationValue
				: update.periodUsageDurationValue,
		periodUsageDurationUnit:
			update.periodUsageDurationUnit === undefined
				? current.periodUsageDurationUnit
				: update.periodUsageDurationUnit,
	};
}

export function parseApiKeyPeriodConfig(config: ApiKeyLimitConfig) {
	const parsedConfig = apiKeyPeriodConfigSchema.safeParse({
		periodUsageLimit: config.periodUsageLimit,
		periodUsageDurationValue: config.periodUsageDurationValue,
		periodUsageDurationUnit: config.periodUsageDurationUnit,
	});

	if (!parsedConfig.success) {
		throw new HTTPException(400, {
			message:
				parsedConfig.error.issues[0]?.message ??
				"Invalid API key period limit configuration.",
		});
	}
}

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
	periodUsageLimit: z.string().nullable(),
	periodUsageDurationValue: z.number().int().nullable(),
	periodUsageDurationUnit: apiKeyPeriodDurationUnitSchema.nullable(),
	currentPeriodUsage: z.string(),
	currentPeriodStartedAt: z.date().nullable(),
	currentPeriodResetAt: z.date().nullable(),
	expiresAt: z.date().nullable(),
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
					"allow_ip_cidrs",
					"deny_ip_cidrs",
				]),
				ruleValue: z.object({
					models: z.array(z.string()).optional(),
					providers: z.array(z.string()).optional(),
					pricingType: z.enum(["free", "paid"]).optional(),
					maxInputPrice: z.number().optional(),
					maxOutputPrice: z.number().optional(),
					ipCidrs: z.array(z.string()).optional(),
				}),
				status: z.enum(["active", "inactive"]),
			}),
		)
		.optional(),
});

// Schema for creating a new API key
const createApiKeySchema = z
	.object({
		description: z.string().trim().min(1).max(255),
		projectId: z.string().trim().min(1),
		usageLimit: createNullableLimitSchema("Usage limit")
			.optional()
			.default(null),
		expiresAt: z
			.string()
			.datetime()
			.nullable()
			.optional()
			.default(null)
			.openapi({
				description:
					"ISO 8601 timestamp when the key expires (TTL). The worker disables the key once this time passes; the gateway also rejects it immediately. Omit or null for a key that never expires.",
			}),
		...createApiKeyPeriodConfigFieldsSchema,
	})
	.superRefine(validateApiKeyPeriodConfig);

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

// Schema for updating an API key status and/or metadata
const updateApiKeyStatusSchema = z.object({
	status: z.enum(["active", "inactive"]).optional(),
	expiresAt: z.string().datetime().nullable().optional().openapi({
		description:
			"ISO 8601 timestamp when the key expires (TTL). Required to reactivate a key whose TTL has already passed; pass null to remove the TTL. Omit to leave the existing expiry unchanged.",
	}),
	description: z.string().trim().min(1).max(255).optional().openapi({
		description: "New display name for the API key. Omit to leave unchanged.",
	}),
});

// Schema for updating an API key usage limit
const updateApiKeyUsageLimitSchema = z
	.object({
		usageLimit: createNullableLimitSchema("Usage limit").optional(),
		...updateApiKeyPeriodConfigFieldsSchema,
	})
	.strict();

const platformKeySchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	description: z.string(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	projectId: z.string(),
	createdBy: z.string(),
	maskedToken: z.string(),
	mode: z.enum(["live", "test"]),
});

const listPlatformKeysQuerySchema = z.object({
	projectId: z.string().trim().min(1),
});

const createPlatformKeySchema = z.object({
	projectId: z.string().trim().min(1),
	description: z
		.string()
		.trim()
		.min(1)
		.max(255)
		.optional()
		.default("SDK platform secret"),
	// Mint a Stripe-sandbox (test-mode) secret key. Sessions and wallets minted
	// from it are fully segregated from live data and can only spend on free
	// models, so developers can test top-ups without real charges.
	test: z.boolean().optional().default(false),
});

async function assertPlatformKeyAdminAccess(
	userId: string,
	projectId: string,
	{
		requirePaymentsSdkPreview = false,
	}: { requirePaymentsSdkPreview?: boolean } = {},
) {
	const project = await db.query.project.findFirst({
		where: {
			id: { eq: projectId },
		},
		with: {
			organization: true,
		},
	});

	if (!project || project.status === "deleted") {
		throw new HTTPException(404, {
			message: "Project not found",
		});
	}

	const userOrg = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: project.organizationId },
		},
	});

	if (!userOrg) {
		throw new HTTPException(403, {
			message: "You don't have access to this project",
		});
	}

	if (userOrg.role !== "owner" && userOrg.role !== "admin") {
		throw new HTTPException(403, {
			message: "Only organization owners and admins can manage platform keys",
		});
	}

	if (!project.organization) {
		throw new HTTPException(404, {
			message: "Organization not found",
		});
	}

	// The Payments SDK is a preview feature that must be opted into directly in
	// the database. Minting platform secrets is what lets a project actually use
	// the SDK, so gate it on the same flag rather than relying on the dashboard
	// button being disabled.
	if (requirePaymentsSdkPreview && !project.paymentsSdkEnabled) {
		throw new HTTPException(403, {
			message:
				"The Payments SDK is currently in preview and opt-in only. Contact us to enable it for your project.",
		});
	}

	return project;
}

export const iamRuleTypeEnum = z.enum([
	"allow_models",
	"deny_models",
	"allow_pricing",
	"deny_pricing",
	"allow_providers",
	"deny_providers",
	"allow_ip_cidrs",
	"deny_ip_cidrs",
]);

export const iamRuleValueSchema = z.object({
	models: z.array(z.string()).optional(),
	providers: z.array(z.string()).optional(),
	pricingType: z.enum(["free", "paid"]).optional(),
	maxInputPrice: z.number().optional(),
	maxOutputPrice: z.number().optional(),
	ipCidrs: z.array(z.string()).optional(),
});

const listPlatformKeys = createRoute({
	method: "get",
	path: "/platform",
	request: {
		query: listPlatformKeysQuerySchema,
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						platformKeys: z.array(platformKeySchema).openapi({}),
					}),
				},
			},
			description: "List SDK platform keys for a project.",
		},
	},
});

keysApi.openapi(listPlatformKeys, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { projectId } = c.req.valid("query");
	await assertPlatformKeyAdminAccess(user.id, projectId);

	const platformKeys = await db.query.apiKey.findMany({
		where: {
			projectId: { eq: projectId },
			keyType: { eq: "platform_secret" },
			status: { ne: "deleted" },
		},
	});

	return c.json({
		platformKeys: platformKeys.map((platformKey) => ({
			id: platformKey.id,
			createdAt: platformKey.createdAt,
			updatedAt: platformKey.updatedAt,
			description: platformKey.description,
			status: platformKey.status,
			projectId: platformKey.projectId,
			createdBy: platformKey.createdBy,
			maskedToken: maskToken(platformKey.token),
			mode: platformKeyMode(platformKey.token),
		})),
	});
});

const createPlatformKey = createRoute({
	method: "post",
	path: "/platform",
	request: {
		body: {
			content: {
				"application/json": {
					schema: createPlatformKeySchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						platformKey: platformKeySchema
							.extend({
								token: z.string(),
							})
							.openapi({}),
					}),
				},
			},
			description: "SDK platform key created successfully.",
		},
	},
});

keysApi.openapi(createPlatformKey, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { projectId, description, test } = c.req.valid("json");
	const project = await assertPlatformKeyAdminAccess(user.id, projectId, {
		requirePaymentsSdkPreview: true,
	});
	const token = `sk_${test ? "test" : "live"}_${shortid(40)}`;

	const [platformKey] = await cdb
		.insert(tables.apiKey)
		.values({
			token,
			projectId,
			description,
			keyType: "platform_secret",
			createdBy: user.id,
		})
		.returning();

	await logAuditEvent({
		organizationId: project.organizationId,
		userId: user.id,
		action: "api_key.create",
		resourceType: "api_key",
		resourceId: platformKey.id,
		metadata: {
			resourceName: description,
			projectId,
			keyType: "platform_secret",
		},
	});

	return c.json({
		platformKey: {
			id: platformKey.id,
			createdAt: platformKey.createdAt,
			updatedAt: platformKey.updatedAt,
			description: platformKey.description,
			status: platformKey.status,
			projectId: platformKey.projectId,
			createdBy: platformKey.createdBy,
			maskedToken: maskToken(token),
			mode: platformKeyMode(token),
			token,
		},
	});
});

const deletePlatformKey = createRoute({
	method: "delete",
	path: "/platform/{id}",
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
			description: "SDK platform key deleted successfully.",
		},
	},
});

keysApi.openapi(deletePlatformKey, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { id } = c.req.param();

	const platformKey = await db.query.apiKey.findFirst({
		where: {
			id: { eq: id },
			keyType: { eq: "platform_secret" },
			status: { ne: "deleted" },
		},
	});

	if (!platformKey) {
		throw new HTTPException(404, {
			message: "Platform key not found",
		});
	}

	const project = await assertPlatformKeyAdminAccess(
		user.id,
		platformKey.projectId,
	);

	// Delete through the cached client so onMutate busts the gateway's cached
	// token lookups; otherwise the deleted key keeps authenticating until the
	// cache expires.
	await cdb
		.update(tables.apiKey)
		.set({
			status: "deleted",
		})
		.where(eq(tables.apiKey.id, id));

	await logAuditEvent({
		organizationId: project.organizationId,
		userId: user.id,
		action: "api_key.delete",
		resourceType: "api_key",
		resourceId: id,
		metadata: {
			resourceName: platformKey.description,
			projectId: platformKey.projectId,
			keyType: "platform_secret",
		},
	});

	return c.json({
		message: "Platform key deleted successfully",
	});
});

function isValidCidr(cidr: string): boolean {
	try {
		const parsed = ipaddr.parseCIDR(cidr);
		return Array.isArray(parsed) && parsed.length === 2;
	} catch {
		return false;
	}
}

export function isIpCidrRuleType(
	ruleType?: z.infer<typeof iamRuleTypeEnum>,
): boolean {
	return ruleType === "allow_ip_cidrs" || ruleType === "deny_ip_cidrs";
}

export function assertEnterpriseForIpCidrRule(
	ruleType: z.infer<typeof iamRuleTypeEnum> | undefined,
	plan: string | null | undefined,
): void {
	if (isIpCidrRuleType(ruleType) && plan !== "enterprise") {
		throw new HTTPException(403, {
			message: "IP address IAM rules require an enterprise plan",
		});
	}
}

export function validateIamRuleInput(input: {
	ruleType?: z.infer<typeof iamRuleTypeEnum>;
	ruleValue?: z.infer<typeof iamRuleValueSchema>;
}): void {
	const { ruleType, ruleValue } = input;
	if (!ruleType || !ruleValue) {
		return;
	}
	if (ruleType === "allow_ip_cidrs" || ruleType === "deny_ip_cidrs") {
		const cidrs = ruleValue.ipCidrs;
		if (!cidrs || cidrs.length === 0) {
			throw new HTTPException(400, {
				message: `ruleValue.ipCidrs is required for ruleType ${ruleType}`,
			});
		}
		for (const cidr of cidrs) {
			if (!isValidCidr(cidr)) {
				throw new HTTPException(400, {
					message: `Invalid CIDR: ${cidr}. Expected IPv4 (e.g. 192.0.2.0/24) or IPv6 (e.g. 2001:db8::/32).`,
				});
			}
		}
	}
}

export const iamRuleStatusEnum = z.enum(["active", "inactive"]);

export const iamRuleSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	apiKeyId: z.string(),
	ruleType: iamRuleTypeEnum,
	ruleValue: iamRuleValueSchema,
	status: iamRuleStatusEnum,
});

export const createIamRuleSchema = z.object({
	ruleType: iamRuleTypeEnum,
	ruleValue: iamRuleValueSchema,
	status: iamRuleStatusEnum.default("active"),
});

// Org-wide cap on active developer API keys. An explicit `organization.apiKeyLimit`
// override (set by admins) always takes precedence over these plan defaults.
export function resolveApiKeyLimit(
	plan: string | null | undefined,
	apiKeyLimit: number | null | undefined,
): number {
	if (apiKeyLimit !== null && apiKeyLimit !== undefined) {
		return apiKeyLimit;
	}
	return plan === "enterprise" ? 500 : plan === "pro" ? 20 : 5;
}

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

export interface CreateApiKeyInput {
	description: string;
	usageLimit?: string | null;
	periodUsageLimit?: string | null;
	periodUsageDurationValue?: number | null;
	periodUsageDurationUnit?: ApiKeyPeriodDurationUnit | null;
	expiresAt?: Date | string | null;
}

interface MemberBudgetColumns {
	role: "owner" | "admin" | "developer";
	maxApiKeys: number | null;
	usageLimit: string | null;
	periodUsageLimit: string | null;
	periodUsageDurationValue: number | null;
	periodUsageDurationUnit: ApiKeyPeriodDurationUnit | null;
}

interface OrgDeveloperDefaultColumns {
	defaultDeveloperMaxApiKeys: number | null;
	defaultDeveloperUsageLimit: string | null;
	defaultDeveloperPeriodUsageLimit: string | null;
	defaultDeveloperPeriodUsageDurationValue: number | null;
	defaultDeveloperPeriodUsageDurationUnit: ApiKeyPeriodDurationUnit | null;
}

/**
 * Reject a proposed API-key limit that would exceed the key owner's effective
 * member budget (their own caps, or the org-wide default developer caps that
 * SSO-provisioned members inherit). The gateway enforces the member budget
 * first at request time regardless, but keeping a key's own limit at or below
 * the member limit keeps the configured numbers honest. No-op when the member
 * has no budget.
 */
function assertApiKeyLimitsWithinMemberBudget(
	membership: MemberBudgetColumns | null | undefined,
	organization: OrgDeveloperDefaultColumns,
	keyLimits: ApiKeyLimitConfig,
): void {
	if (!membership) {
		return;
	}

	const budget = resolveEffectiveMemberBudget(
		membership.role,
		{
			maxApiKeys: membership.maxApiKeys,
			usageLimit: membership.usageLimit,
			periodUsageLimit: membership.periodUsageLimit,
			periodUsageDurationValue: membership.periodUsageDurationValue,
			periodUsageDurationUnit: membership.periodUsageDurationUnit,
		},
		{
			defaultDeveloperMaxApiKeys: organization.defaultDeveloperMaxApiKeys,
			defaultDeveloperUsageLimit: organization.defaultDeveloperUsageLimit,
			defaultDeveloperPeriodUsageLimit:
				organization.defaultDeveloperPeriodUsageLimit,
			defaultDeveloperPeriodUsageDurationValue:
				organization.defaultDeveloperPeriodUsageDurationValue,
			defaultDeveloperPeriodUsageDurationUnit:
				organization.defaultDeveloperPeriodUsageDurationUnit,
		},
	);

	const error = validateApiKeyLimitsWithinMemberBudget(
		{
			usageLimit: keyLimits.usageLimit,
			periodUsageLimit: keyLimits.periodUsageLimit,
			periodUsageDurationValue: keyLimits.periodUsageDurationValue,
			periodUsageDurationUnit: keyLimits.periodUsageDurationUnit,
		},
		budget,
	);

	if (error) {
		throw new HTTPException(400, { message: error });
	}
}

export async function createApiKeyForProject(
	projectId: string,
	userId: string,
	input: CreateApiKeyInput,
	options: { skipAccessCheck?: boolean } = {},
) {
	const {
		description,
		usageLimit,
		periodUsageLimit,
		periodUsageDurationValue,
		periodUsageDurationUnit,
	} = input;

	const expiresAt =
		input.expiresAt === undefined || input.expiresAt === null
			? null
			: new Date(input.expiresAt);

	if (expiresAt && expiresAt.getTime() <= Date.now()) {
		throw new HTTPException(400, {
			message: "Expiration date must be in the future.",
		});
	}

	if (!options.skipAccessCheck) {
		const projectIds = await getUserProjectIds(userId);

		if (!projectIds.length) {
			throw new HTTPException(400, {
				message: "No organizations found for user",
			});
		}

		if (!projectIds.includes(projectId)) {
			throw new HTTPException(403, {
				message: "You don't have access to this project",
			});
		}
	}

	const project = await db.query.project.findFirst({
		where: { id: { eq: projectId } },
		with: { organization: true },
	});

	if (!project?.organization) {
		throw new HTTPException(404, {
			message: "Project or organization not found",
		});
	}

	const orgProjects = await db.query.project.findMany({
		where: { organizationId: { eq: project.organization.id } },
		columns: { id: true },
	});
	const orgProjectIds = orgProjects.map((p) => p.id);

	// Org-wide cap on active developer API keys across all of the org's projects.
	// Platform and hidden LLM SDK aggregate keys are excluded (keyType: "user").
	const orgActiveApiKeys = await db.query.apiKey.findMany({
		where: {
			projectId: { in: orgProjectIds },
			status: { eq: "active" },
			keyType: { eq: "user" },
		},
		columns: { id: true },
	});

	const maxApiKeys = resolveApiKeyLimit(
		project.organization.plan,
		project.organization.apiKeyLimit,
	);

	if (orgActiveApiKeys.length >= maxApiKeys) {
		throw new HTTPException(400, {
			message: `API key limit reached. Maximum ${maxApiKeys} active API keys per organization. Contact us at contact@llmgateway.io to unlock more.`,
		});
	}

	// Enforce the per-member active-key cap. The creator's own per-member cap
	// wins; for developers with no explicit cap the org-wide default developer
	// cap applies.
	const creatorMembership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: userId },
			organizationId: { eq: project.organization.id },
		},
		columns: {
			role: true,
			maxApiKeys: true,
			usageLimit: true,
			periodUsageLimit: true,
			periodUsageDurationValue: true,
			periodUsageDurationUnit: true,
		},
	});

	// A key's limits must stay at or below the creator's effective member budget.
	// Skipped for programmatic (master-key) creation, which has no interactive
	// member context; the gateway still enforces the member budget at request time.
	if (!options.skipAccessCheck) {
		assertApiKeyLimitsWithinMemberBudget(
			creatorMembership,
			project.organization,
			{
				usageLimit: usageLimit ?? null,
				periodUsageLimit: periodUsageLimit ?? null,
				periodUsageDurationValue: periodUsageDurationValue ?? null,
				periodUsageDurationUnit: periodUsageDurationUnit ?? null,
			},
		);
	}

	const effectiveMaxApiKeys =
		creatorMembership?.maxApiKeys ??
		(creatorMembership?.role === "developer"
			? project.organization.defaultDeveloperMaxApiKeys
			: null);

	if (typeof effectiveMaxApiKeys === "number") {
		const memberActiveKeys = await db.query.apiKey.findMany({
			where: {
				createdBy: { eq: userId },
				status: { eq: "active" },
				keyType: { eq: "user" },
				projectId: { in: orgProjectIds },
			},
			columns: { id: true },
		});

		if (memberActiveKeys.length >= effectiveMaxApiKeys) {
			throw new HTTPException(400, {
				message: `You have reached your limit of ${effectiveMaxApiKeys} active API keys set by an organization admin.`,
			});
		}
	}

	const prefix =
		process.env.NODE_ENV === "development" ? `llmgdev_` : "llmgtwy_";
	const token = prefix + shortid(40);

	const [apiKey] = await cdb
		.insert(tables.apiKey)
		.values({
			token,
			projectId,
			description,
			usageLimit,
			periodUsageLimit,
			periodUsageDurationValue,
			periodUsageDurationUnit,
			expiresAt,
			createdBy: userId,
		})
		.returning();

	await logAuditEvent({
		organizationId: project.organization.id,
		userId,
		action: "api_key.create",
		resourceType: "api_key",
		resourceId: apiKey.id,
		metadata: {
			resourceName: description,
			projectId,
			usageLimit,
			periodUsageLimit,
			periodUsageDurationValue,
			periodUsageDurationUnit,
			expiresAt: expiresAt?.toISOString() ?? null,
		},
	});

	return { apiKey, token };
}

keysApi.openapi(create, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, {
			message: "Unauthorized",
		});
	}

	const { projectId, ...rest } = c.req.valid("json");

	const { apiKey, token } = await createApiKeyForProject(
		projectId,
		user.id,
		rest,
	);

	return c.json({
		apiKey: serializeApiKey({
			...apiKey,
			token,
		}),
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
								plan: z.enum(["free", "pro", "enterprise"]),
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
	// Project-scoped "developer" members may only ever see their OWN keys.
	let developerScoped = false;
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
				developerScoped = userRole === "developer";
			}
		}
	}

	// Owners/admins see all keys (with an optional "mine" filter); developers are
	// always restricted to the keys they created.
	const shouldFilterByCreator = filter === "mine" || developerScoped;

	// Get API keys for the specified project or all accessible projects
	const apiKeys = await db.query.apiKey.findMany({
		where: {
			projectId: {
				in: projectId ? [projectId] : projectIds,
			},
			// Hide platform and LLM SDK aggregate keys from the dashboard —
			// only show developer-created keys.
			keyType: { eq: "user" },
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

	// Get organization plan info if projectId is specified. The cap is org-wide,
	// so currentCount counts active developer keys across ALL of the org's
	// projects, not just the selected one.
	let currentCount = 0;
	let maxKeys = 0;
	let plan: "free" | "pro" | "enterprise" = "free";

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
			plan = project.organization.plan as "free" | "pro" | "enterprise";
			maxKeys = resolveApiKeyLimit(plan, project.organization.apiKeyLimit);

			const orgProjects = await db.query.project.findMany({
				where: { organizationId: { eq: project.organization.id } },
				columns: { id: true },
			});
			const orgActiveKeys = await db.query.apiKey.findMany({
				where: {
					projectId: { in: orgProjects.map((p) => p.id) },
					status: { eq: "active" },
					keyType: { eq: "user" },
				},
				columns: { id: true },
			});
			currentCount = orgActiveKeys.length;
		}
	}

	return c.json({
		apiKeys: apiKeys.map((key) => ({
			...serializeApiKey(key),
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

	// Prevent deletion of the auto-generated playground key
	if (isPlaygroundApiKey(apiKey)) {
		throw new HTTPException(403, {
			message:
				"Cannot delete the playground API key. This key is required for the playground to function.",
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

	// Delete through the cached client so onMutate busts the gateway's cached
	// token lookups; otherwise the deleted key keeps authenticating until the
	// cache expires.
	await cdb
		.update(tables.apiKey)
		.set({
			status: "deleted",
		})
		.where(eq(tables.apiKey.id, id));

	await logAuditEvent({
		organizationId: projectOrgId,
		userId: user.id,
		action: "api_key.delete",
		resourceType: "api_key",
		resourceId: id,
		metadata: {
			resourceName: apiKey.description,
		},
	});

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
	const {
		status,
		expiresAt: expiresAtInput,
		description: descriptionInput,
	} = c.req.valid("json");

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

	if (
		status === undefined &&
		expiresAtInput === undefined &&
		descriptionInput === undefined
	) {
		throw new HTTPException(400, {
			message: "No changes provided",
		});
	}

	// Prevent deactivation of the auto-generated playground key
	if (isPlaygroundApiKey(apiKey) && status === "inactive") {
		throw new HTTPException(403, {
			message:
				"Cannot deactivate the playground API key. This key is required for the playground to function.",
		});
	}

	// Renaming the auto-generated playground key would break the UI's lookup
	// of it by its fixed description.
	if (isPlaygroundApiKey(apiKey) && descriptionInput !== undefined) {
		throw new HTTPException(403, {
			message: "Cannot rename the playground API key.",
		});
	}

	// A regular key must not take on the reserved playground description,
	// or it would collide with the playground key's fixed-description lookup.
	if (descriptionInput === PLAYGROUND_API_KEY_DESCRIPTION) {
		throw new HTTPException(403, {
			message: "This name is reserved for the playground API key.",
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

	// Resolve the effective TTL: an explicit value (or null) overrides, otherwise
	// keep whatever expiry the key already had.
	const expiresAtProvided = expiresAtInput !== undefined;
	const nextExpiresAt = expiresAtProvided
		? expiresAtInput === null
			? null
			: new Date(expiresAtInput)
		: (apiKey.expiresAt ?? null);

	// Reactivating a key requires its TTL (if any) to point to a future date,
	// so an expired key can only come back online with a fresh expiry.
	if (
		status === "active" &&
		nextExpiresAt &&
		nextExpiresAt.getTime() <= Date.now()
	) {
		throw new HTTPException(400, {
			message:
				"Set a future expiration date to reactivate this API key. Its TTL has already passed.",
		});
	}

	// Update the API key status
	// Update through the cached client so its onMutate invalidates the gateway's
	// cached token lookups (Drizzle cache + SWR mirror) for the api_key table.
	// Otherwise a deactivated key keeps authenticating (and a reactivated one
	// stays rejected) until the cache expires, so the change is not instant.
	const [updatedApiKey] = await cdb
		.update(tables.apiKey)
		.set({
			...(status !== undefined ? { status } : {}),
			...(expiresAtProvided ? { expiresAt: nextExpiresAt } : {}),
			...(descriptionInput !== undefined
				? { description: descriptionInput }
				: {}),
		})
		.where(eq(tables.apiKey.id, id))
		.returning();

	const statusChanged = status !== undefined && apiKey.status !== status;
	const expiryChanged =
		expiresAtProvided &&
		(apiKey.expiresAt?.getTime() ?? null) !==
			(nextExpiresAt?.getTime() ?? null);
	const descriptionChanged =
		descriptionInput !== undefined && apiKey.description !== descriptionInput;

	if (statusChanged || expiryChanged || descriptionChanged) {
		const changes: Record<string, { old: unknown; new: unknown }> = {};
		if (statusChanged) {
			changes.status = { old: apiKey.status, new: status };
		}
		if (expiryChanged) {
			changes.expiresAt = {
				old: apiKey.expiresAt?.toISOString() ?? null,
				new: nextExpiresAt?.toISOString() ?? null,
			};
		}
		if (descriptionChanged) {
			changes.description = {
				old: apiKey.description,
				new: descriptionInput,
			};
		}

		await logAuditEvent({
			organizationId: projectOrgId,
			userId: user.id,
			action: "api_key.update_status",
			resourceType: "api_key",
			resourceId: id,
			metadata: {
				resourceName: apiKey.description,
				changes,
			},
		});
	}

	return c.json({
		message:
			status !== undefined
				? `API key status updated to ${status}`
				: "API key updated",
		apiKey: {
			...serializeApiKey(updatedApiKey),
			maskedToken: maskToken(updatedApiKey.token),
			token: undefined,
		},
	});
});

// Roll (regenerate the secret of) an API key while keeping its metadata and stats
const roll = createRoute({
	method: "post",
	path: "/api/{id}/roll",
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
						apiKey: apiKeySchema
							.omit({ token: true })
							.extend({
								token: z.string(),
							})
							.openapi({}),
					}),
				},
			},
			description: "API key secret regenerated successfully.",
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

keysApi.openapi(roll, async (c) => {
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

	// Only developer keys are rolled here; platform/embeddable keys use a
	// different token format and lifecycle.
	if (apiKey.keyType !== "user") {
		throw new HTTPException(400, {
			message: "Only developer API keys can be rolled.",
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

	const prefix =
		process.env.NODE_ENV === "development" ? `llmgdev_` : "llmgtwy_";
	const token = prefix + shortid(40);

	// Roll through the cached client so its onMutate invalidates the gateway's
	// cached token lookups (Drizzle cache + SWR mirror) for the api_key table.
	// Otherwise the old secret would keep authenticating until the cache expired.
	const [updatedApiKey] = await cdb
		.update(tables.apiKey)
		.set({ token })
		.where(eq(tables.apiKey.id, id))
		.returning();

	await logAuditEvent({
		organizationId: projectOrgId,
		userId: user.id,
		action: "api_key.roll",
		resourceType: "api_key",
		resourceId: id,
		metadata: {
			resourceName: apiKey.description,
		},
	});

	return c.json({
		message: "API key secret regenerated successfully.",
		apiKey: serializeApiKey({
			...updatedApiKey,
			token,
		}),
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
	const limitUpdate = c.req.valid("json");

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

	const nextLimitConfig = mergeApiKeyLimitConfig(apiKey, limitUpdate);
	parseApiKeyPeriodConfig(nextLimitConfig);

	// The key's limits must stay at or below the key owner's effective member
	// budget (their own caps, or the org-wide default developer caps).
	const ownerMembership = await db.query.userOrganization.findFirst({
		where: {
			userId: { eq: apiKey.createdBy },
			organizationId: { eq: projectOrgId },
		},
		columns: {
			role: true,
			maxApiKeys: true,
			usageLimit: true,
			periodUsageLimit: true,
			periodUsageDurationValue: true,
			periodUsageDurationUnit: true,
		},
	});
	const ownerOrg = await db.query.organization.findFirst({
		where: { id: { eq: projectOrgId } },
		columns: {
			defaultDeveloperMaxApiKeys: true,
			defaultDeveloperUsageLimit: true,
			defaultDeveloperPeriodUsageLimit: true,
			defaultDeveloperPeriodUsageDurationValue: true,
			defaultDeveloperPeriodUsageDurationUnit: true,
		},
	});
	if (ownerOrg) {
		assertApiKeyLimitsWithinMemberBudget(
			ownerMembership,
			ownerOrg,
			nextLimitConfig,
		);
	}

	const periodConfigChanged = hasPeriodConfigChanged(apiKey, nextLimitConfig);

	// Update the API key usage limit through the cached client so onMutate busts
	// the gateway's cached token lookup and the new limits take effect instantly.
	const [updatedApiKey] = await cdb
		.update(tables.apiKey)
		.set({
			usageLimit: nextLimitConfig.usageLimit,
			periodUsageLimit: nextLimitConfig.periodUsageLimit,
			periodUsageDurationValue: nextLimitConfig.periodUsageDurationValue,
			periodUsageDurationUnit: nextLimitConfig.periodUsageDurationUnit,
			...(periodConfigChanged && {
				currentPeriodUsage: "0",
				currentPeriodStartedAt: null,
			}),
		})
		.where(eq(tables.apiKey.id, id))
		.returning();

	if (apiKey.usageLimit !== nextLimitConfig.usageLimit || periodConfigChanged) {
		await logAuditEvent({
			organizationId: projectOrgId,
			userId: user.id,
			action: "api_key.update_limit",
			resourceType: "api_key",
			resourceId: id,
			metadata: {
				resourceName: apiKey.description,
				changes: buildApiKeyLimitAuditChanges(apiKey, nextLimitConfig),
			},
		});
	}

	return c.json({
		message: "API key limits updated successfully.",
		apiKey: {
			...serializeApiKey(updatedApiKey),
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

	validateIamRuleInput(ruleData);

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
			project: {
				with: {
					organization: true,
				},
			},
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

	assertEnterpriseForIpCidrRule(
		ruleData.ruleType,
		apiKey.project.organization?.plan,
	);

	// Create the IAM rule
	const [rule] = await cdb
		.insert(tables.apiKeyIamRule)
		.values({
			apiKeyId: id,
			...ruleData,
		})
		.returning();

	await logAuditEvent({
		organizationId: projectOrgId,
		userId: user.id,
		action: "api_key.iam_rule.create",
		resourceType: "iam_rule",
		resourceId: rule.id,
		metadata: {
			apiKeyId: id,
			ruleType: ruleData.ruleType,
			ruleValue: ruleData.ruleValue,
		},
	});

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

	// We may not yet know the existing ruleType for partial updates; the
	// validator pulls it from the patch and runs only when both fields are
	// present. For pure ruleValue changes we re-validate after loading the
	// existing rule below.
	validateIamRuleInput(updateData);

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
			project: {
				with: {
					organization: true,
				},
			},
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

	// Get the existing rule to track changes
	const existingRule = await db.query.apiKeyIamRule.findFirst({
		where: {
			id: {
				eq: ruleId,
			},
		},
	});

	// Re-validate using the effective ruleType + ruleValue after merging
	// with the existing rule, so partial updates can't bypass CIDR checks.
	if (existingRule && (updateData.ruleType || updateData.ruleValue)) {
		validateIamRuleInput({
			ruleType: updateData.ruleType ?? existingRule.ruleType,
			ruleValue: updateData.ruleValue ?? existingRule.ruleValue,
		});
	}

	const effectiveRuleType = updateData.ruleType ?? existingRule?.ruleType;
	assertEnterpriseForIpCidrRule(
		effectiveRuleType,
		apiKey.project.organization?.plan,
	);

	// Update the IAM rule
	const [updatedRule] = await cdb
		.update(tables.apiKeyIamRule)
		.set(updateData)
		.where(eq(tables.apiKeyIamRule.id, ruleId))
		.returning();

	if (!updatedRule) {
		throw new HTTPException(404, {
			message: "IAM rule not found",
		});
	}

	await logAuditEvent({
		organizationId: projectOrgId,
		userId: user.id,
		action: "api_key.iam_rule.update",
		resourceType: "iam_rule",
		resourceId: ruleId,
		metadata: {
			apiKeyId: id,
			changes: {
				...(updateData.ruleType !== undefined &&
				existingRule?.ruleType !== updateData.ruleType
					? {
							ruleType: {
								old: existingRule?.ruleType,
								new: updateData.ruleType,
							},
						}
					: {}),
				...(updateData.status !== undefined &&
				existingRule?.status !== updateData.status
					? { status: { old: existingRule?.status, new: updateData.status } }
					: {}),
			},
		},
	});

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
	const result = await cdb
		.delete(tables.apiKeyIamRule)
		.where(eq(tables.apiKeyIamRule.id, ruleId))
		.returning();

	if (!result.length) {
		throw new HTTPException(404, {
			message: "IAM rule not found",
		});
	}

	await logAuditEvent({
		organizationId: projectOrgId,
		userId: user.id,
		action: "api_key.iam_rule.delete",
		resourceType: "iam_rule",
		resourceId: ruleId,
		metadata: {
			apiKeyId: id,
			ruleType: result[0].ruleType,
		},
	});

	return c.json({
		message: "IAM rule deleted successfully",
	});
});

export default keysApi;
