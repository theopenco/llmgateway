import { afterEach, describe, expect, it, vi } from "vitest";

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

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalOpenAIKey === undefined) {
			delete process.env.LLM_OPENAI_API_KEY;
			return;
		}

		process.env.LLM_OPENAI_API_KEY = originalOpenAIKey;
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
						results: [{ flagged: false, categories: {} }],
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
		expect(result.results.some((entry) => entry.flagged)).toBe(true);
	});
});
