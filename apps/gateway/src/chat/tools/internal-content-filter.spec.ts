import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	checkInternalContentFilter,
	chunkInternalModerationText,
	toInternalModerationResult,
} from "./internal-content-filter.js";
import { evaluateTieredContentFilter } from "./tiered-content-filter.js";

const CONTEXT = {
	requestId: "request-id",
	organizationId: "org-id",
	projectId: "project-id",
	apiKeyId: "api-key-id",
};

function verdict(body: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("chunkInternalModerationText", () => {
	it("keeps a prompt under the limit whole", () => {
		expect(chunkInternalModerationText("hello", 10)).toEqual(["hello"]);
		expect(chunkInternalModerationText("", 10)).toEqual([]);
	});

	it("never splits a multi-byte character", () => {
		// "é" is two bytes, so a 3-byte limit fits one per chunk.
		const chunks = chunkInternalModerationText("éééé", 3);

		expect(chunks).toEqual(["é", "é", "é", "é"]);
		expect(chunks.join("")).toBe("éééé");
	});
});

describe("toInternalModerationResult", () => {
	it("violates both tiers only when the service blocks", () => {
		const blocked = toInternalModerationResult({
			tags: ["child_exploitation"],
			block: true,
			score: 0.9,
		});
		const tagged = toInternalModerationResult({
			tags: ["violence"],
			block: false,
			score: 0.99,
		});

		expect(evaluateTieredContentFilter([blocked], "lenient").violation).toBe(
			true,
		);
		expect(evaluateTieredContentFilter([tagged], "strict").violation).toBe(
			false,
		);
	});

	it("records an untagged block under a fallback category", () => {
		expect(
			toInternalModerationResult({ tags: [], block: true }).category_scores,
		).toEqual({ blocked: 1 });
	});
});

describe("checkInternalContentFilter", () => {
	const originalUrl = process.env.LLM_CONTENT_FILTER_INTERNAL_URL;

	beforeEach(() => {
		process.env.LLM_CONTENT_FILTER_INTERNAL_URL = "http://classifier.test/";
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalUrl === undefined) {
			delete process.env.LLM_CONTENT_FILTER_INTERNAL_URL;
		} else {
			process.env.LLM_CONTENT_FILTER_INTERNAL_URL = originalUrl;
		}
	});

	it("posts the prompt and keeps the raw verdict on the response", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			verdict({
				tags: ["sexual_content"],
				block: true,
				score: 0.9,
				reasons: ["rule"],
			}),
		);

		const result = await checkInternalContentFilter(
			[{ role: "user", content: "bad prompt" }],
			CONTEXT,
		);

		expect(fetchMock).toHaveBeenCalledWith(
			"http://classifier.test/v1/classify",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ prompt: "user: bad prompt" }),
			}),
		);
		expect(result.flagged).toBe(true);
		expect(result.results[0]?.category_scores).toEqual({
			sexual_content: 1,
		});
		expect(result.responses[0]?.results?.[0]).toMatchObject({
			reasons: ["rule"],
			score: 0.9,
		});
		expect(result.partialModerationFailed).toBeUndefined();
	});

	it("fails open on a service error", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			verdict({ error: "boom" }, 500),
		);

		const result = await checkInternalContentFilter(
			[{ role: "user", content: "hello" }],
			CONTEXT,
		);

		expect(result.flagged).toBe(false);
		expect(result.results).toEqual([]);
	});

	it("does not trust a truncated verdict", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			verdict({ tags: [], block: false, score: 0, truncated: true }),
		);

		const result = await checkInternalContentFilter(
			[{ role: "user", content: "hello" }],
			CONTEXT,
		);

		expect(result.results).toEqual([]);
	});

	it("classifies an oversized prompt in chunks", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(verdict({ tags: [], block: false, score: 0 }))
			.mockResolvedValueOnce(
				verdict({ tags: ["violence"], block: true, score: 0.9 }),
			);

		const result = await checkInternalContentFilter(
			[{ role: "user", content: "a".repeat(70_000) }],
			CONTEXT,
		);

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.flagged).toBe(true);
		expect(result.results).toHaveLength(2);
	});

	it("marks a partial failure when only some chunks classify", async () => {
		vi.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(verdict({ tags: [], block: false, score: 0 }))
			.mockRejectedValueOnce(new Error("connection reset"));

		const result = await checkInternalContentFilter(
			[{ role: "user", content: "a".repeat(70_000) }],
			CONTEXT,
		);

		expect(result.results).toHaveLength(1);
		expect(result.partialModerationFailed).toBe(true);
	});

	it("skips the call when no URL is configured", async () => {
		delete process.env.LLM_CONTENT_FILTER_INTERNAL_URL;
		const fetchMock = vi.spyOn(globalThis, "fetch");

		const result = await checkInternalContentFilter(
			[{ role: "user", content: "hello" }],
			CONTEXT,
		);

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.results).toEqual([]);
	});
});
