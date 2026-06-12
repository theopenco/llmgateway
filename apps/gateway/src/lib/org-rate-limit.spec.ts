import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	checkOrgRateLimit,
	getEffectiveLimit,
	getSpendTierMultiplier,
	isOrgRateLimitEnabled,
	PATH_RATE_LIMITS,
	resolvePathRateLimit,
	type PathRateLimitConfig,
} from "./org-rate-limit.js";

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		zremrangebyscore: vi.fn(),
		zcard: vi.fn(),
		zrange: vi.fn(),
		zadd: vi.fn(),
		expire: vi.fn(),
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

vi.mock("@llmgateway/db", () => ({
	db: {},
	eq: vi.fn(),
	sql: vi.fn(),
	project: {},
	projectHourlyStats: {},
}));

vi.mock("./cached-queries.js", () => ({
	findApiKeyByToken: vi.fn(),
	findProjectById: vi.fn(),
}));

const mockCache = await import("@llmgateway/cache");
const redis = mockCache.redisClient;

const ENV_KEYS = [
	"GATEWAY_RATE_LIMIT_ENABLED",
	"E2E_TEST",
	"GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM",
	"GATEWAY_RATE_LIMIT_TIER_1_THRESHOLD",
	"GATEWAY_RATE_LIMIT_TIER_2_THRESHOLD",
	"GATEWAY_RATE_LIMIT_TIER_3_THRESHOLD",
	"GATEWAY_RATE_LIMIT_TIER_1_MULTIPLIER",
	"GATEWAY_RATE_LIMIT_TIER_3_MULTIPLIER",
	"GATEWAY_RATE_LIMIT_TIER_0_MULTIPLIER",
	"GATEWAY_RATE_LIMIT_WINDOW_SECONDS",
];

beforeEach(() => {
	vi.clearAllMocks();
	// Start each test from a clean, deterministic env for all keys we read.
	for (const key of ENV_KEYS) {
		vi.stubEnv(key, undefined as unknown as string);
	}
});

afterEach(() => {
	vi.unstubAllEnvs();
});

const chatConfig = PATH_RATE_LIMITS.find(
	(c) => c.key === "chat_completions",
) as PathRateLimitConfig;

describe("resolvePathRateLimit", () => {
	it("matches exact paths", () => {
		expect(resolvePathRateLimit("/v1/chat/completions")?.key).toBe(
			"chat_completions",
		);
		expect(resolvePathRateLimit("/v1/models")?.key).toBe("models");
		expect(resolvePathRateLimit("/v1/messages")?.key).toBe("messages");
	});

	it("matches sub-paths", () => {
		expect(resolvePathRateLimit("/v1/images/generations")?.key).toBe("images");
		expect(resolvePathRateLimit("/v1/audio/speech")?.key).toBe("audio_speech");
		expect(resolvePathRateLimit("/v1/videos/abc/content")?.key).toBe("videos");
	});

	it("returns null for non-rate-limited paths", () => {
		expect(resolvePathRateLimit("/")).toBeNull();
		expect(resolvePathRateLimit("/metrics")).toBeNull();
		expect(resolvePathRateLimit("/docs")).toBeNull();
		expect(resolvePathRateLimit("/mcp")).toBeNull();
	});
});

describe("isOrgRateLimitEnabled", () => {
	it("is enabled by default", () => {
		expect(isOrgRateLimitEnabled()).toBe(true);
	});

	it("is disabled in the e2e suite by default", () => {
		process.env.E2E_TEST = "true";
		expect(isOrgRateLimitEnabled()).toBe(false);
	});

	it("honors an explicit override even in the e2e suite", () => {
		process.env.E2E_TEST = "true";
		process.env.GATEWAY_RATE_LIMIT_ENABLED = "true";
		expect(isOrgRateLimitEnabled()).toBe(true);
	});

	it("can be explicitly disabled", () => {
		process.env.GATEWAY_RATE_LIMIT_ENABLED = "false";
		expect(isOrgRateLimitEnabled()).toBe(false);
	});
});

