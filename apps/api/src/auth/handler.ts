import { OpenAPIHono } from "@hono/zod-openapi";

import { apiAuth } from "./config.js";

import type { ServerTypes } from "@/vars.js";

// Create a Hono app for auth routes
export const authHandler = new OpenAPIHono<ServerTypes>();

// Better Auth's sso() plugin mounts its own provider-management endpoints under
// the /auth/* catch-all. They only require a session (any authenticated user),
// so exposing them would let a user bypass the enterprise/admin-gated /sso
// wrapper and register a provider — claiming any email domain — with no
// organization scoping. Block direct HTTP access to them here; our server-side
// registration calls `apiAuth.api.registerSSOProvider` directly and never goes
// through this handler, so it is unaffected. The SAML sign-in/callback/metadata
// endpoints (/auth/sso/saml2/*, /auth/sso/callback, /auth/sign-in/sso) are left
// reachable because the login flow needs them.
const BLOCKED_SSO_PLUGIN_PATHS = new Set([
	"/auth/sso/register",
	"/auth/sso/update-provider",
	"/auth/sso/delete-provider",
	"/auth/sso/get-provider",
	"/auth/sso/providers",
	"/auth/sso/request-domain-verification",
	"/auth/sso/verify-domain",
]);

authHandler.use("*", async (c, next) => {
	const session = await apiAuth.api.getSession({ headers: c.req.raw.headers });

	if (!session) {
		c.set("user", null);
		c.set("session", null);
		return await next();
	}

	c.set("user", session.user);
	c.set("session", session.session);
	return await next();
});

authHandler.on(["POST", "GET"], "/auth/*", (c) => {
	if (BLOCKED_SSO_PLUGIN_PATHS.has(new URL(c.req.url).pathname)) {
		return c.json({ error: "not_found", message: "Not found" }, 404);
	}
	return apiAuth.handler(c.req.raw);
});
