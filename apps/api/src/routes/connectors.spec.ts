import { createHash } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { openConnector, sealConnector } from "@/lib/connectors/crypto.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import type * as UrlSafety from "@llmgateway/shared/url-safety-node";

vi.mock("@llmgateway/shared/url-safety-node", async (importOriginal) => ({
	...(await importOriginal<typeof UrlSafety>()),
	fetchSafeUserUrl: vi.fn(),
}));

describe("Lounge connector routes", () => {
	let cookie: string;
	beforeEach(async () => {
		cookie = await createTestUser();
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "fixture-secret");
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
	async function begin() {
		const response = await request("/gmail/authorize", "POST", {});
		expect(response.status).toBe(200);
		const { url } = await response.json();
		return new URL(url).searchParams.get("state")!;
	}
	async function connect() {
		const state = await begin();
		vi.mocked(fetchSafeUserUrl).mockResolvedValue(
			Response.json({
				access_token: "fixture-access",
				refresh_token: "fixture-refresh",
				expires_in: 3600,
			}),
		);
		const response = await request(`/gmail/callback?state=${state}&code=code`);
		expect(response.status).toBe(302);
		return state;
	}
	it("requires a session and rejects custom connector IDs", async () => {
		expect((await request("", "GET", undefined, "")).status).toBe(401);
		expect((await request("/custom/authorize", "POST", {})).status).toBe(400);
	});
	it("lists all eleven connectors without credentials", async () => {
		const response = await request("");
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body.connectors).toHaveLength(11);
		expect(JSON.stringify(body)).not.toContain("fixture-secret");
	});
	it("returns failed exchanges to the Lounge without changing an existing connection", async () => {
		await connect();
		const before = await db.query.loungeConnection.findFirst();
		const state = await begin();
		vi.mocked(fetchSafeUserUrl).mockResolvedValue(
			new Response("private upstream error", { status: 400 }),
		);
		const response = await request(
			`/gmail/callback?state=${state}&code=bad-code`,
		);
		expect(response.status).toBe(302);
		expect(
			new URL(response.headers.get("location")!).searchParams.get(
				"connector_status",
			),
		).toBe("failed");
		expect((await db.query.loungeConnection.findFirst())?.credentials).toBe(
			before?.credentials,
		);
		expect(
			(await request(`/gmail/callback?state=${state}&code=code`)).status,
		).toBe(400);
	});
	it("stores encrypted credentials, consumes OAuth state, and blocks replay", async () => {
		const state = await connect();
		const connection = await db.query.loungeConnection.findFirst();
		expect(connection).toBeDefined();
		expect(connection!.credentials).not.toContain("fixture-access");
		expect(
			openConnector(connection!.credentials, connection!.userId, "gmail"),
		).toMatchObject({ tokens: { access_token: "fixture-access" } });
		expect(
			(await request(`/gmail/callback?state=${state}&code=code`)).status,
		).toBe(400);
		expect(vi.mocked(fetchSafeUserUrl)).toHaveBeenCalledTimes(1);
	});
	it("binds authorization to its connector and session", async () => {
		const state = await begin();
		expect(
			(await request(`/google-drive/callback?state=${state}&code=code`)).status,
		).toBe(400);
		expect(vi.mocked(fetchSafeUserUrl)).not.toHaveBeenCalled();
		const hash = createHash("sha256").update(state).digest("hex");
		const pending = await db.query.loungeConnectorAuthorization.findFirst({
			where: { id: hash },
		});
		expect(pending?.consumed).toBe(false);
	});
	it("rejects expired authorization before contacting the provider", async () => {
		const state = await begin();
		await db
			.update(tables.loungeConnectorAuthorization)
			.set({ expiresAt: new Date(0) });
		expect(
			(await request(`/gmail/callback?state=${state}&code=code`)).status,
		).toBe(400);
		expect(vi.mocked(fetchSafeUserUrl)).not.toHaveBeenCalled();
	});
	it("preserves a working connection when reconnection is denied", async () => {
		await connect();
		const before = await db.query.loungeConnection.findFirst();
		const state = await begin();
		expect(
			(await request(`/gmail/callback?state=${state}&error=access_denied`))
				.status,
		).toBe(302);
		const after = await db.query.loungeConnection.findFirst();
		expect(after?.credentials).toBe(before?.credentials);
	});
	it("disconnect clears credentials and pending authorization", async () => {
		await connect();
		const state = await begin();
		expect((await request("/gmail", "DELETE")).status).toBe(200);
		expect(await db.query.loungeConnection.findFirst()).toBeUndefined();
		expect(
			(await request(`/gmail/callback?state=${state}&code=code`)).status,
		).toBe(400);
		expect(
			(
				await request("/gmail/tools/search_messages", "POST", {
					input: { query: "test" },
				})
			).status,
		).toBe(409);
	});
	it("cannot discover, use, change, or delete another user's connector", async () => {
		await db.insert(tables.user).values({
			id: "connector-other-user",
			email: "connector-other@example.com",
		});
		await db.insert(tables.loungeConnection).values({
			userId: "connector-other-user",
			connectorId: "gmail",
			credentials: sealConnector(
				{ tokens: { access_token: "fixture-other", token_type: "Bearer" } },
				"connector-other-user",
				"gmail",
			),
		});
		const body = await (await request("")).json();
		expect(
			body.connectors.find((entry: { id: string }) => entry.id === "gmail")
				.connected,
		).toBe(false);
		expect(
			(await request("/tools", "POST", { connectors: ["gmail"] })).status,
		).toBe(409);
		expect((await request("/gmail", "PATCH", { enabled: false })).status).toBe(
			404,
		);
		expect((await request("/gmail", "DELETE")).status).toBe(200);
		expect(await db.query.loungeConnection.findFirst()).toBeDefined();
	});
	it("updates an assistant approval message without duplicating history", async () => {
		const chatResponse = await app.request("/chats", {
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ title: "Connector chat", model: "auto" }),
		});
		expect(chatResponse.status).toBe(201);
		const { chat } = await chatResponse.json();
		for (const state of ["approval-requested", "output-available"]) {
			const response = await app.request(`/chats/${chat.id}/messages`, {
				method: "POST",
				headers: { Cookie: cookie, "Content-Type": "application/json" },
				body: JSON.stringify({
					id: "fixture-assistant-message",
					role: "assistant",
					tools: JSON.stringify([
						{
							type: "dynamic-tool",
							toolName: "gmail__search_messages",
							toolCallId: "fixture-call",
							state,
						},
					]),
				}),
			});
			expect(response.status).toBe(201);
		}
		const messages = await db.query.message.findMany({
			where: { chatId: chat.id },
		});
		expect(messages).toHaveLength(1);
		expect(messages[0].tools).toContain("output-available");
	});

	it("returns to the chat after consent and rejects external return URLs", async () => {
		const response = await request("/gmail/authorize", "POST", {
			returnTo: "/?id=fixture-chat",
		});
		expect(response.status).toBe(200);
		const { url } = await response.json();
		const state = new URL(url).searchParams.get("state");
		const callback = await request(
			`/gmail/callback?state=${state}&error=access_denied`,
		);
		expect(
			new URL(callback.headers.get("location")!).searchParams.get("id"),
		).toBe("fixture-chat");
		for (const returnTo of [
			"https://evil.example",
			"//evil.example",
			"/\n/evil.example",
			"/\t/evil.example",
			"/\\evil.example",
		]) {
			expect(
				(await request("/gmail/authorize", "POST", { returnTo })).status,
			).toBe(400);
		}
	});

	it("pausing immediately blocks tool discovery and execution", async () => {
		await connect();
		expect((await request("/gmail", "PATCH", { enabled: false })).status).toBe(
			200,
		);
		expect(
			(await request("/tools", "POST", { connectors: ["gmail"] })).status,
		).toBe(409);
		expect(
			(
				await request("/gmail/tools/search_messages", "POST", {
					input: { query: "test" },
				})
			).status,
		).toBe(409);
	});
});