describe("getSpendTierMultiplier", () => {
	it("returns tier 0 below the first threshold", () => {
		expect(getSpendTierMultiplier(0)).toEqual({ tier: 0, multiplier: 1 });
		expect(getSpendTierMultiplier(999)).toEqual({ tier: 0, multiplier: 1 });
	});

	it("returns tier 1 at $1k", () => {
		expect(getSpendTierMultiplier(1_000)).toEqual({ tier: 1, multiplier: 2 });
		expect(getSpendTierMultiplier(9_999)).toEqual({ tier: 1, multiplier: 2 });
	});

	it("returns tier 2 at $10k", () => {
		expect(getSpendTierMultiplier(10_000)).toEqual({ tier: 2, multiplier: 4 });
	});

	it("returns tier 3 at $50k", () => {
		expect(getSpendTierMultiplier(50_000)).toEqual({ tier: 3, multiplier: 10 });
		expect(getSpendTierMultiplier(1_000_000)).toEqual({
			tier: 3,
			multiplier: 10,
		});
	});

	it("respects env overrides for thresholds and multipliers", () => {
		process.env.GATEWAY_RATE_LIMIT_TIER_1_THRESHOLD = "500";
		process.env.GATEWAY_RATE_LIMIT_TIER_1_MULTIPLIER = "3";
		expect(getSpendTierMultiplier(500)).toEqual({ tier: 1, multiplier: 3 });
		expect(getSpendTierMultiplier(499)).toEqual({ tier: 0, multiplier: 1 });
	});
});

describe("getEffectiveLimit", () => {
	it("uses the path default times the multiplier", () => {
		expect(getEffectiveLimit(chatConfig, 1)).toBe(chatConfig.defaultRpm);
		expect(getEffectiveLimit(chatConfig, 2)).toBe(chatConfig.defaultRpm * 2);
	});

	it("honors a per-path env override", () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "100";
		expect(getEffectiveLimit(chatConfig, 1)).toBe(100);
		expect(getEffectiveLimit(chatConfig, 4)).toBe(400);
	});
});

describe("checkOrgRateLimit", () => {
	const orgId = "org-1";

	it("allows requests under the limit and records them", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "10";
		vi.mocked(redis.zcard).mockResolvedValue(3);

		const result = await checkOrgRateLimit(orgId, chatConfig, 1);

		expect(result.allowed).toBe(true);
		expect(result.limit).toBe(10);
		expect(result.remaining).toBe(6);
		expect(redis.zadd).toHaveBeenCalled();
		expect(redis.expire).toHaveBeenCalled();
	});

	it("blocks requests at the limit with a retryAfter", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "5";
		vi.mocked(redis.zcard).mockResolvedValue(5);
		const future = Date.now() + 30_000;
		vi.mocked(redis.zrange).mockResolvedValue(["m", future.toString()]);

		const result = await checkOrgRateLimit(orgId, chatConfig, 1);

		expect(result.allowed).toBe(false);
		expect(result.limit).toBe(5);
		expect(result.remaining).toBe(0);
		expect(result.retryAfter).toBeGreaterThan(0);
		expect(redis.zadd).not.toHaveBeenCalled();
	});

	it("applies the spend-tier multiplier to the limit", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "10";
		vi.mocked(redis.zcard).mockResolvedValue(15);

		// At base limit 10 a 16th request would block, but with multiplier 4 the
		// effective limit is 40 so the request is allowed.
		const result = await checkOrgRateLimit(orgId, chatConfig, 4);

		expect(result.allowed).toBe(true);
		expect(result.limit).toBe(40);
	});

	it("treats a zero limit as unlimited", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "0";

		const result = await checkOrgRateLimit(orgId, chatConfig, 1);

		expect(result.allowed).toBe(true);
		expect(redis.zcard).not.toHaveBeenCalled();
	});

	it("fails open on Redis errors", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "5";
		vi.mocked(redis.zremrangebyscore).mockRejectedValue(
			new Error("Redis down"),
		);

		const result = await checkOrgRateLimit(orgId, chatConfig, 1);

		expect(result.allowed).toBe(true);
	});
});
