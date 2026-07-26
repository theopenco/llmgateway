import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { maskToken } from "@/lib/maskToken.js";
import { adminMiddleware } from "@/middleware/admin.js";

import {
	encryptProviderKey,
	getManagedCredentialConfigKeys,
	getMissingManagedCredentialKeys,
	getUnknownManagedCredentialKeys,
	managedCredentialValidationOptions,
	providerKeyEncryptionScope,
	readProviderKey,
	redactToken,
	validateProviderKey,
} from "@llmgateway/actions";
import { and, cdb, db, eq, shortid, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getProviderApiKeyEnvCounts,
	getProviderEnvKeys,
	providers,
} from "@llmgateway/models";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import type { ServerTypes } from "@/vars.js";
import type { ProviderKeyVariant } from "@llmgateway/db";
import type { ProviderDefinition, ProviderId } from "@llmgateway/models";

export const adminProviderCredentials = new OpenAPIHono<ServerTypes>();

adminProviderCredentials.use("/*", adminMiddleware);

// Kept in lockstep with the schema's variant column via `satisfies`.
const PROVIDER_KEY_VARIANTS = [
	"default",
	"enterprise",
	"plans",
] as const satisfies readonly ProviderKeyVariant[];

const variantSchema = z.enum(PROVIDER_KEY_VARIANTS);
const statusSchema = z.enum(["active", "inactive"]);

const credentialSchema = z.object({
	id: z.string(),
	createdAt: z.date(),
	updatedAt: z.date(),
	provider: z.string(),
	comment: z.string().nullable(),
	variant: variantSchema,
	region: z.string().nullable(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	config: z.record(z.string(), z.string()),
	maskedToken: z.string(),
	/**
	 * HMAC fingerprint of the token, identical to `log.usedApiKeyHash` on the
	 * requests this credential served. The token itself is never returned.
	 */
	tokenHash: z.string().nullable(),
});

const configKeySchema = z.object({
	key: z.string(),
	envVar: z.string(),
	required: z.boolean(),
});

const catalogEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	/** Env var carrying the API key, shown so admins can find what to migrate. */
	apiKeyEnvVar: z.string().nullable(),
	/** Whether that env var is currently set on this deployment. */
	apiKeyEnvConfigured: z.boolean(),
	/**
	 * API keys configured through env vars per audience, so the form can show
	 * what a managed credential would be replacing for each one.
	 */
	apiKeyEnvCounts: z.object({
		default: z.number(),
		enterprise: z.number(),
		plans: z.number(),
	}),
	/**
	 * Regions the provider's catalogue declares. Empty for providers that are
	 * not region-scoped, in which case a credential must not carry a region at
	 * all — there is nothing for it to select against.
	 */
	regions: z.array(z.object({ id: z.string(), label: z.string() })),
	/** Region used when a credential does not pin one. Null when not region-scoped. */
	defaultRegion: z.string().nullable(),
	configKeys: z.array(configKeySchema),
});

type CredentialRow = typeof tables.providerKey.$inferSelect;

/**
 * Serializes a credential for the admin dashboard. Deliberately an explicit
 * allowlist rather than a spread: `row` is a full `provider_key` record
 * carrying `token`/`tokenCiphertext`, and neither may ever leave this process.
 * Once stored, a token is write-only — an operator identifies a credential by
 * its mask, its note, and `tokenHash`, which matches `log.usedApiKeyHash` on
 * the requests it served.
 */
function toCredential(row: CredentialRow) {
	return {
		id: row.id,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		provider: row.provider,
		comment: row.comment,
		variant: row.variant,
		region: row.region,
		status: row.status,
		config: row.config ?? {},
		maskedToken: row.tokenMasked ?? maskToken(row.token ?? ""),
		tokenHash: row.tokenHash,
	};
}

/**
 * Drops blank values so an emptied form field clears the setting instead of
 * storing an empty string, which would otherwise satisfy `?? env` lookups and
 * silently route to an empty base URL or project.
 */
