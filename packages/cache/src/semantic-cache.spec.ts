import { afterAll, describe, expect, test } from "vitest";

import {
	addSemanticCacheEntry,
	cosineSimilarity,
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
