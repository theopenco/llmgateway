import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAutoRoutingSessionStore } from "./auto-routing-session.js";

import type { AutoRoutingSessionEntry } from "./auto-routing-session.js";

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

const ENTRY: AutoRoutingSessionEntry = {
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

describe("createAutoRoutingSessionStore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("reads the pinned verdict from the per-project session key", async () => {
		vi.mocked(redis.get).mockResolvedValue(JSON.stringify(ENTRY));
		const store = createAutoRoutingSessionStore(
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
		const store = createAutoRoutingSessionStore(
			"org1",
			"proj1",
			"session-abc",
			3600,
		);

		expect(await store.get()).toBeNull();
	});

	it("writes with the sticky-session TTL", async () => {
		const store = createAutoRoutingSessionStore(
			"org1",
			"proj1",
			"session-abc",
			900,
		);

		await store.set(ENTRY);

		expect(redis.set).toHaveBeenCalledWith(
			"session_auto_routing:org1:proj1:session-abc",
			JSON.stringify(ENTRY),
			"EX",
			900,
		);
	});

	it("keys separate projects apart so a session id cannot cross over", async () => {
		vi.mocked(redis.get).mockResolvedValue(null);
		await createAutoRoutingSessionStore("org1", "proj1", "s", 60).get();
		await createAutoRoutingSessionStore("org1", "proj2", "s", 60).get();

		expect(vi.mocked(redis.get).mock.calls.map((call) => call[0])).toEqual([
			"session_auto_routing:org1:proj1:s",
			"session_auto_routing:org1:proj2:s",
		]);
	});

	it("falls open to a fresh classification when redis read fails", async () => {
		vi.mocked(redis.get).mockRejectedValue(new Error("boom"));
		const store = createAutoRoutingSessionStore("org1", "proj1", "s", 60);

		expect(await store.get()).toBeNull();
	});

	it("swallows redis errors on write", async () => {
		vi.mocked(redis.set).mockRejectedValue(new Error("boom"));
		const store = createAutoRoutingSessionStore("org1", "proj1", "s", 60);

		await expect(store.set(ENTRY)).resolves.toBeUndefined();
	});
});
