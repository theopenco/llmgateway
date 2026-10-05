import { afterAll, describe, expect, test } from "vitest";

import {
	addSemanticCacheEntry,
	cosineSimilarity,
	decodeSemanticCacheEntry,
	findSemanticCacheHit,
	findSemanticCacheMatches,
	generateSemanticCacheScopeKey,
	rankSemanticMatches,
	semanticAnchors,
} from "./semantic-cache.js";
import { storageRedisClient } from "./storage-redis.js";

const none: string[] = [];

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

	test("anchors keep numbers, codes, negations, polar words and names in order", () => {
		expect(semanticAnchors("What is 2+3?")).toEqual(["2+3"]);
		expect(semanticAnchors("Convert 100 EUR to USD.")).toEqual([
			"100",
			"EUR",
			"USD",
		]);
		expect(semanticAnchors("Convert 100 USD to EUR.")).not.toEqual(
			semanticAnchors("Convert 100 EUR to USD."),
		);
		// Codes joined by punctuation are still separate, ordered anchors.
		expect(semanticAnchors("Convert EUR→USD")).toEqual(["EUR", "USD"]);
		expect(semanticAnchors("Convert USD→EUR")).toEqual(["USD", "EUR"]);
		expect(semanticAnchors("EUR/USD rate")).toEqual(["EUR", "USD"]);
		expect(semanticAnchors("EUR-USD rate")).toEqual(["EUR", "USD"]);
		// Every n't contraction, straight or curly, is a negation.
		expect(semanticAnchors("Please don't cancel my order")).toEqual([
			"not",
			"cancel",
		]);
		expect(semanticAnchors("Please don\u2019t cancel my order")).toEqual([
			"not",
			"cancel",
		]);
		expect(semanticAnchors("I didn't receive my refund")).toEqual([
			"not",
			"receive",
		]);
		expect(semanticAnchors("I received my refund")).toEqual(["receive"]);
		expect(semanticAnchors("I couldn't log in")).toEqual(["not"]);
		// Polar verbs by base form.
		expect(semanticAnchors("Sell Tesla")).toEqual(["sell", "Tesla"]);
		expect(semanticAnchors("Buy Tesla")).toEqual(["buy", "Tesla"]);
		expect(semanticAnchors("Selling my shares")).toEqual(["sell"]);
		expect(semanticAnchors("I sold my shares")).toEqual(["sell"]);
		expect(semanticAnchors("Approve the request")).toEqual(["approve"]);
		expect(semanticAnchors("Reject the request")).toEqual(["reject"]);
		expect(semanticAnchors("The cancelled orders")).toEqual(["cancel"]);
		expect(semanticAnchors("Turn on dark mode")).toEqual(["on"]);
		expect(semanticAnchors("Turn off dark mode")).toEqual(["off"]);
		// Names after the first word of a sentence.
		expect(semanticAnchors("Weather in Paris today")).toEqual(["Paris"]);
		expect(semanticAnchors("Weather in London today")).toEqual(["London"]);
		expect(semanticAnchors("Paris weather. Tell me more")).toEqual(["more"]);
		// Rewordings of the same question carry no anchors.
		expect(semanticAnchors("How do I reset my password?")).toEqual([]);
		expect(
			semanticAnchors("How can I reset the password for my account?"),
		).toEqual([]);
		expect(semanticAnchors("Explain LLM routing (3f2a-9b)")).toEqual(
			semanticAnchors("Can you explain LLM routing? (3f2a-9b)"),
		);
	});

	test("ranks entries at or above the threshold, most similar first", () => {
		const entries = [
			{ cacheKey: "a", embedding: [1, 0.2], anchors: none },
			{ cacheKey: "b", embedding: [1, 0.05], anchors: none },
			{ cacheKey: "c", embedding: [0, 1], anchors: none },
		];
		expect(
			rankSemanticMatches(
				{ embedding: [1, 0], anchors: none },
				entries,
				0.95,
			).map((m) => m.cacheKey),
		).toEqual(["b", "a"]);
		expect(
			rankSemanticMatches(
				{ embedding: [0.7, 0.7], anchors: none },
				entries,
				0.99,
			),
		).toEqual([]);
	});

	test("an identical vector with different anchors never matches", () => {
		const entries = [
			{ cacheKey: "sum-4", embedding: [1, 0], anchors: ["2+2"] },
			{ cacheKey: "sum-5", embedding: [1, 0], anchors: ["2+3"] },
		];
		expect(
			rankSemanticMatches(
				{ embedding: [1, 0], anchors: ["2+3"] },
				entries,
				0.9,
			).map((m) => m.cacheKey),
		).toEqual(["sum-5"]);
		expect(
			rankSemanticMatches(
				{ embedding: [1, 0], anchors: ["EUR", "USD"] },
				[{ cacheKey: "x", embedding: [1, 0], anchors: ["USD", "EUR"] }],
				0.9,
			),
		).toEqual([]);
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
			decodeSemanticCacheEntry(JSON.stringify({ k: "x", a: [], e: "AAA" })),
		).toBeNull();
		expect(
			decodeSemanticCacheEntry(JSON.stringify({ k: "x", e: "AAAAAAAA" })),
		).toBeNull();
		expect(decodeSemanticCacheEntry("null")).toBeNull();
		const valid = JSON.stringify({
			k: "x",
			a: ["42"],
			e: Buffer.from(new Float32Array([0.5, 0.25]).buffer).toString("base64"),
		});
		expect(decodeSemanticCacheEntry(valid)).toEqual({
			cacheKey: "x",
			anchors: ["42"],
			embedding: [0.5, 0.25],
		});
	});

	test("one corrupt list element does not hide valid entries", async () => {
		await storageRedisClient.del(scopeKey);
		await storageRedisClient.lpush(scopeKey, "{corrupt");
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "good", embedding: [1, 0], anchors: none },
			60,
		);
		await storageRedisClient.rpush(scopeKey, "{also-corrupt");
		const [hit] = await findSemanticCacheMatches(
			scopeKey,
			{ embedding: [1, 0], anchors: none },
			0.99,
		);
		expect(hit?.cacheKey).toBe("good");
		await storageRedisClient.del(scopeKey);
	});

	test("round-trips entries through Redis", async () => {
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "cached-response", embedding: [0.6, 0.8, 0], anchors: none },
			60,
		);
		const [hit] = await findSemanticCacheMatches(
			scopeKey,
			{ embedding: [0.61, 0.79, 0.01], anchors: none },
			0.99,
		);
		expect(hit?.cacheKey).toBe("cached-response");
		expect(hit?.similarity).toBeGreaterThan(0.99);
		expect(
			await findSemanticCacheMatches(
				scopeKey,
				{ embedding: [0, 0, 1], anchors: none },
				0.9,
			),
		).toEqual([]);
		expect(await storageRedisClient.ttl(scopeKey)).toBeGreaterThan(0);
	});

	test("falls through to the next match when the best response is gone, and moves a hit to the front", async () => {
		await storageRedisClient.del(scopeKey);
		const live = `spec-live-${Date.now()}`;
		const responses = new Map([[live, { id: "live" }]]);
		const load = async (key: string) => responses.get(key) ?? null;
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: live, embedding: [1, 0.1], anchors: none },
			60,
		);
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "spec-expired", embedding: [1, 0], anchors: none },
			60,
		);
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "spec-newest", embedding: [0, 1], anchors: none },
			60,
		);
		const hit = await findSemanticCacheHit(
			scopeKey,
			{ embedding: [1, 0], anchors: none },
			0.9,
			load,
		);
		expect(hit?.cacheKey).toBe(live);
		expect(hit?.response).toEqual({ id: "live" });
		await new Promise((resolve) => setTimeout(resolve, 20));
		const [front] = await storageRedisClient.lrange(scopeKey, 0, 0);
		expect(decodeSemanticCacheEntry(front)?.cacheKey).toBe(live);
		expect(
			await findSemanticCacheHit(
				scopeKey,
				{ embedding: [0, 1], anchors: none },
				0.9,
				load,
			),
		).toBeNull();
		await storageRedisClient.del(scopeKey);
	});
});
