import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	findManagedProviderKey,
	hasManagedProviderCredential,
} from "@/lib/cached-queries.js";

import { encryptProviderKeyForStorage } from "@llmgateway/actions";
import { redisClient } from "@llmgateway/cache";
import { logger } from "@llmgateway/logger";

import { resetContentFilterCredentialCooldowns } from "./content-filter-credential.js";
import {
	MODERATION_CACHE_TTL_SECONDS,
	moderationCacheKey,
} from "./moderation-cache.js";
import {
	buildLatestTurnModerationText,
	buildOpenAIContentFilterImageInputs,
	buildOpenAIContentFilterTextChunks,
	buildOpenAIContentFilterTextInput,
	checkOpenAIContentFilter,
	chunkModerationText,
	truncateMiddle,
} from "./openai-content-filter.js";

import type * as CachedQueries from "@/lib/cached-queries.js";
import type { InferSelectModel, providerKey } from "@llmgateway/db";

// These cases cover the env credential path. Without this, a managed key left
// in the worker's DB or Redis cache by another spec file silently wins.
vi.mock("@/lib/cached-queries.js", async (importOriginal) => ({
	...(await importOriginal<typeof CachedQueries>()),
	hasManagedProviderCredential: vi.fn(async () => false),
	findManagedProviderKey: vi.fn(async () => undefined),
}));

describe("buildOpenAIContentFilterTextInput", () => {
	it("flattens text-only messages into a single moderation string", () => {
		expect(
			buildOpenAIContentFilterTextInput([
				{
					role: "system",
					content: "You are a helpful assistant.",
				},
				{
					role: "user",
					content: "Hello world",
				},
			]),
		).toBe("system: You are a helpful assistant.\n\nuser: Hello world");
	});

	it("includes multimodal text in the text moderation request", () => {
		expect(
			buildOpenAIContentFilterTextInput([
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What is in this image?",
						},
						{
							type: "image_url",
							image_url: {
								url: "https://example.com/cat.png",
								detail: "high",
							},
						},
					],
				},
			]),
		).toBe("user: What is in this image?");
	});
});

describe("buildOpenAIContentFilterImageInputs", () => {
	it("extracts image_url content into one moderation input per image", () => {
		expect(
			buildOpenAIContentFilterImageInputs([
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "What is in this image?",
						},
						{
							type: "image_url",
							image_url: {
								url: "https://example.com/cat.png",
								detail: "high",
							},
						},
						{
							type: "image_url",
							image_url: {
								url: "https://example.com/dog.png",
							},
						},
					],
				},
			]),
		).toEqual([
			[
				{
					type: "image_url",
					image_url: {
						url: "https://example.com/cat.png",
					},
				},
			],
			[
				{
					type: "image_url",
					image_url: {
						url: "https://example.com/dog.png",
					},
				},
			],
		]);
	});

	it("converts base64 image content into data URLs for moderation", () => {
		expect(
			buildOpenAIContentFilterImageInputs([
				{
					role: "user",
					content: [
						{
							type: "image",
							source: {
								type: "base64",
								media_type: "image/png",
								data: "aGVsbG8=",
							},
						},
					],
				},
			]),
		).toEqual([
			[
				{
					type: "image_url",
					image_url: {
						url: "data:image/png;base64,aGVsbG8=",
					},
				},
			],
		]);
	});
});

