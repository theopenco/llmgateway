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
	providerKeyEncryptionScope,
} from "@llmgateway/actions";
import { and, cdb, db, eq, shortid, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import { getProviderEnvKeys, providers } from "@llmgateway/models";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import type { ServerTypes } from "@/vars.js";
import type { ProviderKeyVariant } from "@llmgateway/db";

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
	configKeys: z.array(configKeySchema),
});

type CredentialRow = typeof tables.providerKey.$inferSelect;

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
			return {
				id: provider.id,
				name: provider.name,
				apiKeyEnvVar,
				apiKeyEnvConfigured: apiKeyEnvVar
					? Boolean(process.env[apiKeyEnvVar])
					: false,
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

	if (body.token !== undefined) {
		updates.token = null;
		updates.tokenCiphertext = encryptProviderKey(
			body.token,
			existing.id,
			providerKeyEncryptionScope(existing.organizationId),
		);
		updates.tokenMasked = maskToken(body.token);
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
