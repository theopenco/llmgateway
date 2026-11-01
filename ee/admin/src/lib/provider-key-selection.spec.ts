import { describe, expect, test } from "vitest";

import { providerKeySelectionPositions } from "./provider-key-selection";

const key = (
	id: string,
	selectionStrategy: "ordered" | "round_robin" = "ordered",
	variant = "default",
	region: string | null = null,
	provider = "openai",
) => ({ id, selectionStrategy, variant, region, provider });

describe("provider key selection positions", () => {
	test("keeps ordered keys as individual fallbacks", () => {
		expect(
			Array.from(providerKeySelectionPositions([key("a"), key("b"), key("c")])),
		).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
		]);
	});
	test("pools nonadjacent round-robin members at the earliest member", () => {
		expect(
			Array.from(
				providerKeySelectionPositions([
					key("a"),
					key("b", "round_robin"),
					key("c"),
					key("d", "round_robin"),
					key("e"),
				]),
			),
		).toEqual([
			["a", 1],
			["b", 2],
			["c", 3],
			["d", 2],
			["e", 4],
		]);
	});
	test("separates provider, variant and region scopes", () => {
		const keys = [
			key("a", "round_robin"),
			key("b", "round_robin", "enterprise"),
			key("c", "round_robin", "default", "eu"),
			key("d", "round_robin", "default", null, "anthropic"),
			key("e"),
		];
		expect(Array.from(providerKeySelectionPositions(keys))).toEqual([
			["a", 1],
			["b", 1],
			["c", 1],
			["d", 1],
			["e", 2],
		]);
		expect(keys.map(({ id }) => id)).toEqual(["a", "b", "c", "d", "e"]);
	});
	test("handles no eligible keys", () => {
		expect(providerKeySelectionPositions([]).size).toBe(0);
	});
});
