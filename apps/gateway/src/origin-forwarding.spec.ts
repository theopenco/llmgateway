import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";
import { hashApiKeyForStorage } from "@llmgateway/shared/api-key-hash";

import { app } from "./app.js";
import { createGatewayApiTestHarness } from "./test-utils/gateway-api-test-harness.js";
import {
	sdkToken,
	seedGatewaySdkSession,
} from "./test-utils/gateway-sdk-session.js";
import { inferencePaths } from "./test-utils/gateway-security-paths.js";

const png =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j6ioAAAAASUVORK5CYII=";
const chat = {
	model: "gpt-4o-mini",
	messages: [{ role: "user", content: "Hello" }],
};
const image = { model: "gemini-2.5-flash-image", prompt: "A tree" };
const adapters = [
	...inferencePaths.filter(
		({ path }) =>
			path === "/v1/chat/completions" ||
			path.includes("/messages") ||
			path.includes("/responses") ||
			path.includes("/images/") ||
			path.includes("/ai/language-model"),
	),
	{
		path: "/v1/images/edits",
		body: { ...image, images: [{ image_url: "data:image/png;base64," + png }] },
	},
];
describe("SDK origin context across gateway adapters", () => {
	createGatewayApiTestHarness();
	beforeEach(async () => {
		vi.stubEnv("GATEWAY_CORS_ORIGINS", "https://deployment.example");
		await seedGatewaySdkSession();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	describe.each([
		{
			origin: "https://denied.example",
			expected: "Origin not allowed for this project",
		},
		{
			origin: "https://allowed.example",
			expected: "Test-mode wallets can only use free models",
		},
		{
			origin: undefined,
			expected: "Test-mode wallets can only use free models",
		},
	])("origin $origin", ({ origin, expected }) => {
		test.each(adapters)(
			"$path preserves session origin checks",
			async ({ path, body, multipart }) => {
				const response = await app.request(path, {
					method: "POST",
					headers: {
						...(!multipart ? { "Content-Type": "application/json" } : {}),
						Authorization: "Bearer " + sdkToken,
						"ai-language-model-specification-version": "4",
						"ai-language-model-id": "openai/" + chat.model,
						...(origin ? { Origin: origin } : {}),
					},
					body: multipart ? multipart() : JSON.stringify(body),
				});
				expect(response.status).toBe(403);
				expect(await response.text()).toContain(expected);
			},
		);
	});
});

describe("MCP internal request origin context", () => {
	createGatewayApiTestHarness();
	beforeEach(async () => {
		await db.insert(tables.apiKey).values({
			id: "mcp-origin-key",
			description: "MCP origin key",
			...hashApiKeyForStorage("mcp-origin-token"),
			projectId: "project-id",
			createdBy: "user-id",
		});
	});
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});
	const tools = [
		{ name: "chat", arguments: chat },
		{ name: "generate-image", arguments: { prompt: "A tree" } },
		{ name: "generate-nano-banana", arguments: { prompt: "A tree" } },
		{ name: "get-account", arguments: {} },
	];
	describe.each([false, true])("streamable %s", (streamable) => {
		describe.each(["https://allowed.example", undefined])(
			"origin %s",
			(origin) => {
				test.each(tools)(
					"$name preserves only the trusted client context",
					async (params) => {
						vi.stubEnv("GATEWAY_CORS_ORIGINS", "https://allowed.example");
						vi.stubEnv("MCP_GATEWAY_URL", "https://gateway.example.com");
						vi.stubEnv("API_BACKEND_URL", "https://api.example.com");
						vi.stubEnv("CLIENT_IP_HEADER", "x-client-ip");
						const fetchSpy = vi
							.spyOn(globalThis, "fetch")
							.mockResolvedValue(
								Response.json(
									{ error: "Stopped before provider" },
									{ status: 403 },
								),
							);
						await app.request("/mcp", {
							method: "POST",
							headers: {
								"Content-Type": "application/json",
								Authorization: "Bearer mcp-origin-token",
								"x-client-ip": "192.0.2.1",
								"x-forwarded-for": "198.51.100.1",
								...(origin ? { Origin: origin } : {}),
								...(streamable
									? {
											Accept: "application/json, text/event-stream",
											"MCP-Protocol-Version": "2025-03-26",
										}
									: {}),
							},
							body: JSON.stringify({
								jsonrpc: "2.0",
								id: 1,
								method: "tools/call",
								params,
							}),
						});
						expect(fetchSpy).toHaveBeenCalledOnce();
						const headers = new Headers(fetchSpy.mock.calls[0]![1]?.headers);
						expect(headers.get("Origin")).toBe(origin ?? null);
						expect(headers.get("x-client-ip")).toBe("192.0.2.1");
						expect(headers.has("x-forwarded-for")).toBe(false);
					},
				);
			},
		);
	});
});
