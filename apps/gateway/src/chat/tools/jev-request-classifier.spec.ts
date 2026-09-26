import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildClassifierQuestions,
	buildClassifierState,
	classifyRequest,
} from "./jev-request-classifier.js";

import type { RequestClassifierCandidate } from "./jev-request-classifier.js";
import type { ClassifierRequestContext } from "./log-classifier-usage.js";
import type * as LogsModule from "@/lib/logs.js";

const insertLog = vi.hoisted(() => vi.fn(async () => 1));

vi.mock("@/lib/logs.js", async (importOriginal) => ({
	...(await importOriginal<typeof LogsModule>()),
	insertLog,
}));

const CONTEXT = {
	requestId: "request-id",
	project: {
		id: "project-id",
		organizationId: "org-id",
		mode: "credits",
	},
	apiKey: { id: "api-key-id", projectId: "project-id" },
	retentionLevel: "retain",
	requestedModel: "smart",
} as unknown as ClassifierRequestContext;

const CANDIDATES: RequestClassifierCandidate[] = [
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

describe("buildClassifierQuestions", () => {
	it("asks for difficulty, task, output type, a model preference and an effort", () => {
		const questions = buildClassifierQuestions(CANDIDATES) as Record<
			string,
			{ type: string; instructions: string; criteria: unknown }
		>;

		expect(Object.keys(questions)).toEqual([
			"difficulty",
			"task",
			"output_type",
			"best_model",
			"effort",
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

	it("asks how the work changed when rechecking a session", () => {
		const questions = buildClassifierQuestions(CANDIDATES, {
			previous: { difficulty: "high", task: "coding", effort: "high" },
			currentModel: "top-model",
			currentEffort: "high",
		}) as Record<string, { instructions: string; criteria: object }>;

		expect(Object.keys(questions.work_change.criteria)).toEqual([
			"same",
			"easier",
			"harder",
			"different",
			"unclear",
		]);
		expect(questions.work_change.instructions).toContain(
			"high difficulty, a coding task, high reasoning effort",
		);
		expect(questions.work_change.instructions).toContain(
			"A short answer alone does not mean the work became easier.",
		);
		expect(questions.work_change.instructions).toContain("untrusted data");
	});

	it("describes each candidate with its name and price band", () => {
		const questions = buildClassifierQuestions(CANDIDATES) as Record<
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

describe("buildClassifierState", () => {
	it("keeps the newest turns and drops the oldest when over budget", () => {
		const { conversation } = buildClassifierState([
			{ role: "user", content: `OLDEST ${"x".repeat(9_000)}` },
			{ role: "assistant", content: "ok" },
			{ role: "user", content: "NEWEST request" },
		] as any);

		expect(conversation).toContain("NEWEST request");
		expect(conversation.endsWith("NEWEST request")).toBe(true);
		expect(conversation).not.toContain("OLDEST");
	});

	it("keeps only instructions and final answers for a recheck", () => {
		const { conversation } = buildClassifierState(
			[
				{ role: "user", content: "Fix the bug." },
				{
					role: "assistant",
					content: "Reading the file.",
					tool_calls: [
						{
							id: "c1",
							type: "function",
							function: { name: "read", arguments: "{}" },
						},
					],
				},
				{ role: "tool", content: "TOOL OUTPUT", tool_call_id: "c1" },
				{ role: "assistant", content: "Fixed it." },
				{ role: "user", content: "Update the README." },
			] as any,
			{ instructionsAndAnswersOnly: true },
		);

		expect(conversation).toBe(
			"user: Fix the bug.\n\nassistant: Fixed it.\n\nuser: Update the README.",
		);
	});

	it("separates the system prompt from the conversation", () => {
		const { system, conversation } = buildClassifierState([
			{ role: "system", content: "You are an agent." },
			{ role: "user", content: "Refactor this." },
		] as any);

		expect(system).toBe("You are an agent.");
		expect(conversation).toBe("user: Refactor this.");
	});

	it("reads text out of structured content blocks", () => {
		const { conversation } = buildClassifierState([
			{
				role: "user",
				content: [
					{ type: "text", text: "first part" },
					{
						type: "image_url",
						image_url: { url: "https://example.com/a.png" },
					},
					{ type: "text", text: "second part" },
				],
			},
		] as any);

		expect(conversation).toContain("first part");
		expect(conversation).toContain("second part");
	});
});

describe("classifyRequest", () => {
	const originalKey = process.env.LLM_TYPESAFE_API_KEY;
	const originalBaseUrl = process.env.LLM_TYPESAFE_BASE_URL;

	afterEach(() => {
		vi.restoreAllMocks();
		insertLog.mockClear();
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

		const result = await classifyRequest(classifierInput(), CONTEXT);

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

	it("parses the effort and, on a recheck, the work change", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		let body: any;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			body = JSON.parse(String(init?.body ?? "{}"));
			return jevResponse({
				difficulty: { type: "score", score: 0 },
				effort: { type: "choice", choice: "low", confidence: 0.8 },
				work_change: { type: "choice", choice: "easier", confidence: 0.7 },
			});
		});

		const result = await classifyRequest(
			classifierInput({
				recheck: {
					previous: { difficulty: "high" },
					currentModel: "top-model",
					currentEffort: "high",
				},
			}),
			CONTEXT,
		);

		expect(body.state.current_model).toBe("top-model");
		expect(body.state.current_effort).toBe("high");
		expect(result).toMatchObject({
			difficulty: "low",
			effort: "low",
			workChange: "easier",
			workChangeConfidence: 0.7,
		});
	});

	it("ignores a work change it did not ask for", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({
				difficulty: { type: "score", score: 0 },
				effort: { type: "choice", choice: "extreme" },
				work_change: { type: "choice", choice: "easier", confidence: 1 },
			}),
		);

		const result = await classifyRequest(classifierInput(), CONTEXT);

		expect(result?.effort).toBeUndefined();
		expect(result?.workChange).toBeUndefined();
	});

	it("rounds a fractional score onto a difficulty level", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({ difficulty: { type: "score", score: 0.6 } }),
		);

		const result = await classifyRequest(classifierInput(), CONTEXT);

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

		const result = await classifyRequest(classifierInput(), CONTEXT);

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

		await classifyRequest(
			classifierInput({
				messages: [
					{ role: "user" as const, content: `${"a".repeat(20_000)}TAIL` },
				],
			}),
			CONTEXT,
		);

		expect(body.state.conversation.length).toBeLessThan(9_000);
		// The tail survives: the newest content is what is being asked.
		expect(body.state.conversation).toContain("TAIL");
	});

	it("keeps the user's request when an agent preamble dwarfs it", async () => {
		// A coding agent's system prompt and tool preamble run to tens of
		// thousands of characters. Slicing the concatenated transcript kept only
		// that preamble and dropped the request, so every agent session scored
		// the same — on boilerplate rather than on what was asked.
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		let body: any;
		vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
			body = JSON.parse(String(init?.body ?? "{}"));
			return jevResponse({ difficulty: { type: "score", score: 2 } });
		});

		await classifyRequest(
			classifierInput({
				messages: [
					{ role: "system" as const, content: "AGENT_PREAMBLE ".repeat(4_000) },
					{
						role: "user" as const,
						content: "Prove this queue is linearizable.",
					},
				],
			}),
			CONTEXT,
		);

		expect(body.state.conversation).toContain(
			"Prove this queue is linearizable.",
		);
		expect(body.state.conversation).not.toContain("AGENT_PREAMBLE");
		expect(body.state.system).toContain("AGENT_PREAMBLE");
		expect(body.state.system.length).toBeLessThan(1_100);
	});

	it("fails open on an upstream error", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("boom", { status: 500 }),
		);

		expect(await classifyRequest(classifierInput(), CONTEXT)).toBeNull();
	});

	it("fails open when the difficulty answer is missing", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({ task: { type: "choice", choice: "coding" } }),
		);

		expect(await classifyRequest(classifierInput(), CONTEXT)).toBeNull();
	});

	it("fails open on a timeout", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			Object.assign(new Error("The operation was aborted due to timeout"), {
				name: "TimeoutError",
			}),
		);

		expect(await classifyRequest(classifierInput(), CONTEXT)).toBeNull();
	});

	it("rethrows a client abort instead of failing open", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		const controller = new AbortController();
		controller.abort();
		vi.spyOn(globalThis, "fetch").mockRejectedValue(
			Object.assign(new Error("aborted"), { name: "AbortError" }),
		);

		await expect(
			classifyRequest(classifierInput(), CONTEXT, controller.signal),
		).rejects.toThrow();
	});

	it("skips the call without candidates", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		expect(
			await classifyRequest(classifierInput({ candidates: [] }), CONTEXT),
		).toBeNull();
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("bills the classification to the calling org, project and key", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({ difficulty: { type: "score", score: 1 } }),
		);

		const result = await classifyRequest(classifierInput(), CONTEXT);

		// 812 input tokens at $0.042 per million; output is priced at zero.
		const expectedCost = 812 * 0.042e-6;
		expect(result?.cost).toBeCloseTo(expectedCost, 12);
		expect(insertLog).toHaveBeenCalledTimes(1);
		const [row, options] = insertLog.mock.calls[0] as unknown as [
			Record<string, unknown>,
			Record<string, unknown>,
		];
		expect(row).toMatchObject({
			organizationId: "org-id",
			projectId: "project-id",
			apiKeyId: "api-key-id",
			requestId: "request-id",
			requestedModel: "smart",
			usedModel: "typesafe/jev-1.13.0",
			usedProvider: "typesafe",
			// A platform credential served it, so the organization pays credits
			// even for a BYOK project.
			usedMode: "credits",
			promptTokens: "812",
			completionTokens: "44",
			estimatedCost: false,
		});
		expect(row.cost).toBeCloseTo(expectedCost, 12);
		expect(row.outputCost).toBe(0);
		expect(options).toEqual({ retentionLevel: "retain" });
	});

	it("bills nothing when the classifier call fails", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("boom", { status: 500 }),
		);

		expect(await classifyRequest(classifierInput(), CONTEXT)).toBeNull();
		expect(insertLog).not.toHaveBeenCalled();
	});
});
