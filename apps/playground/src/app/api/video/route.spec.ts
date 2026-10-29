import { afterEach, describe, expect, test, vi } from "vitest";

import { POST } from "./route";

vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/getUser", () => ({
	getUser: vi.fn().mockResolvedValue({ id: "user" }),
}));
vi.mock("@/lib/constants", () => ({
	getPlaygroundKeyForRequest: vi.fn().mockReturnValue("test-token"),
}));
vi.mock("@llmgateway/shared/gateway-url", () => ({
	getGatewayApiBaseUrl: () => "https://gateway.example/v1",
}));

afterEach(() => vi.restoreAllMocks());

describe("video proxy", () => {
	test.each(["low", "high"])(
		"preserves %s reasoning, resolution, audio and frame inputs",
		async (effort) => {
			const body = {
				model: "fal-ai/flux-3-max",
				prompt: "A bird flies across the sky",
				seconds: 5,
				size: "1080x1920",
				audio: false,
				reasoning_effort: effort,
				image: { image_url: "https://example.com/start.png" },
				last_frame: { image_url: "https://example.com/end.png" },
			};
			const upstream = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(Response.json({ id: "v_123", status: "queued" }));
			const response = await POST(
				new Request("http://localhost/api/video", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-no-fallback": "true",
					},
					body: JSON.stringify(body),
				}),
			);
			expect(response.status).toBe(200);
			expect(upstream).toHaveBeenCalledOnce();
			const [url, init] = upstream.mock.calls[0];
			expect(url).toBe("https://gateway.example/v1/videos");
			expect(JSON.parse(String(init?.body))).toEqual(body);
			expect(new Headers(init?.headers).get("x-no-fallback")).toBe("true");
		},
	);
});
