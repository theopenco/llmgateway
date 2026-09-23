import { beforeEach, describe, expect, it } from "vitest";

import { redisClient, SWR_PREFIX } from "@llmgateway/cache";

import { clearRowCaches } from "./cache-reset.js";
import { RedisCache } from "./redis-cache.js";
import { SCHEMA_CACHE_VERSION } from "./schema-cache-version.js";

describe("RedisCache schema namespacing", () => {
	let cache: RedisCache;

	beforeEach(async () => {
		await redisClient.flushdb();
		cache = new RedisCache(redisClient);
	});

	it("stores entries under the current schema layout", async () => {
		await cache.put("query-hash", [{ status: "active" }], ["api_key"], false);

		const keys = await redisClient.keys("drizzle:cache:*");
		expect(keys).toEqual([`drizzle:cache:${SCHEMA_CACHE_VERSION}:query-hash`]);
		expect(await cache.get("query-hash", ["api_key"], false)).toEqual([
			{ status: "active" },
		]);
	});

	it("ignores rows cached under a different schema layout", async () => {
		// A row serialized before a migration: positional values that the current
		// field list would map onto the wrong columns.
		await redisClient.set(
			"drizzle:cache:0000000000000000:query-hash",
			JSON.stringify({
				data: [["stale", "shifted"]],
				timestamp: Date.now(),
				tables: ["api_key"],
			}),
		);

		expect(await cache.get("query-hash", ["api_key"], false)).toBeUndefined();
	});

	it("evicts entries from other layouts on mutation", async () => {
		await cache.put("query-hash", [{ status: "active" }], ["api_key"], false);
		// Another layout's entry, indexed in the same (unversioned) table set —
		// what a rolling deploy looks like while both versions are serving.
		const otherLayoutKey = "drizzle:cache:0000000000000000:other-hash";
		await redisClient.set(otherLayoutKey, "{}");
		await redisClient.sadd("drizzle:table_keys:api_key", otherLayoutKey);

		await cache.onMutate({ tables: ["api_key"] });

		expect(await redisClient.keys("drizzle:cache:*")).toEqual([]);
	});
});

describe("clearRowCaches", () => {
	beforeEach(async () => {
		await redisClient.flushdb();
	});

	it("drops cached rows and mirrors but leaves other keys alone", async () => {
		await redisClient.set(
			`drizzle:cache:${SCHEMA_CACHE_VERSION}:query-hash`,
			"{}",
		);
		await redisClient.sadd("drizzle:table_keys:api_key", "some-key");
		await redisClient.sadd("drizzle:tags:org:1", "some-key");
		await redisClient.set("drizzle:tables:api_key", "1");
		await redisClient.set(`${SWR_PREFIX}apiKey:token:abc`, "{}");
		await redisClient.set("cache:some-request-hash", "{}");

		await clearRowCaches();

		expect(await redisClient.keys("drizzle:*")).toEqual([]);
		expect(await redisClient.keys(`${SWR_PREFIX}*`)).toEqual([]);
		expect(await redisClient.get("cache:some-request-hash")).toBe("{}");
	});
});
