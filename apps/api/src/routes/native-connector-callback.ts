import { createHash } from "node:crypto";

import { openConnector } from "@/lib/connectors/crypto.js";
import { credentialsSchema } from "@/lib/connectors/oauth.js";

import { db } from "@llmgateway/db";
import { loungeConnectorCallbackScheme } from "@llmgateway/shared/lounge-connectors";

import type { ServerTypes } from "@/vars.js";
import type { MiddlewareHandler } from "hono";

// Only delivers the provider response; linking still requires the initiating API session.
export const nativeConnectorCallback: MiddlewareHandler<ServerTypes> = async (
	c,
	next,
) => {
	const query = new URL(c.req.url).searchParams;
	const state = query.get("state");
	if (
		!state ||
		query.getAll("state").length !== 1 ||
		state.length < 32 ||
		state.length > 128 ||
		c.req.url.length > 16_384
	) {
		return await next();
	}
	const stateHash = createHash("sha256").update(state).digest("hex");
	const pending = await db.query.loungeConnectorAuthorization.findFirst({
		where: { id: stateHash, consumed: false, expiresAt: { gt: new Date() } },
	});
	if (!pending || pending.connectorId !== c.req.param("connectorId")) {
		return await next();
	}
	const credentials = credentialsSchema.parse(
		openConnector(pending.credentials, pending.userId, stateHash),
	);
	if (credentials.platform !== "ios") {
		return await next();
	}
	const callback = new URL(
		`${loungeConnectorCallbackScheme}://connector/${pending.connectorId}`,
	);
	callback.search = new URL(c.req.url).search;
	c.header("Cache-Control", "no-store");
	c.header("Referrer-Policy", "no-referrer");
	return c.redirect(callback.toString(), 302);
};
