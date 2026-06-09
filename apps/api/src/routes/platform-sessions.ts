import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { platformSecretAuth } from "@/lib/platform-secret-auth.js";

import { db, eq, shortid, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { AuthenticatedPlatformKey } from "@/lib/platform-secret-auth.js";
import type { ServerTypes } from "@/vars.js";

/**
 * LLM SDK — platform session endpoints.
 *
 * These are authenticated with a developer **secret key** (`sk_…`, an apiKey row
 * with keyType="platform_secret"), NOT a dashboard session. They let a
 * developer's backend mint short-lived **ephemeral session tokens** (`es_…`)
 * bound to a single end-user wallet, which the browser then uses against the
 * gateway.
 */
export const platformSessions = new OpenAPIHono<ServerTypes>();

/** Postgres unique-constraint violation (used to detect insert races). */
function isUniqueViolation(err: unknown): boolean {
	const code =
		(err as { code?: string; cause?: { code?: string } })?.code ??
		(err as { cause?: { code?: string } })?.cause?.code;
	return code === "23505";
}

const EPHEMERAL_PREFIX = "es_";
const END_USER_CUSTOMER_KEY_PREFIX = "euck_";
const DEFAULT_TTL_SECONDS = 15 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 60 * 60;

// Scope the secret-key auth to only the routes this router owns. This router is
// mounted at the bare `/v1` prefix, so a blanket `use("*")` would register as
// `/v1/*` and leak onto sibling routers (e.g. the public `/v1/config` and the
// `es_`-authenticated `/v1/wallet`, `/v1/sessions/refresh`), wrongly demanding a
// secret key there.
platformSessions.use("/sessions", platformSecretAuth);
platformSessions.use("/wallets/*", platformSecretAuth);

const customerInput = z.union([
	z.string().min(1),
	z.object({
		externalId: z.string().min(1),
		email: z.string().email().optional(),
		name: z.string().optional(),
	}),
]);

const createSessionBody = z.object({
	customer: customerInput,
	scope: z
		.object({
			models: z.array(z.string()).optional(),
			maxSpend: z.number().positive().optional(),
		})
		.optional(),
	ttlSeconds: z
		.number()
		.int()
		.min(MIN_TTL_SECONDS)
		.max(MAX_TTL_SECONDS)
		.optional(),
});

const sessionResponse = z.object({
	sessionToken: z.string(),
	publishableKey: z.string().nullable(),
	walletId: z.string(),
	endCustomerId: z.string(),
	expiresAt: z.string(),
});

const createSession = createRoute({
	method: "post",
	path: "/sessions",
	request: {
		body: {
			content: { "application/json": { schema: createSessionBody } },
		},
	},
	responses: {
		201: {
			content: { "application/json": { schema: sessionResponse } },
			description:
				"Ephemeral end-user session minted. The session token is browser-safe and expires; the wallet it is bound to is debited for AI usage.",
		},
	},
});

/**
 * Find-or-create the end customer (by projectId + externalId) and its 1:1
 * wallet. Not transactional — the unique(projectId, externalId) constraint
 * guards against duplicates; on a race we re-read.
 */
async function ensureCustomerAndWallet(
	platformKey: AuthenticatedPlatformKey,
	customer: z.infer<typeof customerInput>,
) {
	const externalId =
		typeof customer === "string" ? customer : customer.externalId;
	const email = typeof customer === "string" ? undefined : customer.email;
	const name = typeof customer === "string" ? undefined : customer.name;

	let endCustomer = await db.query.endCustomer.findFirst({
		where: {
			projectId: { eq: platformKey.projectId },
			externalId: { eq: externalId },
			mode: { eq: platformKey.mode },
		},
	});

	if (!endCustomer) {
		try {
			[endCustomer] = await db
				.insert(tables.endCustomer)
				.values({
					organizationId: platformKey.organizationId,
					projectId: platformKey.projectId,
					externalId,
					mode: platformKey.mode,
					email,
					name,
				})
				.returning();
		} catch (err) {
			// Only a unique-constraint race is recoverable by re-reading; surface
			// any other DB error instead of masking it as "failed to create".
			if (!isUniqueViolation(err)) {
				throw err;
			}
			endCustomer = await db.query.endCustomer.findFirst({
				where: {
					projectId: { eq: platformKey.projectId },
					externalId: { eq: externalId },
					mode: { eq: platformKey.mode },
				},
			});
		}
	}

	if (!endCustomer) {
		throw new HTTPException(500, { message: "Failed to create end customer" });
	}

	if (endCustomer.status === "blocked") {
		throw new HTTPException(403, { message: "End customer is blocked" });
	}

	let wallet = await db.query.wallet.findFirst({
		where: { endCustomerId: { eq: endCustomer.id } },
	});

	if (!wallet) {
		try {
			[wallet] = await db
				.insert(tables.wallet)
				.values({
					endCustomerId: endCustomer.id,
					projectId: platformKey.projectId,
					organizationId: platformKey.organizationId,
					mode: platformKey.mode,
				})
				.returning();
		} catch (err) {
			if (!isUniqueViolation(err)) {
				throw err;
			}
			wallet = await db.query.wallet.findFirst({
				where: { endCustomerId: { eq: endCustomer.id } },
			});
		}
	}

	if (!wallet) {
		throw new HTTPException(500, { message: "Failed to create wallet" });
	}

	return { endCustomer, wallet };
}

async function ensureEndUserCustomerApiKey(
	platformKey: AuthenticatedPlatformKey,
	endCustomer: typeof tables.endCustomer.$inferSelect,
	wallet: typeof tables.wallet.$inferSelect,
) {
	let aggregateKey = await db.query.apiKey.findFirst({
		where: {
			projectId: { eq: platformKey.projectId },
			keyType: { eq: "end_user_customer" },
			endCustomerWalletId: { eq: wallet.id },
			status: { eq: "active" },
		},
	});

	if (aggregateKey) {
		return aggregateKey;
	}

	await db
		.insert(tables.apiKey)
		.values({
			token: END_USER_CUSTOMER_KEY_PREFIX + shortid(40),
			projectId: platformKey.projectId,
			description: `Embedded end-user: ${endCustomer.externalId}`,
			keyType: "end_user_customer",
			endCustomerWalletId: wallet.id,
			createdBy: platformKey.createdBy,
		})
		.onConflictDoNothing();

	aggregateKey = await db.query.apiKey.findFirst({
		where: {
			projectId: { eq: platformKey.projectId },
			keyType: { eq: "end_user_customer" },
			endCustomerWalletId: { eq: wallet.id },
			status: { eq: "active" },
		},
	});

	if (!aggregateKey) {
		throw new HTTPException(500, {
			message: "Failed to create end-user customer key",
		});
	}

	return aggregateKey;
}

platformSessions.openapi(createSession, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const { customer, scope, ttlSeconds } = c.req.valid("json");

	const { endCustomer, wallet } = await ensureCustomerAndWallet(
		platformKey,
		customer,
	);
	await ensureEndUserCustomerApiKey(platformKey, endCustomer, wallet);

	const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;
	const ttlMs = ttl * 1000;
	const expiresAt = new Date(Date.now() + ttlMs);
	// Tag test-mode sessions in the token (cosmetic — the authoritative mode is
	// read from the bound wallet), mirroring Stripe's `es_test_…` convention.
	const token =
		(platformKey.mode === "test" ? "es_test_" : EPHEMERAL_PREFIX) + shortid(40);

	// Store the session model allowlist directly on end_user_session. The gateway
	// applies this before falling back to API-key IAM rules for developer keys.
	// The scope check compares against the canonical model id
	// (e.g. `gpt-4o-mini`), not the `provider/model` request form. Normalize so
	// developers can pass either `openai/gpt-4o-mini` or `gpt-4o-mini` and have
	// it scope correctly.
	const normalizedModels =
		scope?.models && scope.models.length > 0
			? scope.models.map((m) =>
					m.includes("/") ? m.slice(m.lastIndexOf("/") + 1) : m,
				)
			: null;

	await db.insert(tables.endUserSession).values({
		token,
		projectId: platformKey.projectId,
		organizationId: platformKey.organizationId,
		endCustomerId: endCustomer.id,
		walletId: wallet.id,
		expiresAt,
		createdBy: platformKey.createdBy,
		scope: normalizedModels ? { models: normalizedModels } : undefined,
		usageLimit: scope?.maxSpend ? String(scope.maxSpend) : undefined,
	});

	// The publishable key is a sibling platform_publishable key on the project,
	// used by the browser to load Stripe for top-ups (Phase 2). May not exist yet.
	const publishable = await db.query.apiKey.findFirst({
		where: {
			projectId: { eq: platformKey.projectId },
			keyType: { eq: "platform_publishable" },
			status: { eq: "active" },
		},
	});

	logger.info("Minted end-user session", {
		projectId: platformKey.projectId,
		endCustomerId: endCustomer.id,
		walletId: wallet.id,
		expiresAt: expiresAt.toISOString(),
	});

	return c.json(
		{
			sessionToken: token,
			publishableKey: publishable?.token ?? null,
			walletId: wallet.id,
			endCustomerId: endCustomer.id,
			expiresAt: expiresAt.toISOString(),
		},
		201,
	);
});

