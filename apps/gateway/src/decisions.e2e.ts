import "dotenv/config";
import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import {
	beforeAllHook,
	beforeEachHook,
	decisionModels,
	generateTestRequestId,
	getConcurrentTestOptions,
	getTestOptions,
	logMode,
	validateLogByRequestId,
} from "@/chat-helpers.e2e.js";

import { app } from "./app.js";

describe("e2e decisions", getConcurrentTestOptions(), () => {
	beforeAll(beforeAllHook);
	beforeEach(beforeEachHook);

	test("empty", () => {
		expect(true).toBe(true);
	});

	test.each(decisionModels)(
		"decisions $model",
		getTestOptions(),
		async ({ model }) => {
			const requestId = generateTestRequestId();
			const res = await app.request("/v1/decisions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-request-id": requestId,
					"x-no-fallback": "true",
					Authorization: `Bearer real-token`,
				},
				body: JSON.stringify({
					model,
					input:
						"Our production checkout has returned 500 errors for every customer since 09:00.",
					questions: [
						{
							type: "predicate",
							name: "is_outage",
							instructions: "Does this describe a production outage?",
						},
						{
							type: "choice",
							name: "team",
							instructions: "Which team should handle this?",
							choices: [
								{ value: "billing", description: "Charges and refunds" },
								{ value: "engineering", description: "Bugs and outages" },
							],
						},
						{
							type: "score",
							name: "severity",
							instructions: "How severe is this issue?",
							levels: [
								{ label: "Cosmetic" },
								{ label: "Minor" },
								{ label: "Critical" },
							],
						},
					],
				}),
			});

			const json = await res.json();
			if (logMode) {
				console.log("decisions response:", JSON.stringify(json, null, 2));
			}

			expect(res.status, JSON.stringify(json)).toBe(200);
			expect(Array.isArray(json.answers)).toBe(true);
			expect(json.answers).toHaveLength(3);

			const [outage, team, severity] = json.answers;
			// A model may decline a single question; every other answer must
			// still be well-formed.
			if (outage.type !== "refusal") {
				expect(outage).toMatchObject({ type: "predicate", name: "is_outage" });
				expect(outage.probability).toBeGreaterThanOrEqual(0);
				expect(outage.probability).toBeLessThanOrEqual(1);
			}
			if (team.type !== "refusal") {
				expect(team).toMatchObject({ type: "choice", name: "team" });
				expect(["billing", "engineering"]).toContain(team.choice);
				expect(team.probabilities).toHaveLength(2);
			}
			if (severity.type !== "refusal") {
				expect(severity).toMatchObject({ type: "score", name: "severity" });
				expect(severity.score).toBeGreaterThanOrEqual(0);
				expect(severity.score).toBeLessThanOrEqual(2);
				expect(severity.probabilities).toHaveLength(3);
			}

			expect(json.usage.input_tokens).toBeGreaterThan(0);

			const log = await validateLogByRequestId(requestId);
			expect(log.apiOrigin).toBe("decisions");
			expect(Number(log.cost)).toBeGreaterThan(0);
		},
	);
});
