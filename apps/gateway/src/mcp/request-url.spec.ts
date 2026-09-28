import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { getMcpApiUrl, getMcpGatewayUrl } from "./request-url.js";

beforeEach(() => {
	vi.stubEnv("MCP_GATEWAY_URL", undefined);
	vi.stubEnv("GATEWAY_BACKEND_URL", undefined);
	vi.stubEnv("API_BACKEND_URL", undefined);
	vi.stubEnv("GATEWAY_URL", "https://gateway.example.com");
	vi.stubEnv("API_URL", "https://api.example.com");
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
	{
		backend: "GATEWAY_BACKEND_URL",
		publicUrl: "GATEWAY_URL",
		resolve: getMcpGatewayUrl,
	},
	{ backend: "API_BACKEND_URL", publicUrl: "API_URL", resolve: getMcpApiUrl },
])("MCP $backend", ({ backend, publicUrl, resolve }) => {
	test.each(["http://localhost:4301", "https://backend.example.com"])(
		"uses an explicitly configured backend: %s",
		(url) => {
			vi.stubEnv(backend, ` ${url}/ `);
			expect(resolve()).toBe(url);
		},
	);
	test.each([undefined, "", "  "])(
		"uses the public HTTPS fallback for %s",
		(value) => {
			vi.stubEnv(backend, value);
			vi.stubEnv(publicUrl, "https://public.example.com");
			expect(resolve()).toBe("https://public.example.com");
		},
	);
	test("rejects a public HTTP fallback", () => {
		vi.stubEnv(publicUrl, "http://public.example.com");
		expect(resolve).toThrow("HTTPS");
	});
	test.each(["ftp://localhost", "file:///etc/hosts", "invalid-url"])(
		"rejects invalid backends without falling back: %s",
		(url) => {
			vi.stubEnv(backend, url);
			expect(resolve).toThrow();
		},
	);
});

test("an explicit MCP override remains HTTPS-only and takes precedence", () => {
	vi.stubEnv("GATEWAY_BACKEND_URL", "http://localhost:4301");
	vi.stubEnv("MCP_GATEWAY_URL", "https://override.example.com/");
	expect(getMcpGatewayUrl()).toBe("https://override.example.com");
	vi.stubEnv("MCP_GATEWAY_URL", "http://override.example.com");
	expect(getMcpGatewayUrl).toThrow("HTTPS");
});
