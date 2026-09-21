import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { openConnector } from "@/lib/connectors/crypto.js";
import { createTestUser, deleteAll, getTestToken } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import type * as UrlSafety from "@llmgateway/shared/url-safety-node";

vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => ({
	...(await importOriginal<typeof UrlSafety>()),
	fetchSafeUserUrl: vi.fn(),
}));

describe("native connector authorization", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "fixture-secret");
		vi.mocked(fetchSafeUserUrl).mockImplementation(async () =>
			Response.json({
				access_token: "fixture-access",
				refresh_token: "fixture-refresh",
				expires_in: 3600,
			}),
		);
	});
	afterEach(async () => {
		await deleteAll();
		vi.unstubAllEnvs();
		vi.resetAllMocks();
	});

	function request(
		path: string,
		method = "GET",
		body?: unknown,
		sessionCookie = cookie,
	) {
		return app.request(`/connectors${path}`, {
			method,
			headers: { Cookie: sessionCookie, "Content-Type": "application/json" },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
		});
	}
	async function begin(
		body: { platform?: "ios"; shop?: string } = { platform: "ios" },
		id = "gmail",
	) {
		const response = await request(`/${id}/authorize`, "POST", body);
		expect(response.status).toBe(200);
		const { url } = await response.json();
		return new URL(url).searchParams.get("state")!;
	}
	function complete(
		state: string,
		sessionCookie = cookie,
		extra = "code=fixture-code",
		id = "gmail",
	) {
		return request(
			`/${id}/complete`,
			"POST",
			{ callbackQuery: `state=${state}&${extra}` },
			sessionCookie,
		);
	}

	it("delivers the callback without a browser session and links only through the initiating app session", async () => {
		const state = await begin();
		const query = `state=${state}&code=fixture%2Bcode&scope=mail+profile`;
		const response = await request(
			`/gmail/callback?${query}`,
			"GET",
			undefined,
			"",
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).toBe(
			`io.llmgateway.lounge://connector/gmail?${query}`,
		);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
		expect(await db.query.loungeConnection.findFirst()).toBeUndefined();
		expect(
			(await db.query.loungeConnectorAuthorization.findFirst())?.consumed,
		).toBe(false);
		expect((await complete(state, "")).status).toBe(401);
		const session = await db.query.session.findFirst();
		const result = await app.request("/connectors/gmail/complete", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${session!.token}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				callbackQuery: new URL(response.headers.get("location")!).search,
			}),
		});
		expect(result.status).toBe(200);
		expect(await result.json()).toEqual({ status: "connected" });
		const connection = await db.query.loungeConnection.findFirst();
		expect(connection!.credentials).not.toContain("fixture-access");
		expect(
			openConnector(connection!.credentials, connection!.userId, "gmail"),
		).toMatchObject({ tokens: { access_token: "fixture-access" } });
		const [, init] = vi.mocked(fetchSafeUserUrl).mock.calls[0];
		const exchange = new URLSearchParams(String(init?.body));
		expect(exchange.get("code")).toBe("fixture+code");
		expect(exchange.get("code_verifier")).toBeTruthy();
		expect((await complete(state)).status).toBe(400);
		expect(fetchSafeUserUrl).toHaveBeenCalledTimes(1);
	});

	it("keeps web callbacks session-protected and rejects completing web state in the native endpoint", async () => {
		const state = await begin({});
		expect(
			(
				await request(
					`/gmail/callback?state=${state}&code=code`,
					"GET",
					undefined,
					"",
				)
			).status,
		).toBe(401);
		expect((await complete(state)).status).toBe(400);
		expect(
			(await db.query.loungeConnectorAuthorization.findFirst())?.consumed,
		).toBe(false);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
		expect(
			(await request(`/gmail/callback?state=${state}&code=code`)).status,
		).toBe(302);
		expect(await db.query.loungeConnection.findFirst()).toBeDefined();
	});

	it("only hands native callbacks back to the app even when a browser session is present", async () => {
		const state = await begin();
		const response = await request(`/gmail/callback?state=${state}&code=code`);
		expect(response.headers.get("location")).toContain(
			"io.llmgateway.lounge://connector/gmail?",
		);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
		expect(await db.query.loungeConnection.findFirst()).toBeUndefined();
	});

	it("rejects another session for the same user without consuming the authorization", async () => {
		const state = await begin();
		const otherSession = await getTestToken(app);
		expect((await complete(state, otherSession)).status).toBe(400);
		expect(
			(await db.query.loungeConnectorAuthorization.findFirst())?.consumed,
		).toBe(false);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
		expect((await complete(state)).status).toBe(200);
	});

	it("rejects another user without consuming the authorization", async () => {
		const state = await begin();
		const account = await db.query.account.findFirst();
		await db.insert(tables.user).values({
			id: "connector-other-user",
			email: "connector-other@example.com",
			emailVerified: true,
		});
		await db.insert(tables.account).values({
			id: "connector-other-account",
			accountId: "connector-other-account",
			providerId: "credential",
			userId: "connector-other-user",
			password: account!.password,
		});
		const login = await app.request("/auth/sign-in/email", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "connector-other@example.com",
				password: "admin@example.com1A",
			}),
		});
		expect(login.status).toBe(200);
		expect(
			(await complete(state, login.headers.get("set-cookie")!)).status,
		).toBe(400);
		expect(
			(await db.query.loungeConnectorAuthorization.findFirst())?.consumed,
		).toBe(false);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
	});

	it("binds native state to its connector", async () => {
		const state = await begin();
		expect(
			(
				await request(
					`/google-drive/callback?state=${state}&code=code`,
					"GET",
					undefined,
					"",
				)
			).status,
		).toBe(401);
		expect(
			(await complete(state, cookie, "code=code", "google-drive")).status,
		).toBe(400);
		expect(
			(await db.query.loungeConnectorAuthorization.findFirst())?.consumed,
		).toBe(false);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
	});

	it("rejects expired native state before redirect or exchange", async () => {
		const state = await begin();
		await db
			.update(tables.loungeConnectorAuthorization)
			.set({ expiresAt: new Date(0) });
		expect(
			(
				await request(
					`/gmail/callback?state=${state}&code=code`,
					"GET",
					undefined,
					"",
				)
			).status,
		).toBe(401);
		expect((await complete(state)).status).toBe(400);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
	});

	it.each([
		"state=duplicate&code=code",
		"code=one&code=two",
		"error=one&error=two",
	])("rejects ambiguous callback parameters: %s", async (extra) => {
		const state = await begin();
		expect((await complete(state, cookie, extra)).status).toBe(400);
		expect(
			(await db.query.loungeConnectorAuthorization.findFirst())?.consumed,
		).toBe(false);
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
	});

	it.each(["cancelled", "failed"])(
		"preserves existing credentials when reconnection is %s",
		async (status) => {
			expect((await complete(await begin())).status).toBe(200);
			const before = await db.query.loungeConnection.findFirst();
			const state = await begin();
			vi.mocked(fetchSafeUserUrl).mockResolvedValue(
				new Response("provider error", { status: 400 }),
			);
			const response = await complete(
				state,
				cookie,
				status === "cancelled" ? "error=access_denied" : "code=invalid",
			);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ status });
			expect((await db.query.loungeConnection.findFirst())?.credentials).toBe(
				before?.credentials,
			);
			expect((await complete(state)).status).toBe(400);
		},
	);

	it("does not reconnect after disconnection during the token exchange", async () => {
		const state = await begin();
		vi.mocked(fetchSafeUserUrl).mockImplementationOnce(async () => {
			expect((await request("/gmail", "DELETE")).status).toBe(200);
			return Response.json({
				access_token: "fixture-access",
				token_type: "Bearer",
			});
		});
		expect((await complete(state)).status).toBe(409);
		expect(await db.query.loungeConnection.findFirst()).toBeUndefined();
	});

	it("allows only one completion while a token exchange is in flight", async () => {
		const state = await begin();
		vi.mocked(fetchSafeUserUrl).mockImplementationOnce(async () => {
			expect((await complete(state)).status).toBe(400);
			return Response.json({
				access_token: "fixture-access",
				token_type: "Bearer",
			});
		});
		expect((await complete(state)).status).toBe(200);
		expect(fetchSafeUserUrl).toHaveBeenCalledTimes(1);
		expect(await db.query.loungeConnection.findMany()).toHaveLength(1);
	});

	it("preserves Shopify callback fields through the app handoff and verifies their signature", async () => {
		vi.stubEnv("LOUNGE_SHOPIFY_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_SHOPIFY_CLIENT_SECRET", "fixture-secret");
		const state = await begin(
			{ platform: "ios", shop: "fixture.myshopify.com" },
			"shopify",
		);
		const query = new URLSearchParams({
			code: "code",
			shop: "fixture.myshopify.com",
			state,
			timestamp: "1234",
			host: "fixture+host/==",
		});
		query.sort();
		query.set(
			"hmac",
			createHmac("sha256", "fixture-secret")
				.update([...query].map(([key, value]) => `${key}=${value}`).join("&"))
				.digest("hex"),
		);
		const callback = await request(
			`/shopify/callback?${query}`,
			"GET",
			undefined,
			"",
		);
		expect(callback.status).toBe(302);
		const handoff = new URL(callback.headers.get("location")!);
		expect(handoff.searchParams.toString()).toBe(query.toString());
		const response = await request("/shopify/complete", "POST", {
			callbackQuery: handoff.search,
		});
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "connected" });
		expect((await db.query.loungeConnection.findFirst())?.connectorId).toBe(
			"shopify",
		);
	});
});
