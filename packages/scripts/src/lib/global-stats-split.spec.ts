import { describe, expect, test } from "vitest";

import {
	ALL_METRICS,
	type Candidate,
	emptyMetrics,
	type GlobalRow,
	splitReal,
	splitRow,
	splitWhole,
} from "./global-stats-split.js";

function candidate(
	usedMode: Candidate["usedMode"],
	orgKind: Candidate["orgKind"],
	overrides: Partial<Record<string, number>>,
): Candidate {
	return {
		usedMode,
		orgKind,
		metrics: { ...emptyMetrics(), ...overrides },
	};
}

function globalRow(
	usedMode: GlobalRow["usedMode"],
	orgKind: GlobalRow["orgKind"],
	overrides: Partial<Record<string, number>>,
): GlobalRow {
	return {
		id: "row-1",
		keyValues: ["openai/gpt-5.6", "openai"],
		usedMode,
		orgKind,
		metrics: { ...emptyMetrics(), ...overrides },
	};
}

describe("splitWhole", () => {
	test("parts always sum to the total, however awkward the ratio", () => {
		for (const total of [1, 7, 100, 1015, 999_999]) {
			for (const weights of [
				[1, 1, 1],
				[1, 2, 7],
				[999, 1],
				[1, 0, 0],
				[5, 5, 5, 5, 5, 5, 5],
			]) {
				const parts = splitWhole(total, weights);
				expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
				expect(parts.every((p) => Number.isInteger(p) && p >= 0)).toBe(true);
			}
		}
	});

	test("keeps the total when there is nothing to weight on", () => {
		// Dropping it would quietly shrink the page's totals — the exact bug this
		// backfill exists to fix.
		expect(splitWhole(42, [0, 0, 0])).toEqual([42, 0, 0]);
	});

	test("gives a single candidate everything", () => {
		expect(splitWhole(1015, [1010])).toEqual([1015]);
	});
});

describe("splitReal", () => {
	test("distributes proportionally and preserves the total", () => {
		const parts = splitReal(903, [900, 2]);
		expect(parts[0] + parts[1]).toBeCloseTo(903, 9);
		expect(parts[0] / parts[1]).toBeCloseTo(450, 9);
	});
});

describe("splitRow", () => {
	// The core invariant: the global tables stay authoritative for totals, the
	// project side only decides the proportions. The candidates here deliberately
	// sum to LESS than the row (1010 vs 1015 requests, 902 vs 903 cost), which is
	// the real-world drift between the two aggregations.
	const candidates = [
		candidate("credits", "default", {
			requestCount: 1000,
			cost: 900,
			totalTokens: 5_000_000,
			errorCount: 3,
		}),
		candidate("api-keys", "devpass", {
			requestCount: 10,
			cost: 2,
			totalTokens: 50_000,
			errorCount: 0,
		}),
	];

	test("preserves every metric total exactly", () => {
		const row = globalRow("unknown", "unknown", {
			requestCount: 1015,
			cost: 903,
			totalTokens: 5_075_000,
			errorCount: 3,
		});
		const parts = splitRow(row, candidates);

		for (const metric of ALL_METRICS) {
			const sum = parts.reduce((acc, p) => acc + p.metrics[metric], 0);
			expect(sum).toBeCloseTo(row.metrics[metric], 6);
		}
		expect(parts.map((p) => `${p.usedMode}/${p.orgKind}`)).toEqual([
			"credits/default",
			"api-keys/devpass",
		]);
	});

	test("only resolves the dimension that was unknown", () => {
		// Mode is already known, so every part must keep it and differ only in kind.
		const row = globalRow("credits", "unknown", { requestCount: 400, cost: 40 });
		const parts = splitRow(row, [
			candidate("credits", "default", { requestCount: 300, cost: 30 }),
			candidate("credits", "devpass", { requestCount: 100, cost: 10 }),
		]);

		expect(parts.every((p) => p.usedMode === "credits")).toBe(true);
		expect(parts.map((p) => p.orgKind)).toEqual(["default", "devpass"]);
		expect(parts.map((p) => p.metrics.requestCount)).toEqual([300, 100]);
	});

	test("falls back to the request distribution for metrics the project side never recorded", () => {
		const row = globalRow("unknown", "unknown", {
			requestCount: 100,
			cachedTokens: 900,
		});
		const parts = splitRow(row, candidates);

		// Neither candidate recorded cachedTokens, so it follows the requests.
		expect(
			parts.reduce((acc, p) => acc + p.metrics.cachedTokens, 0),
		).toBe(900);
		expect(parts[0].metrics.cachedTokens).toBeGreaterThan(
			parts[1].metrics.cachedTokens,
		);
	});

	test("carries the key through untouched", () => {
		const row = globalRow("unknown", "unknown", { requestCount: 10 });
		for (const part of splitRow(row, candidates)) {
			expect(part.keyValues).toEqual(["openai/gpt-5.6", "openai"]);
		}
	});
});