function normalizeConfig(
	config: Record<string, string> | undefined,
): Record<string, string> {
	const normalized: Record<string, string> = {};
	for (const [key, value] of Object.entries(config ?? {})) {
		const trimmed = value.trim();
		if (trimmed) {
			normalized[key] = trimmed;
		}
	}
	return normalized;
}

/**
 * Validates a managed credential's settings against the provider catalogue:
 * every required setting must be present (nothing falls back to the
 * environment for a managed credential) and unknown keys are rejected so a
 * typo cannot masquerade as configuration. Any URL is checked for SSRF safety.
 */
async function validateConfig(
	provider: string,
	config: Record<string, string>,
): Promise<void> {
	if (!providers.some((p) => p.id === provider)) {
		throw new HTTPException(400, {
			message: `Unknown provider: ${provider}`,
		});
	}

	const unknown = getUnknownManagedCredentialKeys(provider, config);
	if (unknown.length > 0) {
		throw new HTTPException(400, {
			message: `Unsupported setting(s) for ${provider}: ${unknown.join(", ")}`,
		});
	}

	const missing = getMissingManagedCredentialKeys(provider, config);
	if (missing.length > 0) {
		throw new HTTPException(400, {
			message: `Missing required setting(s) for ${provider}: ${missing.join(", ")}`,
		});
	}

	for (const [key, value] of Object.entries(config)) {
		if (key.toLowerCase().includes("url")) {
			await assertSafeProviderUrl(value);
		}
	}
}

/**
 * A credential's region selects which region's traffic it serves, so it only
 * means anything for a provider whose catalogue declares regions, and only for
 * a region that catalogue actually lists. Anything else would produce a
 * credential that silently never matches a request.
 */
function validateRegion(provider: string, region: string | null): void {
	if (!region) {
		return;
	}

	const regions =
		(providers.find((p) => p.id === provider) as ProviderDefinition | undefined)
			?.regionConfig?.regions ?? [];

	if (regions.length === 0) {
		throw new HTTPException(400, {
			message: `${provider} is not region-scoped, so its credentials cannot pin a region`,
		});
	}

	if (!regions.some((entry) => entry.id === region)) {
		throw new HTTPException(400, {
			message: `Unknown region "${region}" for ${provider}. Available: ${regions
				.map((entry) => entry.id)
				.join(", ")}`,
		});
	}
}

/**
 * Confirms the credential actually works upstream by sending one minimal
 * completion through it, using exactly the settings the gateway will send with
 * it: the row's `config` surfaced as `env_config`, plus the region the
 * credential is pinned to. A managed credential serves every credits-mode
 * request for its provider, so a typo or expired token here breaks all traffic
 * rather than a single tenant's, and it stays broken until someone notices.
 *
 * Admins can pass `skipValidation` for the cases a live check cannot cover —
 * a provider whose catalogue has no chat model to validate against, or an
 * upstream that is temporarily down.
 */
async function validateCredentialToken(
	provider: string,
	token: string,
	config: Record<string, string>,
	region: string | null | undefined,
): Promise<void> {
	// Provider keys in unit tests are fixtures, not live credentials; e2e runs
	// opt back in so the real upstream path stays covered.
	const isTestEnv =
		process.env.NODE_ENV === "test" && process.env.E2E_TEST !== "true";
	if (isTestEnv) {
		return;
	}

	const result = await validateProviderKey(
		provider as ProviderId,
		token,
		undefined, // base URL travels in config/env_config for managed credentials
		false,
		managedCredentialValidationOptions(provider, config, region),
	);

	if (result.valid) {
		return;
	}

	// validateProviderKey already redacts, but any future path populating
	// `error` must not be allowed to echo the plaintext token back to the admin
	// client or into logs.
	const errorMessage = redactToken(
		result.error ?? "Invalid API key. Please make sure the key is correct.",
		token,
	);

	logger.warn("Managed provider credential validation failed", {
		provider,
		model: result.model ?? "unknown",
		statusCode: result.statusCode ?? "none",
		region: config.region ?? region ?? undefined,
		error: errorMessage,
	});

	const statusPart = result.statusCode ? ` (status ${result.statusCode})` : "";
	const modelPart = result.model ? ` using model ${result.model}` : "";
	throw new HTTPException(400, {
		message: `Credential rejected by ${provider}: ${errorMessage}${statusPart}${modelPart}. Pass skipValidation to store it anyway.`,
	});
}

