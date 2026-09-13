import { afterEach, describe, expect, it, vi } from "vitest";

import { executeNativeTool } from "./native-tools.js";
import { connectorFetch } from "./oauth.js";

vi.mock("./oauth.js", () => ({ connectorFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const credentials = {
	tokens: { access_token: "fixture-access", token_type: "Bearer" },
	shop: "fixture.myshopify.com",
};

describe("native connector tools", () => {
	it.each([
		[
			"gmail",
			"search_messages",
			{ query: "from:example.com", limit: 2 },
			"gmail.googleapis.com",
			"/messages",
		],
		[
			"gmail",
			"read_message",
			{ id: "message-id" },
			"gmail.googleapis.com",
			"/messages/message-id",
		],
		[
			"google-drive",
			"search_files",
			{ query: "name contains 'report'" },
			"www.googleapis.com",
			"/drive/v3/files",
		],
		[
			"google-drive",
			"read_document",
			{ id: "document-id" },
			"www.googleapis.com",
			"/drive/v3/files/document-id/export",
		],
		[
			"shopify",
			"search_products",
			{ query: "status:active" },
			"fixture.myshopify.com",
			"/graphql.json",
		],
		[
			"shopify",
			"search_orders",
			{ query: "status:open" },
			"fixture.myshopify.com",
			"/graphql.json",
		],
	] as const)(
		"%s/%s uses the authenticated provider endpoint",
		async (id, name, input, host, path) => {
			vi.mocked(connectorFetch).mockResolvedValue(
				Response.json({ data: "fixture-result" }),
			);
			await executeNativeTool(id, name, input, credentials);
			const [url, init] = vi.mocked(connectorFetch).mock.calls[0];
			expect(new URL(url).hostname).toBe(host);
			expect(new URL(url).pathname).toContain(path);
			const headers = new Headers(init?.headers);
			expect(
				headers.get(
					id === "shopify" ? "X-Shopify-Access-Token" : "Authorization",
				),
			).toBe(id === "shopify" ? "fixture-access" : "Bearer fixture-access");
		},
	);
	it("decodes multipart Gmail bodies for the model", async () => {
		vi.mocked(connectorFetch).mockResolvedValue(
			Response.json({
				id: "message-id",
				payload: {
					mimeType: "multipart/alternative",
					headers: [{ name: "Subject", value: "Fixture subject" }],
					parts: [
						{
							mimeType: "text/plain",
							body: {
								data: Buffer.from("Readable email body").toString("base64url"),
							},
						},
					],
				},
			}),
		);
		await expect(
			executeNativeTool(
				"gmail",
				"read_message",
				{ id: "message-id" },
				credentials,
			),
		).resolves.toMatchObject({
			text: "Readable email body",
			headers: [{ name: "Subject", value: "Fixture subject" }],
		});
	});

	it("rejects a file ID that could alter the endpoint", async () => {
		await expect(
			executeNativeTool(
				"gmail",
				"read_message",
				{ id: "../../settings" },
				credentials,
			),
		).rejects.toThrow();
		expect(connectorFetch).not.toHaveBeenCalled();
	});
	it("does not expose credentials or upstream response bodies on failure", async () => {
		vi.mocked(connectorFetch).mockResolvedValue(
			new Response("private error body", { status: 401 }),
		);
		await expect(
			executeNativeTool(
				"gmail",
				"search_messages",
				{ query: "test" },
				credentials,
			),
		).rejects.toThrow("Reconnect this connector");
	});
	it("surfaces Shopify GraphQL errors returned with HTTP 200", async () => {
		vi.mocked(connectorFetch).mockResolvedValue(
			Response.json({ errors: [{ message: "Denied" }] }),
		);
		await expect(
			executeNativeTool(
				"shopify",
				"search_orders",
				{ query: "test" },
				credentials,
			),
		).rejects.toThrow("could not complete");
	});
	it("keeps Shopify search text out of the GraphQL document", async () => {
		vi.mocked(connectorFetch).mockResolvedValue(Response.json({ data: {} }));
		await executeNativeTool(
			"shopify",
			"search_products",
			{ query: "injected query" },
			credentials,
		);
		const payload = JSON.parse(
			String(vi.mocked(connectorFetch).mock.calls[0][1]?.body),
		);
		expect(payload.query).not.toContain("injected query");
		expect(payload.variables.query).toBe("injected query");
	});
});
