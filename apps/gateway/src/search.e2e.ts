import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	searchModels,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";
import { waitForLogByRequestId } from "./test-utils/test-helpers.js";

describe("e2e search", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(searchModels)(
		"search $model",
		getTestOptions(),
		async ({ model, provider }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/search", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					query: ["capital of France", "capital of Spain"],
					max_results: 3,
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("search response:", JSON.stringify(json, null, 2));
			}

			expect(res.status).toBe(200);
			expect(json.model).toBe(model);
			expect(Array.isArray(json.results)).toBe(true);
			expect(json.results.length).toBeGreaterThan(0);
			expect(typeof json.results[0].url).toBe("string");
			expect(typeof json.results[0].title).toBe("string");

			const log = await waitForLogByRequestId(requestId);
			expect(log.hasError).toBe(false);
			expect(log.apiOrigin).toBe("search");
			expect(log.requestCost).toBe(Number(provider.requestPrice));
			expect(log.cost).toBe(Number(provider.requestPrice));
		},
	);
});
