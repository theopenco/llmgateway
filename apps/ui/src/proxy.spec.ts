import { NextRequest } from "next/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { proxy } from "./proxy";

afterEach(() => vi.unstubAllEnvs());

describe("MCP gateway configuration", () => {
	test.each([undefined, ""])(
		"rejects missing production gateway configuration: %s",
		(gatewayUrl) => {
			vi.stubEnv("NODE_ENV", "production");
			vi.stubEnv("GATEWAY_URL", gatewayUrl);
			expect(() => proxy(new NextRequest("https://app.example/mcp"))).toThrow(
				"GATEWAY_URL is required for MCP forwarding in production",
			);
		},
	);

	test("uses the configured production gateway", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("GATEWAY_URL", "https://gateway.example");
		const response = proxy(new NextRequest("https://app.example/mcp"));
		expect(response.headers.get("x-middleware-rewrite")).toBe(
			"https://gateway.example/mcp",
		);
	});

	test.each(["development", "test"])(
		"defaults to localhost in %s",
		(environment) => {
			vi.stubEnv("NODE_ENV", environment);
			vi.stubEnv("GATEWAY_URL", undefined);
			const response = proxy(new NextRequest("http://localhost:3002/mcp"));
			expect(response.headers.get("x-middleware-rewrite")).toBe(
				"http://localhost:4001/mcp",
			);
		},
	);

	test("keeps browser navigation independent of MCP forwarding", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("GATEWAY_URL", undefined);
		const response = proxy(
			new NextRequest("https://app.example/mcp", {
				headers: { Accept: "text/html" },
			}),
		);
		expect(response.headers.get("x-middleware-rewrite")).toBeNull();
		expect(response.headers.get("x-middleware-next")).toBe("1");
	});
});
