import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { assertOrganizationProviderKey } from "@/lib/organization-provider-key.js";
import {
	allowedModelsSchema,
	normalizeAllowedModels,
	pickAllowedValidationModel,
	validateAllowedModels,
} from "@/lib/provider-key-allowed-models.js";
import { createNullableLimitSchema } from "@/routes/keys-api.js";
import {
	getActiveUserOrganizationIds,
	getAdminOrganizationIds,
} from "@/utils/authorization.js";

import {
	encryptProviderKey,
	redactToken,
	validateProviderKey,
} from "@llmgateway/actions";
import { logAuditEvent } from "@llmgateway/audit";
import {
	and,
	cdb,
	db,
	eq,
	inArray,
	ne,
	shortid,
	sql,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	isStealthProvider,
	providers,
	regionEndpointRequiresWorkspaceId,
} from "@llmgateway/models";
import {
	CUSTOM_PROVIDER_NAME_MESSAGE,
	CUSTOM_PROVIDER_NAME_REGEX,
	RESERVED_CUSTOM_PROVIDER_NAME_MESSAGE,
	RESERVED_CUSTOM_PROVIDER_NAMES,
} from "@llmgateway/shared";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";
import { maskToken } from "@llmgateway/shared/mask-token";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import type { ServerTypes } from "@/vars.js";
import type { ProviderKeyComplianceAttestation } from "@llmgateway/db";
import type { ProviderId } from "@llmgateway/models";

export const keysProvider = new OpenAPIHono<ServerTypes>();

// Self-attested compliance posture for a custom provider key. Client-supplied
// fields only — attestedAt/attestedByUserId are stamped server-side.
export const complianceAttestationSchema = z.object({
	soc2: z
		.union([z.literal(1), z.literal(2)])
		.nullable()
		.optional()
		.openapi({ type: "integer", enum: [1, 2, null] }),
	iso27001: z.boolean().nullable().optional(),
	gdpr: z.boolean().nullable().optional(),
	apiTraining: z.boolean().nullable().optional(),
	promptLogging: z.boolean().nullable().optional(),
	retentionPeriod: z.string().max(64).nullable().optional(),
	headquarters: z
		.string()
		.regex(/^[A-Z]{2}$/, "Must be an ISO 3166-1 alpha-2 country code")
		.nullable()
		.optional(),
});

// Create a schema for provider key responses
// Using z.object directly instead of createSelectSchema due to compatibility issues
export const providerKeySchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	token: z.string(),
	provider: z.string(),
	name: z.string().nullable(),
	description: z.string().nullable(),
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
				.enum(["singapore", "eu-frankfurt", "us-virginia", "cn-beijing"])
				.optional(),
			alibaba_workspace_id: z.string().optional(),
			aws_mantle_region: z
				.enum(["us-east-1", "us-east-2", "us-west-2"])
				.optional(),
			vertex_openai_project_id: z.string().optional(),
		})
		.nullable(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	customModelsOnly: z.boolean(),
	complianceAttestation: complianceAttestationSchema
		.extend({
			attestedAt: z.string().optional(),
			attestedByUserId: z.string().optional(),
		})
		.nullable(),
	organizationId: z.string(),
});

// Public response shape for provider key endpoints. Listed explicitly
// (not via .omit) so that any future secret-bearing column added to
// the provider_key table does not leak by default. Shared with the
// master-key custom-provider API, which serves the same rows.
export const providerKeyPublicSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	provider: z.string(),
	name: z.string().nullable(),
	description: z.string().nullable(),
	baseUrl: z.string().nullable(),
	options: providerKeySchema.shape.options,
	status: providerKeySchema.shape.status,
	customModelsOnly: providerKeySchema.shape.customModelsOnly,
	complianceAttestation: providerKeySchema.shape.complianceAttestation,
	organizationId: z.string(),
	/** USD spend cap; the key auto-deactivates when usage reaches it. */
	usageLimit: z.string().nullable(),
	/** Cumulative upstream spend (USD) attributed by the billing worker. */
	usage: z.string(),
	maskedToken: z.string(),
	/**
	 * Canonical model ids this key may serve; routing skips it for any other
	 * model and (in hybrid mode) falls back to credits instead. Null means the
	 * key serves the provider's full catalogue.
	 */
	allowedModels: z.array(z.string()).nullable(),
});

type ProviderKeyRow = typeof tables.providerKey.$inferSelect;