const walletResponse = z.object({
	id: z.string(),
	endCustomerId: z.string(),
	balance: z.string(),
	currency: z.string(),
	status: z.enum(["active", "frozen"]),
});

/**
 * Load a wallet and assert it belongs to the authenticated platform key's
 * project (and org). A secret key is project-scoped, so an org with multiple
 * projects must not be able to reach another project's wallets.
 */
async function loadWalletForPlatform(
	walletId: string,
	platformKey: AuthenticatedPlatformKey,
) {
	const wallet = await db.query.wallet.findFirst({
		where: { id: { eq: walletId } },
	});
	if (
		!wallet ||
		wallet.organizationId !== platformKey.organizationId ||
		wallet.projectId !== platformKey.projectId ||
		// A test key must not read or credit live wallets, and vice versa.
		wallet.mode !== platformKey.mode
	) {
		throw new HTTPException(404, {
			message: "Wallet not found in this project",
		});
	}
	return wallet;
}

const retrieveWallet = createRoute({
	method: "get",
	path: "/wallets/{id}",
	request: { params: z.object({ id: z.string() }) },
	responses: {
		200: {
			content: { "application/json": { schema: walletResponse } },
			description: "Wallet retrieved.",
		},
	},
});

platformSessions.openapi(retrieveWallet, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.param();
	const wallet = await loadWalletForPlatform(id, platformKey);
	return c.json({
		id: wallet.id,
		endCustomerId: wallet.endCustomerId,
		balance: wallet.balance,
		currency: wallet.currency,
		status: wallet.status,
	});
});

