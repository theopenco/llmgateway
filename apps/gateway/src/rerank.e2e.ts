import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	rerankModels,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

describe("e2e rerank", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(rerankModels)(
		"rerank $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/rerank", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					query: "What is the capital of France?",
					documents: [
						"Paris is the capital of France.",
						"Berlin is the capital of Germany.",
						"Madrid is the capital of Spain.",
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("rerank response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			expect(Array.isArray(json.results)).toBe(true);
			expect(json.results.length).toBeGreaterThan(0);

			const first = json.results[0];
			expect(first).toHaveProperty("index");
			expect(first).toHaveProperty("relevance_score");
			expect(typeof first.relevance_score).toBe("number");
		},
	);

	test("rerank with top_n", async () => {
		const requestId = generateTestRequestId();
		const model = rerankModels[0]?.model;
		if (!model) {
			return; // skip if no rerank models configured
		}

		const res = await app.request("/v1/rerank", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-request-id": requestId,
				"x-no-fallback": "true",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model,
				query: "What is the capital of France?",
				documents: [
					"Paris is the capital of France.",
					"Berlin is the capital of Germany.",
					"Madrid is the capital of Spain.",
					"London is the capital of the UK.",
					"Rome is the capital of Italy.",
				],
				top_n: 2,
			}),
		});

		const json = await res.json();
		if (logMode) {
			console.log("rerank top_n response:", JSON.stringify(json, null, 2));
		}

		expect(res.status).toBe(200);
		expect(Array.isArray(json.results)).toBe(true);
		// top_n truncates the 5 documents sent above down to exactly 2
		expect(json.results.length).toBe(2);

		// Results should be sorted by relevance_score descending
		for (let i = 1; i < json.results.length; i++) {
			expect(json.results[i].relevance_score).toBeLessThanOrEqual(
				json.results[i - 1].relevance_score,
			);
		}
	});

	test("rerank with return_documents", async () => {
		const requestId = generateTestRequestId();
		const model = rerankModels[0]?.model;
		if (!model) {
			return; // skip if no rerank models configured
		}

		const res = await app.request("/v1/rerank", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-request-id": requestId,
				"x-no-fallback": "true",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model,
				query: "What is the capital of France?",
				documents: [
					"Paris is the capital of France.",
					"Berlin is the capital of Germany.",
				],
				return_documents: true,
			}),
		});

		const json = await res.json();
		if (logMode) {
			console.log(
				"rerank return_documents response:",
				JSON.stringify(json, null, 2),
			);
		}

		expect(res.status).toBe(200);
		expect(Array.isArray(json.results)).toBe(true);
		expect(json.results.length).toBeGreaterThan(0);

		// Each result should include the document text
		for (const result of json.results) {
			expect(result).toHaveProperty("document");
			expect(typeof result.document).toBe("string");
		}
	});

	test("rerank logs the request with the rerank api origin", async () => {
		const requestId = generateTestRequestId();
		const model = rerankModels[0]?.model;
		if (!model) {
			return; // skip if no rerank models configured
		}

		const res = await app.request("/v1/rerank", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-request-id": requestId,
				"x-no-fallback": "true",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model,
				query: "What is the capital of France?",
				documents: [
					"Paris is the capital of France.",
					"Berlin is the capital of Germany.",
				],
			}),
		});

		expect(res.status).toBe(200);

		const log = await waitForLogByRequestId(requestId);
		expect(log).toBeDefined();
		expect(log!.apiOrigin).toBe("rerank");
		expect(log!.usedModel).toBe(model);
		expect(log!.hasError).toBe(false);
		// Cross-encoder rerankers have no output tokens, so only the prompt side
		// is billed and the cost must still be a real (non-estimated) number.
		expect(Number(log!.promptTokens)).toBeGreaterThan(0);
		expect(log!.completionTokens).toBeNull();
		expect(log!.estimatedCost).toBe(false);
		expect(Number(log!.cost)).toBeGreaterThan(0);
		expect(Number(log!.outputCost)).toBe(0);
	});

	test("rerank invalid model returns 400", async () => {
		const requestId = generateTestRequestId();
		const res = await app.request("/v1/rerank", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-request-id": requestId,
				"x-no-fallback": "true",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "invalid-model-name",
				query: "test query",
				documents: ["test document"],
			}),
		});

		expect(res.status).toBe(400);
	});

	test("rerank missing documents returns 400", async () => {
		const requestId = generateTestRequestId();
		const res = await app.request("/v1/rerank", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-request-id": requestId,
				"x-no-fallback": "true",
				Authorization: `Bearer real-token`,
			},
			body: JSON.stringify({
				model: "deepinfra/qwen3-reranker-8b",
				query: "test query",
			}),
		});

		expect(res.status).toBe(400);
	});
});
