import { Hono } from "hono";
import { afterEach, describe, expect, test, vi } from "vitest";

import { forwardedCustomHeaders } from "@/chat/tools/extract-custom-headers.js";
import { corsMiddleware } from "@/middleware/cors.js";

import { internalPrincipalHeaders } from "./internal-principal-headers.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("internal principal headers", () => {
	test.each([undefined, "https://allowed.example", "null", ""])(
		"preserves Origin presence: %s",
		(origin) => {
			vi.stubEnv("CLIENT_IP_HEADER", "x-client-ip");
			const headers = new Headers({
				"x-client-ip": "192.0.2.1",
				"x-forwarded-for": "198.51.100.1",
				Authorization: "Bearer test-token",
				Cookie: "session=fixture",
				"x-llmgateway-test": "metadata",
			});
			if (origin !== undefined) {
				headers.set("Origin", origin);
			}
			expect(internalPrincipalHeaders(headers)).toEqual({
				"x-client-ip": "192.0.2.1",
				...(origin !== undefined ? { Origin: origin } : {}),
			});
			expect(headers.get("x-forwarded-for")).toBe("198.51.100.1");
		},
	);
	test("does not substitute untrusted IP headers when the configured header is absent", () => {
		vi.stubEnv("CLIENT_IP_HEADER", "x-client-ip");
		expect(
			internalPrincipalHeaders(
				new Headers({
					"x-forwarded-for": "198.51.100.1",
					"x-real-ip": "198.51.100.2",
				}),
			),
		).toEqual({});
	});
	test("retains the default trusted IP header when not explicitly configured", () => {
		vi.stubEnv("CLIENT_IP_HEADER", undefined);
		expect(
			internalPrincipalHeaders(
				new Headers({ "x-forwarded-for": "192.0.2.1, 192.0.2.2" }),
			),
		).toEqual({ "x-forwarded-for": "192.0.2.1, 192.0.2.2" });
	});
	test("custom metadata forwarding does not preserve Origin", () => {
		expect(
			forwardedCustomHeaders(
				new Headers({ Origin: "https://allowed.example" }),
			),
		).toEqual({});
	});
	test("deployment CORS does not authorize requests for project origins", async () => {
		vi.stubEnv("GATEWAY_CORS_ORIGINS", "https://deployment.example");
		const app = new Hono();
		app.use("*", corsMiddleware);
		app.post("/", (c) => c.text("reached handler"));
		const response = await app.request("/", {
			method: "POST",
			headers: { Origin: "https://denied.example" },
		});
		expect(response.status).toBe(200);
		expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
	});
});