const creditWallet = createRoute({
	method: "post",
	path: "/wallets/{id}/credit",
	request: {
		params: z.object({ id: z.string() }),
		body: {
			content: {
				"application/json": {
					schema: z.object({
						amount: z.number().positive(),
						reason: z.string().optional(),
					}),
				},
			},
		},
	},
	responses: {
		200: {
			content: { "application/json": { schema: walletResponse } },
			description:
				"Server-side credit grant (e.g. free trial credits). Writes an adjustment ledger row.",
		},
	},
});

platformSessions.openapi(creditWallet, async (c) => {
	const platformKey = c.get("platformKey");
	if (!platformKey) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}
	const { id } = c.req.param();
	const { amount, reason } = c.req.valid("json");

	const wallet = await loadWalletForPlatform(id, platformKey);

	// Balance bump + ledger row must commit together.
	const updated = await db.transaction(async (tx) => {
		const [row] = await tx
			.update(tables.wallet)
			.set({ balance: sql`${tables.wallet.balance} + ${amount}` })
			.where(eq(tables.wallet.id, id))
			.returning();

		await tx.insert(tables.walletLedger).values({
			walletId: wallet.id,
			endCustomerId: wallet.endCustomerId,
			organizationId: wallet.organizationId,
			type: "adjustment",
			amount: String(amount),
			balanceAfter: row.balance,
			description: reason ?? "Server-side credit grant",
		});

		return row;
	});

	return c.json({
		id: updated.id,
		endCustomerId: updated.endCustomerId,
		balance: updated.balance,
		currency: updated.currency,
		status: updated.status,
	});
});

export default platformSessions;
