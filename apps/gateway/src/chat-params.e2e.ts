import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/app.js";
import {
	beforeAllHook,
	beforeEachHook,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	testModels,
	validateLogByRequestId,
	validateResponse,
} from "@/chat-helpers.e2e.js";

// Use all testModels - filter via TEST_MODELS env var for specific providers
const paramTestModels = testModels;

console.log(
	`Testing ${paramTestModels.length} model configurations for parameter support`,
);

// Parameter test configurations
// Each entry defines a parameter name and its test value(s)
const parameterTests: Array<{
	name: string;
	params: Record<string, unknown>;
}> = [
	{ name: "temperature", params: { temperature: 0.5 } },
	{ name: "max_tokens", params: { max_tokens: 100 } },
	{ name: "top_p", params: { top_p: 0.9 } },
	{ name: "frequency_penalty", params: { frequency_penalty: 0.5 } },
	{ name: "presence_penalty", params: { presence_penalty: 0.5 } },
	{ name: "temperature + top_p", params: { temperature: 0.7, top_p: 0.9 } },
];

// Generate test cases: combine each parameter config with each model
const paramModelTestCases = parameterTests.flatMap((paramConfig) =>
	paramTestModels.map((modelConfig) => ({
		...modelConfig,
		paramName: paramConfig.name,
		params: paramConfig.params,
	})),
);

describe("e2e params", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	if (process.env.RUN_PARAM_TESTS === "true") {
		// Test all parameter combinations with all models
		test.each(paramModelTestCases)(
			"$paramName $model",
			getTestOptions(),
			async ({ model, paramName, params }) => {
				const requestId = generateTestRequestId();
				const res = await app.request("/v1/chat/completions", {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"x-request-id": requestId,
						Authorization: `Bearer real-token`,
					},
					body: JSON.stringify({
						model: model,
						messages: [
							{
								role: "user",
								content: "Say 'OK'",
							},
						],
						...params,
					}),
				});

				const json = await res.json();
				if (logMode) {
					console.log(
						`${paramName} response for ${model}:`,
						JSON.stringify(json, null, 2),
					);
				}

				expect(res.status).toBe(200);
				validateResponse(json);
				await validateLogByRequestId(requestId);
			},
		);
	}
});
