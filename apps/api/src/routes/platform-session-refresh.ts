import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { endUserSessionAuth } from "@/lib/end-user-session-auth.js";

import { db, eq, shortid, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * LLM SDK — rotate an end-user session token. Authenticated with the
 * current (still-valid) ephemeral token. Mints a fresh token bound to the same
 * wallet, copies the IAM scope + spend limit forward, and inactivates the old
 * token so it can't be replayed. The browser client calls this automatically
 * shortly before expiry.
 */
export const platformSessionRefresh = new OpenAPIHono<ServerTypes>();

const EPHEMERAL_PREFIX = "es_";
const DEFAULT_TTL_SECONDS = 15 * 60;

platformSessionRefresh.use("*", endUserSessionAuth);

const refresh = createRoute({
	method: "post",
	path: "/refresh",
	responses: {
		200: {
			content: {
				"application/json": {
					schema: z.object({
						sessionToken: z.string(),
						walletId: z.string(),
						expiresAt: z.string(),
					}),
				},
			},
			description: "A rotated session token bound to the same wallet.",
		},
	},
});

platformSessionRefresh.openapi(refresh, async (c) => {
	const session = c.get("endUserSession");
	if (!session) {
		throw new HTTPException(401, { message: "Unauthorized" });
	}

	const oldSession = await db.query.endUserSession.findFirst({
		where: { id: { eq: session.sessionId } },
	});
	if (!oldSession) {
		throw new HTTPException(401, { message: "Invalid session token" });
	}

	const ttlMs = DEFAULT_TTL_SECONDS * 1000;
	const expiresAt = new Date(Date.now() + ttlMs);
	const token = EPHEMERAL_PREFIX + shortid(40);

	const newSession = await db.transaction(async (tx) => {
		const [created] = await tx
			.insert(tables.endUserSession)
			.values({
				token,
				projectId: oldSession.projectId,
				organizationId: oldSession.organizationId,
				endCustomerId: oldSession.endCustomerId,
				walletId: session.walletId,
				expiresAt,
				// Carry the spend cap + accumulated usage forward so refreshing can't
				// reset it — including the windowed-limit state, so a rotation mid-window
				// doesn't hand out a fresh allowance.
				scope: oldSession.scope,
				usageLimit: oldSession.usageLimit,
				usage: oldSession.usage,
				periodUsageLimit: oldSession.periodUsageLimit,
				periodUsageDurationValue: oldSession.periodUsageDurationValue,
				periodUsageDurationUnit: oldSession.periodUsageDurationUnit,
				currentPeriodUsage: oldSession.currentPeriodUsage,
				currentPeriodStartedAt: oldSession.currentPeriodStartedAt,
				createdBy: oldSession.createdBy,
			})
			.returning();

		if (!created) {
			throw new HTTPException(500, { message: "Failed to refresh session" });
		}

		await tx
			.update(tables.endUserSession)
			.set({ status: "inactive" })
			.where(eq(tables.endUserSession.id, oldSession.id));

		return created;
	});

	return c.json({
		sessionToken: token,
		walletId: newSession.walletId,
		expiresAt: newSession.expiresAt.toISOString(),
	});
});

export default platformSessionRefresh;
