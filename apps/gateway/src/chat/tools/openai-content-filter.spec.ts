import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "@llmgateway/logger";

import {
	buildOpenAIContentFilterImageInputs,
	buildOpenAIContentFilterTextInput,
	checkOpenAIContentFilter,
} from "./openai-content-filter.js";

import type * as CachedQueries from "@/lib/cached-queries.js";

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

describe("checkOpenAIContentFilter", () => {
	const originalOpenAIKey = process.env.LLM_OPENAI_API_KEY;
	const originalThreshold =
		process.env.LLM_CONTENT_FILTER_OPENAI_SCORE_THRESHOLD;

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
				input: string | Array<{ image_url?: { url: string } }>;
			};
			requestBodies.push(body);

			if (typeof body.input === "string") {
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

			const imageUrl = body.input[0]?.image_url?.url;
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

		expect(requestBodies).toEqual([
			{
				model: "omni-moderation-latest",
				input: "user: Please inspect these images.",
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
		]);
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
				input: unknown;
			};
			if (typeof body.input === "string") {
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
