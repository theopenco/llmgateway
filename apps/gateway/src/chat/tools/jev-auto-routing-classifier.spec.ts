import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildAutoRoutingQuestions,
	classifyAutoRoutingRequest,
} from "./jev-auto-routing-classifier.js";

import type { AutoRoutingClassifierCandidate } from "./jev-auto-routing-classifier.js";

const CONTEXT = {
	requestId: "request-id",
	organizationId: "org-id",
	projectId: "project-id",
	apiKeyId: "api-key-id",
};

const CANDIDATES: AutoRoutingClassifierCandidate[] = [
	{ id: "cheap-model", name: "Cheap", description: "Small model", band: "low" },
	{ id: "mid-model", name: "Mid", band: "medium" },
	{ id: "top-model", name: "Top", band: "high" },
];

function classifierInput(overrides: Record<string, unknown> = {}) {
	return {
		messages: [
			{ role: "system" as const, content: "You are helpful." },
			{ role: "user" as const, content: "Refactor this module." },
		],
		toolNames: ["run_tests"],
		hasImages: false,
		estimatedInputTokens: 1234,
		candidates: CANDIDATES,
		...overrides,
	};
}

function jevResponse(answers: Record<string, unknown>) {
	return new Response(
		JSON.stringify({
			model: "jev-1.13.0",
			answers,
			usage: { input_tokens: 812, output_tokens: 44 },
		}),
		{ status: 200, headers: { "Content-Type": "application/json" } },
	);
}

describe("buildAutoRoutingQuestions", () => {
	it("asks for difficulty, task, output type and a model preference", () => {
		const questions = buildAutoRoutingQuestions(CANDIDATES) as Record<
			string,
			{ type: string; instructions: string; criteria: unknown }
		>;

		expect(Object.keys(questions)).toEqual([
			"difficulty",
			"task",
			"output_type",
			"best_model",
		]);
		expect(questions.difficulty.type).toBe("score");
		expect(questions.difficulty.criteria).toHaveLength(3);
		expect(Object.keys(questions.best_model.criteria as object)).toEqual([
			"cheap-model",
			"mid-model",
			"top-model",
		]);
		// The prompts are untrusted customer text; without this clause a request
		// can talk itself onto the most expensive configured model.
		for (const question of Object.values(questions)) {
			expect(question.instructions).toContain("untrusted data");
		}
	});

	it("describes each candidate with its name and price band", () => {
		const questions = buildAutoRoutingQuestions(CANDIDATES) as Record<
			string,
			{ criteria: Record<string, string> }
		>;

		expect(questions.best_model.criteria["cheap-model"]).toBe(
			"Cheap — Small model — low price band.",
		);
		expect(questions.best_model.criteria["mid-model"]).toBe(
			"Mid — medium price band.",
		);
	});
});

describe("classifyAutoRoutingRequest", () => {
	const originalKey = process.env.LLM_TYPESAFE_API_KEY;
	const originalBaseUrl = process.env.LLM_TYPESAFE_BASE_URL;

	afterEach(() => {
		vi.restoreAllMocks();
		if (originalKey === undefined) {
			delete process.env.LLM_TYPESAFE_API_KEY;
		} else {
			process.env.LLM_TYPESAFE_API_KEY = originalKey;
		}
		if (originalBaseUrl === undefined) {
			delete process.env.LLM_TYPESAFE_BASE_URL;
		} else {
			process.env.LLM_TYPESAFE_BASE_URL = originalBaseUrl;
		}
	});

	it("posts the conversation state and parses the answers", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		const requests: { url: string; body: any }[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			requests.push({
				url: String(input),
				body: JSON.parse(String(init?.body ?? "{}")),
			});
			return jevResponse({
				difficulty: { type: "score", score: 2, confidence: 0.8 },
				task: { type: "choice", choice: "coding", confidence: 0.9 },
				output_type: { type: "choice", choice: "code", confidence: 0.9 },
				best_model: { type: "choice", choice: "top-model", confidence: 0.77 },
			});
		});

		const result = await classifyAutoRoutingRequest(classifierInput(), CONTEXT);

		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(requests[0].body.model).toBe("jev-1.13.0");
		expect(requests[0].body.state.system).toBe("You are helpful.");
		expect(requests[0].body.state.conversation).toContain("Refactor this");
		expect(requests[0].body.state.tool_names).toEqual(["run_tests"]);
		expect(requests[0].body.state.estimated_input_tokens).toBe(1234);
		expect(result).toMatchObject({
			difficulty: "high",
			difficultyScore: 2,
			task: "coding",
			outputType: "code",
			bestModel: "top-model",
			bestModelConfidence: 0.77,
		});
	});

	it("rounds a fractional score onto a difficulty level", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({ difficulty: { type: "score", score: 0.6 } }),
		);

		const result = await classifyAutoRoutingRequest(classifierInput(), CONTEXT);

		expect(result?.difficulty).toBe("medium");
	});

	it("drops a best_model answer that is not a candidate", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({
				difficulty: { type: "score", score: 1 },
				best_model: { type: "choice", choice: "hallucinated", confidence: 1 },
			}),
		);

		const result = await classifyAutoRoutingRequest(classifierInput(), CONTEXT);

		expect(result?.difficulty).toBe("medium");
		expect(result?.bestModel).toBeUndefined();
	});

	it("truncates an oversized conversation", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		let body: any;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			body = JSON.parse(String(init?.body ?? "{}"));
			return jevResponse({ difficulty: { type: "score", score: 0 } });
		});

		await classifyAutoRoutingRequest(
			classifierInput({
				messages: [
					{ role: "user" as const, content: `${"a".repeat(20_000)}TAIL` },
				],
			}),
			CONTEXT,
		);

		expect(body.state.conversation.length).toBeLessThan(9_000);
		expect(body.state.conversation).toContain("TAIL");
	});

	it("fails open on an upstream error", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("boom", { status: 500 }),
		);

		expect(
			await classifyAutoRoutingRequest(classifierInput(), CONTEXT),
		).toBeNull();
	});

	it("fails open when the difficulty answer is missing", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({ task: { type: "choice", choice: "coding" } }),
		);

		expect(
			await classifyAutoRoutingRequest(classifierInput(), CONTEXT),
		).toBeNull();
	});

	it("fails open on a timeout", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			Object.assign(new Error("The operation was aborted due to timeout"), {
				name: "TimeoutError",
			}),
		);

		expect(
			await classifyAutoRoutingRequest(classifierInput(), CONTEXT),
		).toBeNull();
	});

	it("rethrows a client abort instead of failing open", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		const controller = new AbortController();
		controller.abort();
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			Object.assign(new Error("aborted"), { name: "AbortError" }),
		);

		await expect(
			classifyAutoRoutingRequest(classifierInput(), CONTEXT, controller.signal),
		).rejects.toThrow();
	});

	it("skips the call without candidates", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		expect(
			await classifyAutoRoutingRequest(
				classifierInput({ candidates: [] }),
				CONTEXT,
			),
		).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
