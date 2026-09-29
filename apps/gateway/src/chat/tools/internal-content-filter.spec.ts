import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildInternalModerationPrompt,
	checkInternalContentFilter,
	chunkInternalModerationText,
	toInternalModerationResult,
	truncateMiddle,
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
	});
});

describe("truncateMiddle", () => {
	it("keeps text under the limit whole", () => {
		expect(truncateMiddle("hello", 10)).toBe("hello");
	});

	it("keeps the start and the end without splitting a character", () => {
		const text = `start ${"é".repeat(100)} end`;
		const truncated = truncateMiddle(text, 40);

		expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(40);
		expect(truncated.startsWith("start")).toBe(true);
		expect(truncated.endsWith(" end")).toBe(true);
		expect(truncated).not.toContain("\uFFFD");
	});
});

describe("buildInternalModerationPrompt", () => {
	it("sends the system prompt and only the turn after the last assistant message", () => {
		const prompt = buildInternalModerationPrompt([
			{ role: "system", content: "be helpful" },
			{ role: "user", content: "old question" },
			{ role: "assistant", content: "old answer" },
			{ role: "user", content: "new question" },
		]);

		expect(prompt).toBe("system: be helpful\n\nuser: new question");
	});

	it("fits one request and gives the latest turn the budget first", () => {
		const prompt = buildInternalModerationPrompt(
			[
				{ role: "system", content: "s".repeat(500) },
				{ role: "user", content: `ask ${"x".repeat(500)} this` },
			],
			200,
		);

		expect(new TextEncoder().encode(prompt).length).toBeLessThanOrEqual(200);
		expect(prompt.startsWith("user: ask")).toBe(true);
		expect(prompt.endsWith("this")).toBe(true);
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

	const LONG_CONVERSATION = [
		{ role: "user" as const, content: "a".repeat(200_000) },
		{ role: "assistant" as const, content: "ok" },
		{ role: "user" as const, content: "b".repeat(200_000) },
	];

	it("classifies the whole conversation in chunks by default", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(async () =>
				verdict({ tags: [], block: false, score: 0 }),
			);

		const result = await checkInternalContentFilter(LONG_CONVERSATION, CONTEXT);

		// ~400 KB of text at 64 KB per request.
		expect(fetchMock).toHaveBeenCalledTimes(7);
		expect(result.results).toHaveLength(7);
		expect(result.partialModerationFailed).toBeUndefined();
	});

	it("marks a partial failure when only some chunks classify", async () => {
		vi.spyOn(globalThis, "fetch")
			.mockRejectedValueOnce(new Error("connection reset"))
			.mockImplementation(async () =>
				verdict({ tags: [], block: false, score: 0 }),
			);

		const result = await checkInternalContentFilter(LONG_CONVERSATION, CONTEXT);

		expect(result.results).toHaveLength(6);
		expect(result.partialModerationFailed).toBe(true);
	});

	it("classifies only the latest turn in a single request when scoped", async () => {
		const fetchMock = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(
				verdict({ tags: ["violence"], block: true, score: 0.9 }),
			);

		const result = await checkInternalContentFilter(
			LONG_CONVERSATION,
			CONTEXT,
			undefined,
			"latest_turn",
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse(
			(fetchMock.mock.calls[0]![1] as RequestInit).body as string,
		) as { prompt: string };
		expect(new TextEncoder().encode(body.prompt).length).toBeLessThanOrEqual(
			65_536,
		);
		expect(body.prompt).not.toContain("a");
		expect(result.flagged).toBe(true);
		expect(result.results).toHaveLength(1);
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
