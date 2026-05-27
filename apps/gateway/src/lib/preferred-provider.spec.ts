import { describe, expect, it } from "vitest";

import { resolvePreferredProvider } from "./preferred-provider.js";

const candidates = [
	{ providerId: "anthropic", region: undefined },
	{ providerId: "openai", region: undefined },
	{ providerId: "google", region: undefined },
];

describe("resolvePreferredProvider", () => {
	it("returns preferred candidate when score is within margin", () => {
		const preferred = { providerId: "anthropic" };
		const scores = [
			{ providerId: "anthropic", score: 0.05, uptime: 99 },
			{ providerId: "openai", score: 0.02, uptime: 99 },
			{ providerId: "google", score: 0.08, uptime: 99 },
		];
		// anthropic score (0.05) - best score (0.02) = 0.03, within default margin of 0.15
		expect(resolvePreferredProvider(preferred, candidates, scores)).toEqual(
			candidates[0],
		);
	});

	it("returns null when preferred score exceeds margin over best", () => {
		const preferred = { providerId: "anthropic" };
		const scores = [
			{ providerId: "anthropic", score: 0.5, uptime: 99 },
			{ providerId: "openai", score: 0.1, uptime: 99 },
			{ providerId: "google", score: 0.2, uptime: 99 },
		];
		// anthropic score (0.5) - best score (0.1) = 0.4, exceeds default margin 0.15
		expect(resolvePreferredProvider(preferred, candidates, scores)).toBeNull();
	});

	it("returns null when preferred provider uptime is below threshold", () => {
		const preferred = { providerId: "anthropic" };
		const scores = [
			{ providerId: "anthropic", score: 0.02, uptime: 80 },
			{ providerId: "openai", score: 0.05, uptime: 99 },
		];
		// anthropic uptime 80% < default threshold 85%
		expect(resolvePreferredProvider(preferred, candidates, scores)).toBeNull();
	});

	it("returns preferred candidate when uptime is exactly at threshold", () => {
		const preferred = { providerId: "anthropic" };
		const scores = [
			{ providerId: "anthropic", score: 0.02, uptime: 85 },
			{ providerId: "openai", score: 0.05, uptime: 99 },
		];
		expect(resolvePreferredProvider(preferred, candidates, scores)).toEqual(
			candidates[0],
		);
	});

	it("returns null when preferred provider is not in candidates", () => {
		const preferred = { providerId: "cohere" };
		const scores = [{ providerId: "cohere", score: 0.01, uptime: 99 }];
		expect(resolvePreferredProvider(preferred, candidates, scores)).toBeNull();
	});

	it("returns null when preferred provider has no score entry", () => {
		const preferred = { providerId: "anthropic" };
		const scores = [{ providerId: "openai", score: 0.01, uptime: 99 }];
		expect(resolvePreferredProvider(preferred, candidates, scores)).toBeNull();
	});

	it("returns preferred candidate when uptime is undefined (no data)", () => {
		const preferred = { providerId: "openai" };
		const scores = [
			{ providerId: "anthropic", score: 0.01, uptime: 99 },
			{ providerId: "openai", score: 0.05, uptime: undefined },
		];
		// No uptime data → skip uptime check; score diff 0.04 within margin
		expect(resolvePreferredProvider(preferred, candidates, scores)).toEqual(
			candidates[1],
		);
	});

	it("matches preferred provider by region when region is set", () => {
		const regionalCandidates = [
			{ providerId: "vertex", region: "us-east4" },
			{ providerId: "vertex", region: "us-central1" },
		];
		const preferred = { providerId: "vertex", region: "us-east4" };
		const scores = [
			{ providerId: "vertex", region: "us-east4", score: 0.05, uptime: 99 },
			{ providerId: "vertex", region: "us-central1", score: 0.02, uptime: 99 },
		];
		expect(
			resolvePreferredProvider(preferred, regionalCandidates, scores),
		).toEqual(regionalCandidates[0]);
	});

	it("returns null when preferred region is not in candidates", () => {
		const regionalCandidates = [
			{ providerId: "vertex", region: "us-central1" },
		];
		const preferred = { providerId: "vertex", region: "us-east4" };
		const scores = [
			{ providerId: "vertex", region: "us-central1", score: 0.02, uptime: 99 },
		];
		expect(
			resolvePreferredProvider(preferred, regionalCandidates, scores),
		).toBeNull();
	});
});