const getCatalog = createRoute({
	method: "get",
	path: "/provider-credentials/catalog",
	request: {},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ providers: z.array(catalogEntrySchema) }),
				},
			},
			description:
				"Providers that accept managed credentials, with the settings each one takes.",
		},
	},
});

adminProviderCredentials.openapi(getCatalog, async (c) => {
	const entries = providers
		.filter((provider) => provider.id !== "custom")
		.map((provider) => {
			const apiKeyEnvVar =
				getProviderEnvKeys(provider.id).find((entry) => entry.key === "apiKey")
					?.envVar ?? null;
			const regionConfig = (provider as ProviderDefinition).regionConfig;
			return {
				id: provider.id,
				name: provider.name,
				apiKeyEnvVar,
				apiKeyEnvConfigured: apiKeyEnvVar
					? Boolean(process.env[apiKeyEnvVar])
					: false,
				regions: regionConfig?.regions ?? [],
				defaultRegion: regionConfig?.defaultRegion ?? null,
				apiKeyEnvCounts: getProviderApiKeyEnvCounts(provider.id),
				configKeys: getManagedCredentialConfigKeys(provider.id),
			};
		});

	return c.json({ providers: entries });
});

const listCredentials = createRoute({
	method: "get",
	path: "/provider-credentials",
	request: {
		query: z.object({
			provider: z.string().optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						credentials: z.array(credentialSchema),
					}),
				},
			},
			description: "Platform-managed provider credentials.",
		},
	},
});

adminProviderCredentials.openapi(listCredentials, async (c) => {
	const { provider } = c.req.valid("query");

	const rows = await db.query.providerKey.findMany({
		where: {
			managed: { eq: true },
			status: { ne: "deleted" },
			...(provider ? { provider: { eq: provider } } : {}),
		},
		orderBy: {
			provider: "asc",
			createdAt: "asc",
		},
	});

	return c.json({ credentials: rows.map(toCredential) });
});

const createCredential = createRoute({
	method: "post",
	path: "/provider-credentials",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						provider: z.string(),
						token: z.string().min(1),
						comment: z.string().max(500).optional(),
						variant: variantSchema.optional(),
						region: z.string().max(64).optional(),
						config: z.record(z.string(), z.string()).optional(),
						skipValidation: z.boolean().optional(),
					}),
				},
			},
		},
	},
	responses: {
		201: {
			content: {
				"application/json": {
					schema: z.object({ credential: credentialSchema }),
				},
			},
			description: "Created credential.",
		},
	},
});

adminProviderCredentials.openapi(createCredential, async (c) => {
	const user = c.get("user")!;
	const body = c.req.valid("json");
	const config = normalizeConfig(body.config);

	await validateConfig(body.provider, config);
	validateRegion(body.provider, body.region?.trim() || null);

	if (!body.skipValidation) {
		await validateCredentialToken(
			body.provider,
			body.token,
			config,
			body.region,
		);
	}

	// Generate the id up front so the AAD — which binds the ciphertext to the
	// row id and the managed scope — can be computed before the INSERT.
	const id = shortid();
	const [created] = await cdb
		.insert(tables.providerKey)
		.values({
			id,
			managed: true,
			organizationId: null,
			provider: body.provider,
			token: null,
			tokenCiphertext: encryptProviderKey(
				body.token,
				id,
				providerKeyEncryptionScope(null),
			),
			tokenMasked: maskToken(body.token),
			tokenHash: getApiKeyFingerprint(body.token),
			comment: body.comment?.trim() || null,
			variant: body.variant ?? "default",
			region: body.region?.trim() || null,
			config,
		})
		.returning();

	logger.info("Managed provider credential created", {
		credentialId: created.id,
		provider: created.provider,
		variant: created.variant,
		region: created.region ?? undefined,
		userId: user.id,
	});

	return c.json({ credential: toCredential(created) }, 201);
});

