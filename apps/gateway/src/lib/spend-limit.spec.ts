import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@llmgateway/cache", () => ({
	redisClient: {
		mget: vi.fn(),
		pipeline: vi.fn(),
	},
}));

vi.mock("@llmgateway/logger", () => ({
	logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("./org-rate-limit.js", () => ({
	getOrganizationLifetimeSpend: vi.fn(),
	getOrgSpendTier: vi.fn(),
}));

const { checkSpendLimit, recordSpend, isSpendCapEnabled } =
	await import("./spend-limit.js");
const { redisClient } = await import("@llmgateway/cache");
const orl = await import("./org-rate-limit.js");

const T1 = {
	tier: 1,
	rpmMultiplier: 2,
	dailyCapUsd: 100,
	monthlyCapUsd: 1_000,
};

function makePipeline() {
	return {
		incrbyfloat: vi.fn().mockReturnThis(),
		expire: vi.fn().mockReturnThis(),
		exec: vi.fn().mockResolvedValue([]),
	};
}

const defaultOrg = {
	id: "org-1",
	kind: "default" as string | null,
	plan: "pro" as string | null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.stubEnv("GATEWAY_SPEND_CAPS_ENABLED", "true");
	vi.stubEnv("E2E_TEST", undefined as unknown as string);
	vi.mocked(orl.getOrganizationLifetimeSpend).mockResolvedValue(0);
	vi.mocked(orl.getOrgSpendTier).mockReturnValue(T1);
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("isSpendCapEnabled", () => {
	it("honors an explicit false", () => {
		vi.stubEnv("GATEWAY_SPEND_CAPS_ENABLED", "false");
		expect(isSpendCapEnabled()).toBe(false);
	});

	it("honors an explicit true", () => {
		vi.stubEnv("GATEWAY_SPEND_CAPS_ENABLED", "true");
		expect(isSpendCapEnabled()).toBe(true);
	});

	it("is disabled by default under a test runner", () => {
		vi.stubEnv("GATEWAY_SPEND_CAPS_ENABLED", undefined as unknown as string);
		vi.stubEnv("NODE_ENV", "test");
		expect(isSpendCapEnabled()).toBe(false);
	});

	it("is enabled by default outside tests", () => {
		vi.stubEnv("GATEWAY_SPEND_CAPS_ENABLED", undefined as unknown as string);
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("E2E_TEST", undefined as unknown as string);
		expect(isSpendCapEnabled()).toBe(true);
	});
});

describe("checkSpendLimit", () => {
	it("allows and skips Redis when disabled", async () => {
		vi.stubEnv("GATEWAY_SPEND_CAPS_ENABLED", "false");
		const result = await checkSpendLimit(defaultOrg);
		expect(result.allowed).toBe(true);
		expect(redisClient.mget).not.toHaveBeenCalled();
	});

	it("exempts non-default org kinds", async () => {
		const result = await checkSpendLimit({ ...defaultOrg, kind: "devpass" });
		expect(result.allowed).toBe(true);
		expect(redisClient.mget).not.toHaveBeenCalled();
	});

	it("exempts enterprise orgs", async () => {
		const result = await checkSpendLimit({ ...defaultOrg, plan: "enterprise" });
		expect(result.allowed).toBe(true);
		expect(redisClient.mget).not.toHaveBeenCalled();
	});

	it("allows when both counters are under the tier caps", async () => {
		vi.mocked(redisClient.mget).mockResolvedValue(["10", "20"]);
		const result = await checkSpendLimit(defaultOrg);
		expect(result.allowed).toBe(true);
	});

	it("blocks when the daily counter is at/over the cap", async () => {
		vi.mocked(redisClient.mget).mockResolvedValue(["100", "20"]);
		const result = await checkSpendLimit(defaultOrg);
		expect(result.allowed).toBe(false);
		expect(result.period).toBe("daily");
		expect(result.limit).toBe(100);
		expect(result.current).toBe(100);
		expect(result.retryAfter).toBeGreaterThan(0);
	});

	it("blocks when the monthly counter is at/over the cap", async () => {
		vi.mocked(redisClient.mget).mockResolvedValue(["10", "1000"]);
		const result = await checkSpendLimit(defaultOrg);
		expect(result.allowed).toBe(false);
		expect(result.period).toBe("monthly");
		expect(result.limit).toBe(1_000);
		expect(result.retryAfter).toBeGreaterThan(0);
	});

	it("fails open on Redis errors", async () => {
		vi.mocked(redisClient.mget).mockRejectedValue(new Error("redis down"));
		const result = await checkSpendLimit(defaultOrg);
		expect(result.allowed).toBe(true);
	});
});

describe("recordSpend", () => {
	it("increments both buckets with TTLs when cost > 0", async () => {
		const pipeline = makePipeline();
		vi.mocked(redisClient.pipeline).mockReturnValue(pipeline as never);

		await recordSpend("org-1", 0.42);

		expect(pipeline.incrbyfloat).toHaveBeenCalledTimes(2);
		expect(pipeline.expire).toHaveBeenCalledTimes(2);
		expect(pipeline.exec).toHaveBeenCalledOnce();
		const keys = pipeline.incrbyfloat.mock.calls.map((c) => c[0] as string);
		expect(keys.some((k) => k.startsWith("spend_cap:daily:org-1:"))).toBe(true);
		expect(keys.some((k) => k.startsWith("spend_cap:monthly:org-1:"))).toBe(
			true,
		);
	});

	it("does nothing when cost is 0", async () => {
		await recordSpend("org-1", 0);
		expect(redisClient.pipeline).not.toHaveBeenCalled();
	});

	it("does nothing when disabled", async () => {
		vi.stubEnv("GATEWAY_SPEND_CAPS_ENABLED", "false");
		await recordSpend("org-1", 1);
		expect(redisClient.pipeline).not.toHaveBeenCalled();
	});

	it("swallows Redis errors", async () => {
		vi.mocked(redisClient.pipeline).mockImplementation(() => {
			throw new Error("redis down");
		});
		await expect(recordSpend("org-1", 1)).resolves.toBeUndefined();
	});
});
