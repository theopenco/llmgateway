import { describe, expect, test } from "vitest";

import {
	modelRateLimitModelIds,
	normalizeModelRateLimits,
	providerKeyRateLimitChanges,
} from "./provider-key-rate-limits.js";

describe("per-model provider key limits", () => {
	test("normalize drops uncapped windows and models and sorts by model", () => {
		expect(
			normalizeModelRateLimits({
				"model-b": { maxRpm: 12, maxTpd: null },
				"model-a": { maxTpm: 5000 },
				"model-c": { maxRpm: null },
			}),
		).toEqual({ "model-a": { maxTpm: 5000 }, "model-b": { maxRpm: 12 } });
		expect(normalizeModelRateLimits({ "model-a": {} })).toBeNull();
		expect(normalizeModelRateLimits(null)).toBeNull();
	});

	test("only newly capped models need catalogue validation", () => {
		const limits = { "model-a": { maxRpm: 1 }, "model-b": { maxRpm: 1 } };
		expect(modelRateLimitModelIds(limits)).toEqual(["model-a", "model-b"]);
		expect(
			modelRateLimitModelIds(limits, { "model-a": { maxRpm: 5 } }),
		).toEqual(["model-b"]);
		expect(modelRateLimitModelIds(limits, limits)).toBeNull();
		expect(modelRateLimitModelIds(null)).toBeNull();
	});

	test("audit changes compare maps by value", () => {
		const before = {
			maxRpm: null,
			maxRpd: null,
			maxTpm: null,
			maxTpd: null,
			rateLimitMode: "strict" as const,
			modelRateLimits: { "model-b": { maxRpm: 1 }, "model-a": { maxRpm: 2 } },
		};
		expect(
			providerKeyRateLimitChanges(before, {
				modelRateLimits: normalizeModelRateLimits(before.modelRateLimits),
			}),
		).toEqual({});
		expect(
			providerKeyRateLimitChanges(before, { modelRateLimits: null }),
		).toEqual({
			modelRateLimits: { old: before.modelRateLimits, new: null },
		});
	});
});
