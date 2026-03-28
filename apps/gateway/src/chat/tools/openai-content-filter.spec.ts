import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildOpenAIContentFilterInput,
	checkOpenAIContentFilter,
} from "./openai-content-filter.js";

describe("buildOpenAIContentFilterInput", () => {
	it("flattens text-only messages into a single moderation string", () => {
		expect(
			buildOpenAIContentFilterInput([
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

	it("builds multimodal moderation input for image_url content", () => {
		expect(
			buildOpenAIContentFilterInput([
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
		).toEqual([
			{
				type: "text",
				text: "user: What is in this image?",
			},
			{
				type: "image_url",
				image_url: {
					url: "https://example.com/cat.png",
				},
			},
		]);
	});

	it("converts base64 image content into data URLs for moderation", () => {
		expect(
			buildOpenAIContentFilterInput([
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
			{
				type: "image_url",
				image_url: {
					url: "data:image/png;base64,aGVsbG8=",
				},
			},
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
});
