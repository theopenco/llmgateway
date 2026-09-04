import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { Decimal } from "decimal.js";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
	allowedModelsSchema,
	normalizeAllowedModels,
	pickAllowedValidationModel,
	validateAllowedModels,
} from "@/lib/provider-key-allowed-models.js";
import {
	getBucketUnitForWindow,
	getTokenWindowStartDate,
	getWindowBucketTimestamps,
	tokenWindowSchema,
} from "@/lib/stats-window.js";
import { adminMiddleware } from "@/middleware/admin.js";
import { createNullableLimitSchema } from "@/routes/keys-api.js";

import {
	collectProviderEnvCredentials,
	countEnvCredentialsByVariant,
	encryptProviderKey,
	getManagedCredentialConfigKeys,
	getMissingManagedCredentialKeys,
	getPinnedValidationModel,
	getUnknownManagedCredentialKeys,
	managedCredentialValidationOptions,
	providerKeyEncryptionScope,
	readProviderEnvInventory,
	readProviderKey,
	readProviderKeyMask,
	redactToken,
	validateProviderKey,
} from "@llmgateway/actions";
import {
	and,
	cdb,
	db,
	desc,
	eq,
	gte,
	inArray,
	ne,
	shortid,
	sql,
	tables,
} from "@llmgateway/db";
import { logger } from "@llmgateway/logger";
import {
	getProviderEnvExclusiveGroups,
	getProviderEnvExclusiveViolations,
	getProviderEnvKeys,
	providers,
} from "@llmgateway/models";
import {
	createEmptyProviderModelsByKind,
	getModelIdsByProvider,
	getModelIdsByProviderAndKind,
} from "@llmgateway/shared";
import { getApiKeyFingerprint } from "@llmgateway/shared/api-key-hash";
import { maskToken } from "@llmgateway/shared/mask-token";
import { assertSafeProviderUrl } from "@llmgateway/shared/url-safety-node";

import type { ServerTypes } from "@/vars.js";
import type { ProviderKeyVariant, SQL } from "@llmgateway/db";
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
	/** USD spend cap; the credential auto-deactivates when usage reaches it. */
	usageLimit: z.string().nullable(),
	/** Cumulative upstream spend (USD) attributed by the billing worker. */
	usage: z.string(),
	maskedToken: z.string(),
	/**
	 * HMAC fingerprint of the token, identical to `log.usedApiKeyHash` on the
	 * requests this credential served. The token itself is never returned.
	 */
	tokenHash: z.string().nullable(),
	/**
	 * Canonical model ids this credential may serve; routing skips it for any
	 * other model. Null means the credential serves the provider's full
	 * catalogue.
	 */
	allowedModels: z.array(z.string()).nullable(),
});

const configKeySchema = z.object({
	key: z.string(),
	envVar: z.string(),
	required: z.boolean(),
});

/**
 * One API key currently configured through the deployment's environment,
 * masked and fingerprinted exactly like a managed credential so an operator
 * can tell which keys serve traffic and correlate them with
 * `log.usedApiKeyHash`. The plaintext never leaves the process that holds it.
 */
const envCredentialSchema = z.object({
	/** Variable the key comes from, including any variant/region suffix. */
	envVar: z.string(),
	variant: variantSchema,
	/** Region the variable is scoped to via `__{REGION}`, null for the base. */
	region: z.string().nullable(),
	/** Position in the comma-separated list; matches the gateway's configIndex. */
	index: z.number(),
	maskedToken: z.string(),
	/** HMAC fingerprint, identical to `log.usedApiKeyHash` on requests it served. */
	tokenHash: z.string(),
});

const catalogEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	/** Env var carrying the API key, shown so admins can find what to migrate. */
	apiKeyEnvVar: z.string().nullable(),
	/** Whether that env var is set wherever the reported keys were read from. */
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
	 * Every API key the environment `envSource` names currently holds for this
	 * provider — the gateway's, or this process's own when no gateway has
	 * published — across the base variable and its variant/region overrides.
	 * These are read-only from the dashboard: they can only be changed by
	 * redeploying, and once the provider has any active managed credential all
	 * of them stop being used — managed credentials replace the environment for
	 * their provider rather than taking precedence key by key.
	 */
	envCredentials: z.array(envCredentialSchema),
	/**
	 * Regions the provider's catalogue declares. Empty for providers that are
	 * not region-scoped, in which case a credential must not carry a region at
	 * all — there is nothing for it to select against.
	 */
	regions: z.array(z.object({ id: z.string(), label: z.string() })),
	/** Region used when a credential does not pin one. Null when not region-scoped. */
	defaultRegion: z.string().nullable(),
	configKeys: z.array(configKeySchema),
	/**
	 * Groups of settings where exactly one member must be supplied. The form
	 * uses these to explain the choice and to keep the operator from filling
	 * more than one.
	 */
	exclusiveConfigGroups: z.array(
		z.object({ keys: z.array(z.string()), description: z.string() }),
	),
	/**
	 * Canonical model ids the catalogue currently maps to this provider
	 * (deactivated mappings excluded), for the allowed-models picker.
	 */
	models: z.array(z.string()),
	/** Catalogue models grouped by the request surface used to invoke them. */
	modelsByKind: z.object({
		text: z.array(z.string()),
		image: z.array(z.string()),
		ocr: z.array(z.string()),
		embedding: z.array(z.string()),
		video: z.array(z.string()),
	}),
});

