import { afterEach, expect, test, vi } from "vitest";

import { POST } from "./route";

vi.mock("@/lib/source", () => ({ source: { getPages: () => [] } }));
vi.mock("@llmgateway/ai-sdk-provider", () => ({
	createLLMGateway: () => ({ chat: () => ({}) }),
}));
vi.mock("ai", () => ({
	convertToModelMessages: async () => [],
	isStepCount: () => () => false,
	tool: (definition: unknown) => definition,
	streamText: () => ({ toUIMessageStreamResponse: () => new Response("ok") }),
}));

afterEach(() => vi.unstubAllEnvs());

test("invalid conversations cannot consume the global model-attempt allowance", async () => {
	vi.stubEnv("DOCS_AI_SUPPORT_CHAT_API_KEY", "test-token");
	vi.stubEnv("CLIENT_IP_HEADER", "x-forwarded-for");
	for (let index = 0; index < 301; index++) {
		const response = await POST(
			new Request("http://localhost/api/chat", {
				method: "POST",
				headers: {
					"x-forwarded-for": `198.18.${Math.floor(index / 254)}.${(index % 254) + 1}`,
				},
				body: JSON.stringify({
					messages: Array.from({ length: 51 }, () => ({
						role: "user",
						parts: [],
					})),
				}),
			}),
		);
		expect(response.status).toBe(400);
	}
	const response = await POST(
		new Request("http://localhost/api/chat", {
			method: "POST",
			headers: { "x-forwarded-for": "198.19.0.1" },
			body: JSON.stringify({ messages: [] }),
		}),
	);
	expect(response.status).toBe(200);
});
