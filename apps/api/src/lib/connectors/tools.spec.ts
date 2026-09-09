import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestUser, deleteAll } from "@/testing.js";

import { and, db, eq, tables } from "@llmgateway/db";
import { fetchSafeUserUrl } from "@llmgateway/shared/url-safety-node";

import { openConnector, sealConnector } from "./crypto.js";
import { callConnectorTool, listConnectorTools } from "./tools.js";

vi.mock("@llmgateway/shared/url-safety-node", () => ({
	fetchSafeUserUrl: vi.fn(),
}));

describe("connector MCP integration", () => {
	let userId: string;
	beforeEach(async () => {
		await createTestUser();
		userId = (await db.query.user.findFirst())!.id;
		vi.mocked(fetchSafeUserUrl).mockImplementation(async (_url, init) => {
			if (init?.method === "DELETE") {
				return new Response(null, { status: 204 });
			}
			const request = JSON.parse(String(init?.body));
			if (request.method === "notifications/initialized") {
				return new Response(null, { status: 202 });
			}
			const result =
				request.method === "initialize"
					? {
							protocolVersion: "2025-03-26",
							capabilities: { tools: {} },
							serverInfo: { name: "fixture", version: "1" },
						}
					: request.method === "tools/list"
						? {
								tools: [
									{
										name: "search",
										description: "Search fixture documents",
										inputSchema: {
											type: "object",
											properties: { query: { type: "string" } },
											required: ["query"],
										},
									},
								],
							}
						: { content: [{ type: "text", text: "Fixture result" }] };
			return Response.json({ jsonrpc: "2.0", id: request.id, result });
		});
	});
	afterEach(async () => {
		await deleteAll();
		vi.resetAllMocks();
		vi.unstubAllEnvs();
	});

	it("refreshes expiring credentials once across simultaneous calls", async () => {
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "fixture-secret");
		await db.insert(tables.loungeConnection).values({
			userId,
			connectorId: "gmail",
			credentials: sealConnector(
				{
					tokens: {
						access_token: "expired",
						refresh_token: "refresh-before",
						token_type: "Bearer",
					},
					expiresAt: Date.now() - 1,
				},
				userId,
				"gmail",
			),
		});
		let refreshes = 0;
		vi.mocked(fetchSafeUserUrl).mockImplementation(async (url, init) => {
			if (new URL(url).hostname === "oauth2.googleapis.com") {
				refreshes++;
				return Response.json({
					access_token: "fresh",
					refresh_token: "refresh-after",
					token_type: "Bearer",
					expires_in: 3600,
				});
			}
			expect(new Headers(init?.headers).get("authorization")).toBe(
				"Bearer fresh",
			);
			return Response.json({ messages: [] });
		});
		await Promise.all([
			callConnectorTool(userId, "gmail", "search_messages", { query: "first" }),
			callConnectorTool(userId, "gmail", "search_messages", {
				query: "second",
			}),
		]);
		expect(refreshes).toBe(1);
		const connection = await db.query.loungeConnection.findFirst({
			where: { userId, connectorId: "gmail" },
		});
		expect(
			openConnector(connection!.credentials, userId, "gmail"),
		).toMatchObject({ tokens: { refresh_token: "refresh-after" } });
	});

	it("rejects missing GitHub credentials without making an upstream request", async () => {
		await db.insert(tables.loungeConnection).values({
			userId,
			connectorId: "github",
			credentials: sealConnector({}, userId, "github"),
		});
		await expect(listConnectorTools(userId, ["github"])).rejects.toMatchObject({
			status: 409,
			message: "Reconnect this connector",
		});
		expect(fetchSafeUserUrl).not.toHaveBeenCalled();
	});

	it("allows pausing during refresh and never overwrites the changed connection", async () => {
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "fixture-secret");
		const credentials = sealConnector(
			{
				tokens: {
					access_token: "expired",
					refresh_token: "refresh-before",
					token_type: "Bearer",
				},
				expiresAt: 1,
			},
			userId,
			"gmail",
		);
		await db
			.insert(tables.loungeConnection)
			.values({ userId, connectorId: "gmail", credentials });
		vi.mocked(fetchSafeUserUrl).mockImplementation(async () => {
			// This write would deadlock if refresh held a row lock during provider I/O.
			await db
				.update(tables.loungeConnection)
				.set({ enabled: false })
				.where(
					and(
						eq(tables.loungeConnection.userId, userId),
						eq(tables.loungeConnection.connectorId, "gmail"),
					),
				);
			return Response.json({
				access_token: "fresh",
				token_type: "Bearer",
				expires_in: 3600,
			});
		});
		await expect(listConnectorTools(userId, ["gmail"])).rejects.toMatchObject({
			status: 409,
		});
		expect(
			await db.query.loungeConnection.findFirst({ where: { userId } }),
		).toMatchObject({ credentials, enabled: false });
	});

	it("releases the refresh lease after a provider failure so reconnect can recover", async () => {
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_ID", "fixture-client");
		vi.stubEnv("LOUNGE_GOOGLE_CLIENT_SECRET", "fixture-secret");
		await db.insert(tables.loungeConnection).values({
			userId,
			connectorId: "gmail",
			credentials: sealConnector(
				{
					tokens: {
						access_token: "expired",
						refresh_token: "refresh-before",
						token_type: "Bearer",
					},
					expiresAt: 1,
				},
				userId,
				"gmail",
			),
		});
		vi.mocked(fetchSafeUserUrl).mockResolvedValueOnce(
			new Response(null, { status: 500 }),
		);
		await expect(listConnectorTools(userId, ["gmail"])).rejects.toMatchObject({
			status: 502,
		});
		vi.mocked(fetchSafeUserUrl).mockResolvedValueOnce(
			Response.json({
				access_token: "fresh",
				token_type: "Bearer",
				expires_in: 3600,
			}),
		);
		expect(await listConnectorTools(userId, ["gmail"])).not.toHaveLength(0);
	});

	it("rejects repeated MCP pagination cursors", async () => {
		await db.insert(tables.loungeConnection).values({
			userId,
			connectorId: "notion",
			credentials: sealConnector(
				{ tokens: { access_token: "fixture-access", token_type: "Bearer" } },
				userId,
				"notion",
			),
		});
		const original = vi.mocked(fetchSafeUserUrl).getMockImplementation()!;
		vi.mocked(fetchSafeUserUrl).mockImplementation(async (url, init) => {
			const response = await original(url, init);
			if (init?.body && JSON.parse(String(init.body)).method === "tools/list") {
				const body = await response.json();
				body.result.nextCursor = "repeat";
				return Response.json(body);
			}
			return response;
		});
		await expect(listConnectorTools(userId, ["notion"])).rejects.toThrow(
			"too many tool pages",
		);
	});

	it.each([
		"posthog",
		"slack",
		"notion",
		"figma",
		"linear",
		"sentry",
		"github",
		"stripe",
	] as const)(
		"discovers and executes %s tools through the real MCP client",
		async (connectorId) => {
			await db.insert(tables.loungeConnection).values({
				userId,
				connectorId,
				credentials: sealConnector(
					{
						tokens: { access_token: "fixture-access", token_type: "Bearer" },
					},
					userId,
					connectorId,
				),
			});
			const tools = await listConnectorTools(userId, [connectorId]);
			expect(tools).toHaveLength(1);
			expect(tools[0].inputSchema).toMatchObject({ required: ["query"] });
			const result = await callConnectorTool(userId, connectorId, "search", {
				query: "test",
			});
			expect(result).toMatchObject({
				content: [{ type: "text", text: "Fixture result" }],
			});
			const calls = vi.mocked(fetchSafeUserUrl).mock.calls;
			for (const [, init] of calls) {
				expect(new Headers(init?.headers).get("authorization")).toBe(
					"Bearer fixture-access",
				);
			}
		},
	);
});
