import { describe, expect, it } from "vitest";

import { generateCacheKey, generateStreamingCacheKey } from "./cache.js";

// Regression tests for GHSA-h9ww-f95j-h54c: the response-cache key must be
// tenant-scoped so byte-identical request bodies from different projects can
// never collide on the same Redis key. setCache is a no-op under
// NODE_ENV=test, so isolation is asserted on key construction directly.
describe("generateCacheKey", () => {
	const payload = {
		provider: "openai",
		model: "gpt-4o",
		messages: [{ role: "user", content: "hello" }],
	};

	it("prefixes the key with the tenant scope", () => {
		expect(generateCacheKey("project-a", payload)).toMatch(
			/^project-a:[0-9a-f]{64}$/,
		);
	});

	it("produces different keys for different scopes with identical payloads", () => {
		expect(generateCacheKey("project-a", payload)).not.toBe(
			generateCacheKey("project-b", payload),
		);
	});

	it("payload fields cannot forge another tenant's scope", () => {
		expect(
			generateCacheKey("project-a", { ...payload, scope: "project-b" }),
		).toMatch(/^project-a:/);
	});
});

describe("generateStreamingCacheKey", () => {
	it("scopes the streaming key identically", () => {
		const payload = { model: "gpt-4o" };
		expect(generateStreamingCacheKey("project-a", payload)).toBe(
			`stream:${generateCacheKey("project-a", payload)}`,
		);
		expect(generateStreamingCacheKey("project-a", payload)).not.toBe(
			generateStreamingCacheKey("project-b", payload),
		);
	});
});
