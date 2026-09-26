import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectSmartRoutingModel } from "./smart-routing-selection.js";

import type { ClassifierRequestContext } from "./log-classifier-usage.js";
import type {
	SmartRoutingSessionActivity,
	SmartRoutingSessionEntry,
} from "@/lib/smart-routing-session.js";
import type {
	BaseMessage,
	ModelDefinition,
	ProviderModelMapping,
} from "@llmgateway/models";
import type { RequestClassification } from "@llmgateway/shared/smart-routing";

vi.mock("./content-filter-credential.js", () => ({
	hasContentFilterCredential: vi.fn(),
}));
vi.mock("./jev-request-classifier.js", () => ({
	classifyRequest: vi.fn(),
	JEV_CLASSIFIER_RUBRIC_VERSION: 2,
}));

const { hasContentFilterCredential } =
	await import("./content-filter-credential.js");
const { classifyRequest } = await import("./jev-request-classifier.js");

const NOW = 1_800_000_000_000;

function mapping(
	input: string,
	cached: string,
	write: string,
	output: string,
): ProviderModelMapping {
	return {
		providerId: "anthropic",
		externalId: "x",
		inputPrice: input,
		cachedInputPrice: cached,
		cacheWriteInputPrice: write,
		outputPrice: output,
	} as ProviderModelMapping;
}

const CANDIDATES = [
	{
		modelId: "cheap",
		modelDef: { name: "Cheap" } as ModelDefinition,
		price: 1,
		providers: [mapping("1e-6", "0.1e-6", "1.25e-6", "5e-6")],
	},
	{
		modelId: "mid",
		modelDef: { name: "Mid" } as ModelDefinition,
		price: 2,
		providers: [mapping("3e-6", "0.3e-6", "3.75e-6", "15e-6")],
	},
	{
		modelId: "top",
		modelDef: { name: "Top" } as ModelDefinition,
		price: 3,
		providers: [mapping("15e-6", "1.5e-6", "18.75e-6", "75e-6")],
	},
];

const USER_TURN: BaseMessage[] = [
	{ role: "user", content: "Fix the login bug." },
	{ role: "assistant", content: "Fixed." },
	{ role: "user", content: "Now update the README." },
];

function classification(
	overrides: Partial<RequestClassification> = {},
): RequestClassification {
	return {
		difficulty: "low",
		difficultyScore: 0.1,
		effort: "low",
		latencyMs: 42,
		cost: 0.000034,
		...overrides,
	};
}

function entry(
	overrides: Partial<SmartRoutingSessionEntry> = {},
): SmartRoutingSessionEntry {
	return {
		version: 3,
		classification: classification({
			difficulty: "high",
			effort: "high",
			task: "coding",
			cost: undefined,
		}),
		selectedModel: "top",
		effort: "high",
		turnCount: 4,
		turnsSinceCheck: 0,
		turnsSinceSwitch: 3,
		...overrides,
	};
}

function activity(
	overrides: Partial<SmartRoutingSessionActivity> = {},
): SmartRoutingSessionActivity {
	return {
		lastActivityAt: NOW - 60_000,
		lastFinishReason: "completed",
		lastProvider: "anthropic",
		lastPromptTokens: 100_000,
		usedExtendedCache: false,
		requests: 20,
		promptTokens: 1_000_000,
		cachedTokens: 900_000,
		outputTokens: 20_000,
		...overrides,
	};
}

/** In-memory store with the same claim / version-checked replace semantics. */
function memoryStore(
	initial: SmartRoutingSessionEntry | null,
	sessionActivity: SmartRoutingSessionActivity | null = null,
) {
	let stored = initial;
	return {
		current: () => stored,
		get: vi.fn(async () => stored),
		getActivity: vi.fn(async () => sessionActivity),
		claim: vi.fn(async (own: SmartRoutingSessionEntry) => {
			if (stored) {
				return stored;
			}
			stored = own;
			return own;
		}),
		replace: vi.fn(
			async (expectedVersion: number, own: SmartRoutingSessionEntry) => {
				if ((stored?.version ?? 0) !== expectedVersion) {
					return stored!;
				}
				stored = { ...own, version: expectedVersion + 1 };
				return stored;
			},
		),
		touch: vi.fn(async () => undefined),
		recordActivity: vi.fn(async () => undefined),
	};
}

function params(overrides: Record<string, unknown> = {}) {
	return {
		candidates: CANDIDATES,
		configuredModels: ["cheap", "mid", "top"],
		classifier: "jev" as const,
		classifierAllowed: true,
		callerEffort: false,
		messages: [{ role: "user" as const, content: "hi" }] as BaseMessage[],
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
		now: NOW,
		...overrides,
	};
}

