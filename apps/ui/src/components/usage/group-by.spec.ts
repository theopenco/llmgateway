import { describe, expect, test } from "vitest";

import {
	isModelGroupBy,
	parseGroupBy,
	parseModelUsageGroupBy,
	resolveGroupBy,
	shouldStripApiKeyId,
	toApiGroupBy,
	toCanonicalModelBreakdown,
} from "./group-by.js";

import type { ActivityModelUsage } from "@/types/activity";

function row(id: string, provider: string, n: number): ActivityModelUsage {
	return {
		id,
		provider,
		requestCount: n,
		inputTokens: n,
		outputTokens: n,
		cachedTokens: n,
		cacheWriteTokens: n,
		totalTokens: n,
		cost: n,
		inputCost: n,
		outputCost: n,
		cachedInputCost: n,
		cacheWriteInputCost: n,
		creditsRequestCount: n,
		apiKeysRequestCount: n,
		creditsCost: n,
		apiKeysCost: n,
	};
}

describe("parseGroupBy", () => {
	test("accepts the known dimensions", () => {
		expect(parseGroupBy("model")).toBe("model");
		expect(parseGroupBy("apiKey")).toBe("apiKey");
		expect(parseGroupBy("user")).toBe("user");
	});

	test("falls back to model for missing or unknown values", () => {
		expect(parseGroupBy(null)).toBe("model");
		expect(parseGroupBy("")).toBe("model");
		expect(parseGroupBy("USER")).toBe("model");
		expect(parseGroupBy("provider")).toBe("model");
	});
});

describe("resolveGroupBy", () => {
	test("keeps user for an entitled viewer", () => {
		expect(resolveGroupBy("user", true)).toBe("user");
	});

	test("downgrades user to model for an unentitled viewer", () => {
		expect(resolveGroupBy("user", false)).toBe("model");
	});

	test("leaves the ungated dimensions alone", () => {
		expect(resolveGroupBy("model", false)).toBe("model");
		expect(resolveGroupBy("apiKey", false)).toBe("apiKey");
	});
});

describe("shouldStripApiKeyId", () => {
	test("strips a stale api key filter on the non-model dimensions", () => {
		expect(shouldStripApiKeyId("apiKey", true)).toBe(true);
		expect(shouldStripApiKeyId("user", true)).toBe(true);
	});

	test("keeps the api key filter on both model views", () => {
		expect(shouldStripApiKeyId("model", true)).toBe(false);
		expect(shouldStripApiKeyId("mapping", true)).toBe(false);
	});

	test("does nothing without an api key filter", () => {
		expect(shouldStripApiKeyId("apiKey", false)).toBe(false);
		expect(shouldStripApiKeyId("user", false)).toBe(false);
	});

	// Regression: an unentitled viewer resolves to "model", so no URL rewrite is
	// requested. A rewrite here would cancel DeveloperRouteGuard's redirect and
	// leave a developer on the project-wide Model Usage page.
	test("never asks for a rewrite when an unentitled viewer requested user", () => {
		const resolved = resolveGroupBy(parseGroupBy("user"), false);
		expect(resolved).toBe("model");
		expect(shouldStripApiKeyId(resolved, true)).toBe(false);
	});
});

describe("model views", () => {
	test("only the Model Usage page parses mapping", () => {
		expect(parseGroupBy("mapping")).toBe("model");
		expect(parseModelUsageGroupBy("mapping")).toBe("mapping");
		expect(parseModelUsageGroupBy("apiKey")).toBe("apiKey");
		expect(parseModelUsageGroupBy(null)).toBe("model");
	});

	test("mapping is a model view queried as the model breakdown", () => {
		expect(isModelGroupBy("mapping")).toBe(true);
		expect(isModelGroupBy("apiKey")).toBe(false);
		expect(toApiGroupBy("mapping")).toBe("model");
		expect(toApiGroupBy("user")).toBe("user");
	});
});

describe("toCanonicalModelBreakdown", () => {
	test("merges provider mappings and variants into the canonical model", () => {
		const merged = toCanonicalModelBreakdown([
			row("anthropic/claude-5", "anthropic", 1),
			row("gpt-5", "openai", 2),
			row("aws-bedrock/claude-5:thinking", "aws-bedrock", 3),
			row("unknown", "unknown", 4),
		]);
		expect(merged.map((r) => [r.id, r.provider, r.requestCount])).toEqual([
			["claude-5", "anthropic", 4],
			["gpt-5", "openai", 2],
			["unknown", "unknown", 4],
		]);
		expect(merged[0].cost).toBe(4);
		expect(merged[0].apiKeysCost).toBe(4);
	});

	test("does not mutate the input rows", () => {
		const input = [row("a/x", "a", 1), row("b/x", "b", 2)];
		toCanonicalModelBreakdown(input);
		expect(input[0].requestCount).toBe(1);
	});
});
