import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { redisClient } from "@llmgateway/cache";

import {
	admitSortedSetEntry,
	checkAndAddSlidingWindow,
} from "./rate-limit-windows.js";

describe("admitSortedSetEntry against Redis", () => {
	const keys: string[] = [];
	const newKey = () => {
		const key = `test:admission:${randomUUID()}`;
		keys.push(key);
		return key;
	};

	afterEach(async () => {
		if (keys.length > 0) {
			await redisClient.del(...keys.splice(0));
		}
	});

	it("admits under the limit, records the member and sets the TTL", async () => {
		const key = newKey();
		const admission = await admitSortedSetEntry(key, {
			trimBefore: 0,
			limit: 2,
			score: 1_000,
			member: "a",
			ttlSeconds: 120,
		});

		expect(admission).toEqual({ allowed: true, currentCount: 0 });
		expect(await redisClient.zrange(key, 0, -1)).toEqual(["a"]);
		const ttl = await redisClient.ttl(key);
		expect(ttl).toBeGreaterThan(0);
		expect(ttl).toBeLessThanOrEqual(120);
	});

	it("rejects at the limit with the oldest score and adds nothing", async () => {
		const key = newKey();
		for (const [score, member] of [
			[1_000, "a"],
			[2_000, "b"],
		] as const) {
			await admitSortedSetEntry(key, {
				trimBefore: 0,
				limit: 2,
				score,
				member,
				ttlSeconds: 120,
			});
		}

		const admission = await admitSortedSetEntry(key, {
			trimBefore: 0,
			limit: 2,
			score: 3_000,
			member: "c",
			ttlSeconds: 120,
		});

		expect(admission).toEqual({
			allowed: false,
			currentCount: 2,
			oldestScore: 1_000,
		});
		expect(await redisClient.zcard(key)).toBe(2);
	});

	it("trims members older than the window before counting", async () => {
		const key = newKey();
		await admitSortedSetEntry(key, {
			trimBefore: 0,
			limit: 1,
			score: 1_000,
			member: "old",
			ttlSeconds: 120,
		});

		const admission = await admitSortedSetEntry(key, {
			trimBefore: 1_500,
			limit: 1,
			score: 2_000,
			member: "new",
			ttlSeconds: 120,
		});

		expect(admission).toEqual({ allowed: true, currentCount: 0 });
		expect(await redisClient.zrange(key, 0, -1)).toEqual(["new"]);
	});

	it("rejects every request when the limit is 0", async () => {
		const key = newKey();
		const admission = await admitSortedSetEntry(key, {
			trimBefore: 0,
			limit: 0,
			score: 1_000,
			member: "a",
			ttlSeconds: 120,
		});

		expect(admission).toEqual({ allowed: false, currentCount: 0 });
		expect(await redisClient.exists(key)).toBe(0);
	});

	it("rounds a fractional TTL up instead of failing after the add", async () => {
		const key = newKey();
		const admission = await admitSortedSetEntry(key, {
			trimBefore: 0,
			limit: 5,
			score: 1_000,
			member: "a",
			ttlSeconds: 0.25,
		});

		expect(admission.allowed).toBe(true);
		expect(await redisClient.ttl(key)).toBe(1);
	});

	it("rejects a non-finite TTL before touching Redis", async () => {
		const key = newKey();
		await expect(
			admitSortedSetEntry(key, {
				trimBefore: 0,
				limit: 5,
				score: 1_000,
				member: "a",
				ttlSeconds: Number.NaN,
			}),
		).rejects.toThrow("TTL must be finite");
		expect(await redisClient.exists(key)).toBe(0);
	});

	it("sliding window reports retryAfter from the oldest admitted request", async () => {
		const key = newKey();
		const now = 1_000_000;
		await checkAndAddSlidingWindow(key, 60, 1, now, "first");

		const result = await checkAndAddSlidingWindow(
			key,
			60,
			1,
			now + 10_000,
			"second",
		);

		expect(result).toEqual({ allowed: false, currentCount: 1, retryAfter: 50 });
	});
});
