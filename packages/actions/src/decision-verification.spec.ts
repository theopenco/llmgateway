import { describe, expect, it, vi } from "vitest";

import {
	createQueuedModelVerificationChecks,
	runProviderKeySmokeTest,
	runProviderModelVerification,
} from "./model-verification.js";

import type { ProviderModelVerificationTarget } from "@llmgateway/db";

const target: ProviderModelVerificationTarget = {
	providerId: "acme-decide",
	modelName: "acme-decide-1",
	externalId: "acme-decide-upstream",
	decisions: true,
	streaming: false,
	vision: false,
	audio: false,
	tools: false,
	jsonOutput: false,
	jsonOutputSchema: false,
	reasoning: false,
	reasoningMaxTokens: false,
	reasoningEfforts: null,
	webSearch: false,
	contextSize: 8000,
};

interface DecisionQuestion {
	type: "predicate" | "choice" | "score";
	name: string;
	choices?: { value: string }[];
	levels?: { label: string }[];
}

/** A well-behaved OpenAI-compatible `/v1/decisions` answer. */
function answerFor(question: DecisionQuestion) {
	switch (question.type) {
		case "predicate":
			return { type: "predicate", name: question.name, probability: 0.9 };
		case "choice":
			return {
				type: "choice",
				name: question.name,
				choice: question.choices![1].value,
				probabilities: question.choices!.map((choice, index) => ({
					value: choice.value,
					probability: index === 1 ? 0.8 : 0.2,
				})),
			};
		case "score":
			return {
				type: "score",
				name: question.name,
				score: 1.8,
				probabilities: question.levels!.map((level, index) => ({
					value: index,
					label: level.label,
					probability: index === 2 ? 0.8 : 0.1,
				})),
			};
	}
}

function decisionsUpstream(
	transform: (
		body: Record<string, unknown>,
		request: { questions: DecisionQuestion[] },
	) => Response = (body) => Response.json(body),
) {
	return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
		const request = JSON.parse(String(init?.body)) as {
			questions: DecisionQuestion[];
		};
		return transform(
			{
				model: "acme-decide-upstream",
				answers: request.questions.map(answerFor),
				usage: { input_tokens: 120, output_tokens: 0, total_tokens: 120 },
			},
			request,
		);
	});
}

describe("decision listing verification", () => {
	it("queues the decision checks instead of chat checks", () => {
		expect(createQueuedModelVerificationChecks(target)).toEqual([
			{ id: "basic", label: "Typed decisions", status: "queued" },
		]);
		expect(
			createQueuedModelVerificationChecks({ ...target, vision: true }).map(
				(check) => check.id,
			),
		).toEqual(["basic", "vision"]);
	});

	it("probes every question type on the carrier's /v1/decisions", async () => {
		const fetchImplementation = decisionsUpstream();
		const result = await runProviderModelVerification({
			target: { ...target, vision: true },
			token: "carrier-key",
			baseUrl: "https://api.acme-decide.ai/",
			fetchImplementation,
		});

		expect(result.passed).toBe(true);
		expect(result.checks.map((check) => check.status)).toEqual([
			"passed",
			"passed",
		]);
		expect(result.checks[0].probes?.map((probe) => probe.label)).toEqual([
			"predicate",
			"choice",
			"score",
		]);
		expect(fetchImplementation).toHaveBeenCalledTimes(4);
		const [url, init] = fetchImplementation.mock.calls[0];
		expect(url).toBe("https://api.acme-decide.ai/v1/decisions");
		expect(new Headers(init?.headers).get("authorization")).toBe(
			"Bearer carrier-key",
		);
		const sent = JSON.parse(String(init?.body));
		expect(sent).toMatchObject({
			model: "acme-decide-upstream",
			questions: [{ type: "predicate", name: "is_outage" }],
		});
		const visionRequest = JSON.parse(
			String(fetchImplementation.mock.calls[3][1]?.body),
		);
		expect(visionRequest.input[0].content[1]).toMatchObject({
			type: "input_image",
		});
	});

	it("fails image input when the model ignores the image", async () => {
		const result = await runProviderModelVerification({
			target: { ...target, vision: true },
			token: "carrier-key",
			baseUrl: "https://api.acme-decide.ai",
			fetchImplementation: decisionsUpstream((body, request) =>
				Response.json(
					request.questions[0].name === "is_red"
						? {
								...body,
								answers: [
									{ type: "predicate", name: "is_red", probability: 0.1 },
								],
							}
						: body,
				),
			),
		});

		expect(result.passed).toBe(false);
		expect(result.checks[0].status).toBe("passed");
		expect(result.checks[1]).toMatchObject({
			status: "failed",
			feedback: expect.stringContaining("does not appear to read"),
		});
	});

	it("explains a missing /v1/decisions route and skips the rest", async () => {
		const result = await runProviderModelVerification({
			target: { ...target, vision: true },
			token: "carrier-key",
			baseUrl: "https://api.acme-decide.ai",
			fetchImplementation: decisionsUpstream(() =>
				Response.json({ detail: "Not Found" }, { status: 404 }),
			),
		});

		expect(result.passed).toBe(false);
		expect(result.checks[0]).toMatchObject({
			status: "failed",
			feedback: expect.stringContaining("POST /v1/decisions"),
		});
		expect(result.checks[1]).toMatchObject({ status: "skipped" });
	});

	it.each([
		[
			"missing input token usage",
			(body: Record<string, unknown>) =>
				Response.json({ ...body, usage: undefined }),
			"usage.input_tokens",
		],
		[
			"an answer that does not echo the question name",
			(body: Record<string, unknown>) =>
				Response.json({
					...body,
					answers: (body.answers as Record<string, unknown>[]).map(
						(answer) => ({ ...answer, name: "other" }),
					),
				}),
			"echo the question name",
		],
		[
			"a choice outside the offered values",
			(
				body: Record<string, unknown>,
				request: { questions: DecisionQuestion[] },
			) =>
				Response.json(
					request.questions[0].type === "choice"
						? {
								...body,
								answers: [
									{
										...(body.answers as Record<string, unknown>[])[0],
										choice: "sales",
									},
								],
							}
						: body,
				),
			"not one of the offered values",
		],
		[
			"a refusal",
			(body: Record<string, unknown>) =>
				Response.json({
					...body,
					answers: [{ type: "refusal", name: "is_outage" }],
				}),
			"refused",
		],
	])("fails on %s", async (_label, transform, feedback) => {
		const result = await runProviderModelVerification({
			target,
			token: "carrier-key",
			baseUrl: "https://api.acme-decide.ai",
			fetchImplementation: decisionsUpstream(transform),
		});

		expect(result.passed).toBe(false);
		expect(result.checks[0].feedback).toContain(feedback);
	});

	it("smoke-tests a serving key with one decision", async () => {
		const fetchImplementation = decisionsUpstream();
		await expect(
			runProviderKeySmokeTest({
				target,
				token: "serving-key",
				baseUrl: "https://api.acme-decide.ai",
				fetchImplementation,
			}),
		).resolves.toBeNull();
		expect(fetchImplementation).toHaveBeenCalledTimes(1);

		await expect(
			runProviderKeySmokeTest({
				target,
				token: "serving-key",
				baseUrl: "https://api.acme-decide.ai",
				fetchImplementation: decisionsUpstream(() =>
					Response.json(
						{ error: { message: "bad key serving-key" } },
						{ status: 401 },
					),
				),
			}),
		).resolves.toBe("HTTP 401: bad key [REDACTED_TOKEN]");
	});
});
