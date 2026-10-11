import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	checkProviderRateLimit,
	filterRateLimitedProviders,
	getExceededProviderRateLimitLabels,
	peekProviderRateLimit,
	pickNonRateLimitedCandidates,
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

vi.mock("./cached-queries.js", () => ({
	findEffectiveRateLimit: vi.fn(),
}));

const mockCache = await import("@llmgateway/cache");
const mockCachedQueries = await import("./cached-queries.js");
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
		vi.mocked(redis.zcard).mockResolvedValue(0);
		vi.mocked(redis.zrange).mockResolvedValue([]);
	});

	it("allows requests when no limits are configured", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue(
			noLimits,
		);

		const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(result.allowed).toBe(true);
		expect(result.rateLimited).toBe(false);
		expect(result.blockedBy).toEqual([]);
		expect(result.limits.rpm.limit).toBe(0);
		expect(result.limits.rpd.limit).toBe(0);
		expect(redis.zremrangebyscore).not.toHaveBeenCalled();
	});

	it.each([
		"global_provider",
		"global_model",
		"global_provider_model",
		"org_provider",
		"org_model",
		"org_provider_model",
	] as const)(
		"blocks explicit zero caps from %s in both windows and enforcement modes",
		async (source) => {
			for (const shared of [false, true]) {
				for (const window of ["rpm", "rpd"] as const) {
					vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue(
						{
							...noLimits,
							[`${window}Source`]: source,
							[`${window}Shared`]: shared,
						},
					);
					for (const check of [checkProviderRateLimit, peekProviderRateLimit]) {
						const result = await check("org-1", "openai", "gpt-4o");
						expect(result.allowed).toBe(false);
						expect(result.blockedBy).toEqual([window]);
						expect(result.limits[window]).toMatchObject({
							limit: 0,
							remaining: 0,
							rateLimited: true,
						});
					}
				}
			}
			expect(redis.zadd).not.toHaveBeenCalled();
		},
	);

	it.each(["none", "carrier_provider_model"] as const)(
		"preserves zero semantics for %s caps",
		async (source) => {
			vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
				...noLimits,
				rpmSource: source,
				rpdSource: source,
			});
			expect(
				(await checkProviderRateLimit("org-1", "openai", "gpt-4o")).allowed,
			).toBe(true);
		},
	);

	it("consumes both RPM and RPD windows when under the limits", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
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
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
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

	describe.each([0, 1])("mixed windows at limit %s", (limit) => {
		it.each([
			["lax", "lax", false, false, false],
			["lax", "lax", false, true, true],
			["lax", "lax", true, false, true],
			["soft", "lax", false, true, false],
			["lax", "soft", false, true, false],
			["soft", "lax", true, false, true],
			["lax", "soft", true, true, true],
			["strict", "lax", true, true, false],
			["lax", "strict", true, true, false],
		] as const)(
			"checks exceeded %s/%s windows (session=%s, explicit=%s)",
			async (rpmMode, rpdMode, sessionPinned, explicitProvider, allowed) => {
				vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
					maxRpm: limit,
					maxRpd: limit,
					rpmSource: "global_provider",
					rpdSource: "org_provider",
					rpmMode,
					rpdMode,
				});
				vi.mocked(redis.zcard).mockResolvedValue(1);
				vi.mocked(redis.zrange).mockResolvedValue([
					"seed",
					Date.now().toString(),
				]);
				const result = await checkProviderRateLimit(
					"org-1",
					"openai",
					"gpt-4o",
					{
						sessionPinned,
						explicitProvider,
					},
				);
				expect(result.allowed).toBe(allowed);
				expect(redis.zadd).toHaveBeenCalledTimes(allowed ? 2 : 0);
				expect(result.bypassReason).toBe(
					allowed
						? sessionPinned
							? "session_pin"
							: "explicit_provider"
						: undefined,
				);
			},
		);
	});

	describe.each(["soft", "lax"] as const)("zero %s caps", (mode) => {
		it.each(["rpm", "rpd"] as const)(
			"exempts and counts eligible %s requests",
			async (window) => {
				vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
					...noLimits,
					[`${window}Source`]: "org_provider",
					[`${window}Mode`]: mode,
				});
				for (const options of [
					{},
					{ explicitProvider: true },
					{ sessionPinned: true },
				]) {
					vi.mocked(redis.zadd).mockClear();
					const allowed =
						"sessionPinned" in options ||
						(mode === "lax" && "explicitProvider" in options);
					const result = await checkProviderRateLimit(
						"org-1",
						"openai",
						"gpt-4o",
						options,
					);
					expect(result.allowed).toBe(allowed);
					expect(result.limits[window].currentCount).toBe(allowed ? 1 : 0);
					expect(redis.zadd).toHaveBeenCalledTimes(allowed ? 1 : 0);
				}
				const candidates = [{ providerId: "openai" }];
				expect(
					await pickNonRateLimitedCandidates("org-1", "gpt-4o", candidates),
				).toEqual([]);
			},
		);
	});

	describe("soft limits", () => {
		const softRpm = {
			maxRpm: 10,
			maxRpd: 0,
			rpmSource: "global_provider",
			rpdSource: "none",
			rpmMode: "soft",
		} as const;

		beforeEach(() => {
			vi.mocked(redis.zcard).mockResolvedValue(10);
			vi.mocked(redis.zrange).mockResolvedValue([
				"member",
				Date.now().toString(),
			]);
		});

		it("blocks like a strict limit without the exemption", async () => {
			vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue(
				softRpm,
			);

			const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o");

			expect(result.allowed).toBe(false);
			expect(result.sessionExemptible).toBe(true);
			expect(redis.zadd).not.toHaveBeenCalled();
		});

		it("allows and still counts an exempt request past the cap", async () => {
			vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue(
				softRpm,
			);

			const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o", {
				sessionPinned: true,
			});

			expect(result.allowed).toBe(true);
			expect(result.bypassReason).toBe("session_pin");
			expect(vi.mocked(redis.zadd).mock.calls[0][0]).toBe(
				"rate_limit:provider_cap:rpm:org-1:openai:gpt-4o",
			);
		});

		it("does not exempt a request also blocked by a strict window", async () => {
			vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
				...softRpm,
				maxRpd: 10,
				rpdSource: "global_provider",
			});

			const result = await checkProviderRateLimit("org-1", "openai", "gpt-4o", {
				sessionPinned: true,
			});

			expect(result.allowed).toBe(false);
			expect(result.sessionExemptible).toBe(false);
			expect(redis.zadd).not.toHaveBeenCalled();
		});
	});

	it("uses a unique member per request", async () => {
		const now = 1_700_000_000_000;
		const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
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

	it("keys the counter per-org by default", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			maxRpd: 0,
			rpmSource: "global_provider_model",
			rpdSource: "none",
			rpmRateLimitId: "rl-rpm",
		});
		vi.mocked(redis.zcard).mockResolvedValueOnce(0);

		await checkProviderRateLimit("org-1", "openai", "gpt-4o");

		expect(vi.mocked(redis.zadd).mock.calls[0][0]).toBe(
			"rate_limit:provider_cap:rpm:org-1:openai:gpt-4o",
		);
	});

	it("shares one counter across all orgs when enforcement is global", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			maxRpd: 0,
			rpmSource: "global_provider_model",
			rpdSource: "none",
			rpmRateLimitId: "rl-rpm",
			rpmShared: true,
			rpmProvider: "openai",
			rpmModel: "gpt-4o",
		});
		vi.mocked(redis.zcard).mockResolvedValue(0);

		await checkProviderRateLimit("org-1", "openai", "gpt-4o");
		await checkProviderRateLimit("org-2", "openai", "gpt-4o");

		// Both orgs write to the same shared key rather than per-org keys.
		const sharedKey = "rate_limit:provider_cap:rpm:__global__:openai:gpt-4o";
		expect(vi.mocked(redis.zadd).mock.calls[0][0]).toBe(sharedKey);
		expect(vi.mocked(redis.zadd).mock.calls[1][0]).toBe(sharedKey);
	});

	it("collapses wildcard dimensions onto one shared counter for the matched row", async () => {
		// A shared model-only limit (all providers) — the matched row's provider
		// is null, so requests to different providers must share one counter.
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
			maxRpm: 100,
			maxRpd: 0,
			rpmSource: "global_model",
			rpdSource: "none",
			rpmRateLimitId: "rl-rpm",
			rpmShared: true,
			rpmProvider: null,
			rpmModel: "gpt-4o",
		});
		vi.mocked(redis.zcard).mockResolvedValue(0);

		await checkProviderRateLimit("org-1", "openai", "gpt-4o");
		await checkProviderRateLimit("org-2", "anthropic", "gpt-4o");

		const sharedKey =
			"rate_limit:provider_cap:rpm:__global__:__all_providers__:gpt-4o";
		expect(vi.mocked(redis.zadd).mock.calls[0][0]).toBe(sharedKey);
		expect(vi.mocked(redis.zadd).mock.calls[1][0]).toBe(sharedKey);
	});

	it("fails open on Redis errors", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
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
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
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
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
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
		vi.mocked(mockCachedQueries.findEffectiveRateLimit)
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

		expect(result.rateLimited.has("openai")).toBe(true);
		expect(result.rateLimited.has("anthropic")).toBe(false);
		expect(result.sessionExemptible.size).toBe(0);
	});

	it("reports providers blocked by soft limits alone", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit)
			.mockResolvedValueOnce({
				maxRpm: 10,
				maxRpd: 0,
				rpmSource: "global_provider",
				rpdSource: "none",
				rpmMode: "soft",
			})
			// Soft RPM and strict RPD both exceeded: not soft-only.
			.mockResolvedValueOnce({
				maxRpm: 10,
				maxRpd: 100,
				rpmSource: "global_provider",
				rpdSource: "global_provider",
				rpmMode: "soft",
			});
		vi.mocked(redis.zcard).mockResolvedValue(100);
		vi.mocked(redis.zrange).mockResolvedValue([
			"member",
			Date.now().toString(),
		]);

		const result = await filterRateLimitedProviders("org-1", [
			{ providerId: "openai", model: "gpt-4o" },
			{ providerId: "anthropic", model: "claude-3-5-sonnet" },
		]);

		expect([...result.rateLimited].sort()).toEqual(["anthropic", "openai"]);
		expect([...result.sessionExemptible]).toEqual(["openai"]);
	});
});