// Every row served by these routes is organization-owned: they all query by
// organizationId. Platform-managed credentials (organizationId NULL) are
// administered from the admin dashboard and never surface here.
export function toPublicProviderKey(row: ProviderKeyRow) {
	assertOrganizationProviderKey(row);
	return {
		id: row.id,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		provider: row.provider,
		name: row.name,
		description: row.description,
		baseUrl: row.baseUrl,
		options: row.options,
		status: row.status,
		customModelsOnly: row.customModelsOnly,
		// The organization's own compliance attestation for its custom provider,
		// shown back in the dashboard. Not secret-bearing.
		complianceAttestation: row.complianceAttestation,
		organizationId: row.organizationId,
		usageLimit: row.usageLimit,
		usage: row.usage,
		maskedToken: row.tokenMasked ?? maskToken(row.token ?? ""),
		allowedModels: row.allowedModels,
	};
}

/**
 * A custom provider serves models that exist only in the organization's own
 * catalogue, so there is nothing for a canonical-model-id restriction to match
 * against. Restricting which of a custom provider's models are served is what
 * `customModelsOnly` plus the org's model list already does.
 */
function assertAllowedModelsSupported(provider: string) {
	if (provider === "custom") {
		throw new HTTPException(400, {
			message:
				"allowedModels cannot be set on custom provider keys. Manage a custom provider's models from its model list instead.",
		});
	}
}

// The custom provider name is the routing segment used in `custom/<name>/<model>`
// model strings, so it must stay URL-safe and unique within the organization.
export const customProviderNameSchema = z
	.string()
	.regex(CUSTOM_PROVIDER_NAME_REGEX, CUSTOM_PROVIDER_NAME_MESSAGE)
	.refine(
		(name) =>
			!(RESERVED_CUSTOM_PROVIDER_NAMES as readonly string[]).includes(name),
		RESERVED_CUSTOM_PROVIDER_NAME_MESSAGE,
	);

export async function assertCustomProviderNameAvailable(
	organizationId: string,
	name: string,
) {
	const existing = await db.query.providerKey.findFirst({
		where: {
			status: { ne: "deleted" },
			provider: { eq: "custom" },
			name: { eq: name },
			organizationId: { eq: organizationId },
		},
	});

	if (existing) {
		throw new HTTPException(400, {
			message: `A custom provider named '${name}' already exists for this organization`,
		});
	}
}

/**
 * SSRF guard: reject base URLs that resolve to internal/reserved addresses
 * before they are stored or used as an outbound fetch target. No-op unless the
 * hosted provider URL guard is enabled.
 */
export async function assertProviderBaseUrlAllowed(baseUrl: string) {
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

/**
 * Provenance is stamped server-side only so the audit trail can't be forged by
 * the request body.
 */
export function stampComplianceAttestation(
	attestation: z.infer<typeof complianceAttestationSchema> | null,
	userId: string,
): ProviderKeyComplianceAttestation | null {
	return attestation
		? {
				...attestation,
				attestedAt: new Date().toISOString(),
				attestedByUserId: userId,
			}
		: null;
}

// Schema for creating a new provider key
// Regular API keys must be printable ASCII without whitespace, but
// service-account keys (Vertex providers) are JSON blobs that may be
// pretty-printed, so ASCII whitespace is allowed when the value parses as a
// JSON object.
export function isValidProviderToken(value: string): boolean {
	if (/^[\x21-\x7E]+$/.test(value)) {
		return true;
	}
	if (!/^[\t\n\r\x20-\x7E]+$/.test(value)) {
		return false;
	}
	const trimmed = value.trim();
	if (!trimmed.startsWith("{")) {
		return false;
	}
	try {
		JSON.parse(trimmed);
		return true;
	} catch {
		return false;
	}
}

// The workspace id becomes a hostname label on the workspace-dedicated
// endpoint, so it is restricted to what Model Studio issues rather than
// accepted verbatim.
const WORKSPACE_ID_REGEX = /^[a-zA-Z0-9-]{1,64}$/;
const WORKSPACE_ID_MESSAGE =
	"Workspace ID must be 1-64 characters of letters, digits, or hyphens";

/**
 * A workspace id is optional: a region whose endpoint is workspace-scoped
 * still reaches a shared entry point without one. It is only mandatory for a
 * region that has no such fallback, which is enforced here so a direct API
 * client cannot store a key whose endpoint can never be built.
 */
function validateWorkspaceScopedRegion(
	options: { alibaba_region?: string; alibaba_workspace_id?: string },
	ctx: z.RefinementCtx,
) {
	const region = options.alibaba_region;
	if (!region || !regionEndpointRequiresWorkspaceId("alibaba", region)) {
		return;
	}
	if (!options.alibaba_workspace_id) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			path: ["alibaba_workspace_id"],
			message: `The ${region} region has no shared endpoint, so a workspace ID is required.`,
		});
	}
}

