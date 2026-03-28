import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	checkProviderRateLimit,
	filterRateLimitedProviders,
	getExceededProviderRateLimitLabels,
	peekProviderRateLimit,
} from "./provider-rate-limit.js";

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

const noLimits = {
	maxRpm: 0,
	maxRpd: 0,
	rpmSource: "none",
	rpdSource: "none",
} as const;

describe("checkProviderRateLimit", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("allows requests when no limits are configured", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue(noLimits);

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
		expect(result.rateLimited).toBe(false);
		expect(result.blockedBy).toEqual([]);
		expect(result.limits.rpm.limit).toBe(0);
		expect(result.limits.rpd.limit).toBe(0);
		expect(redis.zremrangebyscore).not.toHaveBeenCalled();
	});

	it("consumes both RPM and RPD windows when under the limits", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			maxRpd: 1000,
			rpmSource: "global_provider_model",
			rpdSource: "global_provider_model",
			rpmRateLimitId: "rl-rpm",
			rpdRateLimitId: "rl-rpd",
		});
		vi.mocked(redis.zcard).mockResolvedValueOnce(50).mockResolvedValueOnce(400);

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
		expect(result.limits.rpm.remaining).toBe(49);
		expect(result.limits.rpd.remaining).toBe(599);
		expect(redis.zadd).toHaveBeenCalledTimes(2);
		expect(redis.expire).toHaveBeenCalledTimes(2);
	});

	it("blocks when any configured window is exceeded", async () => {
		const now = 1_700_000_000_000;
		const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 10,
			maxRpd: 1000,
			rpmSource: "global_provider",
			rpdSource: "global_provider_model",
			rpmRateLimitId: "rl-rpm",
			rpdRateLimitId: "rl-rpd",
		});
		vi.mocked(redis.zcard).mockResolvedValueOnce(10).mockResolvedValueOnce(50);
		vi.mocked(redis.zrange).mockResolvedValueOnce([
			"member",
			(now - 5_000).toString(),
		]);

		try {
			const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

			expect(result.allowed).toBe(false);
			expect(result.rateLimited).toBe(true);
			expect(result.blockedBy).toEqual(["rpm"]);
			expect(result.retryAfter).toBeGreaterThan(0);
			expect(redis.zadd).not.toHaveBeenCalled();
		} finally {
			dateNowSpy.mockRestore();
		}
	});

	it("uses a unique member per request", async () => {
		const now = 1_700_000_000_000;
		const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			maxRpd: 0,
			rpmSource: "global_provider_model",
			rpdSource: "none",
			rpmRateLimitId: "rl-rpm",
		});
		vi.mocked(redis.zcard).mockResolvedValueOnce(0);

		try {
			await checkProviderRateLimit("org-1", "openai", "gpt-4o");

			expect(redis.zadd).toHaveBeenCalledOnce();
			const zaddArgs = vi.mocked(redis.zadd).mock.calls[0];
			expect(zaddArgs[0]).toBe(
				"rate_limit:provider_cap:rpm:org-1:openai:gpt-4o",
			);
			expect(zaddArgs[1]).toBe(now);
			expect(zaddArgs[2]).toMatch(new RegExp(`^${now}:`));
		} finally {
			dateNowSpy.mockRestore();
		}
	});

	it("fails open on Redis errors", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			maxRpd: 0,
			rpmSource: "global_provider_model",
			rpdSource: "none",
			rpmRateLimitId: "rl-rpm",
		});
		vi.mocked(redis.zremrangebyscore).mockRejectedValue(
			new Error("Redis error"),
		);

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
		expect(result.rateLimited).toBe(false);
	});
});

describe("peekProviderRateLimit", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("returns not rate-limited when below both windows", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			maxRpd: 5000,
			rpmSource: "global_provider_model",
			rpdSource: "global_provider_model",
			rpmRateLimitId: "rl-rpm",
			rpdRateLimitId: "rl-rpd",
		});
		vi.mocked(redis.zcard).mockResolvedValueOnce(20).mockResolvedValueOnce(300);

		const result = await peekProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
		expect(result.rateLimited).toBe(false);
		expect(result.limits.rpm.currentCount).toBe(20);
		expect(result.limits.rpd.currentCount).toBe(300);
		expect(redis.zadd).not.toHaveBeenCalled();
	});

	it("returns all exceeded windows when multiple limits are hit", async () => {
		const now = 1_700_000_000_000;
		const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		vi.mocked(mockDb.getEffectiveRateLimit).mockResolvedValue({
			maxRpm: 10,
			maxRpd: 100,
			rpmSource: "global_provider",
			rpdSource: "global_model",
			rpmRateLimitId: "rl-rpm",
			rpdRateLimitId: "rl-rpd",
		});
		vi.mocked(redis.zcard).mockResolvedValueOnce(10).mockResolvedValueOnce(100);
		vi.mocked(redis.zrange)
			.mockResolvedValueOnce(["rpm-member", (now - 5_000).toString()])
			.mockResolvedValueOnce(["rpd-member", (now - 10_000).toString()]);

		try {
			const result = await peekProviderRateLimit("org-1", "openai", "gpt-4o");

			expect(result.allowed).toBe(false);
			expect(result.rateLimited).toBe(true);
			expect(result.blockedBy).toEqual(["rpm", "rpd"]);
			expect(result.retryAfter).toBeGreaterThan(0);
		} finally {
			dateNowSpy.mockRestore();
		}
	});
});

describe("filterRateLimitedProviders", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("returns provider IDs that are blocked by either limit window", async () => {
		vi.mocked(mockDb.getEffectiveRateLimit)
			.mockResolvedValueOnce({
				maxRpm: 10,
				maxRpd: 0,
				rpmSource: "global_provider",
				rpdSource: "none",
				rpmRateLimitId: "rl-openai",
			})
			.mockResolvedValueOnce({
				maxRpm: 0,
				maxRpd: 1000,
				rpmSource: "none",
				rpdSource: "global_provider",
				rpdRateLimitId: "rl-anthropic",
			});
		vi.mocked(redis.zcard).mockResolvedValueOnce(10).mockResolvedValueOnce(900);
		vi.mocked(redis.zrange).mockResolvedValueOnce([
			"member",
			Date.now().toString(),
		]);

		const result = await filterRateLimitedProviders("org-1", [
			{ providerId: "openai", model: "gpt-4o" },
			{ providerId: "anthropic", model: "claude-3-5-sonnet" },
		]);

		expect(result.has("openai")).toBe(true);
		expect(result.has("anthropic")).toBe(false);
	});
});

describe("getExceededProviderRateLimitLabels", () => {
	it("formats the blocked limit types for logging", () => {
		expect(getExceededProviderRateLimitLabels(["rpm"])).toBe("RPM");
		expect(getExceededProviderRateLimitLabels(["rpm", "rpd"])).toBe(
			"RPM and RPD",
		);
	});
});
