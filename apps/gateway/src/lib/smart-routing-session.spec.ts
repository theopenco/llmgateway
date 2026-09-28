import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSmartRoutingSessionStore } from "./smart-routing-session.js";

import type { SmartRoutingSessionEntry } from "./smart-routing-session.js";

const pipeline = {
	expire: vi.fn(),
	hset: vi.fn(),
	hincrby: vi.fn(),
	exec: vi.fn(),
};

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		get: vi.fn(),
		set: vi.fn(),
		eval: vi.fn(),
		hgetall: vi.fn(),
		pipeline: vi.fn(() => pipeline),
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

const ENTRY: SmartRoutingSessionEntry = {
	classification: {
		difficulty: "high",
		difficultyScore: 2,
		task: "coding",
		outputType: "code",
		bestModel: "claude-opus-4-6",
		bestModelConfidence: 0.8,
		latencyMs: 120,
	},
	selectedModel: "claude-opus-4-6",
};

describe("createSmartRoutingSessionStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const method of ["expire", "hset", "hincrby"] as const) {
			pipeline[method].mockReturnValue(pipeline);
		}
		pipeline.exec.mockResolvedValue([]);
	});

	it("reads the pinned verdict from the per-project session key", async () => {
		vi.mocked(redis.get).mockResolvedValue(JSON.stringify(ENTRY));
		const store = createSmartRoutingSessionStore(
			"org1",
			"proj1",
			"session-abc",
			3600,
		);

		expect(await store.get()).toEqual(ENTRY);
		expect(redis.get).toHaveBeenCalledWith(
			"session_auto_routing:org1:proj1:session-abc",
		);
	});

	it("returns null when no verdict is stored", async () => {
		vi.mocked(redis.get).mockResolvedValue(null);
		const store = createSmartRoutingSessionStore(
			"org1",
			"proj1",
			"session-abc",
			3600,
		);

		expect(await store.get()).toBeNull();
	});

	it("replaces the entry with a bumped version when the version matches", async () => {
		vi.mocked(redis.eval).mockResolvedValue(null);
		const store = createSmartRoutingSessionStore(
			"org1",
			"proj1",
			"session-abc",
			900,
		);

		const stored = await store.replace(3, ENTRY);

		expect(stored).toEqual({ ...ENTRY, version: 4 });
		expect(redis.eval).toHaveBeenCalledWith(
			expect.any(String),
			1,
			"session_auto_routing:org1:proj1:session-abc",
			JSON.stringify({ ...ENTRY, version: 4 }),
			3,
			900,
		);
	});

	it("returns the newer entry when another request replaced it first", async () => {
		const newer = { ...ENTRY, version: 7, selectedModel: "claude-haiku-4-5" };
		vi.mocked(redis.eval).mockResolvedValue(JSON.stringify(newer));
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 900);

		expect(await store.replace(3, ENTRY)).toEqual(newer);
	});

	it("keeps an active session alive without rewriting it", async () => {
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 900);

		await store.touch();

		expect(pipeline.expire).toHaveBeenCalledWith(
			"session_auto_routing:org1:proj1:s",
			900,
		);
		expect(pipeline.expire).toHaveBeenCalledWith(
			"session_auto_routing_activity:org1:proj1:s",
			900,
		);
		expect(redis.set).not.toHaveBeenCalled();
	});

	it("records activity as counters on the session's activity hash", async () => {
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 900);

		await store.recordActivity({
			finishReason: "completed",
			provider: "anthropic",
			promptTokens: 1000,
			cachedTokens: 800,
			outputTokens: 50,
			extendedCacheWrite: true,
		});

		const key = "session_auto_routing_activity:org1:proj1:s";
		expect(pipeline.hset).toHaveBeenCalledWith(
			key,
			expect.objectContaining({
				lastFinishReason: "completed",
				lastProvider: "anthropic",
				lastPromptTokens: 1000,
			}),
		);
		expect(pipeline.hincrby).toHaveBeenCalledWith(key, "requests", 1);
		expect(pipeline.hincrby).toHaveBeenCalledWith(key, "cachedTokens", 800);
		expect(pipeline.hset).toHaveBeenCalledWith(key, "usedExtendedCache", "1");
		expect(pipeline.expire).toHaveBeenCalledWith(key, 900);
	});

	it("reads activity back with numeric fields", async () => {
		vi.mocked(redis.hgetall).mockResolvedValue({
			lastActivityAt: "1700000000000",
			lastFinishReason: "tool_calls",
			lastProvider: "anthropic",
			lastPromptTokens: "1000",
			requests: "3",
			promptTokens: "3000",
			cachedTokens: "2000",
			outputTokens: "90",
		});
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 900);

		expect(await store.getActivity()).toEqual({
			lastActivityAt: 1_700_000_000_000,
			lastFinishReason: "tool_calls",
			lastProvider: "anthropic",
			lastPromptTokens: 1000,
			usedExtendedCache: false,
			requests: 3,
			promptTokens: 3000,
			cachedTokens: 2000,
			outputTokens: 90,
		});
	});

	it("returns no activity for a session that has none", async () => {
		vi.mocked(redis.hgetall).mockResolvedValue({});
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 900);

		expect(await store.getActivity()).toBeNull();
	});

	it("claims the session atomically and keeps its own entry when it wins", async () => {
		vi.mocked(redis.set).mockResolvedValue("OK");
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 900);

		expect(await store.claim(ENTRY)).toEqual(ENTRY);
		expect(redis.set).toHaveBeenCalledWith(
			"session_auto_routing:org1:proj1:s",
			JSON.stringify(ENTRY),
			"EX",
			900,
			"NX",
		);
	});

	it("adopts the winner's entry when another request claimed first", async () => {
		// Two opening turns of one session must not end up on different models.
		const winner = { ...ENTRY, selectedModel: "claude-sonnet-4-6" };
		vi.mocked(redis.set).mockResolvedValue(null);
		vi.mocked(redis.get).mockResolvedValue(JSON.stringify(winner));
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 900);

		expect(await store.claim(ENTRY)).toEqual(winner);
	});

	it("falls back to its own entry when the claim errors", async () => {
		vi.mocked(redis.set).mockRejectedValue(new Error("boom"));
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 900);

		expect(await store.claim(ENTRY)).toEqual(ENTRY);
	});

	it("keys separate projects apart so a session id cannot cross over", async () => {
		vi.mocked(redis.get).mockResolvedValue(null);
		await createSmartRoutingSessionStore("org1", "proj1", "s", 60).get();
		await createSmartRoutingSessionStore("org1", "proj2", "s", 60).get();

		expect(vi.mocked(redis.get).mock.calls.map((call) => call[0])).toEqual([
			"session_auto_routing:org1:proj1:s",
			"session_auto_routing:org1:proj2:s",
		]);
	});

	it("falls open to a fresh classification when redis read fails", async () => {
		vi.mocked(redis.get).mockRejectedValue(new Error("boom"));
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 60);

		expect(await store.get()).toBeNull();
	});

	it("serves its own decision when the replace errors", async () => {
		vi.mocked(redis.eval).mockRejectedValue(new Error("boom"));
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 60);

		expect(await store.replace(1, ENTRY)).toEqual({ ...ENTRY, version: 2 });
	});
});