const createProviderKeySchema = z.object({
	provider: z
		.string()
		.refine((val) => providers.some((p) => p.id === val) || val === "custom", {
			message:
				"Invalid provider. Must be one of the supported providers or 'custom'.",
		}),
	token: z.string().min(1, "API key is required").refine(isValidProviderToken, {
		message:
			"API key contains invalid characters. Make sure you copied the actual key, not a masked version.",
	}),
	name: customProviderNameSchema.optional(),
	description: z.string().trim().max(200).optional(),
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
				.enum(["singapore", "eu-frankfurt", "us-virginia", "cn-beijing"])
				.optional(),
			alibaba_workspace_id: z
				.string()
				.regex(WORKSPACE_ID_REGEX, WORKSPACE_ID_MESSAGE)
				.optional(),
			aws_mantle_region: z
				.enum(["us-east-1", "us-east-2", "us-west-2"])
				.optional(),
			google_vertex_project_id: z.string().optional(),
			vertex_openai_project_id: z.string().optional(),
		})
		.superRefine(validateWorkspaceScopedRegion)
		.optional(),
	organizationId: z.string().min(1, "Organization ID is required"),
	// Optional USD spend cap; the key auto-deactivates when its cumulative
	// attributed spend reaches it.
	usageLimit: createNullableLimitSchema("Usage limit").optional(),
	// Optional allowlist of canonical model ids this key may serve. Empty/null
	// means the provider's full catalogue.
	allowedModels: allowedModelsSchema,
});