type CredentialRow = typeof tables.providerKey.$inferSelect;

/**
 * Serializes a credential for the admin dashboard. Deliberately an explicit
 * allowlist rather than a spread: `row` is a full `provider_key` record
 * carrying `tokenCiphertext`, which must never leave this process.
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
		usageLimit: row.usageLimit,
		usage: row.usage,
		maskedToken: readProviderKeyMask(row),
		tokenHash: row.tokenHash,
		allowedModels: row.allowedModels,
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
	// "custom" is a per-organization BYOK construct (each key defines its own
	// upstream); there is no platform-wide custom deployment a managed
	// credential could describe, and the catalog route excludes it for the same
	// reason. Allowing it here would advertise `custom` as credits-routable off
	// a row that can never serve a request.
	if (provider === "custom" || !providers.some((p) => p.id === provider)) {
		const carrier =
			provider === "custom" ? null : await findActiveCustomCarrier(provider);
		if (!carrier) {
			throw new HTTPException(400, {
				message: `Unknown provider: ${provider}`,
			});
		}
		// A custom Airside carrier's endpoint is fixed at registration (the
		// claim's base URL); its managed credential is only the API key we
		// hold for it, so it takes no settings.
		if (Object.keys(config).length > 0) {
			throw new HTTPException(400, {
				message: `Custom carrier credentials take no settings — the endpoint comes from the carrier registration.`,
			});
		}
		return;
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

	const exclusiveViolations = getProviderEnvExclusiveViolations(
		provider,
		config,
	);
	if (exclusiveViolations.length > 0) {
		throw new HTTPException(400, {
			message: `Invalid setting(s) for ${provider}: ${exclusiveViolations.join(" ")}`,
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
 * Provider keys in unit tests are fixtures, not live credentials; e2e runs
 * opt back in so the real upstream path stays covered.
 */
function isCredentialTestEnv(): boolean {
	return process.env.NODE_ENV === "test" && process.env.E2E_TEST !== "true";
}

/** The active custom-carrier registration for a non-catalogue provider id,
 *  if any — these accept managed credentials like catalogue providers do. */
async function findActiveCustomCarrier(providerId: string) {
	return await db.query.providerClaim.findFirst({
		where: {
			providerId: { eq: providerId },
			kind: { eq: "custom" },
			status: { eq: "active" },
		},
	});
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
 *
 * A credential restricted via `allowedModels` is probed with one of its own
 * (chat-capable) allowed models instead of the provider's default validation
 * model: the whole point of the restriction is that the account may not have
 * the default model, so probing it would force skipValidation on exactly the
 * credentials the restriction exists for. When no allowed model can answer a
 * chat probe (image/embedding-only lists), the live check is skipped.
 */
async function validateCredentialToken(
	provider: string,
	token: string,
	config: Record<string, string>,
	region: string | null | undefined,
	allowedModels?: string[] | null,
): Promise<void> {
	// Provider keys in unit tests are fixtures, not live credentials; e2e runs
	// opt back in so the real upstream path stays covered.
	if (isCredentialTestEnv()) {
		return;
	}

	// Custom carriers have no catalogue validation model to probe (and
	// validateProviderKey short-circuits for them) — store without a live check.
	if (!providers.some((p) => p.id === provider)) {
		return;
	}

	const validationOptions = managedCredentialValidationOptions(
		provider,
		config,
		region,
	);

	const pinnedModelId = pickAllowedValidationModel(
		provider,
		allowedModels ?? null,
		validationOptions,
	);
	if (allowedModels?.length && !pinnedModelId) {
		return;
	}

	const result = await validateProviderKey(
		provider as ProviderId,
		token,
		undefined, // base URL travels in config/env_config for managed credentials
		false,
		validationOptions,
		pinnedModelId,
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
	// A connectivity failure says nothing about the credential — report it as
	// what it is so the admin fixes the endpoint config, not the key.
	if (result.unreachable) {
		throw new HTTPException(400, {
			message: `Could not reach ${provider} to validate the credential${modelPart}: ${errorMessage}. Pass skipValidation to store it anyway.`,
		});
	}
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
					schema: z.object({
						providers: z.array(catalogEntrySchema),
						/**
						 * Where the reported env credentials were read from.
						 * `gateway` is the snapshot the gateway publishes for its own
						 * process — the keys that actually serve traffic. `api` is this
						 * process's own environment, used only when no gateway has
						 * published one (single-process deployments, or a gateway that
						 * cannot reach this Redis).
						 */
						envSource: z.enum(["gateway", "api"]),
						/** When the gateway published its snapshot; null for `api`. */
						envPublishedAt: z.string().nullable(),
					}),
				},
			},
			description:
				"Providers that accept managed credentials, with the settings each one takes.",
		},
	},
});

