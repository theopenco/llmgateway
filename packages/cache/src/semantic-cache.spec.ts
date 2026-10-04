import { afterAll, describe, expect, test } from "vitest";

import {
	addSemanticCacheEntry,
	cosineSimilarity,
	decodeSemanticCacheEntry,
	findBestSemanticMatch,
	findSemanticCacheMatch,
	generateSemanticCacheScopeKey,
} from "./semantic-cache.js";
import { storageRedisClient } from "./storage-redis.js";

describe("semantic cache", () => {
	const scopeKey = generateSemanticCacheScopeKey(`spec-${Date.now()}`, {
		model: "gpt-4o-mini",
		temperature: 0,
	});

	afterAll(async () => {
		await storageRedisClient.del(scopeKey);
	});

	test("cosine similarity", () => {
		expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
		expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
		expect(cosineSimilarity([1, 0], [1, 0, 0])).toBe(0);
		expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
	});

	test("picks the most similar entry at or above the threshold", () => {
		const entries = [
			{ cacheKey: "a", embedding: [1, 0.2] },
			{ cacheKey: "b", embedding: [1, 0.05] },
			{ cacheKey: "c", embedding: [0, 1] },
		];
		expect(findBestSemanticMatch([1, 0], entries, 0.95)?.cacheKey).toBe("b");
		expect(findBestSemanticMatch([0.7, 0.7], entries, 0.99)).toBeNull();
	});

	test("scope keys differ by settings and project", () => {
		expect(generateSemanticCacheScopeKey("p", { temperature: 0 })).not.toBe(
			generateSemanticCacheScopeKey("p", { temperature: 1 }),
		);
		expect(generateSemanticCacheScopeKey("p", { temperature: 0 })).not.toBe(
			generateSemanticCacheScopeKey("q", { temperature: 0 }),
		);
	});

	test("skips malformed entries instead of failing the lookup", () => {
		expect(decodeSemanticCacheEntry("not json")).toBeNull();
		expect(
			decodeSemanticCacheEntry(JSON.stringify({ k: "x", e: "AAA" })),
		).toBeNull();
		expect(decodeSemanticCacheEntry("null")).toBeNull();
		const valid = JSON.stringify({
			k: "x",
			e: Buffer.from(new Float32Array([0.5, 0.25]).buffer).toString("base64"),
		});
		expect(decodeSemanticCacheEntry(valid)).toEqual({
			cacheKey: "x",
			embedding: [0.5, 0.25],
		});
	});

	test("one corrupt list element does not hide valid entries", async () => {
		await storageRedisClient.del(scopeKey);
		await storageRedisClient.lpush(scopeKey, "{corrupt");
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "good", embedding: [1, 0] },
			60,
		);
		await storageRedisClient.rpush(scopeKey, "{also-corrupt");
		const hit = await findSemanticCacheMatch(scopeKey, [1, 0], 0.99);
		expect(hit?.cacheKey).toBe("good");
		await storageRedisClient.del(scopeKey);
	});

	test("round-trips entries through Redis", async () => {
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "cached-response", embedding: [0.6, 0.8, 0] },
			60,
		);
		const hit = await findSemanticCacheMatch(
			scopeKey,
			[0.61, 0.79, 0.01],
			0.99,
		);
		expect(hit?.cacheKey).toBe("cached-response");
		expect(hit?.similarity).toBeGreaterThan(0.99);
		expect(await findSemanticCacheMatch(scopeKey, [0, 0, 1], 0.9)).toBeNull();
		expect(await storageRedisClient.ttl(scopeKey)).toBeGreaterThan(0);
	});
});
