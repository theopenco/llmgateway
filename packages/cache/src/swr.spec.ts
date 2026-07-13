import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redisClient } from "./redis.js";
import {
	SWR_PREFIX,
	SWR_TABLE_INDEX_PREFIX,
	SWR_THROTTLE_PREFIX,
	getSwrStaleTtlSeconds,
	invalidateSwrByTables,
	swrWrap,
} from "./swr.js";

describe("swrWrap", () => {
	beforeEach(async () => {
		await redisClient.flushdb();
		delete process.env.SWR_STALE_TTL_SECONDS;
	});

	afterEach(async () => {
		delete process.env.SWR_STALE_TTL_SECONDS;
		await redisClient.flushdb();
	});

	it("returns fetcher value and writes to SWR mirror with configured TTL + table index", async () => {
		const value = await swrWrap("test:key:1", ["table_a", "table_b"], () =>
			Promise.resolve({ hello: "world" }),
		);
		expect(value).toEqual({ hello: "world" });

		const mirror = await redisClient.get(`${SWR_PREFIX}test:key:1`);
		expect(mirror).not.toBeNull();
		expect(JSON.parse(mirror!)).toEqual({ hello: "world" });

		const ttl = await redisClient.ttl(`${SWR_PREFIX}test:key:1`);
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(getSwrStaleTtlSeconds());

		const membersA = await redisClient.smembers(
			`${SWR_TABLE_INDEX_PREFIX}table_a`,
		);
		const membersB = await redisClient.smembers(
			`${SWR_TABLE_INDEX_PREFIX}table_b`,
		);
		expect(membersA).toContain(`${SWR_PREFIX}test:key:1`);
		expect(membersB).toContain(`${SWR_PREFIX}test:key:1`);
	});

	it("returns stale value when fetcher throws and mirror exists", async () => {
		await swrWrap("test:key:stale", ["table_a"], () =>
			Promise.resolve({ cached: true }),
		);

		const dbError = new Error("postgres unavailable");
		const value = await swrWrap<{ cached: boolean }>(
			"test:key:stale",
			["table_a"],
			() => Promise.reject(dbError),
		);
		expect(value).toEqual({ cached: true });
	});

	it("rethrows original error when fetcher fails and no mirror exists", async () => {
		const dbError = new Error("postgres unavailable");
		await expect(
			swrWrap("test:key:never", ["table_a"], () => Promise.reject(dbError)),
		).rejects.toBe(dbError);
	});

	it("encodes undefined via sentinel so missing row is distinguishable from missing mirror", async () => {
		const primed = await swrWrap<{ id: string } | undefined>(
			"test:key:undef",
			["table_a"],
			() => Promise.resolve(undefined),
		);
		expect(primed).toBeUndefined();

		const mirror = await redisClient.get(`${SWR_PREFIX}test:key:undef`);
		expect(mirror).not.toBeNull();

		const dbError = new Error("postgres unavailable");
		const fallback = await swrWrap<{ id: string } | undefined>(
			"test:key:undef",
			["table_a"],
			() => Promise.reject(dbError),
		);
		expect(fallback).toBeUndefined();
	});

	it("invalidateSwrByTables wipes mirrors and cleans index", async () => {
		await swrWrap("test:key:inv1", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);
		await swrWrap("test:key:inv2", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		await swrWrap("test:key:inv3", ["table_b"], () =>
			Promise.resolve({ v: 3 }),
		);

		await invalidateSwrByTables(["table_a"]);

		expect(await redisClient.get(`${SWR_PREFIX}test:key:inv1`)).toBeNull();
		expect(await redisClient.get(`${SWR_PREFIX}test:key:inv2`)).toBeNull();
		expect(await redisClient.get(`${SWR_PREFIX}test:key:inv3`)).not.toBeNull();

		expect(await redisClient.exists(`${SWR_TABLE_INDEX_PREFIX}table_a`)).toBe(
			0,
		);
	});

	it("throttles mirror rewrites for the same key within the window", async () => {
		await swrWrap("test:key:throttle", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);
		expect(
			await redisClient.get(`${SWR_PREFIX}test:key:throttle`),
		).not.toBeNull();

		// Drop the mirror, then call again within the throttle window. The fresh
		// fetcher value is still returned, but the mirror is NOT rewritten.
		await redisClient.del(`${SWR_PREFIX}test:key:throttle`);
		const value = await swrWrap("test:key:throttle", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		expect(value).toEqual({ v: 2 });
		expect(await redisClient.get(`${SWR_PREFIX}test:key:throttle`)).toBeNull();
	});

	it("releases the throttle slot so the next call retries when the mirror write fails", async () => {
		const realPipeline = redisClient.pipeline.bind(redisClient);
		const pipelineSpy = vi
			.spyOn(redisClient, "pipeline")
			.mockImplementationOnce(() => {
				const pipeline = realPipeline();
				vi.spyOn(pipeline, "exec").mockRejectedValueOnce(
					new Error("redis write failed"),
				);
				return pipeline;
			});

		await swrWrap("test:key:relfail", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);

		// Write failed, so neither the mirror nor a lingering throttle marker
		// should remain — the slot must be released for a retry.
		expect(await redisClient.get(`${SWR_PREFIX}test:key:relfail`)).toBeNull();
		expect(
			await redisClient.get(`${SWR_THROTTLE_PREFIX}test:key:relfail`),
		).toBeNull();

		pipelineSpy.mockRestore();

		// The next call (still within the window) now succeeds in writing the
		// mirror instead of being suppressed by a stuck throttle marker.
		await swrWrap("test:key:relfail", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		expect(
			await redisClient.get(`${SWR_PREFIX}test:key:relfail`),
		).not.toBeNull();
	});

	it("repopulates mirror on next fetch after invalidation despite throttle", async () => {
		await swrWrap("test:key:reinv", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);
		await invalidateSwrByTables(["table_a"]);
		expect(await redisClient.get(`${SWR_PREFIX}test:key:reinv`)).toBeNull();

		await swrWrap("test:key:reinv", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		expect(await redisClient.get(`${SWR_PREFIX}test:key:reinv`)).not.toBeNull();
	});

	it("honors SWR_STALE_TTL_SECONDS env var", async () => {
		process.env.SWR_STALE_TTL_SECONDS = "120";
		expect(getSwrStaleTtlSeconds()).toBe(120);

		await swrWrap("test:key:ttl", ["table_a"], () => Promise.resolve({ v: 1 }));
		const ttl = await redisClient.ttl(`${SWR_PREFIX}test:key:ttl`);
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(120);
	});
});
