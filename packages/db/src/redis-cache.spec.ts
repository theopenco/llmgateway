import { beforeEach, describe, expect, it } from "vitest";

import { redisClient, swrMirrorKey } from "@llmgateway/cache";

import { clearRowCaches } from "./cache-reset.js";
import { RedisCache } from "./redis-cache.js";
import { SCHEMA_CACHE_VERSION } from "./schema-cache-version.js";

const currentLayoutKey = `drizzle:cache:${SCHEMA_CACHE_VERSION}:query-hash`;
const otherLayoutKey = "drizzle:cache:0000000000000000:query-hash";
const otherLayoutIndexedKey = "drizzle:cache:0000000000000000:other-hash";
const mirrorKey = swrMirrorKey("apiKey:token:abc");
const unrelatedKey = "cache:some-request-hash";

// Scoped to the keys these tests write: the unit suite shares one Redis with
// every other spec, so flushing the database would delete their state too.
const testKeys = [
	currentLayoutKey,
	otherLayoutKey,
	otherLayoutIndexedKey,
	"drizzle:table_keys:api_key",
	"drizzle:tags:org:1",
	"drizzle:tables:api_key",
	mirrorKey,
	unrelatedKey,
];

describe("RedisCache schema namespacing", () => {
	let cache: RedisCache;

	beforeEach(async () => {
		await redisClient.del(...testKeys);
		cache = new RedisCache(redisClient);
	});

	it("stores entries under the current schema layout", async () => {
		await cache.put("query-hash", [{ status: "active" }], ["api_key"], false);

		expect(await redisClient.exists(currentLayoutKey)).toBe(1);
		expect(await cache.get("query-hash", ["api_key"], false)).toEqual([
			{ status: "active" },
		]);
	});

	it("ignores rows cached under a different schema layout", async () => {
		// A row serialized before a migration: positional values that the current
		// field list would map onto the wrong columns.
		await redisClient.set(
			otherLayoutKey,
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
		await redisClient.set(otherLayoutIndexedKey, "{}");
		await redisClient.sadd("drizzle:table_keys:api_key", otherLayoutIndexedKey);

		await cache.onMutate({ tables: ["api_key"] });

		expect(await redisClient.exists(currentLayoutKey)).toBe(0);
		expect(await redisClient.exists(otherLayoutIndexedKey)).toBe(0);
	});
});

describe("clearRowCaches", () => {
	beforeEach(async () => {
		await redisClient.del(...testKeys);
	});

	it("drops cached rows and mirrors but leaves other keys alone", async () => {
		await redisClient.set(currentLayoutKey, "{}");
		await redisClient.sadd("drizzle:table_keys:api_key", "some-key");
		await redisClient.sadd("drizzle:tags:org:1", "some-key");
		await redisClient.set("drizzle:tables:api_key", "1");
		await redisClient.set(mirrorKey, "{}");
		await redisClient.set(unrelatedKey, "{}");

		await clearRowCaches();

		expect(
			await redisClient.exists(
				currentLayoutKey,
				"drizzle:table_keys:api_key",
				"drizzle:tags:org:1",
				"drizzle:tables:api_key",
				mirrorKey,
			),
		).toBe(0);
		expect(await redisClient.get(unrelatedKey)).toBe("{}");
	});
});
