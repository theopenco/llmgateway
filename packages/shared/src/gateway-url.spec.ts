import { afterEach, describe, expect, test, vi } from "vitest";

import {
	buildGatewayVideoLogContentUrl,
	getGatewayApiBaseUrl,
	getGatewayPublicBaseUrl,
} from "./gateway-url.js";

afterEach(() => vi.unstubAllEnvs());

describe("gateway origins", () => {
	test("uses the backend for server calls and public origin for content links", () => {
		vi.stubEnv("GATEWAY_URL", "https://gateway.example.com");
		vi.stubEnv("GATEWAY_BACKEND_URL", " http://localhost:4301/ ");
		expect(getGatewayApiBaseUrl()).toBe("http://localhost:4301/v1");
		expect(getGatewayPublicBaseUrl()).toBe("https://gateway.example.com");
		expect(buildGatewayVideoLogContentUrl("test-log")).toBe(
			"https://gateway.example.com/v1/videos/logs/test-log/content",
		);
	});

	test.each([undefined, "", "  "])(
		"keeps the public fallback for %s",
		(backend) => {
			vi.stubEnv("GATEWAY_BACKEND_URL", backend);
			vi.stubEnv("GATEWAY_URL", "https://gateway.example.com/");
			expect(getGatewayApiBaseUrl()).toBe("https://gateway.example.com/v1");
		},
	);

	test("keeps the local development fallback", () => {
		vi.stubEnv("GATEWAY_BACKEND_URL", undefined);
		vi.stubEnv("GATEWAY_URL", undefined);
		vi.stubEnv("NODE_ENV", "development");
		expect(getGatewayApiBaseUrl()).toBe("http://localhost:4001/v1");
	});
});