// Schema for updating a provider key status / settings
const updateProviderKeyStatusSchema = z
	.object({
		status: z.enum(["active", "inactive"]).optional(),
		// Canonical model ids this key may serve; `null` (or an empty list)
		// removes the restriction.
		allowedModels: allowedModelsSchema,
		// Custom providers only: renames the provider, which changes the model
		// prefix used in requests (e.g. "myprovider/some-model").
		name: customProviderNameSchema.optional(),
		// Organization-owned display label. Empty input clears it.
		description: z.string().trim().max(200).nullable().optional(),
		// Custom providers only: restrict requests to catalog-defined models.
		customModelsOnly: z.boolean().optional(),
		// Custom providers only: self-attested compliance posture. `null` clears
		// the attestation (restoring the fail-closed blocked state).
		complianceAttestation: complianceAttestationSchema.nullable().optional(),
		// USD spend cap; `null` clears it.
		usageLimit: createNullableLimitSchema("Usage limit").optional(),
	})
	.refine(
		(v) =>
			v.status !== undefined ||
			v.name !== undefined ||
			v.description !== undefined ||
			v.customModelsOnly !== undefined ||
			v.complianceAttestation !== undefined ||
			v.usageLimit !== undefined ||
			v.allowedModels !== undefined,
		{
			message: "No updatable fields provided",
		},
	);

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
						providerKey: providerKeyPublicSchema.openapi({}),
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
		description,
		baseUrl,
		options,
		organizationId,
		usageLimit,
		allowedModels: requestedAllowedModels,
	} = c.req.valid("json");

	const allowedModels = normalizeAllowedModels(requestedAllowedModels);

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

	if (baseUrl) {
		await assertProviderBaseUrlAllowed(baseUrl);
	}

	if (provider === "custom" && name) {
		await assertCustomProviderNameAvailable(organizationId, name);
	}

	if (allowedModels) {
		assertAllowedModelsSupported(provider);
		validateAllowedModels(provider, allowedModels, options);
	}

	// A restricted key is probed with one of its own allowed models instead of
	// the provider's default validation model: users restrict a key precisely
	// because the upstream account only has some models, so probing the default
	// would reject exactly the keys the restriction exists for. When no allowed
	// model can answer a chat completion (image/embedding-only lists) there is
	// nothing to probe with, so the live check is skipped.
	const pinnedValidationModel = pickAllowedValidationModel(
		provider,
		allowedModels,
		options,
	);
	const skipLiveValidation = !!allowedModels && !pinnedValidationModel;

	let validationResult;
	try {
		const isTestEnv =
			process.env.NODE_ENV === "test" && process.env.E2E_TEST !== "true";
		// Validate that provider is one of the allowed provider IDs
		if (!providers.some((p) => p.id === provider) && provider !== "custom") {
			throw new Error(`Invalid provider: ${provider}`);
		}

		// Skip validation for custom providers as they don't have predefined models
		if (provider === "custom" || skipLiveValidation) {
			validationResult = { valid: true };
		} else {
			validationResult = await validateProviderKey(
				provider as ProviderId,
				userToken,
				baseUrl,
				isTestEnv,
				options,
				pinnedValidationModel,
			);
		}
	} catch (error) {
		throw new HTTPException(500, {
			message: redactToken(
				error instanceof Error ? error.message : "Failed to validate API key",
				userToken,
			),
		});
	}

	if (validationResult.error) {
		// validateProviderKey already redacts but belt-and-suspenders: any
		// future code path that populates validationResult.error must not be
		// allowed to leak the plaintext token via logs or the 400 response body.
		const errorMessage = redactToken(
			validationResult.error ?? "Upstream server error",
			userToken,
		);
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
		// The provider never answered, so the key was never judged: saying it was
		// rejected would send the user off replacing a perfectly good key. The
		// endpoint is derived from the submitted base URL / options, so this is a
		// problem with the request, hence 400 rather than a 5xx.
		if (validationResult.unreachable) {
			throw new HTTPException(400, {
				message: `Could not reach provider ${provider}${modelPart}: ${errorMessage}`,
			});
		}
		// A 401 is an auth or entitlement failure, so "try again later" is the
		// wrong advice — the key will keep failing until it is replaced or the
		// account is granted access. The provider's own message distinguishes the
		// two (a bad token vs. a valid token without access to the model), so
		// surface it rather than guessing.
		if (validationResult.statusCode === 401) {
			throw new HTTPException(400, {
				message: `Provider ${provider} rejected the key${modelPart}${statusPart}. Make sure the key is correct and that your account has access to that model. Provider response: ${errorMessage}`,
			});
		}
		throw new HTTPException(400, {
			message: `Error from provider ${provider}: ${errorMessage}${statusPart}${modelPart}. Please try again later or contact support.`,
		});
	}

	if (!validationResult.valid) {
		throw new HTTPException(400, {
			message: `Invalid API key. Please make sure the key is correct.`,
		});
	}

	// Encrypt the user-provided token at rest. Generate the id in application
	// code so the AAD (which binds ciphertext to the row id + organization id)
	// can be computed before the INSERT, keeping the write a single statement.
	const providerKeyId = shortid();
	const tokenCiphertext = encryptProviderKey(
		userToken,
		providerKeyId,
		organizationId,
	);
	const tokenMasked = maskToken(userToken);

	const [providerKey] = await cdb
		.insert(tables.providerKey)
		.values({
			id: providerKeyId,
			token: null,
			tokenCiphertext,
			tokenMasked,
			tokenHash: getApiKeyFingerprint(userToken),
			organizationId,
			provider,
			name,
			description: description || null,
			baseUrl,
			options,
			usageLimit: usageLimit ?? null,
			allowedModels,
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
			allowedModels,
		},
	});

	return c.json({
		providerKey: toPublicProviderKey(providerKey),
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
						providerKeys: z.array(providerKeyPublicSchema).openapi({}),
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

	// Reads are member-level so every org member (including project-scoped
	// developers) can see which providers/custom models are available; tokens
	// are masked and all mutations stay owner/admin-gated.
	const organizationIds = await getActiveUserOrganizationIds(user.id);

	if (!organizationIds.length) {
		return c.json({ providerKeys: [] });
	}

	// Get all provider keys for these organizations, in the order the gateway
	// will try them: manual position first (NULLs last, so unpositioned keys
	// keep their historical age order), then createdAt/id.
	const providerKeys = await db.query.providerKey.findMany({
		where: {
			organizationId: {
				in: organizationIds,
			},
		},
		orderBy: {
			provider: "asc",
			sortOrder: "asc",
			createdAt: "asc",
			id: "asc",
		},
	});

	return c.json({
		providerKeys: providerKeys.map(toPublicProviderKey),
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

	// Member-level read: exposes only provider ids and status.
	const organizationIds = await getActiveUserOrganizationIds(user.id);

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

	assertOrganizationProviderKey(providerKey);

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
						providerKey: providerKeyPublicSchema.openapi({}),
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
	const {
		status,
		name,
		description,
		customModelsOnly,
		complianceAttestation,
		usageLimit,
		allowedModels: requestedAllowedModels,
	} = c.req.valid("json");

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

	assertOrganizationProviderKey(providerKey);

	if (name !== undefined) {
		if (providerKey.provider !== "custom") {
			throw new HTTPException(400, {
				message: "name can only be changed on custom provider keys",
			});
		}

		if (name !== providerKey.name) {
			await assertCustomProviderNameAvailable(providerKey.organizationId, name);
		}
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

	// Only the catalogue is checked here, not the key upstream: a PATCH cannot
	// change the token, and narrowing which models a key serves never makes an
	// already-working key fail. Blocking the edit on a live probe would also
	// stand in the way of the case the restriction exists for — a key whose
	// account lost access to some models, which the user is fixing right now.
	const allowedModels =
		requestedAllowedModels === undefined
			? undefined
			: normalizeAllowedModels(requestedAllowedModels);
	if (allowedModels) {
		assertAllowedModelsSupported(providerKey.provider);
		validateAllowedModels(
			providerKey.provider,
			allowedModels,
			providerKey.options ?? undefined,
		);
	}

	if (complianceAttestation !== undefined) {
		if (providerKey.provider !== "custom") {
			throw new HTTPException(400, {
				message:
					"complianceAttestation can only be set on custom provider keys",
			});
		}
		if (providerKey.organization?.plan !== "enterprise") {
			throw new HTTPException(403, {
				message: "Compliance attestations require an enterprise plan",
			});
		}
	}

	// Re-enabling an over-limit key without raising or clearing the limit would
	// just get it re-deactivated by the worker on its next attributed batch —
	// reject it so the user sees why instead of watching it flip back.
	if (status === "active") {
		const effectiveLimit =
			usageLimit !== undefined ? usageLimit : providerKey.usageLimit;
		if (
			effectiveLimit !== null &&
			new Decimal(providerKey.usage).greaterThanOrEqualTo(effectiveLimit)
		) {
			throw new HTTPException(400, {
				message:
					"This provider key has reached its spend limit. Raise or clear the limit to re-enable it.",
			});
		}
	}

	const updates: {
		status?: "active" | "inactive";
		name?: string;
		description?: string | null;
		customModelsOnly?: boolean;
		complianceAttestation?: ProviderKeyComplianceAttestation | null;
		usageLimit?: string | null;
		allowedModels?: string[] | null;
	} = {};
	if (status !== undefined) {
		updates.status = status;
	}
	if (allowedModels !== undefined) {
		updates.allowedModels = allowedModels;
	}
	if (usageLimit !== undefined) {
		updates.usageLimit = usageLimit;
	}
	if (name !== undefined) {
		updates.name = name;
	}
	if (description !== undefined) {
		updates.description = description || null;
	}
	if (customModelsOnly !== undefined) {
		updates.customModelsOnly = customModelsOnly;
	}
	if (complianceAttestation !== undefined) {
		updates.complianceAttestation = stampComplianceAttestation(
			complianceAttestation,
			user.id,
		);
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
	if (name !== undefined && providerKey.name !== name) {
		changes.name = { old: providerKey.name, new: name };
	}
	if (
		description !== undefined &&
		providerKey.description !== (description || null)
	) {
		changes.description = {
			old: providerKey.description,
			new: description || null,
		};
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
	if (complianceAttestation !== undefined) {
		changes.complianceAttestation = {
			old: providerKey.complianceAttestation ?? null,
			new: updates.complianceAttestation ?? null,
		};
	}
	if (usageLimit !== undefined && providerKey.usageLimit !== usageLimit) {
		changes.usageLimit = { old: providerKey.usageLimit, new: usageLimit };
	}
	if (
		allowedModels !== undefined &&
		(providerKey.allowedModels ?? []).join(",") !==
			(allowedModels ?? []).join(",")
	) {
		changes.allowedModels = {
			old: providerKey.allowedModels,
			new: allowedModels,
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
		providerKey: toPublicProviderKey(updatedProviderKey),
	});
});

const reorderSchema = z.object({
	organizationId: z.string(),
	provider: z.string(),
	/**
	 * Complete ordered list of the scope's non-deleted provider-key ids, primary
	 * first. Must match the scope's current membership exactly: a mismatch means
	 * the client's list is stale (a key was added or removed while dragging), and
	 * silently reshuffling around it would demote a key nobody chose to demote.
	 */
	providerKeyIds: z.array(z.string()).min(1).max(100),
});

const reorder = createRoute({
	method: "put",
	path: "/provider/order",
	request: {
		body: {
			content: {
				"application/json": {
					schema: reorderSchema,
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
						providerKeys: z.array(providerKeyPublicSchema).openapi({}),
					}),
				},
			},
			description: "Provider keys reordered.",
		},
		400: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Duplicate ids.",
		},
		401: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Unauthorized.",
		},
		404: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "Provider key not found.",
		},
		409: {
			content: {
				"application/json": {
					schema: z.object({ message: z.string() }),
				},
			},
			description: "The submitted order is out of date.",
		},
	},
});

