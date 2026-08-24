import { describe, expect, it } from "vitest";

import {
	isLoungeSource,
	LEGACY_LOUNGE_SOURCE,
	LOUNGE_SOURCE,
} from "./lounge-source.js";

describe("isLoungeSource", () => {
	it("recognizes the current Lounge host", () => {
		expect(isLoungeSource(LOUNGE_SOURCE)).toBe(true);
		expect(isLoungeSource("lounge.llmgateway.io")).toBe(true);
	});

	it("still recognizes logs written before the domain move", () => {
		expect(isLoungeSource(LEGACY_LOUNGE_SOURCE)).toBe(true);
		expect(isLoungeSource("chat.llmgateway.io")).toBe(true);
	});

	it("rejects other sources", () => {
		expect(isLoungeSource("llmgateway.io")).toBe(false);
		expect(isLoungeSource("devpass.llmgateway.io")).toBe(false);
		expect(isLoungeSource("claude-code")).toBe(false);
		expect(isLoungeSource(null)).toBe(false);
		expect(isLoungeSource(undefined)).toBe(false);
		expect(isLoungeSource("")).toBe(false);
	});
});
