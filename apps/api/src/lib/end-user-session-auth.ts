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
	sessionId: string;
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

	const session = await db.query.endUserSession.findFirst({
		where: {
			token: { eq: token },
			status: { eq: "active" },
		},
		with: { wallet: { with: { endCustomer: true, project: true } } },
	});

	if (!session || !session.wallet) {
		throw new HTTPException(401, { message: "Invalid session token" });
	}

	if (session.expiresAt.getTime() < Date.now()) {
		throw new HTTPException(401, {
			message: "Session expired. Mint a fresh session token from your backend.",
		});
	}

	if (session.wallet.status !== "active") {
		throw new HTTPException(402, { message: "Wallet is frozen" });
	}

	// Reject sessions whose end customer was blocked/deleted or whose project was
	// deactivated/deleted after the token was minted.
	if (
		session.wallet.endCustomer &&
		session.wallet.endCustomer.status !== "active"
	) {
		throw new HTTPException(401, { message: "End customer is inactive" });
	}

	const projectStatus = session.wallet.project?.status;
	if (projectStatus && projectStatus !== "active") {
		throw new HTTPException(401, { message: "Project is inactive" });
	}

	// Defense-in-depth origin allowlist (see gateway chat handler).
	const allowedOrigins = session.wallet.project?.allowedOrigins ?? null;
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
		session.wallet.markupPercentOverride ??
			session.wallet.project?.endUserMarkupPercent ??
			"0",
	);

	c.set("endUserSession", {
		sessionId: session.id,
		walletId: session.wallet.id,
		endCustomerId: session.wallet.endCustomerId,
		projectId: session.wallet.projectId,
		organizationId: session.wallet.organizationId,
		markupPercent: Number.isFinite(markupPercent) ? markupPercent : 0,
		allowedOrigins: session.wallet.project?.allowedOrigins ?? null,
	});

	await next();
}
