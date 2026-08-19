import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getNextSpendTier } from "@llmgateway/shared";

import {
	baseLimitEnvVar,
	checkOrgRateLimit,
	getBaseLimit,
	getOrgSpendTier,
	getPlanClass,
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
	swrWrap: vi.fn(
		async <T>(_key: string, _tables: string[], fetcher: () => Promise<T>) =>
			await fetcher(),
	),
}));

vi.mock("@llmgateway/logger", () => ({
	logger: {
		info: vi.fn(),
		debug: vi.fn(),
		error: vi.fn(),
	},
}));

vi.mock("@llmgateway/db", () => ({
	and: vi.fn(),
	cdb: {},
	eq: vi.fn(),
	getTableName: vi.fn(() => "mock_table"),
	sql: vi.fn(),
	project: {},
	projectHourlyStats: {},
	transaction: {},
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
	"GATEWAY_SPEND_TIER_1_SPEND_USD",
	"GATEWAY_SPEND_TIER_1_RPM_MULTIPLIER",
	"GATEWAY_SPEND_TIER_1_MIN_AGE_DAYS",
	"GATEWAY_SPEND_TIER_2_MIN_AGE_DAYS",
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
		expect(resolvePathRateLimit("/v1/ocr")?.key).toBe("ocr");
		expect(resolvePathRateLimit("/v1/rerank")?.key).toBe("rerank");
		expect(resolvePathRateLimit("/v1/audio/transcriptions")?.key).toBe(
			"audio_transcriptions",
		);
	});

	it("matches sub-paths", () => {
		expect(resolvePathRateLimit("/v1/images/generations")?.key).toBe("images");
		expect(resolvePathRateLimit("/v1/audio/speech")?.key).toBe("audio_speech");
		expect(resolvePathRateLimit("/v1/videos/abc/content")?.key).toBe("videos");
	});

	it("distinguishes the two /v1/audio subpaths", () => {
		expect(resolvePathRateLimit("/v1/audio/speech")?.key).toBe("audio_speech");
		expect(resolvePathRateLimit("/v1/audio/transcriptions")?.key).toBe(
			"audio_transcriptions",
		);
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

describe("getOrgSpendTier", () => {
	const NOW = Date.UTC(2026, 0, 15);
	const daysAgo = (n: number) => {
		const offsetMs = n * 86_400_000;
		return new Date(NOW - offsetMs);
	};

	it("classifies a brand-new $0 org as T0", () => {
		expect(getOrgSpendTier({ createdAt: daysAgo(0) }, 0, NOW)).toMatchObject({
			tier: 0,
			rpmMultiplier: 1,
			dailyCapUsd: 25,
			monthlyCapUsd: 250,
		});
	});

	it("qualifies by account age alone (spend $0)", () => {
		expect(getOrgSpendTier({ createdAt: daysAgo(8) }, 0, NOW).tier).toBe(1);
		expect(getOrgSpendTier({ createdAt: daysAgo(31) }, 0, NOW).tier).toBe(2);
		expect(getOrgSpendTier({ createdAt: daysAgo(61) }, 0, NOW).tier).toBe(3);
		expect(getOrgSpendTier({ createdAt: daysAgo(90) }, 0, NOW).tier).toBe(4);
	});

	it("never promotes a brand-new org on spend alone (min-age floors)", () => {
		const org = { createdAt: daysAgo(0) };
		expect(getOrgSpendTier(org, 10, NOW).tier).toBe(0);
		expect(getOrgSpendTier(org, 100, NOW).tier).toBe(0);
		expect(getOrgSpendTier(org, 1_000, NOW).tier).toBe(0);
		expect(getOrgSpendTier(org, 5_000, NOW).tier).toBe(0);
		expect(getOrgSpendTier(org, 1_000_000, NOW).tier).toBe(0);
	});

	it("qualifies by spend once the tier's minimum age is met", () => {
		expect(getOrgSpendTier({ createdAt: daysAgo(1) }, 10, NOW).tier).toBe(1);
		expect(getOrgSpendTier({ createdAt: daysAgo(3) }, 100, NOW).tier).toBe(2);
		expect(getOrgSpendTier({ createdAt: daysAgo(7) }, 1_000, NOW).tier).toBe(3);
		expect(getOrgSpendTier({ createdAt: daysAgo(14) }, 5_000, NOW).tier).toBe(
			4,
		);
		// High spend but young account: capped by the floor, not the spend.
		expect(
			getOrgSpendTier({ createdAt: daysAgo(3) }, 1_000_000, NOW).tier,
		).toBe(2);
	});

	it("takes the highest of the age-or-spend qualifiers", () => {
		// 31 days old (age → T2) but $1,000 lifetime spend (spend → T3) => T3
		expect(getOrgSpendTier({ createdAt: daysAgo(31) }, 1_000, NOW).tier).toBe(
			3,
		);
	});

	it("treats thresholds as inclusive", () => {
		expect(getOrgSpendTier({ createdAt: daysAgo(7) }, 0, NOW).tier).toBe(1);
		expect(getOrgSpendTier({ createdAt: daysAgo(6) }, 9, NOW).tier).toBe(0);
	});

	it("exposes the caps and multiplier for the resolved tier", () => {
		expect(
			getOrgSpendTier({ createdAt: daysAgo(14) }, 5_000, NOW),
		).toMatchObject({
			tier: 4,
			rpmMultiplier: 20,
			dailyCapUsd: 15_000,
			monthlyCapUsd: 200_000,
		});
	});

	it("respects env overrides for tier thresholds and values", () => {
		process.env.GATEWAY_SPEND_TIER_1_SPEND_USD = "5";
		process.env.GATEWAY_SPEND_TIER_1_RPM_MULTIPLIER = "3";
		expect(getOrgSpendTier({ createdAt: daysAgo(1) }, 5, NOW)).toMatchObject({
			tier: 1,
			rpmMultiplier: 3,
		});
	});

	it("admin trustTierOverride takes precedence in both directions", () => {
		// Pin UP: brand-new $0 org lifted straight to T4 (past the age floors).
		expect(
			getOrgSpendTier({ createdAt: daysAgo(0), trustTierOverride: 4 }, 0, NOW),
		).toMatchObject({ tier: 4, topUpDailyCapUsd: 20_000 });

		// Pin DOWN: an aged, high-spend org held at T0 regardless.
		expect(
			getOrgSpendTier(
				{ createdAt: daysAgo(365), trustTierOverride: 0 },
				50_000,
				NOW,
			).tier,
		).toBe(0);

		// Out-of-range pins clamp to the ladder.
		expect(
			getOrgSpendTier({ createdAt: daysAgo(0), trustTierOverride: 99 }, 0, NOW)
				.tier,
		).toBe(4);

		// Null/undefined = automatic ladder.
		expect(
			getOrgSpendTier(
				{ createdAt: daysAgo(31), trustTierOverride: null },
				0,
				NOW,
			).tier,
		).toBe(2);

		// A pinned org has no next-tier progression to advertise.
		expect(
			getNextSpendTier({ createdAt: daysAgo(0), trustTierOverride: 1 }, 0, NOW),
		).toBeNull();
	});

	it("respects env overrides of the min-age floors", () => {
		// Floor lowered to 0: day-one spend promotion restored for that tier.
		process.env.GATEWAY_SPEND_TIER_1_MIN_AGE_DAYS = "0";
		expect(getOrgSpendTier({ createdAt: daysAgo(0) }, 10, NOW).tier).toBe(1);

		// Floor raised: a 10-day-old $100 org is held below T2.
		process.env.GATEWAY_SPEND_TIER_2_MIN_AGE_DAYS = "30";
		expect(getOrgSpendTier({ createdAt: daysAgo(10) }, 100, NOW).tier).toBe(1);
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

	it("classifies product orgs by immutable kind even when the plan lapsed", () => {
		// A canceled DevPass/Chat org keeps kind but drops its entitlement to
		// "none" — it must keep flat product limits, never regular PAYG bases.
		expect(getPlanClass({ kind: "devpass", devPlan: "none" })).toBe("dev");
		expect(getPlanClass({ kind: "chat", chatPlan: "none" })).toBe("chat");
		// A default-kind org still classifies by entitlements.
		expect(getPlanClass({ kind: "default", devPlan: "lite" })).toBe("dev");
		expect(
			getPlanClass({ kind: "default", devPlan: "none", chatPlan: "none" }),
		).toBe("regular");
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
