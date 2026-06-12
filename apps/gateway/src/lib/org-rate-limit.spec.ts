import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	baseLimitEnvVar,
	checkOrgRateLimit,
	getBaseLimit,
	getPlanClass,
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
	"GATEWAY_RATE_LIMITS_ENABLED",
	"E2E_TEST",
	"GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM",
	"GATEWAY_RATE_LIMIT_DEV_CHAT_COMPLETIONS_RPM",
	"GATEWAY_RATE_LIMIT_CHATPLAN_CHAT_COMPLETIONS_RPM",
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
		process.env.GATEWAY_RATE_LIMITS_ENABLED = "true";
		expect(isOrgRateLimitEnabled()).toBe(true);
	});

	it("can be explicitly disabled as a global kill switch", () => {
		process.env.GATEWAY_RATE_LIMITS_ENABLED = "false";
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

describe("getPlanClass", () => {
	it("classifies regular orgs", () => {
		expect(getPlanClass({ devPlan: "none", chatPlan: "none" })).toBe("regular");
		expect(getPlanClass({})).toBe("regular");
		expect(getPlanClass({ devPlan: null, chatPlan: null })).toBe("regular");
	});

	it("classifies dev (devpass) plan orgs", () => {
		expect(getPlanClass({ devPlan: "lite", chatPlan: "none" })).toBe("dev");
		expect(getPlanClass({ devPlan: "max", chatPlan: "none" })).toBe("dev");
	});

	it("classifies chat plan orgs", () => {
		expect(getPlanClass({ devPlan: "none", chatPlan: "plus" })).toBe("chat");
	});

	it("prefers dev over chat when both are set", () => {
		expect(getPlanClass({ devPlan: "pro", chatPlan: "pro" })).toBe("dev");
	});
});

describe("baseLimitEnvVar", () => {
	it("derives the env var name per plan class", () => {
		expect(baseLimitEnvVar("regular", chatConfig)).toBe(
			"GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM",
		);
		expect(baseLimitEnvVar("dev", chatConfig)).toBe(
			"GATEWAY_RATE_LIMIT_DEV_CHAT_COMPLETIONS_RPM",
		);
		expect(baseLimitEnvVar("chat", chatConfig)).toBe(
			"GATEWAY_RATE_LIMIT_CHATPLAN_CHAT_COMPLETIONS_RPM",
		);
	});
});

describe("getBaseLimit", () => {
	it("uses the regular default for regular orgs", () => {
		expect(getBaseLimit(chatConfig, "regular")).toBe(chatConfig.defaultRpm);
	});

	it("uses the tighter per-plan defaults for dev and chat plans", () => {
		expect(getBaseLimit(chatConfig, "dev")).toBe(chatConfig.devDefaultRpm);
		expect(getBaseLimit(chatConfig, "chat")).toBe(chatConfig.chatDefaultRpm);
		expect(chatConfig.devDefaultRpm).toBeLessThan(chatConfig.defaultRpm);
		expect(chatConfig.chatDefaultRpm).toBeLessThan(chatConfig.defaultRpm);
		// Dev (devpass) is relaxed relative to the chat plan: it's an anti-abuse
		// backstop, not a product cap.
		expect(chatConfig.devDefaultRpm).toBeGreaterThanOrEqual(
			chatConfig.chatDefaultRpm,
		);
	});

	it("honors a per-plan-class env override", () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "500";
		process.env.GATEWAY_RATE_LIMIT_DEV_CHAT_COMPLETIONS_RPM = "20";
		process.env.GATEWAY_RATE_LIMIT_CHATPLAN_CHAT_COMPLETIONS_RPM = "10";
		expect(getBaseLimit(chatConfig, "regular")).toBe(500);
		expect(getBaseLimit(chatConfig, "dev")).toBe(20);
		expect(getBaseLimit(chatConfig, "chat")).toBe(10);
	});
});

describe("checkOrgRateLimit", () => {
	const orgId = "org-1";
	const multiplierOf = (value: number) => vi.fn().mockResolvedValue(value);

	it("allows requests under the limit and records them", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "10";
		vi.mocked(redis.zcard).mockResolvedValue(3);

		const getMultiplier = multiplierOf(1);
		const result = await checkOrgRateLimit(
			orgId,
			chatConfig,
			"regular",
			getMultiplier,
		);

		expect(result.allowed).toBe(true);
		expect(result.limit).toBe(10);
		expect(result.remaining).toBe(6);
		expect(redis.zadd).toHaveBeenCalled();
		expect(redis.expire).toHaveBeenCalled();
		// Under the base limit the spend tier must not be resolved.
		expect(getMultiplier).not.toHaveBeenCalled();
	});

	it("blocks requests at the limit with a retryAfter", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "5";
		vi.mocked(redis.zcard).mockResolvedValue(5);
		const future = Date.now() + 30_000;
		vi.mocked(redis.zrange).mockResolvedValue(["m", future.toString()]);

		const result = await checkOrgRateLimit(
			orgId,
			chatConfig,
			"regular",
			multiplierOf(1),
		);

		expect(result.allowed).toBe(false);
		expect(result.limit).toBe(5);
		expect(result.remaining).toBe(0);
		expect(result.retryAfter).toBeGreaterThan(0);
		expect(redis.zadd).not.toHaveBeenCalled();
	});

	it("applies the tighter base limit for dev (devpass) plans", async () => {
		// No env override: dev plan falls back to its default, which is below the
		// regular default.
		vi.mocked(redis.zcard).mockResolvedValue(chatConfig.devDefaultRpm);
		const future = Date.now() + 30_000;
		vi.mocked(redis.zrange).mockResolvedValue(["m", future.toString()]);

		const getMultiplier = multiplierOf(1);
		const result = await checkOrgRateLimit(
			orgId,
			chatConfig,
			"dev",
			getMultiplier,
		);

		expect(result.allowed).toBe(false);
		expect(result.limit).toBe(chatConfig.devDefaultRpm);
	});

	it("resolves the spend-tier multiplier only once the base limit is hit", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "10";
		vi.mocked(redis.zcard).mockResolvedValue(15);

		// At base limit 10 a 16th request would block, but with multiplier 4 the
		// effective limit is 40 so the request is allowed.
		const getMultiplier = multiplierOf(4);
		const result = await checkOrgRateLimit(
			orgId,
			chatConfig,
			"regular",
			getMultiplier,
		);

		expect(result.allowed).toBe(true);
		expect(result.limit).toBe(40);
		expect(getMultiplier).toHaveBeenCalledOnce();
	});

	it("treats a zero limit as unlimited without touching Redis", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "0";

		const getMultiplier = multiplierOf(1);
		const result = await checkOrgRateLimit(
			orgId,
			chatConfig,
			"regular",
			getMultiplier,
		);

		expect(result.allowed).toBe(true);
		expect(redis.zcard).not.toHaveBeenCalled();
		expect(getMultiplier).not.toHaveBeenCalled();
	});

	it("fails open on Redis errors", async () => {
		process.env.GATEWAY_RATE_LIMIT_CHAT_COMPLETIONS_RPM = "5";
		vi.mocked(redis.zremrangebyscore).mockRejectedValue(
			new Error("Redis down"),
		);

		const result = await checkOrgRateLimit(
			orgId,
			chatConfig,
			"regular",
			multiplierOf(1),
		);

		expect(result.allowed).toBe(true);
	});
});