describe("pickNonRateLimitedCandidates", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	const cappedRpm = {
		maxRpm: 10,
		maxRpd: 0,
		rpmSource: "global_provider",
		rpdSource: "none",
		rpmRateLimitId: "rl-rpm",
	} as const;

	const openRpm = {
		maxRpm: 100,
		maxRpd: 0,
		rpmSource: "global_provider",
		rpdSource: "none",
		rpmRateLimitId: "rl-rpm",
	} as const;

	it("does not revive lax providers when every fallback is capped", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValue({
			...cappedRpm,
			rpmMode: "lax",
		});
		vi.mocked(redis.zcard).mockResolvedValue(10);
		vi.mocked(redis.zrange).mockResolvedValue(["seed", Date.now().toString()]);
		expect(
			await pickNonRateLimitedCandidates("org-1", "gpt-4o", [
				{ providerId: "openai" },
				{ providerId: "azure" },
			]),
		).toEqual([]);
	});

	it("drops a rate-limited candidate so the router falls back to the next one", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit)
			.mockResolvedValueOnce(cappedRpm)
			.mockResolvedValueOnce(openRpm);
		vi.mocked(redis.zcard).mockResolvedValueOnce(10).mockResolvedValueOnce(20);
		vi.mocked(redis.zrange).mockResolvedValueOnce([
			"member",
			Date.now().toString(),
		]);

		const result = await pickNonRateLimitedCandidates("org-1", "glm-4.7", [
			{ providerId: "together-ai", externalId: "glm-4.7" },
			{ providerId: "cerebras", externalId: "glm-4.7" },
		]);

		expect(result).toEqual([{ providerId: "cerebras", externalId: "glm-4.7" }]);
	});

	it("fails open when every candidate is rate-limited", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit)
			.mockResolvedValueOnce(cappedRpm)
			.mockResolvedValueOnce(cappedRpm);
		vi.mocked(redis.zcard).mockResolvedValueOnce(10).mockResolvedValueOnce(10);
		vi.mocked(redis.zrange)
			.mockResolvedValueOnce(["m1", Date.now().toString()])
			.mockResolvedValueOnce(["m2", Date.now().toString()]);

		const candidates = [
			{ providerId: "together-ai", externalId: "glm-4.7" },
			{ providerId: "cerebras", externalId: "glm-4.7" },
		];
		const result = await pickNonRateLimitedCandidates(
			"org-1",
			"glm-4.7",
			candidates,
		);

		expect(result).toEqual(candidates);
	});

	it("dedupes peeks across region-expanded variants of the same provider+model", async () => {
		vi.mocked(mockCachedQueries.findEffectiveRateLimit).mockResolvedValueOnce(
			openRpm,
		);
		vi.mocked(redis.zcard).mockResolvedValueOnce(0);

		const candidates = [
			{ providerId: "alibaba", externalId: "glm-4.6", region: "singapore" },
			{ providerId: "alibaba", externalId: "glm-4.6", region: "cn-beijing" },
			{ providerId: "alibaba", externalId: "glm-4.6", region: "us-east-1" },
		];
		const result = await pickNonRateLimitedCandidates(
			"org-1",
			"glm-4.6",
			candidates,
		);

		expect(
			vi.mocked(mockCachedQueries.findEffectiveRateLimit),
		).toHaveBeenCalledTimes(1);
		expect(result).toEqual(candidates);
	});

	it("returns an empty list unchanged without calling Redis", async () => {
		const result = await pickNonRateLimitedCandidates("org-1", "glm-4.7", []);

		expect(result).toEqual([]);
		expect(
			vi.mocked(mockCachedQueries.findEffectiveRateLimit),
		).not.toHaveBeenCalled();
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
