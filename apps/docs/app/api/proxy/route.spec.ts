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
test.each([false, true])(
	"streams multipart uploads with Content-Length: %s",
	async (knownLength: boolean) => {
		vi.stubEnv("GATEWAY_URL", "https://gateway.example.com");
		vi.stubEnv("GATEWAY_BACKEND_URL", "http://localhost:4301");
		const body = new FormData();
		body.set("model", "test-model");
		body.set(
			"file",
			new File(["audio fixture"], "test.wav", { type: "audio/wav" }),
		);
		const request = new Request(
			"http://localhost/api/proxy?url=https://gateway.example.com/v1/audio/transcriptions",
			{
				method: "POST",
				headers: {
					Authorization: "Bearer test-token",
					"x-client-ip": "192.0.2.1",
					"transfer-encoding": "chunked",
				},
				body,
			},
		);
		if (knownLength) {
			request.headers.set(
				"content-length",
				String((await request.clone().arrayBuffer()).byteLength),
			);
			request.headers.delete("transfer-encoding");
		}
		const bufferBody = vi.spyOn(request, "arrayBuffer");
		expect(request.headers.has("content-length")).toBe(knownLength);
		const upstream = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({ ok: true }));
		const response = await POST(request);
		expect(bufferBody).not.toHaveBeenCalled();
		expect(response.status).toBe(200);
		expect(upstream).toHaveBeenCalledOnce();
		const forwarded = upstream.mock.calls[0][0];
		if (!(forwarded instanceof Request)) {
			throw new Error("Expected a proxied Request");
		}
		expect(forwarded.url).toBe("http://localhost:4301/v1/audio/transcriptions");
		expect(forwarded.headers.get("authorization")).toBe("Bearer test-token");
		expect(forwarded.headers.get("x-client-ip")).toBe("192.0.2.1");
		expect(forwarded.headers.has("transfer-encoding")).toBe(false);
		const form = await forwarded.formData();
		expect(form.get("model")).toBe("test-model");
		const file = form.get("file");
		if (!(file instanceof File)) {
			throw new Error("Expected an uploaded file");
		}
		expect(file.name).toBe("test.wav");
		expect(file.type).toBe("audio/wav");
		expect(await file.text()).toBe("audio fixture");
	},
);
test.each([
	[
		"https://gateway.example.com/public",
		"http://localhost:4301/internal",
		"http://localhost:4301/internal/v1/audio/speech?test=1",
	],
	[
		"https://gateway.example.com/public/",
		"http://localhost:4301/internal/",
		"http://localhost:4301/internal/v1/audio/speech?test=1",
	],
	[
		"https://gateway.example.com/public",
		undefined,
		"https://gateway.example.com/public/v1/audio/speech?test=1",
	],
])(
	"maps public base %s to backend %s",
	async (
		publicBase: string,
		backendBase: string | undefined,
		expected: string,
	) => {
		vi.stubEnv("GATEWAY_URL", publicBase);
		vi.stubEnv("GATEWAY_BACKEND_URL", backendBase);
		const target = `${publicBase.replace(/\/+$/, "")}/v1/audio/speech?test=1`;
		const upstream = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json({ ok: true }));
		const response = await POST(
			new Request(
				`http://localhost/api/proxy?url=${encodeURIComponent(target)}`,
				{ method: "POST" },
			),
		);
		expect(response.status).toBe(200);
		expect(upstream).toHaveBeenCalledOnce();
		const forwarded = upstream.mock.calls[0][0];
		if (!(forwarded instanceof Request)) {
			throw new Error("Expected a proxied Request");
		}
		expect(forwarded.url).toBe(expected);
	},
);