adminProviderCredentials.openapi(getCatalog, async (c) => {
	// Live catalogue models per provider, for the allowed-models picker.
	const modelsByProvider = getModelIdsByProvider();
	const modelsByProviderAndKind = getModelIdsByProviderAndKind();

	// Provider keys live on the gateway, which is a separate deployment: reading
	// this process's own environment would report nothing at all in a split
	// setup, and where both services happen to hold keys the API's copy can
	// differ from the set actually spending money. Prefer what the gateway
	// published about itself, and fall back to local env only when there is no
	// snapshot.
	const inventory = await readProviderEnvInventory();

	const entries = providers
		.filter((provider) => provider.id !== "custom")
		.map((provider) => {
			const apiKeyEnvVar =
				getProviderEnvKeys(provider.id).find((entry) => entry.key === "apiKey")
					?.envVar ?? null;
			const regionConfig = (provider as ProviderDefinition).regionConfig;
			const regions = regionConfig?.regions ?? [];
			const envCredentials = inventory
				? (inventory.providers[provider.id] ?? [])
				: collectProviderEnvCredentials(provider.id);
			const apiKeyEnvCounts = countEnvCredentialsByVariant(envCredentials);
			return {
				id: provider.id,
				name: provider.name,
				apiKeyEnvVar,
				apiKeyEnvConfigured: apiKeyEnvCounts.default > 0,
				regions,
				defaultRegion: regionConfig?.defaultRegion ?? null,
				apiKeyEnvCounts,
				envCredentials,
				configKeys: getManagedCredentialConfigKeys(provider.id),
				exclusiveConfigGroups: getProviderEnvExclusiveGroups(provider.id),
				models: modelsByProvider.get(provider.id) ?? [],
				modelsByKind:
					modelsByProviderAndKind.get(provider.id) ??
					createEmptyProviderModelsByKind(),
			};
		});

	// Active custom Airside carriers accept managed credentials too: no env
	// vars, no settings (their endpoint lives on the carrier registration),
	// and their model list comes from their approved listings.
	const customCarriers = await db.query.providerClaim.findMany({
		where: { kind: { eq: "custom" }, status: { eq: "active" } },
	});
	const customListings = customCarriers.length
		? await db.query.providerDraftModel.findMany({
				where: {
					providerId: { in: customCarriers.map((cl) => cl.providerId) },
					status: { eq: "active" },
				},
				columns: { providerId: true, modelName: true },
			})
		: [];
	const carrierEntries = customCarriers.map((cl) => {
		const carrierModels = customListings
			.filter((m) => m.providerId === cl.providerId)
			.map((m) => m.modelName);
		return {
			id: cl.providerId,
			name: cl.customName ?? cl.providerId,
			apiKeyEnvVar: null,
			apiKeyEnvConfigured: false,
			regions: [],
			defaultRegion: null,
			apiKeyEnvCounts: countEnvCredentialsByVariant([]),
			envCredentials: [],
			configKeys: [],
			exclusiveConfigGroups: [],
			models: carrierModels,
			modelsByKind: {
				...createEmptyProviderModelsByKind(),
				text: carrierModels,
			},
		};
	});

	return c.json({
		providers: [...entries, ...carrierEntries],
		envSource: inventory ? ("gateway" as const) : ("api" as const),
		envPublishedAt: inventory?.publishedAt ?? null,
	});
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
			sortOrder: "asc",
			createdAt: "asc",
			// Same full tiebreak as the gateway's selection order, so the row the
			// dashboard shows first is the row that actually serves traffic even
			// when sortOrder and createdAt tie.
			id: "asc",
		},
	});

	return c.json({ credentials: rows.map(toCredential) });
});

/**
 * ISO-8601 UTC label for a truncated bucket, formatted the same way
 * `Date#toISOString` would, so it can be compared to a generated bucket grid.
 */
