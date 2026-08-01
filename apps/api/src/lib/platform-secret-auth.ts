import { HTTPException } from "hono/http-exception";

import { db } from "@llmgateway/db";

import type { Context, Next } from "hono";

/**
 * LLM SDK: authentication for a developer's backend using a platform
 * **secret key** (`sk_…`, an apiKey row with keyType="platform_secret"). Shared
 * by the session-mint, wallet-management, customer-analytics, and Connect-payout
 * endpoints. Mirrors the v1-master.ts token-auth pattern.
 */
export type PlatformMode = "live" | "test";

/**
 * Derive the Stripe mode from a platform secret key token. `sk_test_…` keys are
 * sandbox; everything else (including legacy `sk_…` keys minted before the
 * live/test split) is live.
 */
export function platformKeyMode(token: string): PlatformMode {
	return token.startsWith("sk_test_") ? "test" : "live";
}

export interface AuthenticatedPlatformKey {
	apiKeyId: string;
	projectId: string;
	organizationId: string;
	createdBy: string;
	mode: PlatformMode;
}

declare module "hono" {
	interface ContextVariableMap {
		platformKey?: AuthenticatedPlatformKey;
	}
}

export async function platformSecretAuth(c: Context, next: Next) {
	const authHeader = c.req.header("Authorization");
	const token = authHeader?.startsWith("Bearer ")
		? authHeader.slice("Bearer ".length).trim()
		: c.req.header("x-api-key")?.trim();

	if (!token) {
		throw new HTTPException(401, {
			message:
				"Missing secret key. Pass it as 'Authorization: Bearer sk_…' or 'x-api-key'.",
		});
	}

	const row = await db.query.apiKey.findFirst({
		where: {
			token: { eq: token },
			keyType: { eq: "platform_secret" },
			status: { eq: "active" },
		},
		with: { project: { with: { organization: true } } },
	});

	if (!row || !row.project) {
		throw new HTTPException(401, { message: "Invalid platform secret key" });
	}

	// Strict active-only: reject inactive/deleted projects, not just deleted ones.
	if (row.project.status && row.project.status !== "active") {
		throw new HTTPException(403, { message: "Project is not active" });
	}

	if (
		row.project.organization &&
		row.project.organization.status !== "active"
	) {
		throw new HTTPException(403, { message: "Organization is not active" });
	}

	if (!row.project.endUserEnabled) {
		throw new HTTPException(403, {
			message:
				"End-user sessions are not enabled for this project. Enable them in project settings.",
		});
	}

	c.set("platformKey", {
		apiKeyId: row.id,
		projectId: row.projectId,
		organizationId: row.project.organizationId,
		createdBy: row.createdBy,
		mode: platformKeyMode(row.token),
	});

	await next();
}
