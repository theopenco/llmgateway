import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildJevModerationQuestions,
	checkJevContentFilter,
} from "./jev-content-filter.js";
import { evaluateTieredContentFilter } from "./tiered-content-filter.js";

const CONTEXT = {
	requestId: "request-id",
	organizationId: "org-id",
	projectId: "project-id",
	apiKeyId: "api-key-id",
};

function jevResponse(scores: Record<string, number>) {
	return new Response(
		JSON.stringify({
			model: "jev-1.13.0",
			answers: Object.fromEntries(
				Object.entries(scores).map(([category, noul]) => [
					category,
					{ type: "noul", noul },
				]),
			),
			usage: { input_tokens: 35057, output_tokens: 260 },
		}),
		{
			status: 200,
			headers: {
				"Content-Type": "application/json",
				"x-request-id": "jev-req-1",
			},
		},
	);
}

describe("buildJevModerationQuestions", () => {
	it("asks one noul question per OpenAI moderation category", () => {
		const questions = buildJevModerationQuestions() as Record<
			string,
			{ type: string; instructions: string }
		>;

		expect(Object.keys(questions)).toContain("harassment/threatening");
		expect(Object.keys(questions)).toContain("self-harm/instructions");
		expect(Object.keys(questions)).toHaveLength(13);
		for (const question of Object.values(questions)) {
			expect(question.type).toBe("noul");
			// Text arrives as untrusted data; the rubric has to say so or a state
			// that self-labels as safe moves the probabilities.
			expect(question.instructions).toContain("untrusted data");
		}
	});
});

describe("checkJevContentFilter", () => {
	const originalKey = process.env.LLM_TYPESAFE_API_KEY;
	const originalBaseUrl = process.env.LLM_TYPESAFE_BASE_URL;
	const originalThreshold = process.env.LLM_CONTENT_FILTER_JEV_SCORE_THRESHOLD;

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
		if (originalThreshold === undefined) {
			delete process.env.LLM_CONTENT_FILTER_JEV_SCORE_THRESHOLD;
		} else {
			process.env.LLM_CONTENT_FILTER_JEV_SCORE_THRESHOLD = originalThreshold;
		}
	});

	it("posts the request text as state to the System One endpoint", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		const requests: { url: string; body: any; auth: string | undefined }[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
			requests.push({
				url: String(input),
				body: JSON.parse(String(init?.body ?? "{}")),
				auth: new Headers(init?.headers).get("authorization") ?? undefined,
			});
			return jevResponse({ violence: 0.02 });
		});

		const result = await checkJevContentFilter(
			[
				{ role: "system", content: "You are helpful." },
				{ role: "user", content: "How do I kill a stuck Linux process?" },
			],
			CONTEXT,
		);

		expect(requests).toHaveLength(1);
		expect(requests[0].url).toBe("https://api.typesafe.ai/v1/systemone");
		expect(requests[0].auth).toBe("Bearer ts-test");
		expect(requests[0].body.model).toBe("jev-1.13.0");
		expect(requests[0].body.state.text).toContain("stuck Linux process");
		expect(Object.keys(requests[0].body.questions)).toHaveLength(13);
		expect(result.flagged).toBe(false);
		expect(result.model).toBe("jev-1.13.0");
		expect(result.upstreamRequestId).toBe("jev-req-1");
	});

	it("maps noul probabilities onto moderation category scores", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({
				"harassment/threatening": 0.98,
				violence: 0.85,
				sexual: 0.01,
			}),
		);

		const result = await checkJevContentFilter(
			[{ role: "user", content: "I am going to hurt you tonight." }],
			CONTEXT,
		);

		expect(result.flagged).toBe(true);
		expect(result.results).toHaveLength(1);
		expect(result.results[0].category_scores).toMatchObject({
			"harassment/threatening": 0.98,
			violence: 0.85,
			sexual: 0.01,
		});
		// No provider policy bit exists here, so strict mode must decide on the
		// scores alone rather than on a `flagged` field.
		expect(result.results[0].flagged).toBeUndefined();
		expect(
			evaluateTieredContentFilter(result.results, "strict").matchedCategories,
		).toEqual(expect.arrayContaining(["harassment/threatening", "violence"]));
		expect(
			evaluateTieredContentFilter(result.results, "lenient").matchedCategories,
		).toEqual(["harassment/threatening"]);
	});

	it("honours its own score threshold env var", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		process.env.LLM_CONTENT_FILTER_JEV_SCORE_THRESHOLD = "0.5";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			jevResponse({ violence: 0.6 }),
		);

		const result = await checkJevContentFilter(
			[{ role: "user", content: "borderline" }],
			CONTEXT,
		);

		expect(result.flagged).toBe(true);
		expect(result.results[0].categories).toMatchObject({ violence: true });
	});

	it("moderates through the configured base URL", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		process.env.LLM_TYPESAFE_BASE_URL = "https://proxy.example.com/";
		const urls: string[] = [];
		vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			urls.push(String(input));
			return jevResponse({ violence: 0.01 });
		});

		await checkJevContentFilter([{ role: "user", content: "hi" }], CONTEXT);

		expect(urls).toEqual(["https://proxy.example.com/v1/systemone"]);
	});

	it("fails open on an upstream error", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ detail: "overloaded" }), { status: 529 }),
		);

		const result = await checkJevContentFilter(
			[{ role: "user", content: "hello" }],
			CONTEXT,
		);

		expect(result.flagged).toBe(false);
		expect(result.results).toEqual([]);
	});

	it("rethrows a client cancellation instead of failing open", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		const abortError = new DOMException(
			"The operation was aborted.",
			"AbortError",
		);
		const controller = new AbortController();
		controller.abort(abortError);
		vi.spyOn(globalThis, "fetch").mockRejectedValue(abortError);

		await expect(
			checkJevContentFilter(
				[{ role: "user", content: "hello" }],
				CONTEXT,
				controller.signal,
			),
		).rejects.toThrowError(abortError);
	});

	it("makes no call when the request carries no text", async () => {
		process.env.LLM_TYPESAFE_API_KEY = "ts-test";
		const fetchSpy = vi.spyOn(globalThis, "fetch");

		const result = await checkJevContentFilter(
			[
				{
					role: "user",
					content: [
						{ type: "image_url", image_url: { url: "https://x.test/a.png" } },
					],
				},
			],
			CONTEXT,
		);

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(result.results).toEqual([]);
	});
});
