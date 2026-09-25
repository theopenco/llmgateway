import { beforeEach, describe, expect, it, vi } from "vitest";

import { createSmartRoutingSessionStore } from "./smart-routing-session.js";

import type { SmartRoutingSessionEntry } from "./smart-routing-session.js";

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

	it("refreshes with the sticky-session TTL", async () => {
		const store = createSmartRoutingSessionStore(
			"org1",
			"proj1",
			"session-abc",
			900,
		);

		await store.refresh(ENTRY);

		expect(redis.set).toHaveBeenCalledWith(
			"session_auto_routing:org1:proj1:session-abc",
			JSON.stringify(ENTRY),
			"EX",
			900,
		);
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

	it("swallows redis errors on refresh", async () => {
		vi.mocked(redis.set).mockRejectedValue(new Error("boom"));
		const store = createSmartRoutingSessionStore("org1", "proj1", "s", 60);

		await expect(store.refresh(ENTRY)).resolves.toBeUndefined();
	});
});
