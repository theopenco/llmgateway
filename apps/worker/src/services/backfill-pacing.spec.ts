import { describe, expect, test } from "vitest";

import { backfillPauseMs, parseBackfillPauseRatio } from "./backfill-pacing.js";

describe("backfill pacing", () => {
	test.each([
		[undefined, 1],
		["", 1],
		["abc", 1],
		["-1", 1],
		["Infinity", 1],
		["0", 0],
		["2.5", 2.5],
	])("parses %s as %s", (value, expected) => {
		expect(parseBackfillPauseRatio(value)).toBe(expected);
	});

	test("scales the pause with the step duration", () => {
		expect(backfillPauseMs(1200, 1)).toBe(1200);
		expect(backfillPauseMs(1200, 0.5)).toBe(600);
		expect(backfillPauseMs(1200, 0)).toBe(0);
	});
});
