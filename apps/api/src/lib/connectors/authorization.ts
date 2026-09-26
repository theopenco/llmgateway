import { createHash } from "node:crypto";

import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { and, db, eq, gt, tables, shortid } from "@llmgateway/db";
import { logger } from "@llmgateway/logger";

import { assertConnectorAvailable } from "./catalogue.js";
import { openConnector, sealConnector } from "./crypto.js";
import { credentialsSchema, finishAuthorization } from "./oauth.js";

import type { LoungeConnectorId } from "@llmgateway/shared/lounge-connectors";

export const connectorCallbackQuery = z.object({
	state: z.string().min(32).max(128),
	code: z.string().min(1).max(4096).optional(),
	error: z.string().max(255).optional(),
});

export async function completeConnectorAuthorization({
	id,
	userId,
	sessionId,
	query,
	platform,
}: {
	id: LoungeConnectorId;
	userId: string;
	sessionId: string;
	query: URLSearchParams;
	platform?: "ios";
}) {
	assertConnectorAvailable(id);
	for (const key of ["state", "code", "error"]) {
		if (query.getAll(key).length > 1) {
			throw new HTTPException(400, {
				message: "Invalid authorization response",
			});
		}
	}
	const parsed = connectorCallbackQuery.safeParse(Object.fromEntries(query));
	if (!parsed.success) {
		throw new HTTPException(400, { message: "Invalid authorization response" });
	}
	const { state, code, error } = parsed.data;
	const stateHash = createHash("sha256").update(state).digest("hex");
	const pending = await db.query.loungeConnectorAuthorization.findFirst({
		where: {
			id: stateHash,
			userId,
			sessionId,
			connectorId: id,
			consumed: false,
			expiresAt: { gt: new Date() },
		},
	});
	if (!pending) {
		throw new HTTPException(400, {
			message: "Authorization expired or already used. Try connecting again.",
		});
	}
	const credentials = credentialsSchema.parse(
		openConnector(pending.credentials, userId, stateHash),
	);
	if (credentials.platform !== platform) {
		throw new HTTPException(400, {
			message: "Finish authorization in the app that started it.",
		});
	}
	const [consumed] = await db
		.update(tables.loungeConnectorAuthorization)
		.set({ consumed: true })
		.where(
			and(
				eq(tables.loungeConnectorAuthorization.id, stateHash),
				eq(tables.loungeConnectorAuthorization.userId, userId),
				eq(tables.loungeConnectorAuthorization.sessionId, sessionId),
				eq(tables.loungeConnectorAuthorization.connectorId, id),
				eq(tables.loungeConnectorAuthorization.consumed, false),
				gt(tables.loungeConnectorAuthorization.expiresAt, new Date()),
			),
		)
		.returning();
	if (!consumed) {
		throw new HTTPException(400, {
			message: "Authorization expired or already used. Try connecting again.",
		});
	}
	if (error) {
		return { status: "cancelled" as const, returnTo: credentials.returnTo };
	}
	if (!code) {
		throw new HTTPException(400, { message: "Missing authorization code" });
	}
	try {
		await finishAuthorization(id, credentials, code, query);
	} catch {
		logger.warn("Lounge connector authorization failed", { connector: id });
		return { status: "failed" as const, returnTo: credentials.returnTo };
	}
	await db.transaction(async (tx) => {
		const [active] = await tx
			.delete(tables.loungeConnectorAuthorization)
			.where(eq(tables.loungeConnectorAuthorization.id, stateHash))
			.returning();
		if (!active) {
			throw new HTTPException(409, {
				message: "Authorization was cancelled. Connect again.",
			});
		}
		await tx
			.insert(tables.loungeConnection)
			.values({
				id: shortid(),
				userId,
				connectorId: id,
				credentials: sealConnector(credentials, userId, id),
			})
			.onConflictDoUpdate({
				target: [
					tables.loungeConnection.userId,
					tables.loungeConnection.connectorId,
				],
				set: {
					credentials: sealConnector(credentials, userId, id),
					enabled: true,
					updatedAt: new Date(),
				},
			});
	});
	return { status: "connected" as const, returnTo: credentials.returnTo };
}
