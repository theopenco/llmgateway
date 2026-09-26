import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import { mcpEndpoints } from "./catalogue.js";
import { beginAuthorization, finishAuthorization } from "./oauth.js";

import type { ConnectorCredentials } from "./oauth.js";

vi.mock("@llmgateway/shared/url-safety-node", () => ({
	fetchSafeUserUrl: vi.fn(),
}));
afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetAllMocks();
});

describe("MCP OAuth protocol integration", () => {
	it.each([
		"posthog",
		"slack",
		"notion",
		"figma",
		"linear",
		"sentry",
		"stripe",
	] as const)(
		"completes discovery, consent and code exchange for %s",
		async (id) => {
			vi.stubEnv("API_URL", "https://api.example.com");
			vi.stubEnv(`LOUNGE_${id.toUpperCase()}_CLIENT_ID`, "registered-client");
			vi.stubEnv(
				`LOUNGE_${id.toUpperCase()}_CLIENT_SECRET`,
				"registered-secret",
			);
			let registrations = 0;
			let exchange: URLSearchParams | undefined;
			vi.mocked(fetchSafeUserUrl).mockImplementation(async (input, init) => {
				const url = new URL(input);
				if (url.pathname.includes("oauth-protected-resource")) {
					return Response.json({
						resource: mcpEndpoints[id],
						authorization_servers: ["https://oauth.example.com"],
						scopes_supported: ["read"],
					});
				}
				if (url.pathname.includes(".well-known")) {
					return Response.json({
						issuer: "https://oauth.example.com",
						authorization_endpoint: "https://oauth.example.com/authorize",
						token_endpoint: "https://oauth.example.com/token",
						registration_endpoint: "https://oauth.example.com/register",
						response_types_supported: ["code"],
						code_challenge_methods_supported: ["S256"],
						token_endpoint_auth_methods_supported: [
							"none",
							"client_secret_post",
						],
					});
				}
				if (url.pathname === "/register") {
					registrations++;
					return Response.json({
						...JSON.parse(String(init?.body)),
						client_id: "dynamic-client",
					});
				}
				if (url.pathname === "/token") {
					exchange = new URLSearchParams(String(init?.body));
					return Response.json({
						access_token: "fixture-access",
						refresh_token: "fixture-refresh",
						token_type: "Bearer",
						expires_in: 3600,
					});
				}
				throw new Error(
					`Unexpected OAuth endpoint: ${url.origin}${url.pathname}`,
				);
			});
			const credentials: ConnectorCredentials = {};
			const consent = new URL(
				await beginAuthorization(id, "fixture-state", credentials),
			);
			const verifier = credentials.verifier!;
			expect(consent.origin).toBe("https://oauth.example.com");
			expect(consent.searchParams.get("state")).toBe("fixture-state");
			expect(consent.searchParams.get("code_challenge")).toBe(
				createHash("sha256").update(verifier).digest("base64url"),
			);
			await finishAuthorization(
				id,
				credentials,
				"fixture-code",
				new URLSearchParams(),
			);
			expect(exchange?.get("code_verifier")).toBe(verifier);
			expect(exchange?.get("code")).toBe("fixture-code");
			expect(exchange?.get("redirect_uri")).toBe(
				`https://api.example.com/connectors/${id}/callback`,
			);
			expect(credentials.tokens?.access_token).toBe("fixture-access");
			expect(credentials.expiresAt).toBeGreaterThan(Date.now());
			expect(credentials.verifier).toBeUndefined();
			expect(registrations).toBe(0);
		},
	);
});
