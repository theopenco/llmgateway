import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSessionProviderStore } from "./preferred-provider.js";

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: vi.fn(),
		set: vi.fn(),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

const mockCache = await import("@llmgateway/cache");
const redis = mockCache.redisClient;

describe("createSessionProviderStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reads the pinned provider from the per-session redis key", async () => {
		vi.mocked(redis.get).mockResolvedValue(
			JSON.stringify({ providerId: "deepseek", region: "singapore" }),
		);
		const store = createSessionProviderStore(
			"org1",
			"model1",
			"session-abc",
			3600,
		);

		const entry = await store.get();

		expect(redis.get).toHaveBeenCalledWith(
			"session_provider:org1:model1:session-abc",
		);
		expect(entry).toEqual({ providerId: "deepseek", region: "singapore" });
	});

	it("returns null when no pin is stored", async () => {
		vi.mocked(redis.get).mockResolvedValue(null);
		const store = createSessionProviderStore(
			"org1",
			"model1",
			"session-abc",
			3600,
		);

		expect(await store.get()).toBeNull();
	});

	it("returns null and swallows redis errors on read", async () => {
		vi.mocked(redis.get).mockRejectedValue(new Error("boom"));
		const store = createSessionProviderStore(
			"org1",
			"model1",
			"session-abc",
			3600,
		);

		expect(await store.get()).toBeNull();
	});

	it("writes the pinned provider with the configured ttl", async () => {
		const store = createSessionProviderStore(
			"org1",
			"model1",
			"session-abc",
			1800,
		);

		await store.set("deepseek", "singapore");

		expect(redis.set).toHaveBeenCalledWith(
			"session_provider:org1:model1:session-abc",
			JSON.stringify({ providerId: "deepseek", region: "singapore" }),
			"EX",
			1800,
		);
	});

	it("persists a region-less pin", async () => {
		const store = createSessionProviderStore(
			"org1",
			"model1",
			"session-abc",
			1800,
		);

		await store.set("openai");

		expect(redis.set).toHaveBeenCalledWith(
			"session_provider:org1:model1:session-abc",
			JSON.stringify({ providerId: "openai", region: undefined }),
			"EX",
			1800,
		);
	});

	it("scopes the redis key per org, model, and session", async () => {
		vi.mocked(redis.get).mockResolvedValue(null);

		await createSessionProviderStore("orgA", "modelX", "s1", 60).get();
		await createSessionProviderStore("orgB", "modelY", "s2", 60).get();

		expect(redis.get).toHaveBeenNthCalledWith(
			1,
			"session_provider:orgA:modelX:s1",
		);
		expect(redis.get).toHaveBeenNthCalledWith(
			2,
			"session_provider:orgB:modelY:s2",
		);
	});
});
