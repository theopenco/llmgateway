import { HTTPException } from "hono/http-exception";

import { db } from "@llmgateway/db";

import type { Context, Next } from "hono";

/**
 * Embeddable SDK: authentication for browser requests bearing an ephemeral
 * end-user session token (`es_…`). Validates the token + expiry, loads the bound
 * wallet, and stashes the resolved session on the context. Shared by the wallet
 * endpoints and the session-refresh endpoint.
 */
export interface AuthenticatedSession {
	apiKeyId: string;
	walletId: string;
	endCustomerId: string;
	projectId: string;
	organizationId: string;
	markupPercent: number;
	/** Origins allowed to call with this session (CORS), from the project. */
	allowedOrigins: string[] | null;
}

declare module "hono" {
	interface ContextVariableMap {
		endUserSession?: AuthenticatedSession;
	}
}

export async function endUserSessionAuth(c: Context, next: Next) {
	const authHeader = c.req.header("Authorization");
	const token = authHeader?.startsWith("Bearer ")
		? authHeader.slice("Bearer ".length).trim()
		: c.req.header("x-api-key")?.trim();

	if (!token) {
		throw new HTTPException(401, {
			message:
				"Missing session token. Pass it as 'Authorization: Bearer es_…'.",
		});
	}

	const key = await db.query.apiKey.findFirst({
		where: {
			token: { eq: token },
			keyType: { eq: "ephemeral_session" },
			status: { eq: "active" },
		},
		with: { wallet: { with: { endCustomer: true, project: true } } },
	});

	if (!key || !key.endCustomerWalletId || !key.wallet) {
		throw new HTTPException(401, { message: "Invalid session token" });
	}

	if (!key.expiresAt || key.expiresAt.getTime() < Date.now()) {
		throw new HTTPException(401, {
			message: "Session expired. Mint a fresh session token from your backend.",
		});
	}

	if (key.wallet.status !== "active") {
		throw new HTTPException(402, { message: "Wallet is frozen" });
	}

	// Defense-in-depth origin allowlist (see gateway chat handler).
	const allowedOrigins = key.wallet.project?.allowedOrigins ?? null;
	const origin = c.req.header("Origin");
	if (
		origin &&
		allowedOrigins &&
		allowedOrigins.length > 0 &&
		!allowedOrigins.includes(origin)
	) {
		throw new HTTPException(403, {
			message: "Origin not allowed for this project",
		});
	}

	const markupPercent = Number(
		key.wallet.markupPercentOverride ??
			key.wallet.project?.endUserMarkupPercent ??
			"0",
	);

	c.set("endUserSession", {
		apiKeyId: key.id,
		walletId: key.wallet.id,
		endCustomerId: key.wallet.endCustomerId,
		projectId: key.wallet.projectId,
		organizationId: key.wallet.organizationId,
		markupPercent: Number.isFinite(markupPercent) ? markupPercent : 0,
		allowedOrigins: key.wallet.project?.allowedOrigins ?? null,
	});

	await next();
}