function bucketLabel(bucketExpr: SQL<Date>) {
	return sql<string>`to_char(${bucketExpr}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
}

const spendPointSchema = z.object({
	timestamp: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	errorCount: z.number(),
	upstreamErrorCount: z.number(),
	totalTokens: z.string(),
});

const spendByOrganizationSchema = z.object({
	organizationId: z.string(),
	organizationName: z.string().nullable(),
	cost: z.number(),
	requestCount: z.number(),
});

const providerKeySpendSchema = z.object({
	window: tokenWindowSchema,
	bucket: z.enum(["hour", "day"]),
	key: z.object({
		id: z.string(),
		provider: z.string(),
		name: z.string().nullable(),
		managed: z.boolean(),
		status: z.string().nullable(),
		organizationId: z.string().nullable(),
		/** Lifetime counter the spend limit is enforced against. */
		usage: z.string(),
		usageLimit: z.string().nullable(),
	}),
	/** Window totals, from the rollup — not the lifetime `key.usage` counter. */
	totalCost: z.number(),
	totalRequests: z.number(),
	totalErrors: z.number(),
	/**
	 * Every bucket boundary in the window, including the quiet ones `data` skips,
	 * so a chart can zero-fill and span the whole selected duration.
	 */
	buckets: z.array(z.string()),
	data: z.array(spendPointSchema),
	/**
	 * Spend split by consuming organization, highest first. Always a single
	 * entry for a BYOK key; the interesting case is a managed credential shared
	 * across tenants.
	 */
	organizations: z.array(spendByOrganizationSchema),
});

const getProviderKeySpend = createRoute({
	method: "get",
	path: "/provider-keys/{providerKeyId}/spend",
	request: {
		params: z.object({ providerKeyId: z.string() }),
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: providerKeySpendSchema,
				},
			},
			description:
				"Upstream spend attributed to a provider key over time, split by consuming organization.",
		},
		404: {
			description: "Provider key not found.",
		},
	},
});

adminProviderCredentials.openapi(getProviderKeySpend, async (c) => {
	const { providerKeyId } = c.req.valid("param");
	const window = c.req.valid("query").window ?? "7d";
	const startDate = getTokenWindowStartDate(window);
	const bucketUnit = getBucketUnitForWindow(window);

	const key = await db.query.providerKey.findFirst({
		where: { id: { eq: providerKeyId } },
	});

	// Soft-deleted keys are deliberately still readable here: the admin
	// organization view lists them, and their attributed spend stays in the
	// rollup after the key is retired — which is exactly when someone asks what
	// it cost.
	if (!key) {
		throw new HTTPException(404, { message: "Provider key not found" });
	}

	const bucketExpr = sql<Date>`date_trunc(${sql.raw(`'${bucketUnit}'`)}, ${tables.providerKeyHourlyStats.hourTimestamp})`;
	// `hourTimestamp` is a zone-less `timestamp` holding UTC, so label the bucket
	// in SQL rather than letting the driver reinterpret it in the process
	// timezone — that is what makes these strings line up with the zero-filled
	// `buckets` grid below.
	const bucketLabelExpr = bucketLabel(bucketExpr);

	const baseFilter = and(
		eq(tables.providerKeyHourlyStats.providerKeyId, providerKeyId),
		gte(tables.providerKeyHourlyStats.hourTimestamp, startDate),
	);

	const [points, organizations] = await Promise.all([
		db
			.select({
				timestamp: bucketLabelExpr.as("bucket"),
				cost: sql<number>`COALESCE(SUM(cast(${tables.providerKeyHourlyStats.cost} as double precision)), 0)`.as(
					"cost",
				),
				requestCount:
					sql<number>`COALESCE(SUM(${tables.providerKeyHourlyStats.requestCount}), 0)`.as(
						"request_count",
					),
				errorCount:
					sql<number>`COALESCE(SUM(${tables.providerKeyHourlyStats.errorCount}), 0)`.as(
						"error_count",
					),
				upstreamErrorCount:
					sql<number>`COALESCE(SUM(${tables.providerKeyHourlyStats.upstreamErrorCount}), 0)`.as(
						"upstream_error_count",
					),
				totalTokens:
					sql<string>`COALESCE(SUM(CAST(${tables.providerKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
						"total_tokens",
					),
			})
			.from(tables.providerKeyHourlyStats)
			.where(baseFilter)
			.groupBy(bucketExpr)
			.orderBy(bucketExpr),
		// Attribution runs through the denormalized projectId, so the consuming
		// organization comes from the project rather than the key: a managed
		// credential has no organizationId of its own.
		db
			.select({
				organizationId: tables.project.organizationId,
				organizationName: tables.organization.name,
				cost: sql<number>`COALESCE(SUM(cast(${tables.providerKeyHourlyStats.cost} as double precision)), 0)`.as(
					"cost",
				),
				requestCount:
					sql<number>`COALESCE(SUM(${tables.providerKeyHourlyStats.requestCount}), 0)`.as(
						"request_count",
					),
			})
			.from(tables.providerKeyHourlyStats)
			.innerJoin(
				tables.project,
				eq(tables.project.id, tables.providerKeyHourlyStats.projectId),
			)
			.leftJoin(
				tables.organization,
				eq(tables.organization.id, tables.project.organizationId),
			)
			.where(baseFilter)
			.groupBy(tables.project.organizationId, tables.organization.name)
			.orderBy(
				desc(
					sql`SUM(cast(${tables.providerKeyHourlyStats.cost} as double precision))`,
				),
			)
			.limit(20),
	]);

	const data = points.map((point) => ({
		timestamp: point.timestamp,
		cost: Number(point.cost),
		requestCount: Number(point.requestCount),
		errorCount: Number(point.errorCount),
		upstreamErrorCount: Number(point.upstreamErrorCount),
		totalTokens: String(point.totalTokens),
	}));

	return c.json({
		window,
		bucket: bucketUnit,
		key: {
			id: key.id,
			provider: key.provider,
			name: key.name,
			managed: key.managed,
			status: key.status,
			organizationId: key.organizationId,
			usage: key.usage,
			usageLimit: key.usageLimit,
		},
		totalCost: data.reduce((sum, point) => sum + point.cost, 0),
		totalRequests: data.reduce((sum, point) => sum + point.requestCount, 0),
		totalErrors: data.reduce((sum, point) => sum + point.errorCount, 0),
		buckets: getWindowBucketTimestamps(window),
		data,
		organizations: organizations.map((row) => ({
			organizationId: row.organizationId,
			organizationName: row.organizationName,
			cost: Number(row.cost),
			requestCount: Number(row.requestCount),
		})),
	});
});

