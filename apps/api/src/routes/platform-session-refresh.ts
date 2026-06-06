import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { endUserSessionAuth } from "@/lib/end-user-session-auth.js";

import { db, eq, shortid, tables } from "@llmgateway/db";

import type { ServerTypes } from "@/vars.js";

/**
 * Embeddable SDK — rotate an end-user session token. Authenticated with the
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

	const oldKey = await db.query.apiKey.findFirst({
		where: { id: { eq: session.apiKeyId } },
		with: { iamRules: true },
	});
	if (!oldKey) {
		throw new HTTPException(401, { message: "Invalid session token" });
	}

	const ttlMs = DEFAULT_TTL_SECONDS * 1000;
	const expiresAt = new Date(Date.now() + ttlMs);
	const token = EPHEMERAL_PREFIX + shortid(40);

	const [newKey] = await db
		.insert(tables.apiKey)
		.values({
			token,
			projectId: oldKey.projectId,
			description: oldKey.description,
			keyType: "ephemeral_session",
			endCustomerWalletId: session.walletId,
			expiresAt,
			// Carry the spend cap + accumulated usage forward so refreshing can't
			// reset it — including the windowed-limit state, so a rotation mid-window
			// doesn't hand out a fresh allowance.
			usageLimit: oldKey.usageLimit,
			usage: oldKey.usage,
			periodUsageLimit: oldKey.periodUsageLimit,
			periodUsageDurationValue: oldKey.periodUsageDurationValue,
			periodUsageDurationUnit: oldKey.periodUsageDurationUnit,
			currentPeriodUsage: oldKey.currentPeriodUsage,
			currentPeriodStartedAt: oldKey.currentPeriodStartedAt,
			createdBy: oldKey.createdBy,
		})
		.returning();

	for (const rule of oldKey.iamRules) {
		await db.insert(tables.apiKeyIamRule).values({
			apiKeyId: newKey.id,
			ruleType: rule.ruleType,
			ruleValue: rule.ruleValue,
			status: rule.status,
		});
	}

	await db
		.update(tables.apiKey)
		.set({ status: "inactive" })
		.where(eq(tables.apiKey.id, oldKey.id));

	return c.json({
		sessionToken: token,
		walletId: session.walletId,
		expiresAt: expiresAt.toISOString(),
	});
});

export default platformSessionRefresh;
