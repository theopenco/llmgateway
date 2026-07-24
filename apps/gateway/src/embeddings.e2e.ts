import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	embeddingModels,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";

describe("e2e embeddings", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(embeddingModels)(
		"embeddings $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/embeddings", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					input: "The quick brown fox jumps over the lazy dog.",
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("embeddings response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			expect(json).toHaveProperty("object", "list");
			expect(Array.isArray(json.data)).toBe(true);
			expect(json.data.length).toBeGreaterThan(0);

			const first = json.data[0];
			expect(first).toHaveProperty("object", "embedding");
			expect(first).toHaveProperty("index", 0);
			expect(Array.isArray(first.embedding)).toBe(true);
			expect(first.embedding.length).toBeGreaterThan(0);
			expect(first.embedding.every((v: unknown) => typeof v === "number")).toBe(
				true,
			);

			expect(json).toHaveProperty("usage.prompt_tokens");
			expect(typeof json.usage.prompt_tokens).toBe("number");
			expect(json.usage.prompt_tokens).toBeGreaterThan(0);
		},
	);
});