describe("selectSmartRoutingModel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(hasContentFilterCredential).mockResolvedValue(true);
		vi.mocked(classifyRequest).mockResolvedValue(classification());
	});

	describe("opening turn", () => {
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

		it("serves the configured fallback when the classifier gives no verdict", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(null);
			const store = memoryStore(null);

			const result = await selectSmartRoutingModel(
				params({ fallbackModel: "mid", sessionStore: store }),
			);

			expect(result?.candidate.modelId).toBe("mid");
			// Nothing is pinned, so the next turn classifies again.
			expect(store.claim).not.toHaveBeenCalled();
		});

		it("chooses a model and effort and saves both for the session", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(
				classification({ difficulty: "high", effort: "high" }),
			);
			const store = memoryStore(null);

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store }),
			);

			expect(result?.candidate.modelId).toBe("top");
			expect(result?.effort).toBe("high");
			expect(result?.decision).toMatchObject({
				trigger: "initial",
				effort: "high",
				effortSource: "classifier",
				classifierLatencyMs: 42,
				classifierCost: 0.000034,
			});
			expect(result?.decision?.classifierReused).toBeUndefined();
			expect(store.current()).toMatchObject({
				version: 1,
				selectedModel: "top",
				effort: "high",
				turnCount: 1,
			});
			// The charge is not replayed by later turns.
			expect(store.current()?.classification.cost).toBeUndefined();
		});

		it("adopts a concurrent opening turn's choice", async () => {
			const winner = entry({ selectedModel: "mid", effort: "medium" });
			const store = memoryStore(null);
			store.claim.mockResolvedValue(winner);

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store }),
			);

			expect(result?.candidate.modelId).toBe("mid");
			expect(result?.effort).toBe("medium");
			expect(result?.decision?.classifierReused).toBe(true);
			expect(result?.decision?.classifierLatencyMs).toBe(42);
		});

		it("never overrides an effort the caller set", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(
				classification({ difficulty: "high", effort: "high" }),
			);

			const result = await selectSmartRoutingModel(
				params({ callerEffort: true }),
			);

			expect(result?.effort).toBeUndefined();
			expect(result?.decision?.effortSource).toBe("caller");
		});
	});

	describe("following turns", () => {
		it("reuses the choice without calling the classifier", async () => {
			const store = memoryStore(entry(), activity());

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store, messages: USER_TURN }),
			);

			expect(classifyRequest).not.toHaveBeenCalled();
			expect(result?.candidate.modelId).toBe("top");
			expect(result?.effort).toBe("high");
			expect(result?.decision).toMatchObject({
				trigger: "reused",
				classifierReused: true,
			});
			expect(result?.decision?.classifierCost).toBeUndefined();
			expect(store.current()).toMatchObject({
				version: 4,
				turnCount: 5,
				turnsSinceCheck: 1,
				turnsSinceSwitch: 4,
			});
		});

		it("never re-evaluates mid-turn, even after the cache expired", async () => {
			const store = memoryStore(
				entry({ turnsSinceCheck: 10 }),
				activity({
					lastActivityAt: NOW - 3_600_000,
					lastFinishReason: "tool_calls",
				}),
			);

			const result = await selectSmartRoutingModel(
				params({
					sessionStore: store,
					messages: [
						...USER_TURN,
						{ role: "user", content: "Also check the logout flow." },
					],
				}),
			);

			expect(classifyRequest).not.toHaveBeenCalled();
			expect(result?.candidate.modelId).toBe("top");
			expect(result?.decision?.trigger).toBe("mid-turn");
			expect(store.touch).toHaveBeenCalled();
			expect(store.replace).not.toHaveBeenCalled();
		});

		it("does not treat an unknown cache lifetime as expiry", async () => {
			const store = memoryStore(
				entry(),
				activity({ lastProvider: "openai", lastActivityAt: NOW - 86_400_000 }),
			);

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store, messages: USER_TURN }),
			);

			expect(classifyRequest).not.toHaveBeenCalled();
			expect(result?.decision?.trigger).toBe("reused");
		});
	});

	describe("rechecks", () => {
		it("keeps the choice after cache expiry when the work is unchanged", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(
				classification({ workChange: "same", workChangeConfidence: 0.9 }),
			);
			const store = memoryStore(
				entry(),
				activity({ lastActivityAt: NOW - 400_000 }),
			);

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store, messages: USER_TURN }),
			);

			expect(classifyRequest).toHaveBeenCalledWith(
				expect.objectContaining({
					recheck: expect.objectContaining({ currentModel: "top" }),
				}),
				expect.anything(),
				undefined,
			);
			expect(result?.candidate.modelId).toBe("top");
			expect(result?.decision).toMatchObject({
				trigger: "cache-expired",
				workChange: "same",
				keptReason: "work-unchanged",
			});
			expect(result?.decision?.switch).toBeUndefined();
			expect(store.current()?.turnsSinceCheck).toBe(0);
		});

		it("moves to a cheaper choice before expiry when savings cover the cache break", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(
				classification({ workChange: "easier", workChangeConfidence: 0.9 }),
			);
			const store = memoryStore(entry({ turnsSinceCheck: 3 }), activity());

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store, messages: USER_TURN }),
			);

			expect(result?.candidate.modelId).toBe("cheap");
			expect(result?.effort).toBe("low");
			expect(result?.decision?.trigger).toBe("scan");
			expect(result?.decision?.switch).toMatchObject({
				fromModel: "top",
				toModel: "cheap",
				fromEffort: "high",
				toEffort: "low",
				direction: "downgrade",
				reason: "savings",
			});
			expect(result?.decision?.switch?.estimatedSwitchUsd).toBeLessThan(
				result?.decision?.switch?.estimatedStayUsd ?? 0,
			);
			expect(store.current()).toMatchObject({
				selectedModel: "cheap",
				effort: "low",
				turnsSinceSwitch: 0,
				lastSwitchAt: NOW,
			});
		});

		it("keeps the choice when the cache break outweighs the savings", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(
				classification({ workChange: "easier", workChangeConfidence: 0.9 }),
			);
			const store = memoryStore(
				entry({
					selectedModel: "mid",
					effort: "low",
					turnCount: 1,
					turnsSinceCheck: 3,
				}),
				activity({
					requests: 1,
					promptTokens: 10_000,
					cachedTokens: 9_000,
					outputTokens: 100,
					lastPromptTokens: 1_000_000,
				}),
			);

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store, messages: USER_TURN }),
			);

			expect(result?.candidate.modelId).toBe("mid");
			expect(result?.decision?.keptReason).toBe("insufficient-savings");
		});

		it("upgrades for harder work without waiting for expiry or a cooldown", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(
				classification({
					difficulty: "high",
					effort: "high",
					workChange: "harder",
					workChangeConfidence: 0.9,
				}),
			);
			const store = memoryStore(
				entry({
					selectedModel: "cheap",
					effort: "low",
					turnsSinceCheck: 3,
					turnsSinceSwitch: 0,
				}),
				activity(),
			);

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store, messages: USER_TURN }),
			);

			expect(result?.candidate.modelId).toBe("top");
			expect(result?.effort).toBe("high");
			expect(result?.decision?.switch).toMatchObject({
				direction: "upgrade",
				reason: "harder-work",
			});
		});

		it("upgrades for harder work when no candidate occupies the high band", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(
				classification({
					difficulty: "high",
					effort: "high",
					workChange: "harder",
					workChangeConfidence: 0.9,
				}),
			);
			const store = memoryStore(
				entry({
					selectedModel: "cheap",
					effort: "low",
					turnsSinceCheck: 3,
				}),
				activity(),
			);

			const result = await selectSmartRoutingModel(
				params({
					sessionStore: store,
					messages: USER_TURN,
					candidates: CANDIDATES.slice(0, 2),
				}),
			);

			expect(result?.candidate.modelId).toBe("mid");
			expect(result?.decision?.switch).toMatchObject({
				direction: "upgrade",
				reason: "harder-work",
			});
		});

		it("keeps the current choice when the check fails", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(null);
			const store = memoryStore(entry({ turnsSinceCheck: 3 }), activity());

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store, messages: USER_TURN }),
			);

			expect(result?.candidate.modelId).toBe("top");
			expect(result?.effort).toBe("high");
			expect(result?.decision?.classifierFailed).toBe(true);
			expect(store.current()?.turnsSinceCheck).toBe(0);
		});

		it("discards its decision when another turn wrote first", async () => {
			vi.mocked(classifyRequest).mockResolvedValue(
				classification({ workChange: "easier", workChangeConfidence: 0.9 }),
			);
			const store = memoryStore(entry({ turnsSinceCheck: 3 }), activity());
			const newer = entry({
				version: 9,
				selectedModel: "mid",
				effort: "medium",
			});
			store.replace.mockResolvedValue(newer);

			const result = await selectSmartRoutingModel(
				params({ sessionStore: store, messages: USER_TURN }),
			);

			expect(result?.candidate.modelId).toBe("mid");
			expect(result?.effort).toBe("medium");
			expect(result?.decision?.switch).toBeUndefined();
		});
	});

	it("reports a move off a pinned model that is no longer a candidate", async () => {
		const store = memoryStore(entry(), activity());

		const result = await selectSmartRoutingModel(
			params({
				sessionStore: store,
				messages: USER_TURN,
				candidates: CANDIDATES.slice(0, 2),
			}),
		);

		expect(result?.candidate.modelId).toBe("mid");
		expect(result?.decision?.switch).toMatchObject({
			fromModel: "top",
			toModel: "mid",
			reason: "model-unavailable",
		});
	});
});
