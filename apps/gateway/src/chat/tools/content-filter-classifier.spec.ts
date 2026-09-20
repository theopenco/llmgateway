import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	evaluateContentFilterWithClassifiers,
	runContentFilterClassifier,
} from "./content-filter-classifier.js";

import type * as OpenAIContentFilter from "./openai-content-filter.js";
import type { TieredContentFilterPlan } from "./tiered-content-filter.js";
import type { BaseMessage } from "@llmgateway/models";

const checkJev = vi.hoisted(() => vi.fn());
const hasJevCredential = vi.hoisted(() => vi.fn());
const checkOpenAI = vi.hoisted(() => vi.fn());
const hasOpenAICredential = vi.hoisted(() => vi.fn());

vi.mock("./jev-content-filter.js", () => ({
	checkJevContentFilter: checkJev,
	hasJevContentFilterCredential: hasJevCredential,
}));

vi.mock("./openai-content-filter.js", async (importOriginal) => ({
	...(await importOriginal<typeof OpenAIContentFilter>()),
	checkOpenAIContentFilter: checkOpenAI,
	hasOpenAIContentFilterCredential: hasOpenAICredential,
}));

const CONTEXT = {
	requestId: "request-id",
	organizationId: "org-id",
	projectId: "project-id",
	apiKeyId: "api-key-id",
};

const TEXT_MESSAGES: BaseMessage[] = [{ role: "user", content: "hello" }];
const IMAGE_MESSAGES: BaseMessage[] = [
	{
		role: "user",
		content: [
			{ type: "text", text: "what is this?" },
			{ type: "image_url", image_url: { url: "https://x.test/a.png" } },
		],
	},
];

function result(
	flagged: boolean,
	scores: Record<string, number>,
	model: string,
) {
	return {
		flagged,
		model,
		upstreamRequestId: null,
		results: [{ category_scores: scores }],
		responses: [{ model, results: [{ category_scores: scores }] }],
	};
}

const PLAN: TieredContentFilterPlan = {
	provider: "openai",
	tier: 1,
	overridden: false,
	level: "strict",
	enforce: true,
	classifier: "jev",
	shadowClassifier: null,
};

describe("runContentFilterClassifier", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hasOpenAICredential.mockResolvedValue(true);
		hasJevCredential.mockResolvedValue(true);
	});

	it("does not call OpenAI at all for a text-only Jev request", async () => {
		checkJev.mockResolvedValue(result(false, { violence: 0.1 }, "jev-1.13.0"));

		const checked = await runContentFilterClassifier(
			"jev",
			TEXT_MESSAGES,
			CONTEXT,
			undefined,
			{ imagesAllowed: true },
		);

		expect(checked.classifier).toBe("jev");
		expect(checkOpenAI).not.toHaveBeenCalled();
	});

	it("delegates image parts to OpenAI and merges the verdicts", async () => {
		checkJev.mockResolvedValue(result(false, { violence: 0.1 }, "jev-1.13.0"));
		checkOpenAI.mockResolvedValue(
			result(true, { violence: 0.95 }, "omni-moderation-latest"),
		);

		const checked = await runContentFilterClassifier(
			"jev",
			IMAGE_MESSAGES,
			CONTEXT,
			undefined,
			{ imagesAllowed: true },
		);

		expect(checkOpenAI).toHaveBeenCalledWith(
			IMAGE_MESSAGES,
			CONTEXT,
			undefined,
			{ kinds: ["image"] },
		);
		expect(checked.flagged).toBe(true);
		expect(checked.results).toHaveLength(2);
		expect(checked.model).toBe("jev-1.13.0");
	});

	it("skips image delegation when the policy excludes OpenAI", async () => {
		checkJev.mockResolvedValue(result(false, { violence: 0.1 }, "jev-1.13.0"));

		const checked = await runContentFilterClassifier(
			"jev",
			IMAGE_MESSAGES,
			CONTEXT,
			undefined,
			{ imagesAllowed: false },
		);

		expect(checkOpenAI).not.toHaveBeenCalled();
		expect(checked.flagged).toBe(false);
	});
});

describe("evaluateContentFilterWithClassifiers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hasOpenAICredential.mockResolvedValue(true);
		hasJevCredential.mockResolvedValue(true);
	});

	it("reuses a result already scored by the same classifier", async () => {
		const existing = {
			...result(false, { violence: 0.1 }, "jev-1.13.0"),
			classifier: "jev" as const,
		};

		const evaluated = await evaluateContentFilterWithClassifiers({
			plan: PLAN,
			messages: TEXT_MESSAGES,
			context: CONTEXT,
			imagesAllowed: true,
			classifierAllowed: () => true,
			existing,
		});

		expect(checkJev).not.toHaveBeenCalled();
		expect(evaluated?.evaluation.classifier).toBe("jev");
		expect(evaluated?.evaluation.action).toBe("passed");
	});

	it("records the shadow classifier's disagreement without blocking on it", async () => {
		checkJev.mockResolvedValue(result(false, { violence: 0.1 }, "jev-1.13.0"));
		checkOpenAI.mockResolvedValue(
			result(true, { violence: 0.95 }, "omni-moderation-latest"),
		);

		const evaluated = await evaluateContentFilterWithClassifiers({
			plan: { ...PLAN, shadowClassifier: "openai" },
			messages: TEXT_MESSAGES,
			context: CONTEXT,
			imagesAllowed: true,
			classifierAllowed: () => true,
		});

		expect(evaluated?.evaluation.action).toBe("passed");
		expect(evaluated?.evaluation.shadow).toMatchObject({
			classifier: "openai",
			violation: true,
			disagreed: true,
		});
		expect(evaluated?.results).toHaveLength(2);
	});

	it("skips entirely when the deciding classifier is not permitted", async () => {
		expect(
			await evaluateContentFilterWithClassifiers({
				plan: PLAN,
				messages: TEXT_MESSAGES,
				context: CONTEXT,
				imagesAllowed: true,
				classifierAllowed: (classifier) => classifier !== "jev",
			}),
		).toBeNull();
		expect(checkJev).not.toHaveBeenCalled();
	});

	it("drops a shadow classifier that has no credential", async () => {
		checkJev.mockResolvedValue(result(false, { violence: 0.1 }, "jev-1.13.0"));
		hasOpenAICredential.mockResolvedValue(false);

		const evaluated = await evaluateContentFilterWithClassifiers({
			plan: { ...PLAN, shadowClassifier: "openai" },
			messages: TEXT_MESSAGES,
			context: CONTEXT,
			imagesAllowed: true,
			classifierAllowed: () => true,
		});

		expect(evaluated?.evaluation.shadow).toBeUndefined();
		expect(checkOpenAI).not.toHaveBeenCalled();
	});
});
