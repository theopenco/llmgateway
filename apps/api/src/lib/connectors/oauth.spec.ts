import { createHash, createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import { connectorAvailable, shopDomain } from "./catalogue.js";
import {
	beginAuthorization,
	exchangeNativeToken,
	verifyShopifyCallback,
} from "./oauth.js";

import type { ConnectorCredentials } from "./oauth.js";

vi.mock("@llmgateway/shared/url-safety-node", () => ({
	fetchSafeUserUrl: vi.fn(),
}));
afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetAllMocks();
});

describe("connector OAuth", () => {
	it("requests Shopify access scoped to the authorizing staff member", async () => {
		vi.stubEnv("LOUNGE_SHOPIFY_CLIENT_ID", "fixture-client");
		const url = new URL(
			await beginAuthorization("shopify", "fixture-state", {
				shop: "fixture.myshopify.com",
			}),
		);
		expect(url.searchParams.get("grant_options[]")).toBe("per-user");
		expect(url.searchParams.get("scope")).toBe("read_products,read_orders");
	});
	it.each(["gmail", "google-drive", "github"] as const)(
		"uses PKCE and a fixed callback for %s",
		async (id) => {
			vi.stubEnv(
				`LOUNGE_${id === "github" ? "GITHUB" : "GOOGLE"}_CLIENT_ID`,
				"fixture-client",
			);
			vi.stubEnv("API_URL", "https://api.example.com");
			const credentials: ConnectorCredentials = {};
			const url = new URL(
				await beginAuthorization(id, "fixture-state", credentials),
			);
			expect(url.searchParams.get("state")).toBe("fixture-state");
			expect(url.searchParams.get("redirect_uri")).toBe(
				`https://api.example.com/connectors/${id}/callback`,
			);
			expect(url.searchParams.get("code_challenge_method")).toBe("S256");
			expect(url.searchParams.get("code_challenge")).toBe(
				createHash("sha256").update(credentials.verifier!).digest("base64url"),
			);
		},
	);
	it.each([
		"https://store.myshopify.com",
		"evil.example",
		"store.myshopify.com.evil.example",
		"store.myshopify.com/path",
		"localhost",
	])("rejects unsafe store %s", (shop) => {
		expect(() => shopDomain(shop)).toThrow();
	});
	it("marks registered-app connectors unavailable without credentials", () => {
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "");
		expect(connectorAvailable("gmail")).toBe(false);
		expect(connectorAvailable("notion")).toBe(true);
	});
	it("refreshes tokens and keeps an existing refresh token if omitted", async () => {
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "fixture-secret");
		vi.mocked(fetchSafeUserUrl).mockResolvedValue(
			Response.json({ access_token: "fixture-new", expires_in: 3600 }),
		);
		const credentials: ConnectorCredentials = {
			tokens: {
				access_token: "fixture-old",
				refresh_token: "fixture-refresh",
				token_type: "Bearer",
			},
		};
		await exchangeNativeToken("gmail", credentials);
		expect(credentials.tokens?.access_token).toBe("fixture-new");
		expect(credentials.tokens?.refresh_token).toBe("fixture-refresh");
		expect(credentials.expiresAt).toBeGreaterThan(Date.now());
		const [, init] = vi.mocked(fetchSafeUserUrl).mock.calls[0];
		expect(String(init?.body)).toContain("grant_type=refresh_token");
	});
	it("rejects an OAuth error even when the provider returns HTTP 200", async () => {
		vi.stubEnv("LOUNGE_GITHUB_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GITHUB_CLIENT_SECRET", "fixture-secret");
		vi.mocked(fetchSafeUserUrl).mockResolvedValue(
			Response.json({ error: "bad_verification_code" }),
		);
		await expect(exchangeNativeToken("github", {}, "code")).rejects.toThrow(
			"invalid credentials",
		);
	});
	it("validates Shopify callback signatures and the selected store", () => {
		vi.stubEnv("LOUNGE_SHOPIFY_CLIENT_SECRET", "fixture-secret");
		const params = new URLSearchParams({
			code: "code",
			shop: "fixture.myshopify.com",
			state: "state",
			timestamp: "1234",
		});
		params.set(
			"hmac",
			createHmac("sha256", "fixture-secret")
				.update(
					"code=code&shop=fixture.myshopify.com&state=state&timestamp=1234",
				)
				.digest("hex"),
		);
		expect(() =>
			verifyShopifyCallback(params, "fixture.myshopify.com"),
		).not.toThrow();
		expect(() =>
			verifyShopifyCallback(params, "other.myshopify.com"),
		).toThrow();
		params.set("code", "tampered");
		expect(() =>
			verifyShopifyCallback(params, "fixture.myshopify.com"),
		).toThrow();
	});
});
