import { describe, expect, it } from "vitest";

import { models } from "@llmgateway/models";

import {
	buildComparisonSummary,
	canonicalComparisonSlug,
	comparisonPath,
	featuredComparisons,
	parseComparisonSlug,
} from "./model-comparisons";

describe("model comparisons", () => {
	const [first] = featuredComparisons;

	it("features unique pairs of two different models", () => {
		const slugs = featuredComparisons.map((pair) => pair.slug);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(featuredComparisons.every((p) => p.left.id !== p.right.id)).toBe(
			true,
		);
	});

	it("can split every slug on its separator", () => {
		expect(models.some((model) => model.id.includes("-vs-"))).toBe(false);
	});

	it("resolves both orders of a pair to one canonical slug", () => {
		expect(canonicalComparisonSlug(first.left.id, first.right.id)).toBe(
			first.slug,
		);
		expect(canonicalComparisonSlug(first.right.id, first.left.id)).toBe(
			first.slug,
		);
	});

	it("round-trips a featured slug", () => {
		const parsed = parseComparisonSlug(first.slug);
		expect(parsed?.left.id).toBe(first.left.id);
		expect(parsed?.right.id).toBe(first.right.id);
		expect(comparisonPath(first.slug)).toBe(`/models/compare/${first.slug}`);
	});

	it("rejects unknown models, a missing separator and self-comparisons", () => {
		expect(parseComparisonSlug("not-a-model-vs-also-not-a-model")).toBeNull();
		expect(parseComparisonSlug(first.left.id)).toBeNull();
		expect(
			parseComparisonSlug(`${first.left.id}-vs-${first.left.id}`),
		).toBeNull();
	});

	it("credits each advantage to exactly one model", () => {
		const summary = buildComparisonSummary(first.left, first.right);
		const cheaper = [...summary.leftWins, ...summary.rightWins].filter((win) =>
			win.startsWith("Lower cost"),
		);
		expect(cheaper.length).toBeLessThanOrEqual(1);
		expect(summary.verdict).toContain(first.left.name);
		expect(summary.faqs.length).toBeGreaterThanOrEqual(3);
	});
});
