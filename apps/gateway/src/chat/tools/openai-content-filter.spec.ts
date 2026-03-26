import { describe, expect, it } from "vitest";

import { buildOpenAIContentFilterInput } from "./openai-content-filter.js";

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