const spendOverviewKeySchema = z.object({
	id: z.string(),
	provider: z.string(),
	variant: variantSchema,
	region: z.string().nullable(),
	comment: z.string().nullable(),
	maskedToken: z.string(),
	status: z.enum(["active", "inactive", "deleted"]).nullable(),
	/** Lifetime counter the spend limit is enforced against. */
	usage: z.string(),
	usageLimit: z.string().nullable(),
	/** Window totals, from the rollup — not the lifetime `usage` counter. */
	totalCost: z.number(),
	totalRequests: z.number(),
	totalTokens: z.string(),
});

const spendOverviewPointSchema = z.object({
	timestamp: z.string(),
	providerKeyId: z.string(),
	cost: z.number(),
	requestCount: z.number(),
	totalTokens: z.string(),
});

const spendOverviewSchema = z.object({
	window: tokenWindowSchema,
	bucket: z.enum(["hour", "day"]),
	/**
	 * Every managed credential, in the gateway's selection order. Soft-deleted
	 * ones appear only while they still have attributed spend in the window —
	 * their history should not vanish before the money stops being interesting.
	 */
	keys: z.array(spendOverviewKeySchema),
	/**
	 * Every bucket boundary in the window, quiet ones included. `data` only
	 * carries buckets that saw traffic, so the chart zero-fills against this grid
	 * instead of collapsing to the busy days.
	 */
	buckets: z.array(z.string()),
	/** One row per (bucket, credential); pivot client-side for stacking. */
	data: z.array(spendOverviewPointSchema),
});

const getSpendOverview = createRoute({
	method: "get",
	path: "/provider-credentials/spend",
	request: {
		query: z.object({
			window: tokenWindowSchema.default("7d").optional(),
		}),
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: spendOverviewSchema,
				},
			},
			description:
				"Upstream spend over time for every managed credential, one series per key.",
		},
	},
});

/**
 * The whole-fleet counterpart of the per-key spend route above: one query
 * grouped by credential so the dashboard can stack every key of a provider in
 * a single chart. Env-var credentials cannot appear here — requests they serve
 * are logged with a NULL `providerKeyId`, so there is nothing to attribute.
 */
