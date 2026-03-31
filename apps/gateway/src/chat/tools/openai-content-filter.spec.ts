import { afterEach, describe, expect, it, vi } from "vitest";

import { logger } from "@llmgateway/logger";

import {
	buildOpenAIContentFilterImageInputs,
	buildOpenAIContentFilterTextInput,
	checkOpenAIContentFilter,
} from "./openai-content-filter.js";

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

	it("ignores upstream flagged when category scores stay at or below 0.8", async () => {
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
								violence: 0.8,
								"violence/graphic": 0.79,
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

	it("flags when any category score is higher than 0.8", async () => {
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
								violence: 0.81,
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
