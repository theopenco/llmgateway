import { describe, expect, it } from "vitest";

import { sortByValueDesc, sortTooltipPayload } from "./chart-tooltip";

describe("sortTooltipPayload", () => {
	it("orders by value descending", () => {
		const payload = [
			{ name: "a", value: 1 },
			{ name: "b", value: 30 },
			{ name: "c", value: "5" },
		];
		expect(sortTooltipPayload(payload).map((item) => item.name)).toEqual([
			"b",
			"c",
			"a",
		]);
		expect(payload.map((item) => item.name)).toEqual(["a", "b", "c"]);
	});

	it("puts non-numeric values last and keeps ties stable", () => {
		const payload = [
			{ name: "a", value: undefined },
			{ name: "b", value: 2 },
			{ name: "c", value: null },
			{ name: "d", value: 2 },
			{ name: "e", value: [1, 2] },
		];
		expect(sortTooltipPayload(payload).map((item) => item.name)).toEqual([
			"b",
			"d",
			"c",
			"a",
			"e",
		]);
	});
});

describe("sortByValueDesc", () => {
	it("sorts by the selected value", () => {
		expect(
			sortByValueDesc(
				[{ cost: 1 }, { cost: 3 }, { cost: 2 }],
				(item) => item.cost,
			),
		).toEqual([{ cost: 3 }, { cost: 2 }, { cost: 1 }]);
	});
});
