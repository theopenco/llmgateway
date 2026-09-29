import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	evaluateContentFilterWithClassifiers,
	isContentFilterClassifierCompliant,
	runContentFilterClassifier,
} from "./content-filter-classifier.js";

import type * as OpenAIContentFilter from "./openai-content-filter.js";
import type { TieredContentFilterPlan } from "./tiered-content-filter.js";
import type { BaseMessage } from "@llmgateway/models";

const checkJev = vi.hoisted(() => vi.fn());
const hasJevCredential = vi.hoisted(() => vi.fn());
const checkInternal = vi.hoisted(() => vi.fn());
const checkOpenAI = vi.hoisted(() => vi.fn());
const hasOpenAICredential = vi.hoisted(() => vi.fn());

vi.mock("./jev-content-filter.js", () => ({
	checkJevContentFilter: checkJev,
	hasJevContentFilterCredential: hasJevCredential,
}));

vi.mock("./internal-content-filter.js", () => ({
	checkInternalContentFilter: checkInternal,
	hasInternalContentFilterCredential: () => true,
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

const sleep = (ms: number) =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, ms);
	});

const PLAN: TieredContentFilterPlan = {
	provider: "openai",
	tier: 1,
	overridden: false,
	level: "strict",
	enforce: true,
	classifier: "jev",
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

	it("times the text check and the image delegation together", async () => {
		checkJev.mockImplementation(async () => {
			await sleep(40);
			return result(false, { violence: 0.1 }, "jev-1.13.0");
		});
		checkOpenAI.mockImplementation(async () => {
			await sleep(40);
			return result(false, { violence: 0.1 }, "omni-moderation-latest");
		});

		const checked = await runContentFilterClassifier(
			"jev",
			IMAGE_MESSAGES,
			CONTEXT,
			undefined,
			{ imagesAllowed: true },
		);

		expect(checked.durationMs).toBeGreaterThanOrEqual(75);
	});

	it("marks a failed image delegation without changing the text verdict", async () => {
		checkJev.mockResolvedValue(result(false, { violence: 0.1 }, "jev-1.13.0"));
		// The OpenAI filter fails open by returning no results.
		checkOpenAI.mockResolvedValue({
			flagged: false,
			model: "omni-moderation-latest",
			upstreamRequestId: null,
			results: [],
			responses: [],
		});

		const checked = await runContentFilterClassifier(
			"jev",
			IMAGE_MESSAGES,
			CONTEXT,
			undefined,
			{ imagesAllowed: true },
		);

		expect(checked.flagged).toBe(false);
		expect(checked.partialModerationFailed).toBe(true);
		expect(checked.results).toHaveLength(1);
	});

	it("marks a failed text check that a successful image check would hide", async () => {
		// Jev fails open by returning no results.
		checkJev.mockResolvedValue({
			flagged: false,
			model: "jev-1.13.0",
			upstreamRequestId: null,
			results: [],
			responses: [],
		});
		checkOpenAI.mockResolvedValue(
			result(false, { violence: 0.1 }, "omni-moderation-latest"),
		);

		const checked = await runContentFilterClassifier(
			"jev",
			IMAGE_MESSAGES,
			CONTEXT,
			undefined,
			{ imagesAllowed: true },
		);

		expect(checked.results).toHaveLength(1);
		expect(checked.partialModerationFailed).toBe(true);
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

describe("internal classifier", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		hasOpenAICredential.mockResolvedValue(true);
	});

	it("scores text with the internal classifier and delegates images", async () => {
		checkInternal.mockResolvedValue(
			result(true, { child_exploitation: 1 }, "internal-classifier"),
		);
		checkOpenAI.mockResolvedValue(
			result(false, { violence: 0.1 }, "omni-moderation-latest"),
		);

		const checked = await runContentFilterClassifier(
			"internal",
			IMAGE_MESSAGES,
			CONTEXT,
			undefined,
			{ imagesAllowed: true },
		);

		expect(checkJev).not.toHaveBeenCalled();
		expect(checked.classifier).toBe("internal");
		expect(checked.flagged).toBe(true);
		expect(checked.model).toBe("internal-classifier");
		expect(checked.results).toHaveLength(2);
	});

	it("carries a partially failed text check through image delegation", async () => {
		checkInternal.mockResolvedValue({
			...result(false, {}, "internal-classifier"),
			partialModerationFailed: true,
		});
		checkOpenAI.mockResolvedValue(
			result(false, { violence: 0.1 }, "omni-moderation-latest"),
		);

		const checked = await runContentFilterClassifier(
			"internal",
			IMAGE_MESSAGES,
			CONTEXT,
			undefined,
			{ imagesAllowed: true },
		);

		expect(checked.partialModerationFailed).toBe(true);
	});

	it("is never excluded by a compliance policy", () => {
		// TypeSafe publishes no SOC 2 attestation, so this policy excludes Jev.
		const policy = { enabled: true, requireSoc2Type2: true };

		expect(isContentFilterClassifierCompliant("jev", policy)).toBe(false);
		expect(isContentFilterClassifierCompliant("internal", policy)).toBe(true);
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
			durationMs: 87,
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
		// The reused check's own timing, not the near-zero cost of reusing it.
		expect(evaluated?.evaluation.durationMs).toBe(87);
	});

	it("records the classifier's duration", async () => {
		checkJev.mockImplementation(async () => {
			await sleep(40);
			return result(false, { violence: 0.1 }, "jev-1.13.0");
		});

		const evaluated = await evaluateContentFilterWithClassifiers({
			plan: PLAN,
			messages: TEXT_MESSAGES,
			context: CONTEXT,
			imagesAllowed: true,
			classifierAllowed: () => true,
		});

		expect(evaluated?.evaluation.durationMs).toBeGreaterThanOrEqual(35);
		expect(evaluated?.results).toHaveLength(1);
	});

	it("reports a failed image delegation as a failed moderation", async () => {
		checkJev.mockResolvedValue(result(false, { violence: 0.1 }, "jev-1.13.0"));
		checkOpenAI.mockResolvedValue({
			flagged: false,
			model: "omni-moderation-latest",
			upstreamRequestId: null,
			results: [],
			responses: [],
		});

		const evaluated = await evaluateContentFilterWithClassifiers({
			plan: PLAN,
			messages: IMAGE_MESSAGES,
			context: CONTEXT,
			imagesAllowed: true,
			classifierAllowed: () => true,
		});

		expect(evaluated?.evaluation.moderationFailed).toBe(true);
		// Fail open: an uncovered image is not a violation.
		expect(evaluated?.evaluation.action).toBe("passed");
	});

	it("skips entirely when the classifier is not permitted", async () => {
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

	it("skips entirely when the classifier has no credential", async () => {
		hasJevCredential.mockResolvedValue(false);

		expect(
			await evaluateContentFilterWithClassifiers({
				plan: PLAN,
				messages: TEXT_MESSAGES,
				context: CONTEXT,
				imagesAllowed: true,
				classifierAllowed: () => true,
			}),
		).toBeNull();
		expect(checkJev).not.toHaveBeenCalled();
	});
});