const updateCredential = createRoute({
	method: "patch",
	path: "/provider-credentials/{id}",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						token: z.string().min(1).optional(),
						comment: z.string().max(500).nullable().optional(),
						variant: variantSchema.optional(),
						region: z.string().max(64).nullable().optional(),
						status: statusSchema.optional(),
						config: z.record(z.string(), z.string()).optional(),
						skipValidation: z.boolean().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ credential: credentialSchema }),
				},
			},
			description: "Updated credential.",
		},
	},
});

adminProviderCredentials.openapi(updateCredential, async (c) => {
	const user = c.get("user")!;
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");

	const existing = await db.query.providerKey.findFirst({
		where: {
			id: { eq: id },
			managed: { eq: true },
			status: { ne: "deleted" },
		},
	});

	if (!existing) {
		throw new HTTPException(404, { message: "Credential not found" });
	}

	const updates: Partial<typeof tables.providerKey.$inferInsert> = {};

	if (body.config !== undefined) {
		const config = normalizeConfig(body.config);
		await validateConfig(existing.provider, config);
		updates.config = config;
	}

	if (body.region !== undefined) {
		validateRegion(existing.provider, body.region?.trim() || null);
	}

	// A new token, a changed config and a changed region all alter what the
	// gateway will send upstream or which endpoint it reaches, so revalidate on
	// any of them — a key enabled in one region is not necessarily enabled in
	// another. Edits that leave the token alone are checked against the stored
	// one, which is the pair that will actually serve traffic.
	if (
		!body.skipValidation &&
		(body.token !== undefined ||
			body.config !== undefined ||
			body.region !== undefined)
	) {
		await validateCredentialToken(
			existing.provider,
			body.token ?? readProviderKey(existing),
			updates.config ?? existing.config ?? {},
			body.region !== undefined ? body.region : existing.region,
		);
	}

	if (body.token !== undefined) {
		updates.token = null;
		updates.tokenCiphertext = encryptProviderKey(
			body.token,
			existing.id,
			providerKeyEncryptionScope(existing.organizationId),
		);
		updates.tokenMasked = maskToken(body.token);
		updates.tokenHash = getApiKeyFingerprint(body.token);
	}

	if (body.comment !== undefined) {
		updates.comment = body.comment?.trim() || null;
	}
	if (body.variant !== undefined) {
		updates.variant = body.variant;
	}
	if (body.region !== undefined) {
		updates.region = body.region?.trim() || null;
	}
	if (body.status !== undefined) {
		updates.status = body.status;
	}

	if (Object.keys(updates).length === 0) {
		return c.json({ credential: toCredential(existing) });
	}

	const [updated] = await cdb
		.update(tables.providerKey)
		.set(updates)
		.where(
			and(eq(tables.providerKey.id, id), eq(tables.providerKey.managed, true)),
		)
		.returning();

	logger.info("Managed provider credential updated", {
		credentialId: updated.id,
		provider: updated.provider,
		fields: Object.keys(updates),
		userId: user.id,
	});

	return c.json({ credential: toCredential(updated) });
});

const deleteCredential = createRoute({
	method: "delete",
	path: "/provider-credentials/{id}",
	request: {
		params: z.object({ id: z.string() }),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ success: z.boolean() }),
				},
			},
			description: "Credential deleted.",
		},
	},
});

adminProviderCredentials.openapi(deleteCredential, async (c) => {
	const user = c.get("user")!;
	const { id } = c.req.valid("param");

	// Soft delete: request logs reference provider-key ids for health tracking
	// and attribution, so the row must survive.
	const [deleted] = await cdb
		.update(tables.providerKey)
		.set({ status: "deleted" })
		.where(
			and(eq(tables.providerKey.id, id), eq(tables.providerKey.managed, true)),
		)
		.returning({ id: tables.providerKey.id });

	if (!deleted) {
		throw new HTTPException(404, { message: "Credential not found" });
	}

	logger.info("Managed provider credential deleted", {
		credentialId: deleted.id,
		userId: user.id,
	});

	return c.json({ success: true });
});

export default adminProviderCredentials;
