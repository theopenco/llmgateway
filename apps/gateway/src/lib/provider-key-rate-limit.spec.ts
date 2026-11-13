import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	getRateLimitedProviderKeyIds,
	getRateLimitedProviderKeys,
	ProviderKeyRateLimitError,
	recordProviderKeyUsage,
	withModelRateLimitedProviderKeyIds,
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
	provider: "openai",
	maxRpm: null,
	maxRpd: null,
	maxTpm: null,
	maxTpd: null,
	rateLimitMode: "strict",
	modelRateLimits: null,
} as const;

const imageCapped = {
	...uncapped,
	modelRateLimits: { "gpt-image-2": { maxRpm: 12 } },
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

	it("reports when each capped key frees up and the earliest across keys", async () => {
		vi.mocked(redis.zcard).mockResolvedValue(1);
		vi.mocked(redis.zrange).mockImplementation(async (key) => [
			"member",
			String(
				key === "rate_limit:provider_key:rpm:key-a"
					? now - 50_000
					: now - 10_000,
			),
		]);

		const limited = await getRateLimitedProviderKeys([
			{ id: "key-a", ...uncapped, maxRpm: 1 },
			{ id: "key-b", ...uncapped, maxRpm: 1 },
		]);

		expect(limited).toEqual(
			new Map([
				["key-a", 10],
				["key-b", 50],
			]),
		);
		expect(new ProviderKeyRateLimitError("capped", limited)).toMatchObject({
			status: 429,
			retryAfter: 10,
		});
	});

	it.each([
		["strict", { sessionPinned: true, explicitProvider: true }, true],
		["soft", { sessionPinned: true }, false],
		["soft", { explicitProvider: true }, true],
		["lax", { explicitProvider: true }, false],
		["lax", {}, true],
	] as const)(
		"treats a capped %s key with exemption %o as capped: %s",
		async (rateLimitMode, exemption, capped) => {
			vi.mocked(redis.zcard).mockResolvedValue(1);
			const keys = [
				{ id: "key-1", ...uncapped, maxRpm: 1, rateLimitMode },
				{
					id: "key-other",
					...uncapped,
					provider: "azure",
					maxRpm: 1,
					rateLimitMode,
				},
			];

			const limited = await getRateLimitedProviderKeyIds(keys, (provider) =>
				provider === "openai" ? exemption : {},
			);

			expect(limited.has("key-1")).toBe(capped);
			// A session pinned to one provider exempts none of another's keys.
			expect(limited.has("key-other")).toBe(true);
		},
	);

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

	it("caps a key for a model only when that model's window is full", async () => {
		vi.mocked(redis.zcard).mockImplementation(async (key) =>
			key === "rate_limit:provider_key_model:rpm:key-1:gpt-image-2" ? 12 : 0,
		);
		const keys = [{ id: "key-1", ...imageCapped }];

		expect(
			(await getRateLimitedProviderKeyIds(keys, undefined, "gpt-image-2")).has(
				"key-1",
			),
		).toBe(true);
		expect(
			(await getRateLimitedProviderKeyIds(keys, undefined, "gpt-5.2")).size,
		).toBe(0);
		// Without a model only key-wide caps apply.
		expect((await getRateLimitedProviderKeyIds(keys)).size).toBe(0);
	});

	it("caps a key for every model when a key-wide window is full", async () => {
		vi.mocked(redis.zcard).mockImplementation(async (key) =>
			key === "rate_limit:provider_key:rpm:key-1" ? 100 : 0,
		);

		const limited = await getRateLimitedProviderKeyIds(
			[{ id: "key-1", ...imageCapped, maxRpm: 100 }],
			undefined,
			"gpt-5.2",
		);

		expect(limited.has("key-1")).toBe(true);
	});

	it("adds model-capped keys to a key-wide result without re-reading key-wide windows", async () => {
		vi.mocked(redis.zcard).mockResolvedValue(12);
		const keys = [
			{ id: "key-wide", ...uncapped, maxRpm: 1 },
			{ id: "key-model", ...imageCapped, maxRpm: 1000 },
			{ id: "key-free", ...uncapped },
		];

		const limited = await withModelRateLimitedProviderKeyIds(
			new Set(["key-wide"]),
			keys,
			"gpt-image-2",
		);

		expect([...limited].sort()).toEqual(["key-model", "key-wide"]);
		expect(vi.mocked(redis.zcard).mock.calls.map(([key]) => key)).toEqual([
			"rate_limit:provider_key_model:rpm:key-model:gpt-image-2",
		]);
	});

	it("exempts a soft key's model caps for a pinned session", async () => {
		vi.mocked(redis.zcard).mockResolvedValue(12);

		const limited = await getRateLimitedProviderKeyIds(
			[{ id: "key-1", ...imageCapped, rateLimitMode: "soft" }],
			() => ({ sessionPinned: true }),
			"gpt-image-2",
		);

		expect(limited.size).toBe(0);
	});

	it("records usage against the served model's windows too", async () => {
		await recordProviderKeyUsage(
			{
				id: "key-1",
				...uncapped,
				maxRpd: 100,
				modelRateLimits: { "gpt-image-2": { maxRpm: 12, maxTpd: 5000 } },
			},
			250,
			"gpt-image-2",
		);

		expect(
			vi
				.mocked(redis.zadd)
				.mock.calls.map(([key]) => key)
				.sort(),
		).toEqual([
			"rate_limit:provider_key:rpd:key-1",
			"rate_limit:provider_key_model:rpm:key-1:gpt-image-2",
		]);
		expect(redis.hincrby).toHaveBeenCalledWith(
			"rate_limit:provider_key_model:tpd:key-1:gpt-image-2",
			expect.any(String),
			250,
		);
	});

	it("does not record other models' windows", async () => {
		await recordProviderKeyUsage(
			{ id: "key-1", ...imageCapped },
			250,
			"gpt-5.2",
		);

		expect(redis.zadd).not.toHaveBeenCalled();
		expect(redis.hincrby).not.toHaveBeenCalled();
	});
});
