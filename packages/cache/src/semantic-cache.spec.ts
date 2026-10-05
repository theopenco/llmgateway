import { afterAll, describe, expect, test } from "vitest";

import {
	addSemanticCacheEntry,
	cosineSimilarity,
	decodeSemanticCacheEntry,
	findSemanticCacheHit,
	findSemanticCacheMatches,
	generateSemanticCacheScopeKey,
	quantiseEmbedding,
	rankSemanticMatches,
	sameWordOrder,
	semanticAnchors,
	semanticWords,
	wordKeys,
} from "./semantic-cache.js";
import { storageRedisClient } from "./storage-redis.js";

const none: string[] = [];
const plain = { anchors: none, wordKeys: none };

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
		// Pronoun parties anchor only when two or more differ.
		expect(semanticAnchors("transfer the money from me to him")).toEqual([
			"@me",
			"@him",
		]);
		expect(semanticAnchors("transfer the money from him to me")).toEqual([
			"@him",
			"@me",
		]);
		expect(semanticAnchors("I sent it to them")).toEqual([
			"@me",
			"send",
			"@them",
		]);
		expect(semanticAnchors("They sent it to me")).toEqual([
			"@them",
			"send",
			"@me",
		]);
		expect(semanticAnchors("Summarise my notes please.")).toEqual([]);
		expect(semanticAnchors("How do I reset my password?")).toEqual([]);
		// Rewordings of the same question carry no anchors.
		expect(semanticAnchors("How do I reset my password?")).toEqual([]);
		expect(
			semanticAnchors("How can I reset the password for my account?"),
		).toEqual([]);
		expect(semanticAnchors("Explain LLM routing (3f2a-9b)")).toEqual(
			semanticAnchors("Can you explain LLM routing? (3f2a-9b)"),
		);
	});

	test("shared words must keep their order, so operand swaps never match", () => {
		const words = (text: string) => semanticWords(text);
		expect(words("Transfer 500 from savings to checking")).toEqual([
			"transfer",
			"500",
			"saving",
			"checking",
		]);
		const swap = (a: string, b: string) => sameWordOrder(words(a), words(b));
		expect(
			swap(
				"transfer 500 from savings to checking",
				"transfer 500 from checking to savings",
			),
		).toBe(false);
		expect(swap("convert 100 eur to usd", "convert 100 usd to eur")).toBe(
			false,
		);
		expect(swap("convert eur→usd", "convert usd→eur")).toBe(false);
		expect(swap("change 100 usd to eur", "convert 100 eur to usd")).toBe(false);
		expect(
			swap("is paris bigger than london", "is london bigger than paris"),
		).toBe(false);
		// Rewordings add, drop or replace words without reordering shared ones.
		expect(
			swap(
				"How do I reset my password?",
				"How can I reset the password for my account?",
			),
		).toBe(true);
		expect(
			swap("Tell me about caching please", "Tell me all about caching"),
		).toBe(true);
		expect(swap("Explain LLM routing", "Can you explain LLM routing?")).toBe(
			true,
		);
		const keys = (text: string) => wordKeys(words(text));
		expect(keys("transfer 500 from savings to checking")).toHaveLength(4);
		expect(keys("eur usd")).toEqual(keys("eur usd"));
		expect(keys("eur usd")).not.toEqual(keys("usd eur"));
		expect(
			rankSemanticMatches(
				{ embedding: [1, 0], anchors: none, wordKeys: keys("eur to usd") },
				[
					{
						cacheKey: "reverse",
						embedding: [1, 0],
						anchors: none,
						wordKeys: keys("usd to eur"),
					},
					{
						cacheKey: "same",
						embedding: [1, 0],
						anchors: none,
						wordKeys: keys("please convert eur to usd"),
					},
				],
				0.9,
			).map((m) => m.cacheKey),
		).toEqual(["same"]);
	});

	test("ranks entries at or above the threshold, most similar first", () => {
		const entries = [
			{ cacheKey: "a", embedding: [1, 0.2], ...plain },
			{ cacheKey: "b", embedding: [1, 0.05], ...plain },
			{ cacheKey: "c", embedding: [0, 1], ...plain },
		];
		expect(
			rankSemanticMatches({ embedding: [1, 0], ...plain }, entries, 0.95).map(
				(m) => m.cacheKey,
			),
		).toEqual(["b", "a"]);
		expect(
			rankSemanticMatches({ embedding: [0.7, 0.7], ...plain }, entries, 0.99),
		).toEqual([]);
	});

	test("an identical vector with different anchors never matches", () => {
		const entries = [
			{
				cacheKey: "sum-4",
				embedding: [1, 0],
				anchors: ["2+2"],
				wordKeys: none,
			},
			{
				cacheKey: "sum-5",
				embedding: [1, 0],
				anchors: ["2+3"],
				wordKeys: none,
			},
		];
		expect(
			rankSemanticMatches(
				{ embedding: [1, 0], anchors: ["2+3"], wordKeys: none },
				entries,
				0.9,
			).map((m) => m.cacheKey),
		).toEqual(["sum-5"]);
		expect(
			rankSemanticMatches(
				{ embedding: [1, 0], anchors: ["EUR", "USD"], wordKeys: none },
				[
					{
						cacheKey: "x",
						embedding: [1, 0],
						anchors: ["USD", "EUR"],
						wordKeys: none,
					},
				],
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
			decodeSemanticCacheEntry(JSON.stringify({ k: "x", a: [], w: "", e: "" })),
		).toBeNull();
		expect(
			decodeSemanticCacheEntry(JSON.stringify({ k: "x", e: "AAAAAAAA" })),
		).toBeNull();
		expect(
			decodeSemanticCacheEntry(
				JSON.stringify({ k: "x", a: [], e: "AAAAAAAA" }),
			),
		).toBeNull();
		expect(decodeSemanticCacheEntry("null")).toBeNull();
		const valid = JSON.stringify({
			k: "x",
			a: ["42"],
			w: "abc def",
			e: Buffer.from(new Int8Array([127, -64]).buffer).toString("base64"),
		});
		expect(decodeSemanticCacheEntry(valid)).toEqual({
			cacheKey: "x",
			anchors: ["42"],
			wordKeys: ["abc", "def"],
			embedding: [127, -64],
		});
	});

	test("stores 8-bit vectors that keep similarities within 0.002", () => {
		const a = Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.37));
		const b = a.map((value, i) => value + (i % 7 === 0 ? 0.08 : 0));
		const exact = cosineSimilarity(a, b);
		const stored = cosineSimilarity(quantiseEmbedding(a), quantiseEmbedding(b));
		expect(Math.abs(exact - stored)).toBeLessThan(0.002);
		expect(
			cosineSimilarity(quantiseEmbedding(a), quantiseEmbedding(a)),
		).toBeCloseTo(1, 10);
		expect(quantiseEmbedding([0, 0])).toEqual([0, 0]);
		expect(Math.max(...quantiseEmbedding(a).map(Math.abs))).toBe(127);
	});

	test("one corrupt list element does not hide valid entries", async () => {
		await storageRedisClient.del(scopeKey);
		await storageRedisClient.lpush(scopeKey, "{corrupt");
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "good", embedding: [1, 0], ...plain },
			60,
		);
		await storageRedisClient.rpush(scopeKey, "{also-corrupt");
		const [hit] = await findSemanticCacheMatches(
			scopeKey,
			{ embedding: [1, 0], ...plain },
			0.99,
		);
		expect(hit?.cacheKey).toBe("good");
		await storageRedisClient.del(scopeKey);
	});

	test("round-trips entries through Redis", async () => {
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "cached-response", embedding: [0.6, 0.8, 0], ...plain },
			60,
		);
		const [hit] = await findSemanticCacheMatches(
			scopeKey,
			{ embedding: [0.61, 0.79, 0.01], ...plain },
			0.99,
		);
		expect(hit?.cacheKey).toBe("cached-response");
		expect(hit?.similarity).toBeGreaterThan(0.99);
		expect(
			await findSemanticCacheMatches(
				scopeKey,
				{ embedding: [0, 0, 1], ...plain },
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
			{ cacheKey: live, embedding: [1, 0.1], ...plain },
			60,
		);
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "spec-expired", embedding: [1, 0], ...plain },
			60,
		);
		await addSemanticCacheEntry(
			scopeKey,
			{ cacheKey: "spec-newest", embedding: [0, 1], ...plain },
			60,
		);
		const hit = await findSemanticCacheHit(
			scopeKey,
			{ embedding: [1, 0], ...plain },
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
				{ embedding: [0, 1], ...plain },
				0.9,
				load,
			),
		).toBeNull();
		await storageRedisClient.del(scopeKey);
	});
});
