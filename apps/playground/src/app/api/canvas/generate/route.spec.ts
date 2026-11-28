import { describe, expect, it, vi } from "vitest";

import { models, type ModelDefinition } from "@llmgateway/models";

import { POST } from "./route";

const chat = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
	streamText: () => ({ toTextStreamResponse: () => new Response() }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/constants", () => ({
	getPlaygroundKeyForRequest: () => "test-token",
}));
vi.mock("@/lib/getUser", () => ({ getUser: async () => ({ id: "user" }) }));
vi.mock("@llmgateway/ai-sdk-provider", () => ({
	createLLMGateway: () => ({ chat }),
}));
vi.mock("@llmgateway/canvas/catalog", () => ({
	catalog: { prompt: () => "" },
}));

describe("canvas generate route", () => {
	it("defaults to a model its pinned provider still serves", async () => {
		await POST(
			new Request("http://localhost/api/canvas/generate", {
				method: "POST",
				body: JSON.stringify({ prompt: "a pricing card" }),
			}),
		);

		const [providerId, modelId] = String(chat.mock.calls[0]?.[0]).split("/");
		const model: ModelDefinition | undefined = models.find(
			(m) => m.id === modelId,
		);
		const mapping = model?.providers.find((p) => p.providerId === providerId);

		expect(mapping).toBeDefined();
		expect(!mapping?.deactivatedAt || mapping.deactivatedAt > new Date()).toBe(
			true,
		);
	});
});
