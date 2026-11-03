import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { redisClient } from "@/auth/config.js";

import {
	cachedPublicResponse,
	invalidatePublicResponse,
	resetLocalPublicResponseCache,
} from "./public-response-cache.js";

const KEY = "spec:key";
const options = { refreshAfterMs: 60_000 };

describe("cachedPublicResponse", () => {
	beforeEach(async () => {
		await redisClient.flushdb();
		resetLocalPublicResponseCache();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("computes a cold key once for concurrent callers", async () => {
		const compute = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
			return { value: 1 };
		});
		const results = await Promise.all(
			Array.from({ length: 20 }, () =>
				cachedPublicResponse(KEY, options, compute),
			),
		);
		expect(compute).toHaveBeenCalledTimes(1);
		expect(results.every((r) => r.value === 1)).toBe(true);
	});

	it("waits for another pod's computation instead of repeating it", async () => {
		let release!: () => void;
		const slow = vi.fn(
			async () =>
				await new Promise<{ value: number }>((resolve) => {
					release = () => resolve({ value: 7 });
				}),
		);
		const first = cachedPublicResponse(KEY, options, slow);
		await new Promise((resolve) => setTimeout(resolve, 50));

		// A second process: no local copy, no in-flight promise, lock taken.
		resetLocalPublicResponseCache();
		const other = vi.fn(async () => ({ value: 99 }));
		const second = cachedPublicResponse(KEY, options, other);
		await new Promise((resolve) => setTimeout(resolve, 100));
		release();

		expect(await first).toEqual({ value: 7 });
		expect(await second).toEqual({ value: 7 });
		expect(other).not.toHaveBeenCalled();
	});

	it("serves cached data across processes without recomputing", async () => {
		await cachedPublicResponse(KEY, options, async () => ({ value: 1 }));
		resetLocalPublicResponseCache();
		const compute = vi.fn(async () => ({ value: 2 }));
		expect(await cachedPublicResponse(KEY, options, compute)).toEqual({
			value: 1,
		});
		expect(compute).not.toHaveBeenCalled();
	});

	it("serves stale data immediately and refreshes once in the background", async () => {
		const start = Date.now();
		vi.useFakeTimers({ toFake: ["Date"], now: start });
		await cachedPublicResponse(KEY, options, async () => ({ value: 1 }));

		vi.setSystemTime(start + 61_000);
		let release!: () => void;
		const refresh = vi.fn(
			async () =>
				await new Promise<{ value: number }>((resolve) => {
					release = () => resolve({ value: 2 });
				}),
		);
		const stale = await Promise.all(
			Array.from({ length: 10 }, () =>
				cachedPublicResponse(KEY, options, refresh),
			),
		);
		expect(stale.every((r) => r.value === 1)).toBe(true);
		await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
		release();
		await vi.waitFor(async () =>
			expect(await cachedPublicResponse(KEY, options, refresh)).toEqual({
				value: 2,
			}),
		);
		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it("never caches a failed computation and backs off before retrying", async () => {
		await expect(
			cachedPublicResponse(KEY, options, async () => {
				throw new Error("db down");
			}),
		).rejects.toThrow("db down");
		expect(await redisClient.get("public-response:v1:" + KEY)).toBeNull();
		const lockTtl = await redisClient.pttl("public-response:lock:v1:" + KEY);
		expect(lockTtl).toBeGreaterThan(0);
		expect(lockTtl).toBeLessThanOrEqual(15_000);

		await redisClient.del("public-response:lock:v1:" + KEY);
		expect(
			await cachedPublicResponse(KEY, options, async () => ({ value: 3 })),
		).toEqual({ value: 3 });
	});

	it("recomputes after invalidation", async () => {
		await cachedPublicResponse(KEY, options, async () => ({ value: 1 }));
		await invalidatePublicResponse(KEY);
		expect(
			await cachedPublicResponse(KEY, options, async () => ({ value: 2 })),
		).toEqual({ value: 2 });
	});
});
