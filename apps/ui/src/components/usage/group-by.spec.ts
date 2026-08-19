import { describe, expect, test } from "vitest";

import {
	parseGroupBy,
	resolveGroupBy,
	shouldStripApiKeyId,
} from "./group-by.js";

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
