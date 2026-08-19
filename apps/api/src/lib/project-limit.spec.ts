import { describe, expect, test } from "vitest";

import { resolveProjectLimit } from "@/lib/project-limit.js";

describe("resolveProjectLimit", () => {
	test("falls back to the plan default when no override is set", () => {
		expect(resolveProjectLimit("free", null)).toBe(10);
		expect(resolveProjectLimit("pro", null)).toBe(10);
		expect(resolveProjectLimit("enterprise", null)).toBe(250);
		expect(resolveProjectLimit(undefined, undefined)).toBe(10);
	});

	test("prefers the override over the plan default", () => {
		expect(resolveProjectLimit("free", 42)).toBe(42);
		expect(resolveProjectLimit("enterprise", 3)).toBe(3);
	});

	test("treats a zero override as a real limit, not as unset", () => {
		expect(resolveProjectLimit("enterprise", 0)).toBe(0);
	});
});
