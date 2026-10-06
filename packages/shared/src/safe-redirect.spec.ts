import { describe, expect, it } from "vitest";

import { getSafeRedirectPath } from "./safe-redirect.js";

describe("getSafeRedirectPath", () => {
	it.each([
		["/dashboard?tab=keys#top", "/dashboard?tab=keys#top"],
		["/", "/"],
	])("keeps the same-origin path %s", (url, expected) => {
		expect(getSafeRedirectPath(url)).toBe(expected);
	});

	it.each([
		null,
		"",
		"https://evil.com",
		"//evil.com",
		"/\\evil.com",
		"/\\/evil.com",
		"/\t/evil.com",
		"javascript:alert(1)",
	])("falls back for %j", (url) => {
		expect(getSafeRedirectPath(url, "/home")).toBe("/home");
	});
});