adminProviderCredentials.openapi(getSpendOverview, async (c) => {
	const window = c.req.valid("query").window ?? "7d";
	const startDate = getTokenWindowStartDate(window);
	const bucketUnit = getBucketUnitForWindow(window);

	const bucketExpr = sql<Date>`date_trunc(${sql.raw(`'${bucketUnit}'`)}, ${tables.providerKeyHourlyStats.hourTimestamp})`;
	const bucketLabelExpr = bucketLabel(bucketExpr);

	const [keys, points] = await Promise.all([
		// Any status: a soft-deleted key is kept when the window still holds its
		// spend, and dropped below once it has aged out.
		db.query.providerKey.findMany({
			where: { managed: { eq: true } },
			orderBy: {
				provider: "asc",
				sortOrder: "asc",
				createdAt: "asc",
				id: "asc",
			},
		}),
		db
			.select({
				timestamp: bucketLabelExpr.as("bucket"),
				providerKeyId: tables.providerKeyHourlyStats.providerKeyId,
				cost: sql<number>`COALESCE(SUM(cast(${tables.providerKeyHourlyStats.cost} as double precision)), 0)`.as(
					"cost",
				),
				requestCount:
					sql<number>`COALESCE(SUM(${tables.providerKeyHourlyStats.requestCount}), 0)`.as(
						"request_count",
					),
				totalTokens:
					sql<string>`COALESCE(SUM(CAST(${tables.providerKeyHourlyStats.totalTokens} AS NUMERIC)), 0)`.as(
						"total_tokens",
					),
			})
			.from(tables.providerKeyHourlyStats)
			.innerJoin(
				tables.providerKey,
				eq(tables.providerKey.id, tables.providerKeyHourlyStats.providerKeyId),
			)
			.where(
				and(
					eq(tables.providerKey.managed, true),
					gte(tables.providerKeyHourlyStats.hourTimestamp, startDate),
				),
			)
			.groupBy(bucketExpr, tables.providerKeyHourlyStats.providerKeyId)
			.orderBy(bucketExpr),
	]);

	const data = points.map((point) => ({
		timestamp: point.timestamp,
		providerKeyId: point.providerKeyId,
		cost: Number(point.cost),
		requestCount: Number(point.requestCount),
		totalTokens: String(point.totalTokens),
	}));

	const totalsByKey = new Map<
		string,
		{ cost: number; requests: number; tokens: Decimal }
	>();
	for (const point of data) {
		const totals = totalsByKey.get(point.providerKeyId) ?? {
			cost: 0,
			requests: 0,
			tokens: new Decimal(0),
		};
		totals.cost += point.cost;
		totals.requests += point.requestCount;
		totals.tokens = totals.tokens.plus(point.totalTokens);
		totalsByKey.set(point.providerKeyId, totals);
	}

	return c.json({
		window,
		bucket: bucketUnit,
		buckets: getWindowBucketTimestamps(window),
		keys: keys
			.filter((key) => key.status !== "deleted" || totalsByKey.has(key.id))
			.map((key) => {
				const totals = totalsByKey.get(key.id);
				return {
					id: key.id,
					provider: key.provider,
					variant: key.variant,
					region: key.region,
					comment: key.comment,
					maskedToken: readProviderKeyMask(key),
					status: key.status,
					usage: key.usage,
					usageLimit: key.usageLimit,
					totalCost: totals?.cost ?? 0,
					totalRequests: totals?.requests ?? 0,
					totalTokens: totals?.tokens.toString() ?? "0",
				};
			}),
		data,
	});
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
						usageLimit: createNullableLimitSchema("Usage limit").optional(),
						allowedModels: allowedModelsSchema,
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
	const allowedModels = normalizeAllowedModels(body.allowedModels);

	await validateConfig(body.provider, config);
	validateRegion(body.provider, body.region?.trim() || null);
	validateAllowedModels(
		body.provider,
		allowedModels,
		managedCredentialValidationOptions(body.provider, config, body.region),
	);

	if (!body.skipValidation) {
		await validateCredentialToken(
			body.provider,
			body.token,
			config,
			body.region,
			allowedModels,
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
			usageLimit: body.usageLimit ?? null,
			allowedModels,
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
						usageLimit: createNullableLimitSchema("Usage limit").optional(),
						allowedModels: allowedModelsSchema,
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

	if (body.allowedModels !== undefined) {
		const allowedModels = normalizeAllowedModels(body.allowedModels);
		// Checked against the config/region this PATCH leaves in effect, so an
		// edit that also moves the region validates against the right mapping.
		validateAllowedModels(
			existing.provider,
			allowedModels,
			managedCredentialValidationOptions(
				existing.provider,
				updates.config ?? existing.config ?? {},
				body.region !== undefined ? body.region : existing.region,
			),
		);
		updates.allowedModels = allowedModels;
	}

	// A new token, a changed config and a changed region all alter what the
	// gateway will send upstream or which endpoint it reaches, so revalidate on
	// any of them — a key enabled in one region is not necessarily enabled in
	// another. A changed allowedModels list revalidates too, because it changes
	// which model the probe uses (the account may not have the default one).
	// Edits that leave the token alone are checked against the stored one,
	// which is the pair that will actually serve traffic.
	if (
		!body.skipValidation &&
		(body.token !== undefined ||
			body.config !== undefined ||
			body.region !== undefined ||
			body.allowedModels !== undefined)
	) {
		await validateCredentialToken(
			existing.provider,
			body.token ?? readProviderKey(existing),
			updates.config ?? existing.config ?? {},
			body.region !== undefined ? body.region : existing.region,
			body.allowedModels !== undefined
				? (updates.allowedModels ?? null)
				: existing.allowedModels,
		);
	}

	if (body.token !== undefined) {
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
	if (body.usageLimit !== undefined) {
		updates.usageLimit = body.usageLimit;
	}

	// Reactivating an over-limit credential without raising or clearing the
	// limit would just get it re-deactivated by the worker on its next
	// attributed batch — reject it so the operator sees why instead of watching
	// the status silently flip back.
	if (body.status === "active") {
		const effectiveLimit =
			body.usageLimit !== undefined ? body.usageLimit : existing.usageLimit;
		if (
			effectiveLimit !== null &&
			new Decimal(existing.usage).greaterThanOrEqualTo(effectiveLimit)
		) {
			throw new HTTPException(400, {
				message:
					"This credential has reached its spend limit. Raise or clear the limit to reactivate it.",
			});
		}
	}

	if (Object.keys(updates).length === 0) {
		return c.json({ credential: toCredential(existing) });
	}

	// status <> 'deleted' repeats the read's predicate so a concurrent delete
	// cannot have this write resurrect (or rotate the token of) a row that was
	// soft-deleted between the read above and this statement.
	const [updated] = await cdb
		.update(tables.providerKey)
		.set(updates)
		.where(
			and(
				eq(tables.providerKey.id, id),
				eq(tables.providerKey.managed, true),
				ne(tables.providerKey.status, "deleted"),
			),
		)
		.returning();

	if (!updated) {
		throw new HTTPException(404, { message: "Credential not found" });
	}

	logger.info("Managed provider credential updated", {
		credentialId: updated.id,
		provider: updated.provider,
		fields: Object.keys(updates),
		userId: user.id,
	});

	return c.json({ credential: toCredential(updated) });
});

/**
 * Fields both test endpoints below accept: either a stored credential (by id)
 * or the raw values from a not-yet-saved dialog. Explicit fields win over the
 * stored ones so an admin can test edits before saving them.
 */
const credentialUnderTestSchema = z.object({
	/** Stored managed credential to test. Its token is read server-side. */
	credentialId: z.string().optional(),
	/** Required when no credentialId is given. */
	provider: z.string().optional(),
	/** Overrides the stored token; required when no credentialId is given. */
	token: z.string().optional(),
	config: z.record(z.string(), z.string()).optional(),
	region: z.string().max(64).nullable().optional(),
});

interface CredentialUnderTest {
	provider: string;
	token: string;
	config: Record<string, string>;
	region: string | null;
}

async function resolveCredentialUnderTest(
	body: z.infer<typeof credentialUnderTestSchema>,
): Promise<CredentialUnderTest> {
	let credential: CredentialRow | undefined;
	if (body.credentialId) {
		credential = await db.query.providerKey.findFirst({
			where: {
				id: { eq: body.credentialId },
				managed: { eq: true },
				status: { ne: "deleted" },
			},
		});
		if (!credential) {
			throw new HTTPException(404, { message: "Credential not found" });
		}
	}

	const provider = body.provider ?? credential?.provider;
	if (!provider || !providers.some((p) => p.id === provider)) {
		throw new HTTPException(400, {
			message: provider
				? `Unknown provider: ${provider}`
				: "Provide a provider or a credentialId",
		});
	}
	if (credential && body.provider && body.provider !== credential.provider) {
		throw new HTTPException(400, {
			message: "provider does not match the stored credential",
		});
	}

	// Trimmed both for the presence check and for use, so the probe and the
	// error redaction see the same value the check accepted.
	const explicitToken = body.token?.trim();
	const token = explicitToken
		? explicitToken
		: credential
			? readProviderKey(credential)
			: undefined;
	if (!token) {
		throw new HTTPException(400, {
			message: "Provide a token or a credentialId with a stored token",
		});
	}

	return {
		provider,
		token,
		config:
			body.config !== undefined
				? normalizeConfig(body.config)
				: (credential?.config ?? {}),
		region:
			body.region !== undefined
				? body.region?.trim() || null
				: (credential?.region ?? null),
	};
}

const selfTestResultSchema = z.object({
	valid: z.boolean(),
	/** Model the probe ran against, when one was resolved. */
	model: z.string().optional(),
	statusCode: z.number().optional(),
	error: z.string().optional(),
});

const selfTestCredential = createRoute({
	method: "post",
	path: "/provider-credentials/self-test",
	request: {
		body: {
			content: {
				"application/json": {
					schema: credentialUnderTestSchema,
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: selfTestResultSchema,
				},
			},
			description:
				"Result of sending one minimal completion through the credential, without storing anything.",
		},
	},
});

/**
 * The save-time validation as a standalone probe: sends one minimal completion
 * through the credential (default validation model) and reports the outcome
 * instead of gating a write on it. Lets an admin check a key — stored or
 * still in the dialog — before deciding what to save.
 */
adminProviderCredentials.openapi(selfTestCredential, async (c) => {
	const body = c.req.valid("json");
	const target = await resolveCredentialUnderTest(body);

	if (isCredentialTestEnv()) {
		return c.json({ valid: true });
	}

	const result = await validateProviderKey(
		target.provider as ProviderId,
		target.token,
		undefined, // base URL travels in config/env_config for managed credentials
		false,
		managedCredentialValidationOptions(
			target.provider,
			target.config,
			target.region,
		),
	);

	return c.json({
		valid: result.valid,
		model: result.model,
		statusCode: result.statusCode,
		// validateProviderKey already redacts; re-redact defensively so no path
		// can echo the plaintext token back to the admin client.
		error: result.error ? redactToken(result.error, target.token) : undefined,
	});
});

const verifyModelsResultSchema = z.object({
	model: z.string(),
	/** Whether the catalogue maps this model to the provider at all. */
	inCatalog: z.boolean(),
	/**
	 * Live probe outcome: true/false, or null when the model was not probed —
	 * either it is missing from the catalogue or its request surface is not
	 * enabled for live verification.
	 */
	valid: z.boolean().nullable(),
	statusCode: z.number().optional(),
	error: z.string().optional(),
});

const DEFAULT_MODEL_PROBE_TIMEOUT_MS = 30_000;
const MEDIA_MODEL_PROBE_TIMEOUT_MS = 90_000;

const verifyCredentialModels = createRoute({
	method: "post",
	path: "/provider-credentials/verify-models",
	request: {
		body: {
			content: {
				"application/json": {
					schema: credentialUnderTestSchema.extend({
						models: z.array(z.string().min(1).max(200)).min(1).max(200),
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
						results: z.array(verifyModelsResultSchema),
						/** True when no listed model failed a check it could run. */
						allValid: z.boolean(),
					}),
				},
			},
			description:
				"Per-model report of whether the credential can serve each listed model.",
		},
	},
});

/**
 * Probes every listed model through the credential and reports each outcome,
 * so an admin filling in allowedModels can confirm the account actually has
 * the models before saving. Purely informational — nothing is stored.
 */
adminProviderCredentials.openapi(verifyCredentialModels, async (c) => {
	const body = c.req.valid("json");
	const target = await resolveCredentialUnderTest(body);
	const modelIds = normalizeAllowedModels(body.models) ?? [];
	// Whitespace-only entries survive the zod min-length check but normalize
	// away; an empty run would report allValid: true for a verification that
	// never happened.
	if (modelIds.length === 0) {
		throw new HTTPException(400, {
			message: "models must contain at least one non-blank model id",
		});
	}

	const validationOptions = managedCredentialValidationOptions(
		target.provider,
		target.config,
		target.region,
	);

	type VerifyResult = z.infer<typeof verifyModelsResultSchema>;

	const verifyOne = async (modelId: string): Promise<VerifyResult> => {
		const pinned = getPinnedValidationModel(
			target.provider as ProviderId,
			modelId,
			validationOptions,
		);
		if (!pinned) {
			return {
				model: modelId,
				inCatalog: false,
				valid: null,
				error: `Not available from ${target.provider} per the catalogue`,
			};
		}
		if (pinned.kind === "video") {
			return {
				model: modelId,
				inCatalog: true,
				valid: null,
				error: "Not live-tested: video generation is intentionally skipped",
			};
		}
		if (!pinned.kind) {
			return {
				model: modelId,
				inCatalog: true,
				valid: null,
				error: "Cannot be live-tested: this model type is not supported yet",
			};
		}
		if (isCredentialTestEnv()) {
			return { model: modelId, inCatalog: true, valid: true };
		}
		const result = await validateProviderKey(
			target.provider as ProviderId,
			target.token,
			undefined,
			false,
			validationOptions,
			modelId,
			AbortSignal.timeout(
				pinned.kind === "image" || pinned.kind === "ocr"
					? MEDIA_MODEL_PROBE_TIMEOUT_MS
					: DEFAULT_MODEL_PROBE_TIMEOUT_MS,
			),
		);
		return {
			model: modelId,
			inCatalog: true,
			valid: result.valid,
			statusCode: result.statusCode,
			error: result.error ? redactToken(result.error, target.token) : undefined,
		};
	};

	// Small batches: enough parallelism that a long list stays responsive,
	// bounded so the probe traffic cannot hammer the upstream into rate limits
	// that would then read as failures.
	const results: VerifyResult[] = [];
	const batchSize = 5;
	for (let i = 0; i < modelIds.length; i += batchSize) {
		results.push(
			...(await Promise.all(modelIds.slice(i, i + batchSize).map(verifyOne))),
		);
	}

	return c.json({
		results,
		allValid: results.every(
			(result) => result.inCatalog && result.valid !== false,
		),
	});
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
	// and attribution, so the row must survive. The status predicate makes a
	// repeat delete report 404 instead of succeeding against an already-deleted
	// row.
	const [deleted] = await cdb
		.update(tables.providerKey)
		.set({ status: "deleted" })
		.where(
			and(
				eq(tables.providerKey.id, id),
				eq(tables.providerKey.managed, true),
				ne(tables.providerKey.status, "deleted"),
			),
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

const reorderCredentials = createRoute({
	method: "put",
	path: "/provider-credentials/order",
	request: {
		body: {
			content: {
				"application/json": {
					schema: z.object({
						provider: z.string(),
						/**
						 * Complete ordered list of the provider's non-deleted managed
						 * credential ids, primary first.
						 */
						credentialIds: z.array(z.string()).min(1).max(100),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({ credentials: z.array(credentialSchema) }),
				},
			},
			description: "Credentials reordered.",
		},
	},
});

/**
 * Sets the order the gateway tries a provider's managed credentials.
 *
 * One flat order per provider, not per (provider, variant, region). Selection
 * narrows by variant then region with order-preserving filters, so a single
 * ranking already induces the right order inside every bucket — and an
 * `enterprise` request that falls back to `default` credentials inherits the
 * order an admin actually set rather than a separate one they never saw.
 */
adminProviderCredentials.openapi(reorderCredentials, async (c) => {
	const user = c.get("user")!;
	const { provider, credentialIds } = c.req.valid("json");

	if (new Set(credentialIds).size !== credentialIds.length) {
		throw new HTTPException(400, {
			message: "credentialIds contains duplicate ids",
		});
	}

	// Same predicates as the list route, so what an admin sees is exactly what
	// they may reorder.
	const scopeRows = await db.query.providerKey.findMany({
		where: {
			managed: { eq: true },
			provider: { eq: provider },
			status: { ne: "deleted" },
		},
		columns: { id: true },
	});

	const scopeIds = new Set(scopeRows.map((row) => row.id));
	if (credentialIds.some((id) => !scopeIds.has(id))) {
		throw new HTTPException(404, { message: "Credential not found" });
	}
	if (credentialIds.length !== scopeRows.length) {
		throw new HTTPException(409, {
			message: "Credential order is out of date",
		});
	}

	// Single statement: atomic, and exactly one cache invalidation. See the
	// matching note on the BYOK reorder route.
	const updated = await cdb
		.update(tables.providerKey)
		.set({
			sortOrder: sql`CASE ${tables.providerKey.id} ${sql.join(
				credentialIds.map(
					(id, index) => sql`WHEN ${id} THEN ${sql.raw(String(index))}`,
				),
				sql` `,
			)} END`,
		})
		.where(
			and(
				inArray(tables.providerKey.id, credentialIds),
				eq(tables.providerKey.managed, true),
				eq(tables.providerKey.provider, provider),
				ne(tables.providerKey.status, "deleted"),
			),
		)
		.returning();

	logger.info("Managed provider credentials reordered", {
		provider,
		credentialIds,
		userId: user.id,
	});

	const byId = new Map(updated.map((row) => [row.id, row]));
	return c.json({
		credentials: credentialIds
			.map((id) => byId.get(id))
			.filter((row): row is (typeof updated)[number] => row !== undefined)
			.map(toCredential),
	});
});

export default adminProviderCredentials;
