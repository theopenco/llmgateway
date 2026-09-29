import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

vi.mock("next/headers", () => ({ cookies: async () => new Map() }));
vi.mock("@/lib/getUser", () => ({
	getUser: async () => ({ id: "test-user" }),
}));
vi.mock("@/lib/config-server", () => ({
	getConfig: () => ({ apiBackendUrl: "http://api.example.test" }),
}));

afterEach(() => vi.unstubAllGlobals());

describe("video content range responses", () => {
	it.each([null, "Range not satisfiable"])(
		"preserves an unsatisfied range with body %s",
		async (body) => {
			const fetchMock = vi
				.fn()
				.mockResolvedValueOnce(
					Response.json({
						content: [{ url: "https://content.example.test/video" }],
					}),
				)
				.mockResolvedValueOnce(
					new Response(body, {
						status: 416,
						headers: {
							"Content-Range": "bytes */1234",
							"Accept-Ranges": "bytes",
						},
					}),
				);
			vi.stubGlobal("fetch", fetchMock);
			const response = await GET(
				new Request("http://localhost/api/video/test/content", {
					headers: { Range: "bytes=2000-" },
				}),
				{ params: Promise.resolve({ videoId: "test" }) },
			);
			expect(response.status).toBe(416);
			expect(response.headers.get("Content-Range")).toBe("bytes */1234");
			expect(await response.text()).toBe(body ?? "");
			expect(fetchMock).toHaveBeenLastCalledWith(
				"https://content.example.test/video",
				{
					headers: { Range: "bytes=2000-" },
					cache: "no-store",
					redirect: "error",
				},
			);
		},
	);
});
