import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectSmartRoutingModel } from "./smart-routing-selection.js";

import type { ClassifierRequestContext } from "./log-classifier-usage.js";
import type { SmartRoutingSessionEntry } from "@/lib/smart-routing-session.js";
import type { ModelDefinition } from "@llmgateway/models";
import type { RequestClassification } from "@llmgateway/shared/smart-routing";

vi.mock("./content-filter-credential.js", () => ({
	hasContentFilterCredential: vi.fn(),
}));
vi.mock("./jev-request-classifier.js", () => ({
	classifyRequest: vi.fn(),
	JEV_CLASSIFIER_RUBRIC_VERSION: 1,
}));

const { hasContentFilterCredential } =
	await import("./content-filter-credential.js");
const { classifyRequest } = await import("./jev-request-classifier.js");

const CANDIDATES = [
	{
		modelId: "cheap",
		modelDef: { name: "Cheap" } as ModelDefinition,
		price: 1,
	},
	{ modelId: "mid", modelDef: { name: "Mid" } as ModelDefinition, price: 2 },
	{ modelId: "top", modelDef: { name: "Top" } as ModelDefinition, price: 3 },
];

function classification(
	overrides: Partial<RequestClassification> = {},
): RequestClassification {
	return {
		difficulty: "low",
		difficultyScore: 0.1,
		latencyMs: 42,
		cost: 0.000034,
		...overrides,
	};
}

function params(overrides: Record<string, unknown> = {}) {
	return {
		candidates: CANDIDATES,
		configuredModels: ["cheap", "mid", "top"],
		classifier: "jev" as const,
		classifierAllowed: true,
		messages: [{ role: "user" as const, content: "hi" }],
		toolNames: [],
		hasImages: false,
		estimatedInputTokens: 10,
		context: {
			requestId: "r",
			project: { id: "p", organizationId: "o", mode: "credits" },
			apiKey: { id: "k", projectId: "p" },
			retentionLevel: "retain",
			requestedModel: "smart",
		} as unknown as ClassifierRequestContext,
		...overrides,
	};
}

function sessionStore(saved: SmartRoutingSessionEntry | null, claim = vi.fn()) {
	return {
		get: vi.fn().mockResolvedValue(saved),
		claim,
		refresh: vi.fn().mockResolvedValue(undefined),
	};
}

describe("selectSmartRoutingModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(hasContentFilterCredential).mockResolvedValue(true);
		vi.mocked(classifyRequest).mockResolvedValue(classification());
	});

	it("records no failure when the classifier is never consulted", async () => {
		vi.mocked(hasContentFilterCredential).mockResolvedValue(false);

		const result = await selectSmartRoutingModel(params());

		expect(result?.candidate.modelId).toBe("cheap");
		expect(result?.decision?.classifierFailed).toBe(false);
		expect(result?.decision?.classifierLatencyMs).toBeUndefined();
		expect(result?.decision?.classifierCost).toBeUndefined();
		expect(classifyRequest).not.toHaveBeenCalled();
	});

	it("records a failure when an attempted call produces no verdict", async () => {
		vi.mocked(classifyRequest).mockResolvedValue(null);

		const result = await selectSmartRoutingModel(params());

		expect(result?.decision?.classifierFailed).toBe(true);
		expect(result?.decision?.classifierLatencyMs).toBeUndefined();
	});

	it("reports its own latency and no reuse on the opening turn", async () => {
		const entry = { classification: classification(), selectedModel: "cheap" };
		const store = sessionStore(
			null,
			vi.fn(async (own: SmartRoutingSessionEntry) => own),
		);

		const result = await selectSmartRoutingModel(
			params({ sessionStore: store }),
		);

		expect(result?.candidate.modelId).toBe(entry.selectedModel);
		expect(result?.decision?.classifierLatencyMs).toBe(42);
		expect(result?.decision?.classifierCost).toBe(0.000034);
		expect(result?.decision?.classifierReused).toBeUndefined();
	});

	it("marks an adopted verdict as reused while keeping its own latency", async () => {
		// A concurrent opening turn won the claim: this request is served under
		// the winner's verdict, so the log must not present it as its own.
		const winner = {
			classification: classification({ difficulty: "high", latencyMs: 999 }),
			selectedModel: "top",
		};
		const store = sessionStore(null, vi.fn().mockResolvedValue(winner));

		const result = await selectSmartRoutingModel(
			params({ sessionStore: store }),
		);

		expect(result?.candidate.modelId).toBe("top");
		expect(result?.decision?.band).toBe("high");
		expect(result?.decision?.classifierReused).toBe(true);
		expect(result?.decision?.classifierLatencyMs).toBe(42);
	});

	it("reuses a stored verdict without calling the classifier", async () => {
		const store = sessionStore({
			classification: classification({ difficulty: "high" }),
			selectedModel: "top",
		});

		const result = await selectSmartRoutingModel(
			params({ sessionStore: store }),
		);

		expect(result?.candidate.modelId).toBe("top");
		expect(result?.decision?.classifierReused).toBe(true);
		expect(result?.decision?.classifierLatencyMs).toBeUndefined();
		// A reused verdict made no call, so it is not charged again.
		expect(result?.decision?.classifierCost).toBeUndefined();
		expect(classifyRequest).not.toHaveBeenCalled();
		expect(store.refresh).toHaveBeenCalled();
		expect(store.refresh.mock.calls[0][0].classification.cost).toBeUndefined();
	});
});
