import { describe, expect, it } from "vitest";

import {
	summarizeApiKeySelection,
	toggleKeySelection,
	togglePageSelection,
} from "./api-key-selection";

const view = ["a", "b", "c", "d"];
const page = ["a", "b"];

describe("summarizeApiKeySelection", () => {
	it("distinguishes a full page from the full view", () => {
		const pageOnly = summarizeApiKeySelection(new Set(page), page, view);
		expect(pageOnly.allPageSelected).toBe(true);
		expect(pageOnly.allViewSelected).toBe(false);
		expect(pageOnly.viewExceedsPage).toBe(true);

		const everything = summarizeApiKeySelection(new Set(view), page, view);
		expect(everything.allViewSelected).toBe(true);
		expect(everything.selectedIds).toEqual(view);
	});

	it("ignores selected keys that left the view", () => {
		const summary = summarizeApiKeySelection(
			new Set(["a", "gone"]),
			page,
			view,
		);
		expect(summary.selectedIds).toEqual(["a"]);
		expect(summary.somePageSelected).toBe(true);
		expect(summary.allPageSelected).toBe(false);
	});

	it("treats an empty view as nothing selected", () => {
		const summary = summarizeApiKeySelection(new Set(), [], []);
		expect(summary.allPageSelected).toBe(false);
		expect(summary.allViewSelected).toBe(false);
	});
});

describe("togglePageSelection", () => {
	it("selects the page, then clears only the page", () => {
		const selected = togglePageSelection(new Set(["c"]), page);
		expect(Array.from(selected).sort()).toEqual(["a", "b", "c"]);
		expect(Array.from(togglePageSelection(selected, page))).toEqual(["c"]);
	});
});

describe("toggleKeySelection", () => {
	it("adds and removes a single key", () => {
		const selected = toggleKeySelection(new Set(), "a");
		expect(selected.has("a")).toBe(true);
		expect(toggleKeySelection(selected, "a").has("a")).toBe(false);
	});
});