/**
 * Sets the order the gateway tries an organization's keys for one provider.
 *
 * The gateway treats the first key as primary and only moves off it when that
 * key is excluded, unhealthy, or materially worse on uptime, so this is how an
 * operator promotes a key.
 *
 * Note for `custom`: `unique(organizationId, name)` means each custom provider
 * has exactly one key, so ordering there only affects how the dashboard lists
 * them — it cannot change which key serves a request.
 */
keysProvider.openapi(reorder, async (c) => {
	const user = c.get("user");
	if (!user) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { organizationId, provider, providerKeyIds } = c.req.valid("json");

	if (new Set(providerKeyIds).size !== providerKeyIds.length) {
		throw new HTTPException(400, {
			message: "providerKeyIds contains duplicate ids",
		});
	}

	const organizationIds = await getAdminOrganizationIds(user.id);
	if (!organizationIds.includes(organizationId)) {
		// Same message as an unknown key: a non-member must not be able to tell
		// "this organization exists" from "it does not".
		throw new HTTPException(404, { message: "Provider key not found" });
	}

	// Authoritative membership, read uncached: a cached set could omit a key
	// added moments ago and turn a valid request into a spurious 409.
	const scopeKeys = await db.query.providerKey.findMany({
		where: {
			organizationId: { eq: organizationId },
			provider: { eq: provider },
			managed: { eq: false },
			status: { ne: "deleted" },
		},
		columns: { id: true, sortOrder: true, createdAt: true },
	});

	const scopeIds = new Set(scopeKeys.map((key) => key.id));
	if (providerKeyIds.some((id) => !scopeIds.has(id))) {
		throw new HTTPException(404, { message: "Provider key not found" });
	}
	if (providerKeyIds.length !== scopeKeys.length) {
		// A key was added or removed while the user was dragging. Reject rather
		// than reshuffle around it: any rule for placing the missing key would
		// silently demote something nobody chose to demote. The client refetches
		// on error and the user retries against the real list.
		throw new HTTPException(409, {
			message: "Provider key order is out of date",
		});
	}

	// One statement, deliberately not a transaction: Drizzle invalidates the
	// cache before commit, so a transaction leaves a window where a gateway read
	// can repopulate Redis with the pre-reorder rows. A single autocommit UPDATE
	// closes that window and fires exactly one invalidation.
	const updated = await cdb
		.update(tables.providerKey)
		.set({
			sortOrder: sql`CASE ${tables.providerKey.id} ${sql.join(
				providerKeyIds.map(
					(id, index) => sql`WHEN ${id} THEN ${sql.raw(String(index))}`,
				),
				sql` `,
			)} END`,
		})
		.where(
			and(
				inArray(tables.providerKey.id, providerKeyIds),
				eq(tables.providerKey.organizationId, organizationId),
				eq(tables.providerKey.provider, provider),
				eq(tables.providerKey.managed, false),
				ne(tables.providerKey.status, "deleted"),
			),
		)
		.returning();

	const previousOrder = [...scopeKeys]
		.sort(
			(a, b) =>
				(a.sortOrder ?? Number.MAX_SAFE_INTEGER) -
					(b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
				a.createdAt.getTime() - b.createdAt.getTime() ||
				a.id.localeCompare(b.id),
		)
		.map((key) => key.id);

	if (previousOrder.join(",") !== providerKeyIds.join(",")) {
		await logAuditEvent({
			organizationId,
			userId: user.id,
			action: "provider_key.reorder",
			resourceType: "provider_key",
			metadata: {
				provider,
				changes: { order: { old: previousOrder, new: providerKeyIds } },
			},
		});
	}

	const byId = new Map(updated.map((row) => [row.id, row]));
	return c.json({
		message: "Provider key order updated",
		providerKeys: providerKeyIds
			.map((id) => byId.get(id))
			.filter((row): row is (typeof updated)[number] => row !== undefined)
			.map(toPublicProviderKey),
	});
});

export default keysProvider;
