import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	checkProviderRateLimit,
	filterRateLimitedProviders,
	peekProviderRateLimit,
} from "./provider-rate-limit.js";

// Mock dependencies
vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		zremrangebyscore: vi.fn(),
		zcard: vi.fn(),
		zrange: vi.fn(),
		zadd: vi.fn(),
		expire: vi.fn(),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@llmgateway/db", () => ({
	getEffectiveRateLimit: vi.fn(),
}));

const mockCache = await import("@llmgateway/cache");
const mockDb = await import("@llmgateway/db");
const redis = mockCache.redisClient;

describe("checkProviderRateLimit", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("should allow requests when no rate limit is configured", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 0,
			source: "none",
		});

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
		expect(result.limit).toBe(0);
		// Should not touch Redis at all
		expect(redis.zremrangebyscore).not.toHaveBeenCalled();
	});

	it("should allow requests under the rate limit", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			source: "global_provider_model",
			rateLimitId: "rl-1",
		});
		vi.mocked(redis.zcard).mockResolvedValue(50);

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
		expect(result.limit).toBe(100);
		expect(result.remaining).toBe(49); // 100 - 50 - 1
		expect(redis.zadd).toHaveBeenCalled();
		expect(redis.expire).toHaveBeenCalled();
	});

	it("should block requests when rate limit is exceeded", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 10,
			source: "global_provider",
			rateLimitId: "rl-2",
		});
		vi.mocked(redis.zcard).mockResolvedValue(10); // At limit
		const futureTimestamp = Date.now() + 30000;
		vi.mocked(redis.zrange).mockResolvedValue([
			"123",
			futureTimestamp.toString(),
		]);

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(false);
		expect(result.limit).toBe(10);
		expect(result.remaining).toBe(0);
		expect(result.retryAfter).toBeGreaterThan(0);
		// Should not add to window when blocked
		expect(redis.zadd).not.toHaveBeenCalled();
	});

	it("should use unique member per request in sorted set", async () => {
		const now = 1_700_000_000_000;
		const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);

		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			source: "global_provider_model",
			rateLimitId: "rl-1",
		});
		vi.mocked(redis.zcard).mockResolvedValue(0);

		try {
			await checkProviderRateLimit("org-1", "openai", "gpt-4o");

			expect(redis.zadd).toHaveBeenCalledOnce();
			const zaddArgs = vi.mocked(redis.zadd).mock.calls[0];
			expect(zaddArgs[0]).toBe("rate_limit:provider_cap:org-1:openai:gpt-4o");
			expect(zaddArgs[1]).toBe(now);
			expect(zaddArgs[2]).toMatch(new RegExp(`^${now}:`));
			expect(zaddArgs[2]).not.toBe(now.toString());
		} finally {
			dateNowSpy.mockRestore();
		}
	});

	it("should allow requests on Redis error (fail-open)", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			source: "global_provider_model",
			rateLimitId: "rl-1",
		});
		vi.mocked(redis.zremrangebyscore).mockRejectedValue(
			new Error("Redis error"),
		);

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
	});

	it("should allow requests on DB error (fail-open)", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockRejectedValue(
			new Error("DB error"),
		);

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
	});

	it("should pass providerModelName to getEffectiveRateLimit", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 0,
			source: "none",
		});

		await checkProviderRateLimit(
			"org-1",
			"openai",
			"gpt-4o",
			"gpt-4o-2024-08-06",
		);

		expect(mockDb.getEffectiveRateLimit).toHaveBeenCalledWith(
			"org-1",
			"openai",
			"gpt-4o",
			"gpt-4o-2024-08-06",
		);
	});
});

describe("peekProviderRateLimit", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("should return not rate-limited when no limit is configured", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 0,
			source: "none",
		});

		const result = await peekProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.rateLimited).toBe(false);
		expect(result.limit).toBe(0);
		expect(redis.zremrangebyscore).not.toHaveBeenCalled();
	});

	it("should return not rate-limited when under the limit", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			source: "global_provider_model",
			rateLimitId: "rl-1",
		});
		vi.mocked(redis.zcard).mockResolvedValue(50);

		const result = await peekProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.rateLimited).toBe(false);
		expect(result.limit).toBe(100);
		expect(result.currentCount).toBe(50);
		// Must NOT consume a slot
		expect(redis.zadd).not.toHaveBeenCalled();
	});

	it("should return rate-limited when at the limit", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 10,
			source: "global_provider",
			rateLimitId: "rl-2",
		});
		vi.mocked(redis.zcard).mockResolvedValue(10);

		const result = await peekProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.rateLimited).toBe(true);
		expect(result.limit).toBe(10);
		// Must NOT consume a slot
		expect(redis.zadd).not.toHaveBeenCalled();
	});

	it("should fail-open on error", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockRejectedValue(
			new Error("DB error"),
		);

		const result = await peekProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.rateLimited).toBe(false);
	});
});

describe("filterRateLimitedProviders", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("should return set of rate-limited provider IDs", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit)
			.mockResolvedValueOnce({
				maxRpm: 10,
				source: "global_provider",
				rateLimitId: "rl-1",
			})
			.mockResolvedValueOnce({
				maxRpm: 100,
				source: "global_provider",
				rateLimitId: "rl-2",
			});
		vi.mocked(redis.zcard)
			.mockResolvedValueOnce(10) // openai at limit
			.mockResolvedValueOnce(5); // anthropic under limit

		const result = await filterRateLimitedProviders("org-1", [
			{ providerId: "openai", model: "gpt-4o" },
			{ providerId: "anthropic", model: "claude-3-5-sonnet" },
		]);

		expect(result.has("openai")).toBe(true);
		expect(result.has("anthropic")).toBe(false);
	});

	it("should return empty set when no limits configured", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 0,
			source: "none",
		});

		const result = await filterRateLimitedProviders("org-1", [
			{ providerId: "openai", model: "gpt-4o" },
		]);

		expect(result.size).toBe(0);
	});
});
