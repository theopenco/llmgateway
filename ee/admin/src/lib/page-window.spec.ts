import { describe, expect, test } from "vitest";

import { CATALOG_PAGE_WINDOW_DEFAULT, parsePageWindow } from "./page-window";

describe("parsePageWindow", () => {
	test("uses the existing fallback by default", () => {
		expect(parsePageWindow(undefined)).toBe("4h");
	});

	test("uses a page-specific fallback", () => {
		expect(parsePageWindow(undefined, CATALOG_PAGE_WINDOW_DEFAULT)).toBe("15m");
		expect(parsePageWindow("invalid", CATALOG_PAGE_WINDOW_DEFAULT)).toBe("15m");
	});

	test("keeps a valid query value", () => {
		expect(parsePageWindow("1h", CATALOG_PAGE_WINDOW_DEFAULT)).toBe("1h");
	});
});
