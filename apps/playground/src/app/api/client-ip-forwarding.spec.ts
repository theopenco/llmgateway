import { afterEach, describe, expect, test, vi } from "vitest";

import { POST as audio } from "./audio/route";
import { POST as ocr } from "./ocr/route";
import { GET as videoContent } from "./video/[videoId]/content/route";
import { GET as videoStatus } from "./video/[videoId]/route";
import { POST as video } from "./video/route";

vi.mock("next/headers", () => ({
	cookies: async () => ({ get: () => ({ value: "test-token" }) }),
}));
vi.mock("@/lib/config-server", () => ({
	getConfig: () => ({ apiBackendUrl: "http://localhost:4302" }),
}));
vi.mock("@/lib/getUser", () => ({
	getUser: async () => ({ id: "fixture-user" }),
}));

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe.each([
	{ header: undefined, value: "192.0.2.1, 192.0.2.2" },
	{ header: "X-Client-Ip", value: "192.0.2.1" },
	{ header: "X-Client-Ip", value: undefined },
])("Lounge forwarding with $header / $value", ({ header, value }) => {
	test.each([
		{
			path: "audio/speech",
			handler: audio,
			body: { model: "tts-1", input: "Hello" },
		},
		{
			path: "ocr",
			handler: ocr,
			body: { model: "auto", document: "test document" },
		},
		{
			path: "videos",
			handler: video,
			body: { model: "auto", prompt: "A tree" },
		},
		{
			path: "videos/test-video",
			handler: (req: Request) =>
				videoStatus(req, {
					params: Promise.resolve({ videoId: "test-video" }),
				}),
			body: {},
		},
	])(
		"$path forwards only the configured IP header",
		async ({ path, handler, body }) => {
			vi.stubEnv("CLIENT_IP_HEADER", header);
			vi.stubEnv("GATEWAY_BACKEND_URL", "http://localhost:4301");
			const upstream = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(Response.json({ id: "test-result" }));
			const headers = new Headers({
				"Content-Type": "application/json",
				"x-forwarded-for": "198.51.100.1",
				"x-real-ip": "198.51.100.2",
			});
			if (value) {
				headers.set(header ?? "x-forwarded-for", value);
			}
			const response = await handler(
				new Request("http://localhost/api/test", {
					method: "POST",
					headers,
					body: JSON.stringify(body),
				}),
			);
			expect(response.status).toBe(200);
			expect(upstream).toHaveBeenCalledOnce();
			const [url, init] = upstream.mock.calls[0];
			expect(url).toBe(`http://localhost:4301/v1/${path}`);
			const forwarded = new Headers(init?.headers);
			expect(forwarded.get(header ?? "x-forwarded-for")).toBe(value ?? null);
			expect(forwarded.get("x-real-ip")).toBeNull();
			if (header) {
				expect(forwarded.get("x-forwarded-for")).toBeNull();
			}
		},
	);
});

test.each([true, false])(
	"video playback forwards IPs only to the gateway: %s",
	async (gatewayContent) => {
		vi.stubEnv("CLIENT_IP_HEADER", "X-Client-Ip");
		vi.stubEnv("GATEWAY_URL", "https://gateway.example.com");
		vi.stubEnv("GATEWAY_BACKEND_URL", "http://localhost:4301");
		const path = "/v1/videos/logs/test-log/content?token=test-token";
		const sourceUrl = `https://${gatewayContent ? "gateway" : "provider"}.example.com${path}`;
		const upstream = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ content: [{ url: sourceUrl }] }))
			.mockResolvedValueOnce(
				new Response("video", { headers: { "Content-Type": "video/mp4" } }),
			);
		const response = await videoContent(
			new Request("http://localhost/api/video/test-video/content", {
				headers: { "x-client-ip": "192.0.2.1", Range: "bytes=0-99" },
			}),
			{ params: Promise.resolve({ videoId: "test-video" }) },
		);
		expect(await response.text()).toBe("video");
		expect(upstream).toHaveBeenCalledTimes(2);
		const [url, init] = upstream.mock.calls[1];
		expect(url).toBe(
			gatewayContent ? `http://localhost:4301${path}` : sourceUrl,
		);
		expect(new Headers(init?.headers).get("x-client-ip")).toBe(
			gatewayContent ? "192.0.2.1" : null,
		);
		expect(new Headers(init?.headers).get("range")).toBe("bytes=0-99");
		expect(init?.redirect).toBe("error");
	},
);
