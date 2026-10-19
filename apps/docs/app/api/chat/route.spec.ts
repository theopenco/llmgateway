import { afterEach, expect, test, vi } from "vitest";

import { POST } from "./route";

import type * as AiModule from "ai";

vi.mock("@/lib/source", () => ({ source: { getPages: () => [] } }));
vi.mock("@llmgateway/ai-sdk-provider", () => ({
	createLLMGateway: () => ({ chat: () => ({}) }),
}));
vi.mock("ai", async (importOriginal: () => Promise<typeof AiModule>) => ({
	...(await importOriginal()),
	streamText: () => ({ toUIMessageStreamResponse: () => new Response("ok") }),
}));

afterEach(() => vi.unstubAllEnvs());

const GLOBAL_HOURLY_LIMIT_MAX = 300;

const validMessage = {
	id: "m1",
	role: "user",
	parts: [{ type: "text", text: "How do I create an API key?" }],
};

const invalidBodies: Record<string, string> = {
	"too many messages": JSON.stringify({
		messages: Array.from({ length: 51 }, () => validMessage),
	}),
	"null message": JSON.stringify({ messages: [null] }),
	"message without parts": JSON.stringify({
		messages: [{ id: "m1", role: "user" }],
	}),
	"messages not an array": JSON.stringify({ messages: "hello" }),
	"empty conversation": JSON.stringify({ messages: [] }),
	"malformed JSON": "{",
};

function post(ip: string, body: string) {
	return POST(
		new Request("http://localhost/api/chat", {
			method: "POST",
			headers: { "x-forwarded-for": ip },
			body,
		}),
	);
}

test("invalid conversations cannot consume the global model-attempt allowance", async () => {
	vi.stubEnv("DOCS_AI_SUPPORT_CHAT_API_KEY", "test-token");
	vi.stubEnv("CLIENT_IP_HEADER", "x-forwarded-for");
	let index = 0;
	for (const [name, body] of Object.entries(invalidBodies)) {
		for (let attempt = 0; attempt < GLOBAL_HOURLY_LIMIT_MAX; attempt++) {
			const ip = `198.18.${Math.floor(index / 254)}.${(index % 254) + 1}`;
			index++;
			const response = await post(ip, body);
			expect(response.status, name).toBe(400);
		}
	}
	const response = await post(
		"198.19.0.1",
		JSON.stringify({ messages: [validMessage] }),
	);
	expect(response.status).toBe(200);
});
