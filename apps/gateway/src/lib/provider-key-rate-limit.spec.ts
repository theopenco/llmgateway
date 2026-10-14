import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getRateLimitedProviderKeyIds,
	recordProviderKeyUsage,
} from "./provider-key-rate-limit.js";

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		zremrangebyscore: vi.fn(),
		zcard: vi.fn(),
		zrange: vi.fn(),
		zadd: vi.fn(),
		expire: vi.fn(),
		hgetall: vi.fn(),
		hdel: vi.fn(),
		hincrby: vi.fn(),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: { error: vi.fn() },
}));

const { redisClient: redis } = await import("@llmgateway/cache");

const uncapped = {
	maxRpm: null,
	maxRpd: null,
	maxTpm: null,
	maxTpd: null,
};

describe("provider key rate limits", () => {
	const now = 1_700_000_000_000;

	beforeEach(() => {
		vi.resetAllMocks();
		vi.spyOn(Date, "now").mockReturnValue(now);
		vi.mocked(redis.zcard).mockResolvedValue(0);
		vi.mocked(redis.zrange).mockResolvedValue([]);
		vi.mocked(redis.hgetall).mockResolvedValue({});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("never touches Redis for keys without caps", async () => {
		const limited = await getRateLimitedProviderKeyIds([
			{ id: "key-1", ...uncapped },
		]);

		expect(limited.size).toBe(0);
		expect(redis.zcard).not.toHaveBeenCalled();
		expect(redis.hgetall).not.toHaveBeenCalled();
	});

	it("flags keys at a request or token cap", async () => {
		vi.mocked(redis.zcard).mockImplementation(async (key) =>
			key === "rate_limit:provider_key:rpm:key-rpm" ? 5 : 0,
		);
		vi.mocked(redis.hgetall).mockImplementation(async (key) =>
			key === "rate_limit:provider_key:tpd:key-tpd"
				? { [String(now - 60_000)]: "1000" }
				: {},
		);

		const limited = await getRateLimitedProviderKeyIds([
			{ id: "key-rpm", ...uncapped, maxRpm: 5 },
			{ id: "key-tpd", ...uncapped, maxTpd: 1000 },
			{ id: "key-free", ...uncapped, maxRpm: 5, maxTpd: 1000 },
		]);

		expect([...limited].sort()).toEqual(["key-rpm", "key-tpd"]);
	});

	it("fails open when Redis errors", async () => {
		vi.mocked(redis.zremrangebyscore).mockRejectedValue(new Error("down"));

		const limited = await getRateLimitedProviderKeyIds([
			{ id: "key-1", ...uncapped, maxRpm: 1 },
		]);

		expect(limited.size).toBe(0);
	});

	it("records the request and its tokens against configured windows only", async () => {
		await recordProviderKeyUsage(
			{ id: "key-1", ...uncapped, maxRpd: 100, maxTpm: 1000 },
			250,
		);

		expect(redis.zadd).toHaveBeenCalledTimes(1);
		expect(vi.mocked(redis.zadd).mock.calls[0][0]).toBe(
			"rate_limit:provider_key:rpd:key-1",
		);
		expect(redis.hincrby).toHaveBeenCalledWith(
			"rate_limit:provider_key:tpm:key-1",
			String(now),
			250,
		);
	});
});
