import { describe, expect, test } from "vitest";

import { app } from "@/index.js";

// Better Auth's sso() plugin mounts its own provider-management endpoints under
// the /auth/* catch-all. They only require a session, so `handler.ts` blocks
// direct HTTP access to them (see BLOCKED_SSO_PLUGIN_PATHS) — our own
// enterprise/admin-gated wrapper lives at /sso and calls the plugin via
// `apiAuth.api.*`, which bypasses this handler entirely.
const BLOCKED_PATHS = [
	"/auth/sso/register",
	"/auth/sso/update-provider",
	"/auth/sso/delete-provider",
	"/auth/sso/get-provider",
	"/auth/sso/providers",
	"/auth/sso/request-domain-verification",
	"/auth/sso/verify-domain",
];

// Paths the login flow needs must NOT be blocked by us; they pass through to
// Better Auth's handler.
const ALLOWED_PATHS = [
	"/auth/sign-in/sso",
	"/auth/sso/callback",
	"/auth/sso/saml2/sp/metadata",
];

const BLOCK_BODY = { error: "not_found", message: "Not found" };

// Our block responds with exactly this 404 JSON, distinct from any 404 Better
// Auth itself might return, so allowed paths can be told apart from blocked.
function isOurBlock(status: number, body: unknown): boolean {
	return (
		status === 404 &&
		!!body &&
		typeof body === "object" &&
		(body as { error?: string }).error === "not_found" &&
		(body as { message?: string }).message === "Not found"
	);
}

describe("SSO plugin management endpoint blocking", () => {
	test.each(BLOCKED_PATHS)("blocks POST %s with 404", async (path) => {
		const response = await app.request(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual(BLOCK_BODY);
	});

	test.each(BLOCKED_PATHS)("blocks GET %s with 404", async (path) => {
		const response = await app.request(path, { method: "GET" });

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual(BLOCK_BODY);
	});

	test("blocks even with a query string", async () => {
		const response = await app.request(
			"/auth/sso/get-provider?providerId=acme",
			{ method: "GET" },
		);

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual(BLOCK_BODY);
	});

	test("does not block an unrelated /auth path", async () => {
		const response = await app.request("/auth/ok", { method: "GET" });
		const body = await response.json().catch(() => null);

		expect(isOurBlock(response.status, body)).toBe(false);
	});

	test.each(ALLOWED_PATHS)(
		"does not block the login-flow path %s",
		async (path) => {
			const response = await app.request(path, { method: "GET" });
			const body = await response.json().catch(() => null);

			// Reached Better Auth (any status/body) rather than our 404 sentinel.
			expect(isOurBlock(response.status, body)).toBe(false);
		},
	);
});