describe("chunkModerationText", () => {
	it("keeps a prompt under the limit whole", () => {
		expect(chunkModerationText("hello", 10)).toEqual(["hello"]);
		expect(chunkModerationText("", 10)).toEqual([]);
	});

	it("never splits a multi-byte character", () => {
		// "é" is two bytes, so a 3-byte limit fits one per chunk.
		const chunks = chunkModerationText("éééé", 3);

		expect(chunks).toEqual(["é", "é", "é", "é"]);
	});

	it("keeps a U+FEFF that starts a chunk", () => {
		// U+FEFF is three bytes; the second chunk is exactly it.
		expect(chunkModerationText("ab\uFEFFcd", 3)).toEqual([
			"ab",
			"\uFEFF",
			"cd",
		]);
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

describe("buildLatestTurnModerationText", () => {
	it("sends the system prompt and only the turn after the last assistant message", () => {
		const prompt = buildLatestTurnModerationText(
			[
				{ role: "system", content: "be helpful" },
				{ role: "user", content: "old question" },
				{ role: "assistant", content: "old answer" },
				{ role: "user", content: "new question" },
			],
			1_000,
		);

		expect(prompt).toBe("system: be helpful\n\nuser: new question");
	});

	it("fits one request and gives the latest turn the budget first", () => {
		const prompt = buildLatestTurnModerationText(
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

describe("buildOpenAIContentFilterTextChunks", () => {
	const longTurn = "x".repeat(10_000);

	it("reads only the latest turn, in chunks under the token limit", () => {
		const chunks = buildOpenAIContentFilterTextChunks(
			[
				{ role: "user", content: "old question" },
				{ role: "assistant", content: "old answer" },
				{ role: "user", content: longTurn },
			],
			"latest_turn",
		);

		expect(chunks).toHaveLength(3);
		expect(chunks.join("")).toBe(`user: ${longTurn}`);
		for (const chunk of chunks) {
			expect(new TextEncoder().encode(chunk).length).toBeLessThanOrEqual(4096);
		}
	});

	it("reads the whole conversation, keeping the newest chunks past the cap", () => {
		const chunks = buildOpenAIContentFilterTextChunks(
			[
				{ role: "user", content: `first ${"a".repeat(300_000)}` },
				{ role: "assistant", content: "old answer" },
				{ role: "user", content: "new question" },
			],
			"full",
		);

		expect(chunks).toHaveLength(64);
		expect(chunks.join("")).toHaveLength(256 * 1024);
		expect(chunks.join("")).not.toContain("first");
		expect(chunks.at(-1)).toContain("user: new question");
	});
});

describe("checkOpenAIContentFilter", () => {
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;
	const originalThreshold =
		process.env.LLM_CONTENT_FILTER_OPENAI_SCORE_THRESHOLD;

	beforeEach(async () => {
		// Verdicts are cached per chunk; start every case from a cold cache.
		await redisClient.flushdb();
		resetContentFilterCredentialCooldowns();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
		} else {
			process.env.LLM_OPENAI_API_KEY = originalOpenAIKey;
		}

		if (originalThreshold === undefined) {
			delete process.env.LLM_CONTENT_FILTER_OPENAI_SCORE_THRESHOLD;
			return;
		}

		process.env.LLM_CONTENT_FILTER_OPENAI_SCORE_THRESHOLD = originalThreshold;
	});

	it("rethrows abort errors from the request signal", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		const abortError = new DOMException(
			"The operation was aborted.",
			"AbortError",
		);
		const requestController = new AbortController();
		requestController.abort(abortError);

		vi.spyOn(globalThis, "fetch").mockRejectedValue(abortError);

		await expect(
			checkOpenAIContentFilter(
				[
					{
						role: "user",
						content: "hello",
					},
				],
				{
					requestId: "request-id",
					organizationId: "org-id",
					projectId: "project-id",
					apiKeyId: "api-key-id",
				},
				requestController.signal,
			),
		).rejects.toThrowError(abortError);
	});

	it("moderates through the env base URL of the OpenAI credential", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		process.env.LLM_OPENAI_BASE_URL = "https://proxy.example.com/";
		const requestedUrls: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			requestedUrls.push(String(input));
			return new Response(
				JSON.stringify({
					id: "modr-text",
					model: "omni-moderation-latest",
					results: [{ flagged: false, categories: {}, category_scores: {} }],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});

		try {
			await checkOpenAIContentFilter(
				[{ role: "user", content: "hello" }],
				{
					requestId: "request-id",
					organizationId: "org-id",
					projectId: "project-id",
					apiKeyId: "api-key-id",
				},
				undefined,
			);
		} finally {
			delete process.env.LLM_OPENAI_BASE_URL;
		}

		expect(requestedUrls).toEqual(["https://proxy.example.com/v1/moderations"]);
	});

	it("submits one moderation request for text and one per image", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		const requestBodies: Array<{ model: string; input: unknown }> = [];

		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				model: string;
				input: Array<string | { image_url?: { url: string } }>;
			};
			requestBodies.push(body);

			const [first] = body.input;
			if (typeof first === "string") {
				return new Response(
					JSON.stringify({
						id: "modr-text",
						model: "omni-moderation-latest",
						results: [
							{
								flagged: false,
								categories: {},
								category_scores: {},
							},
						],
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
							"x-request-id": "req-text",
						},
					},
				);
			}

			const imageUrl = first?.image_url?.url;
			return new Response(
				JSON.stringify({
					id: `modr-${imageUrl}`,
					model: "omni-moderation-latest",
					results: [
						{
							flagged: imageUrl === "https://example.com/dog.png",
							categories: {
								violence: imageUrl === "https://example.com/dog.png",
							},
							category_scores: {
								violence:
									imageUrl === "https://example.com/dog.png" ? 0.95 : 0.2,
							},
						},
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"x-request-id":
							imageUrl === "https://example.com/dog.png"
								? "req-dog"
								: "req-cat",
					},
				},
			);
		});

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: [
						{
							type: "text",
							text: "Please inspect these images.",
						},
						{
							type: "image_url",
							image_url: {
								url: "https://example.com/cat.png",
							},
						},
						{
							type: "image_url",
							image_url: {
								url: "https://example.com/dog.png",
							},
						},
					],
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		// The text call goes out after its cache lookup, so calls run unordered.
		expect(requestBodies).toHaveLength(3);
		expect(requestBodies).toEqual(
			expect.arrayContaining([
				{
					model: "omni-moderation-latest",
					input: ["user: Please inspect these images."],
				},
				{
					model: "omni-moderation-latest",
					input: [
						{
							type: "image_url",
							image_url: {
								url: "https://example.com/cat.png",
							},
						},
					],
				},
				{
					model: "omni-moderation-latest",
					input: [
						{
							type: "image_url",
							image_url: {
								url: "https://example.com/dog.png",
							},
						},
					],
				},
			]),
		);
		expect(result.flagged).toBe(true);
		expect(result.model).toBe("omni-moderation-latest");
		expect(result.upstreamRequestId).toBe("req-dog");
		expect(result.results).toHaveLength(3);
		expect(result.responses).toEqual([
			{
				id: "modr-text",
				model: "omni-moderation-latest",
				results: [
					{
						flagged: false,
						categories: {},
						category_scores: {},
					},
				],
			},
			{
				id: "modr-https://example.com/cat.png",
				model: "omni-moderation-latest",
				results: [
					{
						flagged: false,
						categories: {
							violence: false,
						},
						category_scores: {
							violence: 0.2,
						},
					},
				],
			},
			{
				id: "modr-https://example.com/dog.png",
				model: "omni-moderation-latest",
				results: [
					{
						flagged: true,
						categories: {
							violence: true,
						},
						category_scores: {
							violence: 0.95,
						},
					},
				],
			},
		]);
		expect(result.results.some((entry) => entry.flagged)).toBe(true);
	});

	it("scores long text in chunks and flags a violation in any of them", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		const inputs: string[][] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				input: string[];
			};
			inputs.push(body.input);
			return new Response(
				JSON.stringify({
					model: "omni-moderation-latest",
					results: body.input.map((chunk) => {
						const hit = chunk.includes("VIOLATION");
						return {
							flagged: hit,
							categories: { violence: hit },
							category_scores: { violence: hit ? 0.99 : 0.01 },
						};
					}),
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		const messages = [
			{ role: "user" as const, content: "old VIOLATION question" },
			{ role: "assistant" as const, content: "old answer" },
			{ role: "user" as const, content: `${"x".repeat(9_000)} VIOLATION` },
		];
		const context = {
			requestId: "request-id",
			organizationId: "org-id",
			projectId: "project-id",
			apiKeyId: "api-key-id",
		};

		const latest = await checkOpenAIContentFilter(messages, context);
		const full = await checkOpenAIContentFilter(messages, context, undefined, {
			scope: "full",
		});

		// One call each; the latest turn alone runs past one chunk.
		expect(inputs).toHaveLength(2);
		expect(inputs[0]).toHaveLength(3);
		expect(inputs[0]!.join("")).not.toContain("old VIOLATION question");
		expect(inputs[1]!.join("")).toContain("old VIOLATION question");
		expect(latest.flagged).toBe(true);
		expect(latest.results).toHaveLength(3);
		expect(full.flagged).toBe(true);
	});

	it("ignores upstream flagged when category scores stay at or below 0.75", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "modr-threshold-low",
					model: "omni-moderation-latest",
					results: [
						{
							flagged: true,
							categories: {
								violence: true,
								"violence/graphic": true,
							},
							category_scores: {
								violence: 0.75,
								"violence/graphic": 0.74,
							},
						},
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "req-low-threshold",
					},
				},
			),
		);

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: "I want to attack someone.",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result.flagged).toBe(false);
		expect(result.upstreamRequestId).toBe("req-low-threshold");
	});

	it("flags when any category score is higher than 0.75", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "modr-threshold-high",
					model: "omni-moderation-latest",
					results: [
						{
							flagged: false,
							categories: {
								violence: true,
							},
							category_scores: {
								violence: 0.76,
							},
						},
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "req-high-threshold",
					},
				},
			),
		);

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: "I want to attack someone.",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result.flagged).toBe(true);
		expect(result.upstreamRequestId).toBe("req-high-threshold");
	});

	it("uses the configured env var threshold when provided", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		process.env.LLM_CONTENT_FILTER_OPENAI_SCORE_THRESHOLD = "0.7";

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "modr-env-threshold",
					model: "omni-moderation-latest",
					results: [
						{
							flagged: false,
							categories: {
								violence: true,
							},
							category_scores: {
								violence: 0.75,
							},
						},
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "req-env-threshold",
					},
				},
			),
		);

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: "I want to attack someone.",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result.flagged).toBe(true);
		expect(result.upstreamRequestId).toBe("req-env-threshold");
	});

	it("falls back to the default threshold for invalid env var values", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		process.env.LLM_CONTENT_FILTER_OPENAI_SCORE_THRESHOLD = "not-a-number";

		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					id: "modr-invalid-env-threshold",
					model: "omni-moderation-latest",
					results: [
						{
							flagged: true,
							categories: {
								violence: true,
							},
							category_scores: {
								violence: 0.75,
							},
						},
					],
				}),
				{
					status: 200,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "req-invalid-env-threshold",
					},
				},
			),
		);

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: "I want to attack someone.",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result.flagged).toBe(false);
		expect(result.upstreamRequestId).toBe("req-invalid-env-threshold");
	});

	it("warns on a rejected image and keeps the text verdict", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});

		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? "{}")) as {
				input: unknown[];
			};
			if (typeof body.input[0] === "string") {
				return new Response(
					JSON.stringify({
						model: "omni-moderation-latest",
						results: [{ flagged: false, categories: {}, category_scores: {} }],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({
					error: {
						code: "invalid_image_format",
						message: "Unsupported format: image/avif",
						param: "input",
						type: "invalid_request_error",
					},
				}),
				{
					status: 400,
					headers: {
						"Content-Type": "application/json",
						"x-request-id": "req-image",
					},
				},
			);
		});

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: [
						{ type: "text", text: "look" },
						{
							type: "image_url",
							image_url: { url: "data:image/avif;base64,AAAA" },
						},
					],
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result.results).toHaveLength(1);
		expect(result.errors).toEqual([
			{
				source: "openai",
				kind: "upstream_4xx",
				inputType: "image",
				status: 400,
				code: "invalid_image_format",
				message: "Unsupported format: image/avif",
			},
		]);
		expect(errorSpy).not.toHaveBeenCalled();
		expect(warnSpy).toHaveBeenCalledWith(
			"gateway_content_filter_error",
			expect.objectContaining({
				mode: "openai",
				inputType: "image",
				status: 400,
				upstreamRequestId: "req-image",
				errorKind: "upstream_4xx",
				errorCode: "invalid_image_format",
				error: "Unsupported format: image/avif",
			}),
		);
		expect(warnSpy.mock.calls[0]?.[1]).not.toHaveProperty("errorName");
	});

	it("logs an upstream 5xx error page by its title", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
		vi.spyOn(logger, "warn").mockImplementation(() => {});

		vi.spyOn(globalThis, "fetch").mockImplementation(
			async () =>
				new Response(
					"<html><head><title>api.openai.com | 504: Gateway time-out</title></head><body>long</body></html>",
					{ status: 504, headers: { "Content-Type": "text/html" } },
				),
		);

		const result = await checkOpenAIContentFilter(
			[{ role: "user", content: "hello" }],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result.errors).toEqual([
			{
				source: "openai",
				kind: "upstream_5xx",
				inputType: "text",
				status: 504,
				message: "api.openai.com | 504: Gateway time-out",
			},
		]);
		expect(errorSpy).toHaveBeenCalledWith(
			"gateway_content_filter_error",
			expect.objectContaining({
				status: 504,
				errorKind: "upstream_5xx",
				response: "api.openai.com | 504: Gateway time-out",
			}),
		);
	});

	describe("transient failures", () => {
		const CONTEXT = {
			requestId: "request-id",
			organizationId: "org-id",
			projectId: "project-id",
			apiKeyId: "api-key-id",
		};
		const ENVOY_RESET =
			"upstream connect error or disconnect/reset before headers. reset reason: remote connection failure";
		const ok = () =>
			new Response(
				JSON.stringify({
					model: "omni-moderation-latest",
					results: [{ flagged: false, categories: {}, category_scores: {} }],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		const envoy503 = () =>
			new Response(ENVOY_RESET, {
				status: 503,
				headers: { "Content-Type": "text/plain" },
			});

		it("retries a 5xx connection reset once and only warns when it recovers", async () => {
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementationOnce(async () => envoy503())
				.mockImplementationOnce(async () => ok());

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "hello" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(2);
			expect(result.errors).toEqual([]);
			expect(result.results).toHaveLength(1);
			expect(errorSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith(
				"gateway_content_filter_error",
				expect.objectContaining({
					status: 503,
					errorKind: "upstream_5xx",
					error: ENVOY_RESET,
					attempt: 1,
					retrying: true,
				}),
			);
		});

		it("retries a thrown connection reset once", async () => {
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
			vi.spyOn(logger, "warn").mockImplementation(() => {});
			const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockRejectedValueOnce(
					new TypeError("fetch failed", {
						cause: Object.assign(new Error("read ECONNRESET"), {
							code: "ECONNRESET",
						}),
					}),
				)
				.mockImplementationOnce(async () => ok());

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "hello" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(2);
			expect(result.errors).toEqual([]);
			expect(errorSpy).not.toHaveBeenCalled();
		});

		it("errors and fails open when the retry fails too", async () => {
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async () => envoy503());

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "hello" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(2);
			expect(result.flagged).toBe(false);
			expect(result.errors).toEqual([
				{
					source: "openai",
					kind: "upstream_5xx",
					inputType: "text",
					status: 503,
					message: ENVOY_RESET,
				},
			]);
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledWith(
				"gateway_content_filter_error",
				expect.objectContaining({
					errorKind: "upstream_5xx",
					attempt: 2,
					retrying: false,
				}),
			);
		});

		it("rethrows a request abort that lands before the retry", async () => {
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
			vi.spyOn(logger, "warn").mockImplementation(() => {});
			vi.spyOn(logger, "error").mockImplementation(() => {});
			const controller = new AbortController();
			const abortError = new DOMException("aborted", "AbortError");
			vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
				if (init?.signal?.aborted) {
					throw init.signal.reason;
				}
				controller.abort(abortError);
				return envoy503();
			});

			await expect(
				checkOpenAIContentFilter(
					[{ role: "user", content: "hello" }],
					CONTEXT,
					controller.signal,
				),
			).rejects.toBe(abortError);
		});

		it("fails open as a timeout when the budget runs out before the retry", async () => {
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
			vi.spyOn(logger, "warn").mockImplementation(() => {});
			vi.spyOn(logger, "error").mockImplementation(() => {});
			vi.spyOn(globalThis, "fetch")
				.mockImplementationOnce(async () => envoy503())
				.mockRejectedValueOnce(
					new DOMException("signal timed out", "TimeoutError"),
				);

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "hello" }],
				CONTEXT,
			);

			expect(result.flagged).toBe(false);
			expect(result.errors).toEqual([
				expect.objectContaining({ kind: "timeout" }),
			]);
		});

		it("does not retry a rejected credential and logs it as an error", async () => {
			process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
				async () =>
					new Response(
						JSON.stringify({
							error: { code: "invalid_api_key", message: "Incorrect API key" },
						}),
						{ status: 401, headers: { "Content-Type": "application/json" } },
					),
			);

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "hello" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(result.errors).toHaveLength(1);
			expect(warnSpy).not.toHaveBeenCalled();
			expect(errorSpy).toHaveBeenCalledWith(
				"gateway_content_filter_error",
				expect.objectContaining({
					status: 401,
					errorKind: "upstream_4xx",
					errorCode: "invalid_api_key",
				}),
			);
		});
	});

	it("logs nested fetch causes as structured moderation errors", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		const loggerErrorSpy = vi
			.spyOn(logger, "error")
			.mockImplementation(() => {});

		vi.spyOn(logger, "warn").mockImplementation(() => {});
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			new TypeError("fetch failed", {
				cause: Object.assign(new Error("connect ETIMEDOUT 10.0.0.1:443"), {
					code: "ETIMEDOUT",
				}),
			}),
		);

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: "hello",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result).toEqual({
			flagged: false,
			model: "omni-moderation-latest",
			upstreamRequestId: null,
			results: [],
			responses: [],
			errors: expect.any(Array),
		});
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			"gateway_content_filter_error",
			expect.objectContaining({
				mode: "openai",
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
				inputType: "text",
				timeout: false,
				error: "fetch failed",
				errorName: "TypeError",
				errorCause: "Error: connect ETIMEDOUT 10.0.0.1:443 (code: ETIMEDOUT)",
				errorCode: "ETIMEDOUT",
			}),
			expect.any(TypeError),
		);
	});

	it("logs non-error throwables with a fallback error payload", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		const loggerErrorSpy = vi
			.spyOn(logger, "error")
			.mockImplementation(() => {});

		vi.spyOn(globalThis, "fetch").mockRejectedValue("moderation exploded");

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: "hello",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result).toEqual({
			flagged: false,
			model: "omni-moderation-latest",
			upstreamRequestId: null,
			results: [],
			responses: [],
			errors: expect.any(Array),
		});
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			"gateway_content_filter_error",
			expect.objectContaining({
				mode: "openai",
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
				inputType: "text",
				timeout: false,
				error: "moderation exploded",
				errorName: "string",
			}),
		);
	});

	it("returns undefined errorCode for circular cause chains", async () => {
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
		const loggerErrorSpy = vi
			.spyOn(logger, "error")
			.mockImplementation(() => {});
		vi.spyOn(logger, "warn").mockImplementation(() => {});
		const error = Object.assign(new TypeError("fetch failed"), {
			cause: undefined as unknown,
		});
		error.cause = error;

		vi.spyOn(globalThis, "fetch").mockRejectedValue(error);

		await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: "hello",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		const [eventName, payload, loggedError] = loggerErrorSpy.mock.calls[0]!;
		expect(eventName).toBe("gateway_content_filter_error");
		expect(payload).toEqual(
			expect.objectContaining({
				mode: "openai",
				error: "fetch failed",
				errorName: "TypeError",
			}),
		);
		expect(payload).not.toHaveProperty("errorCode");
		expect(loggedError).toBe(error);
	});

	it("logs missing moderation credentials through the shared logger", async () => {
		delete process.env.LLM_OPENAI_API_KEY;
		const loggerErrorSpy = vi
			.spyOn(logger, "error")
			.mockImplementation(() => {});

		const result = await checkOpenAIContentFilter(
			[
				{
					role: "user",
					content: "hello",
				},
			],
			{
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
			},
		);

		expect(result).toEqual({
			flagged: false,
			model: "omni-moderation-latest",
			upstreamRequestId: null,
			results: [],
			responses: [],
			errors: expect.any(Array),
		});
		expect(loggerErrorSpy).toHaveBeenCalledWith(
			"gateway_content_filter_error",
			expect.objectContaining({
				mode: "openai",
				requestId: "request-id",
				organizationId: "org-id",
				projectId: "project-id",
				apiKeyId: "api-key-id",
				timeout: false,
				error: expect.stringContaining("openai"),
				errorName: "Error",
			}),
			expect.any(Error),
		);
	});
});

