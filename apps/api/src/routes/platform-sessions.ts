import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { platformSecretAuth } from "@/lib/platform-secret-auth.js";

import { db, eq, shortid, sql, tables } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import type { AuthenticatedPlatformKey } from "@/lib/platform-secret-auth.js";
import type { ServerTypes } from "@/vars.js";

/**
 * Embeddable SDK — platform session endpoints.
 *
 * These are authenticated with a developer **secret key** (`sk_…`, an apiKey row
 * with keyType="platform_secret"), NOT a dashboard session. They let a
 * developer's backend mint short-lived **ephemeral session tokens** (`es_…`)
 * bound to a single end-user wallet, which the browser then uses against the
 * gateway.
 */
export const platformSessions = new OpenAPIHono<ServerTypes>();

const EPHEMERAL_PREFIX = "es_";
const DEFAULT_TTL_SECONDS = 15 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 60 * 60;

platformSessions.use("*", platformSecretAuth);

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
					email,
					name,
				})
				.returning();
		} catch {
			// Likely a unique-constraint race — re-read.
			endCustomer = await db.query.endCustomer.findFirst({
				where: {
					projectId: { eq: platformKey.projectId },
					externalId: { eq: externalId },
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
				})
				.returning();
		} catch {
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

	const ttl = ttlSeconds ?? DEFAULT_TTL_SECONDS;
	const ttlMs = ttl * 1000;
	const expiresAt = new Date(Date.now() + ttlMs);
	const token = EPHEMERAL_PREFIX + shortid(40);

	const [sessionKey] = await db
		.insert(tables.apiKey)
		.values({
			token,
			projectId: platformKey.projectId,
			description: `End-user session for ${endCustomer.externalId}`,
			keyType: "ephemeral_session",
			endCustomerWalletId: wallet.id,
			expiresAt,
			createdBy: platformKey.createdBy,
		})
		.returning();

	// Reuse the existing IAM machinery: an allow_models rule scopes which models
	// the browser session may call. The gateway's validateModelAccess reads these
	// from the session key's id, no new code path needed.
	if (scope?.models && scope.models.length > 0) {
		await db.insert(tables.apiKeyIamRule).values({
			apiKeyId: sessionKey.id,
			ruleType: "allow_models",
			ruleValue: { models: scope.models },
		});
	}

	// Optional per-session spend ceiling maps onto the api key usage limit.
	if (scope?.maxSpend) {
		await db
			.update(tables.apiKey)
			.set({ usageLimit: String(scope.maxSpend) })
			.where(eq(tables.apiKey.id, sessionKey.id));
	}

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

/** Load a wallet and assert it belongs to the authenticated platform key's org. */
async function loadWalletForPlatform(walletId: string, organizationId: string) {
	const wallet = await db.query.wallet.findFirst({
		where: { id: { eq: walletId } },
	});
	if (!wallet || wallet.organizationId !== organizationId) {
		throw new HTTPException(404, {
			message: "Wallet not found in this organization",
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
	const wallet = await loadWalletForPlatform(id, platformKey.organizationId);
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

	const wallet = await loadWalletForPlatform(id, platformKey.organizationId);

	const [updated] = await db
		.update(tables.wallet)
		.set({ balance: sql`${tables.wallet.balance} + ${amount}` })
		.where(eq(tables.wallet.id, id))
		.returning();

	await db.insert(tables.walletLedger).values({
		walletId: wallet.id,
		endCustomerId: wallet.endCustomerId,
		organizationId: wallet.organizationId,
		type: "adjustment",
		amount: String(amount),
		balanceAfter: updated.balance,
		description: reason ?? "Server-side credit grant",
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
