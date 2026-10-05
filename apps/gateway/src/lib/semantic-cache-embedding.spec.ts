import { describe, expect, test } from "vitest";

import { semanticCacheText } from "./semantic-cache-embedding.js";

describe("semantic cache text", () => {
	test("embeds recent text turns with roles", () => {
		expect(
			semanticCacheText([
				{ role: "system", content: "Be brief." },
				{
					role: "user",
					content: [{ type: "text", text: "What is LLM routing?" }],
				},
			]),
		).toBe("system: Be brief.\nuser: What is LLM routing?");
	});

	test("skips requests with non-text content", () => {
		expect(
			semanticCacheText([
				{
					role: "user",
					content: [
						{ type: "text", text: "Describe" },
						{
							type: "image_url",
							image_url: { url: "https://example.com/a.png" },
						},
					],
				},
			]),
		).toBe(null);
	});
});
