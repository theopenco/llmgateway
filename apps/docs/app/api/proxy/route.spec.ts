import { createOpenAPI } from "fumadocs-openapi/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import { POST } from "./route";

vi.mock("@/lib/source", () => ({ openapi: createOpenAPI() }));

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("docs API explorer proxy", () => {
	test("preserves the request body and IP through the backend origin", async () => {
		vi.stubEnv("GATEWAY_URL", "https://gateway.example.com");
		vi.stubEnv("GATEWAY_BACKEND_URL", "http://localhost:4301");
		const body = JSON.stringify({ model: "auto" });
		const upstream = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({ ok: true }));
		const url = new URL("http://localhost/api/proxy");
		url.searchParams.set(
			"url",
			"https://gateway.example.com/v1/chat/completions?test=1",
		);
		const response = await POST(
			new Request(url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": String(body.length),
					"x-client-ip": "192.0.2.1",
					Authorization: "Bearer test-token",
				},
				body,
			}),
		);
		expect(response.status).toBe(200);
		expect(upstream).toHaveBeenCalledOnce();
		const forwarded = upstream.mock.calls[0][0];
		expect(forwarded).toBeInstanceOf(Request);
		if (!(forwarded instanceof Request)) {
			throw new Error("Expected a proxied Request");
		}
		expect(forwarded.url).toBe(
			"http://localhost:4301/v1/chat/completions?test=1",
		);
		expect(forwarded.headers.get("x-client-ip")).toBe("192.0.2.1");
		expect(forwarded.headers.get("authorization")).toBe("Bearer test-token");
		expect(forwarded.redirect).toBe("error");
		expect(await forwarded.text()).toBe(body);
	});

	test.each([
		"https://untrusted.example/v1/chat/completions",
		"https://api.llmgateway.io/v1/chat/completions",
	])(
		"rejects %s when another gateway is configured",
		async (target: string) => {
			vi.stubEnv("GATEWAY_URL", "https://gateway.example.com");
			const upstream = vi.spyOn(globalThis, "fetch");
			const response = await POST(
				new Request(
					`http://localhost/api/proxy?url=${encodeURIComponent(target)}`,
					{ method: "POST", headers: { Authorization: "Bearer test-token" } },
				),
			);
			expect(response.status).toBe(400);
			expect(upstream).not.toHaveBeenCalled();
		},
	);
});
test("uses the production gateway by default without a configured backend", async () => {
	vi.stubEnv("NODE_ENV", "production");
	vi.stubEnv("GATEWAY_URL", undefined);
	vi.stubEnv("GATEWAY_BACKEND_URL", undefined);
	const upstream = vi
		.spyOn(globalThis, "fetch")
		.mockResolvedValue(Response.json({ ok: true }));
	const target = "https://api.llmgateway.io/v1/chat/completions";
	const response = await POST(
		new Request(
			`http://localhost/api/proxy?url=${encodeURIComponent(target)}`,
			{
				method: "POST",
				headers: { Authorization: "Bearer test-token" },
			},
		),
	);
	expect(response.status).toBe(200);
	expect(upstream).toHaveBeenCalledOnce();
	const forwarded = upstream.mock.calls[0][0];
	expect(forwarded).toBeInstanceOf(Request);
	if (!(forwarded instanceof Request)) {
		throw new Error("Expected a proxied Request");
	}
	expect(forwarded.url).toBe(target);
	expect(forwarded.headers.get("authorization")).toBe("Bearer test-token");
});
