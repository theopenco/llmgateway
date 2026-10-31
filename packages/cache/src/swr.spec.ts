import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redisClient } from "./redis.js";
import {
	SWR_PREFIX,
	SWR_TABLE_INDEX_PREFIX,
	SWR_THROTTLE_PREFIX,
	getSwrStaleTtlSeconds,
	invalidateSwrByTables,
	invalidateSwrKeys,
	setSwrSchemaVersion,
	swrDroppedKey,
	swrMirrorKey,
	swrThrottleKey,
	swrWrap,
	waitForSwrMirrorWrites,
} from "./swr.js";

// Mirror bookkeeping is detached from the request path; tests must flush it
// before asserting Redis state.
async function swrWrapFlushed<T>(
	key: string,
	tables: string[],
	fetcher: () => Promise<T>,
): Promise<T> {
	const value = await swrWrap(key, tables, fetcher);
	await waitForSwrMirrorWrites();
	return value;
}

describe("swrWrap", () => {
	beforeEach(async () => {
		await redisClient.flushdb();
		delete process.env.SWR_STALE_TTL_SECONDS;
	});

	afterEach(async () => {
		delete process.env.SWR_STALE_TTL_SECONDS;
		setSwrSchemaVersion("unversioned");
		await redisClient.flushdb();
	});

	it("returns fetcher value and writes to SWR mirror with configured TTL + table index", async () => {
		const value = await swrWrapFlushed(
			"test:key:1",
			["table_a", "table_b"],
			() => Promise.resolve({ hello: "world" }),
		);
		expect(value).toEqual({ hello: "world" });

		const mirror = await redisClient.get(swrMirrorKey("test:key:1"));
		expect(mirror).not.toBeNull();
		expect(JSON.parse(mirror!)).toEqual({ hello: "world" });

		const ttl = await redisClient.ttl(swrMirrorKey("test:key:1"));
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(getSwrStaleTtlSeconds());

		const membersA = await redisClient.smembers(
			`${SWR_TABLE_INDEX_PREFIX}table_a`,
		);
		const membersB = await redisClient.smembers(
			`${SWR_TABLE_INDEX_PREFIX}table_b`,
		);
		expect(membersA).toContain(swrMirrorKey("test:key:1"));
		expect(membersB).toContain(swrMirrorKey("test:key:1"));
	});

	it("returns stale value when fetcher throws and mirror exists", async () => {
		await swrWrapFlushed("test:key:stale", ["table_a"], () =>
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

	it("ignores a mirror written under a different schema layout", async () => {
		setSwrSchemaVersion("layout-before-migration");
		await swrWrapFlushed("test:key:layout", ["table_a"], () =>
			Promise.resolve({ status: "active" }),
		);
		const beforeKey = swrMirrorKey("test:key:layout");
		setSwrSchemaVersion("layout-after-migration");

		const dbError = new Error("postgres unavailable");
		await expect(
			swrWrap("test:key:layout", ["table_a"], () => Promise.reject(dbError)),
		).rejects.toBe(dbError);

		// The other layout's mirror is left intact: during a rolling deploy the
		// build that wrote it is still serving and still needs its fallback.
		expect(await redisClient.get(beforeKey)).not.toBeNull();
	});

	it("invalidateSwrByTables evicts mirrors from every schema layout", async () => {
		setSwrSchemaVersion("layout-before-migration");
		await swrWrapFlushed("test:key:bothlayouts", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);
		const beforeKey = swrMirrorKey("test:key:bothlayouts");
		const beforeThrottleKey = swrThrottleKey("test:key:bothlayouts");

		setSwrSchemaVersion("layout-after-migration");
		await swrWrapFlushed("test:key:bothlayouts", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		const afterKey = swrMirrorKey("test:key:bothlayouts");
		expect(afterKey).not.toBe(beforeKey);

		await invalidateSwrByTables(["table_a"]);

		expect(await redisClient.get(beforeKey)).toBeNull();
		expect(await redisClient.get(afterKey)).toBeNull();
		expect(await redisClient.get(beforeThrottleKey)).toBeNull();
	});

	it("rethrows original error when fetcher fails and no mirror exists", async () => {
		const dbError = new Error("postgres unavailable");
		await expect(
			swrWrap("test:key:never", ["table_a"], () => Promise.reject(dbError)),
		).rejects.toBe(dbError);
	});

	it("encodes undefined via sentinel so missing row is distinguishable from missing mirror", async () => {
		const primed = await swrWrapFlushed<{ id: string } | undefined>(
			"test:key:undef",
			["table_a"],
			() => Promise.resolve(undefined),
		);
		expect(primed).toBeUndefined();

		const mirror = await redisClient.get(swrMirrorKey("test:key:undef"));
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
		await swrWrapFlushed("test:key:inv1", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);
		await swrWrapFlushed("test:key:inv2", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		await swrWrapFlushed("test:key:inv3", ["table_b"], () =>
			Promise.resolve({ v: 3 }),
		);

		await invalidateSwrByTables(["table_a"]);

		expect(await redisClient.get(swrMirrorKey("test:key:inv1"))).toBeNull();
		expect(await redisClient.get(swrMirrorKey("test:key:inv2"))).toBeNull();
		expect(await redisClient.get(swrMirrorKey("test:key:inv3"))).not.toBeNull();

		expect(await redisClient.exists(`${SWR_TABLE_INDEX_PREFIX}table_a`)).toBe(
			0,
		);
	});

	it("throttles mirror rewrites for the same key within the window", async () => {
		await swrWrapFlushed("test:key:throttle", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);
		expect(
			await redisClient.get(swrMirrorKey("test:key:throttle")),
		).not.toBeNull();

		// Drop the mirror, then call again within the throttle window. The fresh
		// fetcher value is still returned, but the mirror is NOT rewritten.
		await redisClient.del(swrMirrorKey("test:key:throttle"));
		const value = await swrWrapFlushed("test:key:throttle", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		expect(value).toEqual({ v: 2 });
		expect(await redisClient.get(swrMirrorKey("test:key:throttle"))).toBeNull();
	});

	it("releases the throttle slot so the next call retries when the mirror write fails", async () => {
		// Poison only the mirror-write pipeline (identified by its fenced EVAL
		// on an swr: key). A blanket pipeline() mock would also intercept ioredis'
		// internal auto-pipelining flushes, whose queued command callbacks
		// would then never fire and hang the whole client.
		const realPipeline = redisClient.pipeline.bind(redisClient);
		let poisoned = false;
		const pipelineSpy = vi
			.spyOn(redisClient, "pipeline")
			.mockImplementation((...args: unknown[]) => {
				const pipeline = realPipeline(...(args as never[]));
				let hasMirrorSet = false;
				const realEval = pipeline.eval.bind(pipeline);
				pipeline.eval = ((...evalArgs: unknown[]) => {
					const mirrorKey = String(evalArgs[2]);
					if (
						mirrorKey.startsWith(SWR_PREFIX) &&
						!mirrorKey.startsWith(SWR_THROTTLE_PREFIX)
					) {
						hasMirrorSet = true;
					}
					return realEval(...(evalArgs as Parameters<typeof realEval>));
				}) as typeof pipeline.eval;
				const realExec = pipeline.exec.bind(pipeline);
				pipeline.exec = ((...execArgs: unknown[]) => {
					// The mirror write awaits exec() promise-style; ioredis'
					// auto-pipelining always passes a callback. Only the former
					// may be poisoned — swallowing an internal flush's callback
					// would hang every command batched into it.
					if (hasMirrorSet && execArgs.length === 0 && !poisoned) {
						poisoned = true;
						return Promise.reject(new Error("redis write failed"));
					}
					return realExec(...(execArgs as Parameters<typeof realExec>));
				}) as typeof pipeline.exec;
				return pipeline;
			});

		await swrWrapFlushed("test:key:relfail", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);

		// Write failed, so neither the mirror nor a lingering throttle marker
		// should remain — the slot must be released for a retry.
		expect(await redisClient.get(swrMirrorKey("test:key:relfail"))).toBeNull();
		expect(
			await redisClient.get(swrThrottleKey("test:key:relfail")),
		).toBeNull();

		pipelineSpy.mockRestore();

		// The next call (still within the window) now succeeds in writing the
		// mirror instead of being suppressed by a stuck throttle marker.
		await swrWrapFlushed("test:key:relfail", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		expect(
			await redisClient.get(swrMirrorKey("test:key:relfail")),
		).not.toBeNull();
	});

	it("repopulates mirror on next fetch after invalidation despite throttle", async () => {
		await swrWrapFlushed("test:key:reinv", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);
		await invalidateSwrByTables(["table_a"]);
		expect(await redisClient.get(swrMirrorKey("test:key:reinv"))).toBeNull();

		await swrWrapFlushed("test:key:reinv", ["table_a"], () =>
			Promise.resolve({ v: 2 }),
		);
		expect(
			await redisClient.get(swrMirrorKey("test:key:reinv")),
		).not.toBeNull();
	});

	it("discards a mirror write that lands after invalidateSwrKeys dropped the key", async () => {
		const key = "test:key:dropped";
		await swrWrapFlushed(key, ["table_a"], () => Promise.resolve({ v: 1 }));
		expect(await redisClient.get(swrMirrorKey(key))).not.toBeNull();

		await invalidateSwrKeys([key]);
		expect(await redisClient.get(swrMirrorKey(key))).toBeNull();
		expect(await redisClient.get(swrThrottleKey(key))).toBeNull();
		expect(await redisClient.ttl(swrDroppedKey(key))).toBeGreaterThan(0);

		// A read that fetched the old value before the drop and only now writes
		// its mirror must not restore the dropped fallback.
		await swrWrapFlushed(key, ["table_a"], () => Promise.resolve({ v: 1 }));
		expect(await redisClient.get(swrMirrorKey(key))).toBeNull();
		await expect(
			swrWrap(key, ["table_a"], () => Promise.reject(new Error("db down"))),
		).rejects.toThrow("db down");

		// Once the fence lifts, the next read primes the mirror again.
		await redisClient.del(swrDroppedKey(key), swrThrottleKey(key));
		await swrWrapFlushed(key, ["table_a"], () => Promise.resolve({ v: 2 }));
		expect(await redisClient.get(swrMirrorKey(key))).not.toBeNull();
	});

	it("honors SWR_STALE_TTL_SECONDS env var", async () => {
		process.env.SWR_STALE_TTL_SECONDS = "120";
		expect(getSwrStaleTtlSeconds()).toBe(120);

		await swrWrapFlushed("test:key:ttl", ["table_a"], () =>
			Promise.resolve({ v: 1 }),
		);
		const ttl = await redisClient.ttl(swrMirrorKey("test:key:ttl"));
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(120);
	});
});