describe("moderation throughput", () => {
	const CONTEXT = {
		requestId: "request-id",
		organizationId: "org-throughput",
		projectId: "project-id",
		apiKeyId: "api-key-id",
	};
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;
	type ProviderKeyRow = InferSelectModel<typeof providerKey>;

	function managedKey(id: string): ProviderKeyRow {
		return {
			id,
			provider: "openai",
			organizationId: null,
			config: null,
			...encryptProviderKeyForStorage(`token-${id}`, id, null),
		} as ProviderKeyRow;
	}

	function moderationResponse(
		scores: Record<string, number>[],
		requestId = "req-upstream",
	) {
		return new Response(
			JSON.stringify({
				id: "modr",
				model: "omni-moderation-latest",
				results: scores.map((category_scores) => ({
					flagged: false,
					categories: {},
					category_scores,
				})),
			}),
			{
				status: 200,
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
				},
			},
		);
	}

	function rateLimited(headers: Record<string, string> = {}) {
		return new Response(
			JSON.stringify({
				error: { code: "rate_limit_exceeded", message: "Rate limit reached" },
			}),
			{
				status: 429,
				headers: { "Content-Type": "application/json", ...headers },
			},
		);
	}

	function bearer(init: RequestInit | undefined): string | undefined {
		return new Headers(init?.headers).get("authorization") ?? undefined;
	}

	function bodyInput(init: RequestInit | undefined): string[] {
		return (JSON.parse(String(init?.body)) as { input: string[] }).input;
	}

	beforeEach(async () => {
		await redisClient.flushdb();
		resetContentFilterCredentialCooldowns();
		vi.mocked(findManagedProviderKey).mockClear();
		process.env.LLM_OPENAI_API_KEY = "sk-openai-test";
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.mocked(hasManagedProviderCredential).mockImplementation(
			async () => false,
		);
		vi.mocked(findManagedProviderKey).mockImplementation(async () => undefined);
		if (originalOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
		} else {
			process.env.LLM_OPENAI_API_KEY = originalOpenAIKey;
		}
	});

	describe("429 retries", () => {
		it("retries a 429 on another managed key and succeeds", async () => {
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			vi.mocked(hasManagedProviderCredential).mockResolvedValue(true);
			vi.mocked(findManagedProviderKey).mockImplementation(
				async (_provider, options) =>
					options?.excludedKeyIds?.has("key-a")
						? managedKey("key-b")
						: managedKey("key-a"),
			);
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async (_input, init) =>
					bearer(init) === "Bearer token-key-a"
						? rateLimited({ "retry-after-ms": "30000" })
						: moderationResponse([{ violence: 0.1 }]),
				);

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "retry me elsewhere" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(2);
			expect(bearer(fetchSpy.mock.calls[1]![1]) === "Bearer token-key-b").toBe(
				true,
			);
			expect(result.errors).toEqual([]);
			expect(result.results).toHaveLength(1);
			expect(errorSpy).not.toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith(
				"gateway_content_filter_error",
				expect.objectContaining({
					status: 429,
					attempt: 1,
					retrying: true,
					switchingCredential: true,
				}),
			);
			expect(
				vi
					.mocked(findManagedProviderKey)
					.mock.calls.every(([, options]) => options?.rotateEveryCall),
			).toBe(true);
		});

		it("prefers another key while one is cooling down after a 429", async () => {
			vi.spyOn(logger, "warn").mockImplementation(() => {});
			vi.mocked(hasManagedProviderCredential).mockResolvedValue(true);
			vi.mocked(findManagedProviderKey).mockImplementation(
				async (_provider, options) =>
					options?.excludedKeyIds?.has("key-a")
						? managedKey("key-b")
						: managedKey("key-a"),
			);
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementationOnce(async () => rateLimited())
				.mockImplementation(async () => moderationResponse([{}]));

			await checkOpenAIContentFilter(
				[{ role: "user", content: "first call" }],
				CONTEXT,
			);
			await checkOpenAIContentFilter(
				[{ role: "user", content: "second call" }],
				CONTEXT,
			);

			expect(
				fetchSpy.mock.calls.map(
					([, init]) => bearer(init) === "Bearer token-key-b",
				),
			).toEqual([false, true, true]);
		});

		it("backs off on the only key within budget, then fails open", async () => {
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async () => rateLimited({ "retry-after-ms": "5" }));
			const startedAt = Date.now();

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "no other key" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(3);
			expect(Date.now() - startedAt).toBeLessThan(2_000);
			expect(result.flagged).toBe(false);
			expect(result.results).toEqual([]);
			expect(result.errors).toEqual([
				expect.objectContaining({
					kind: "upstream_4xx",
					status: 429,
					code: "rate_limit_exceeded",
				}),
			]);
			expect(errorSpy).not.toHaveBeenCalled();
			expect(
				warnSpy.mock.calls
					.filter(([event]) => event === "gateway_content_filter_error")
					.map(([, payload]) => {
						const { attempt, retrying, switchingCredential } =
							payload as Record<string, unknown>;
						return { attempt, retrying, switchingCredential };
					}),
			).toEqual([
				{ attempt: 1, retrying: true, switchingCredential: false },
				{ attempt: 2, retrying: true, switchingCredential: false },
				{ attempt: 3, retrying: false, switchingCredential: undefined },
			]);
		});

		it("still retries a 5xx from the key it switched to", async () => {
			vi.spyOn(logger, "warn").mockImplementation(() => {});
			vi.spyOn(logger, "error").mockImplementation(() => {});
			vi.mocked(hasManagedProviderCredential).mockResolvedValue(true);
			vi.mocked(findManagedProviderKey).mockImplementation(
				async (_provider, options) =>
					options?.excludedKeyIds?.has("key-a")
						? managedKey("key-b")
						: managedKey("key-a"),
			);
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementationOnce(async () => rateLimited())
				.mockImplementationOnce(
					async () => new Response("unavailable", { status: 503 }),
				)
				.mockImplementation(async () => moderationResponse([{}]));

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "switch then 503" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(3);
			expect(result.errors).toEqual([]);
		});

		it("waits out a key's own retry-after when the retry lands back on it", async () => {
			vi.spyOn(logger, "warn").mockImplementation(() => {});
			vi.mocked(hasManagedProviderCredential).mockResolvedValue(true);
			// Key B is the only other key and also answers 429, so the third
			// attempt could only go back to key A, which asked for 30 s.
			vi.mocked(findManagedProviderKey).mockImplementation(
				async (_provider, options) => {
					const excluded = options?.excludedKeyIds ?? new Set();
					if (!excluded.has("key-a")) {
						return managedKey("key-a");
					}
					return excluded.has("key-b") ? undefined : managedKey("key-b");
				},
			);
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async (_input, init) =>
					rateLimited(
						bearer(init) === "Bearer token-key-a"
							? { "retry-after": "30" }
							: {},
					),
				);

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "both keys limited" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(2);
			expect(result.errors).toEqual([
				expect.objectContaining({ kind: "upstream_4xx", status: 429 }),
			]);
		});

		it("fails open at once when retry-after outlasts the retry cap", async () => {
			vi.spyOn(logger, "warn").mockImplementation(() => {});
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async () => rateLimited({ "retry-after": "30" }));

			const result = await checkOpenAIContentFilter(
				[{ role: "user", content: "slow down" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(result.errors).toEqual([
				expect.objectContaining({ kind: "upstream_4xx", status: 429 }),
			]);
		});
	});

	describe("per-chunk cache", () => {
		const LONG_TEXT = ["alpha", "bravo", "charlie"]
			.map((word) => `${word} `.repeat(600))
			.join("");
		const LONG_MESSAGES = [{ role: "user" as const, content: LONG_TEXT }];

		async function cacheKeys(): Promise<string[]> {
			return await redisClient.keys("content-filter-moderation:*");
		}

		it("serves a repeated prompt from the cache without calling upstream", async () => {
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async () =>
					moderationResponse([{ violence: 0.9 }]),
				);
			const first = await checkOpenAIContentFilter(
				[{ role: "user", content: "cache me" }],
				CONTEXT,
			);
			await vi.waitFor(async () => expect(await cacheKeys()).toHaveLength(1));

			const second = await checkOpenAIContentFilter(
				[{ role: "user", content: "cache me" }],
				CONTEXT,
			);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(first.flagged).toBe(true);
			expect(second.flagged).toBe(true);
			expect(second.upstreamRequestId).toBeNull();
			expect(second.results).toEqual(first.results);
			expect(second.responses).toEqual([
				expect.objectContaining({ cached: true, results: first.results }),
			]);
			expect(second.errors).toEqual([]);
			const [key] = await cacheKeys();
			const ttl = await redisClient.ttl(key!);
			expect(ttl > 0 && ttl <= MODERATION_CACHE_TTL_SECONDS).toBe(true);
		});

		it("sends only the misses upstream and keeps chunk order", async () => {
			const chunks = buildOpenAIContentFilterTextChunks(
				LONG_MESSAGES,
				"latest_turn",
			);
			expect(chunks).toHaveLength(3);
			await redisClient.set(
				moderationCacheKey(
					CONTEXT.organizationId,
					"omni-moderation-latest",
					chunks[1]!,
				),
				JSON.stringify({ flagged: true, category_scores: { marker: 1 } }),
			);
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async () =>
					moderationResponse([{ marker: 0 }, { marker: 2 }]),
				);

			const result = await checkOpenAIContentFilter(LONG_MESSAGES, CONTEXT);

			expect(fetchSpy).toHaveBeenCalledTimes(1);
			expect(bodyInput(fetchSpy.mock.calls[0]![1])).toEqual([
				chunks[0],
				chunks[2],
			]);
			expect(result.results.map((r) => r.category_scores?.marker)).toEqual([
				0, 1, 2,
			]);
			expect(result.flagged).toBe(true);
			expect(result.upstreamRequestId).toBe("req-upstream");
			await vi.waitFor(async () => expect(await cacheKeys()).toHaveLength(3));
		});

		it("keeps a cached violation when the misses run out of time", async () => {
			vi.spyOn(logger, "error").mockImplementation(() => {});
			const chunks = buildOpenAIContentFilterTextChunks(
				LONG_MESSAGES,
				"latest_turn",
			);
			await redisClient.set(
				moderationCacheKey(
					CONTEXT.organizationId,
					"omni-moderation-latest",
					chunks[1]!,
				),
				JSON.stringify({ category_scores: { violence: 0.99 } }),
			);
			vi.spyOn(globalThis, "fetch").mockRejectedValue(
				new DOMException("signal timed out", "TimeoutError"),
			);

			const result = await checkOpenAIContentFilter(LONG_MESSAGES, CONTEXT);

			expect(result.flagged).toBe(true);
			expect(result.results).toHaveLength(1);
			expect(result.errors).toEqual([
				expect.objectContaining({ kind: "timeout", inputType: "text" }),
			]);
		});

		it("rethrows a caller abort even when every chunk hits the cache", async () => {
			await redisClient.set(
				moderationCacheKey(
					CONTEXT.organizationId,
					"omni-moderation-latest",
					"user: all cached",
				),
				JSON.stringify({ category_scores: {} }),
			);
			const fetchSpy = vi.spyOn(globalThis, "fetch");
			const controller = new AbortController();
			const abortError = new DOMException("aborted", "AbortError");
			controller.abort(abortError);

			await expect(
				checkOpenAIContentFilter(
					[{ role: "user", content: "all cached" }],
					CONTEXT,
					controller.signal,
				),
			).rejects.toBe(abortError);
			expect(fetchSpy).not.toHaveBeenCalled();
		});

		it("never caches a failed call", async () => {
			vi.spyOn(logger, "warn").mockImplementation(() => {});
			vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
				rateLimited({ "retry-after": "30" }),
			);

			await checkOpenAIContentFilter(
				[{ role: "user", content: "failing" }],
				CONTEXT,
			);

			expect(await cacheKeys()).toEqual([]);
		});

		it("moderates every chunk when the cache errors", async () => {
			const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
			vi.spyOn(redisClient, "mget").mockRejectedValue(new Error("cache down"));
			const fetchSpy = vi
				.spyOn(globalThis, "fetch")
				.mockImplementation(async () => moderationResponse([{}, {}, {}]));

			const result = await checkOpenAIContentFilter(LONG_MESSAGES, CONTEXT);

			expect(bodyInput(fetchSpy.mock.calls[0]![1])).toHaveLength(3);
			expect(result.results).toHaveLength(3);
			expect(result.errors).toEqual([]);
			expect(warnSpy).toHaveBeenCalledWith(
				"Moderation cache unavailable; moderating every chunk",
				expect.objectContaining({ error: expect.any(Error) }),
			);
		});

		it("keys by organization and stores no plaintext", async () => {
			const text = "a distinctive prompt to moderate";
			const key = moderationCacheKey("org-a", "omni-moderation-latest", text);
			expect(key.startsWith("content-filter-moderation:v1:")).toBe(true);
			expect(key.includes("distinctive")).toBe(false);
			expect(
				moderationCacheKey("org-b", "omni-moderation-latest", text) === key,
			).toBe(false);
			expect(
				moderationCacheKey("org-a", "omni-moderation-latest", text) === key,
			).toBe(true);

			vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
				moderationResponse([{ violence: 0.2 }]),
			);
			await checkOpenAIContentFilter([{ role: "user", content: text }], {
				...CONTEXT,
				organizationId: "org-a",
			});
			await vi.waitFor(async () => expect(await cacheKeys()).toHaveLength(1));
			const [storedKey] = await cacheKeys();
			const stored = await redisClient.get(storedKey!);
			expect(stored?.includes("distinctive")).toBe(false);
			expect(Object.keys(JSON.parse(stored!) as object).sort()).toEqual([
				"categories",
				"category_scores",
				"flagged",
			]);
			expect(
				(
					await checkOpenAIContentFilter([{ role: "user", content: text }], {
						...CONTEXT,
						organizationId: "org-b",
					})
				).upstreamRequestId,
			).toBe("req-upstream");
		});
	});
});
