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
	validateLogByRequestId,
	validateResponse,
	verbosityModels,
} from "@/chat-helpers.e2e.js";

const verbosityValues = ["low", "medium", "high"] as const;

// Every model that advertises verbosity support must accept all three verbosity
// levels upstream. Some OpenAI models (e.g. the codex snapshots) only accept
// "medium" and are intentionally NOT flagged verbosity: true, so pinning the
// provider with x-no-fallback here ensures a value the upstream rejects surfaces
// as a 400 instead of silently falling back to a healthy provider.
const verbosityTestCases = verbosityModels.flatMap((modelConfig) =>
	verbosityValues.map((verbosity) => ({
		...modelConfig,
		verbosity,
	})),
);

describe("e2e verbosity", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);

	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(verbosityTestCases)(
		"verbosity $verbosity $model",
		getTestOptions(),
		async ({ model, verbosity }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/chat/completions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
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
					verbosity,
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log(
					`verbosity ${verbosity} response for ${model}:`,
					JSON.stringify(json, null, 2),
				);
			}

			expect(res.status).toBe(200);
			validateResponse(json);
			await validateLogByRequestId(requestId);
		},
	);
});
