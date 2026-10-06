import { afterAll, afterEach, describe, expect, test, vi } from "vitest";

import { DIFFERENT_ANSWER_PAIRS } from "./semantic-cache-pairs.fixture.js";
import {
	getSemanticCachePointer,
	normalizedPromptKey,
	semanticCachePointerKey,
	setSemanticCachePointer,
} from "./semantic-cache.js";
import { storageRedisClient } from "./storage-redis.js";

const matches = (a: string, b: string) =>
	normalizedPromptKey(a) === normalizedPromptKey(b);

describe("normalizedPromptKey", () => {
	test("prompts with different answers never share a key", () => {
		expect(DIFFERENT_ANSWER_PAIRS.length).toBeGreaterThanOrEqual(158);
		const served = DIFFERENT_ANSWER_PAIRS.filter(([a, b]) => matches(a, b));
		expect(served).toEqual([]);
	});

	test.each([
		["How do I change my email address?", "How can I change my email address?"],
		[
			"What payment methods do you accept?",
			"Which payment methods do you accept?",
		],
		["What is the capital of Australia?", "What's the capital of Australia?"],
		["weather in paris tomorrow", "Weather in Paris tomorrow?"],
		[
			"Why didn\u2019t my payment go through",
			"Why didn't my payment go through",
		],
		["Can you help me please?", "Can you help me"],
		["Where can I find my invoice", "Where do I find my invoice!"],
		["Don't  delete   it", "Do not delete it."],
		["I'm locked out", "i am locked out"],
	])("matches %j and %j", (a, b) => {
		expect(matches(a, b)).toBe(true);
	});

	test.each([
		["Does a landlord raise rent?", "Can a landlord raise rent?"],
		["Translate 'please' to French", "Translate '' to French"],
		["Convert 1 mW to watts", "Convert 1 MW to watts"],
		["Compute (2+3)*4", "Compute 2+3*4"],
		["Send 100 from me to you", "Send 100 from you to me"],
		["Define news", "Define new"],
		[
			"Fix this:\n```python\nif x:\n    y()\nz()\n```",
			"Fix this:\n```python\nif x:\n    y()\n    z()\n```",
		],
		[
			"Fix this:\n```python\nif x:\n    y()\nz()",
			"Fix this:\n```python\nif x:\n    y()\n    z()",
		],
		["Is it legal?", "Is it illegal?"],
		["What does CSS stand for", "What does css stand for"],
		["Tell me which one is faster", "Tell me what one is faster"],
		["How could I reset it", "How do I reset it"],
	])("does not match %j and %j", (a, b) => {
		expect(matches(a, b)).toBe(false);
	});
});

describe("semantic cache pointer", () => {
	const projectId = `spec-${Date.now()}`;
	const pointerKey = semanticCachePointerKey(projectId, {
		model: "gpt-4o-mini",
		prompt: normalizedPromptKey("How do I reset my password?"),
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await storageRedisClient.del(pointerKey);
	});

	test("is scoped to the project and every scope field, not key order", () => {
		const scope = { model: "a", temperature: 0, context: [{ role: "system" }] };
		const key = semanticCachePointerKey("project-a", scope);
		expect(key).toMatch(/^semcache:project-a:[0-9a-f]{64}$/);
		expect(
			semanticCachePointerKey("project-a", {
				context: [{ role: "system" }],
				temperature: 0,
				model: "a",
			}),
		).toBe(key);
		expect(semanticCachePointerKey("project-b", scope)).not.toBe(key);
		expect(
			semanticCachePointerKey("project-a", { ...scope, temperature: 1 }),
		).not.toBe(key);
	});

	test("stores and reads the response-cache key", async () => {
		expect(await getSemanticCachePointer(pointerKey)).toBeNull();
		await setSemanticCachePointer(pointerKey, `${projectId}:response`, 60);
		expect(await getSemanticCachePointer(pointerKey)).toBe(
			`${projectId}:response`,
		);
		expect(await storageRedisClient.ttl(pointerKey)).toBeGreaterThan(0);
	});

	test("a Redis error or a stalled read is a miss", async () => {
		vi.spyOn(storageRedisClient, "get").mockRejectedValueOnce(
			new Error("connection lost"),
		);
		expect(await getSemanticCachePointer(pointerKey)).toBeNull();

		vi.spyOn(storageRedisClient, "get").mockReturnValueOnce(
			new Promise(() => {}) as ReturnType<typeof storageRedisClient.get>,
		);
		const startedAt = Date.now();
		expect(await getSemanticCachePointer(pointerKey)).toBeNull();
		expect(Date.now() - startedAt).toBeLessThan(1_000);

		vi.spyOn(storageRedisClient, "set").mockRejectedValueOnce(
			new Error("connection lost"),
		);
		await expect(
			setSemanticCachePointer(pointerKey, "other", 60),
		).resolves.toBeUndefined();
	});
});
