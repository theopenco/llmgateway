import { describe, expect, test } from "vitest";

import { resolveProjectLimit } from "@/lib/project-limit.js";

describe("resolveProjectLimit", () => {
	test("falls back to the plan default when no override is set", () => {
		expect(resolveProjectLimit("org", "free", null)).toBe(10);
		expect(resolveProjectLimit("org", "pro", null)).toBe(10);
		expect(resolveProjectLimit("org", "enterprise", null)).toBe(250);
		expect(resolveProjectLimit("org", undefined, undefined)).toBe(10);
	});

	test("prefers the override over the plan default", () => {
		expect(resolveProjectLimit("org", "free", 42)).toBe(42);
		expect(resolveProjectLimit("org", "enterprise", 3)).toBe(3);
	});

	test("treats a zero override as a real limit, not as unset", () => {
		expect(resolveProjectLimit("org", "enterprise", 0)).toBe(0);
	});

	test("adds purchased extra projects for seat-based Pro only", () => {
		const pro = { proSeats: 5, proExtraProjects: 3 };
		expect(resolveProjectLimit("org", "pro", null, pro)).toBe(13);
		// Legacy flat-fee Pro has no proSeats and keeps the included allowance.
		expect(
			resolveProjectLimit("org", "pro", null, {
				proSeats: null,
				proExtraProjects: 3,
			}),
		).toBe(10);
		expect(resolveProjectLimit("org", "free", null, pro)).toBe(10);
		// The admin override still wins.
		expect(resolveProjectLimit("org", "pro", 4, pro)).toBe(4);
	});
});
