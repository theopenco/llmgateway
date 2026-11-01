import { describe, expect, test } from "vitest";

import {
	providerKeySelectionPositions,
	providerKeySelectionOrder,
} from "./provider-key-selection";

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
function selectionOrderTests() {
	test("renders the reported pool/fallback/pool order as 1, 1, 2", () => {
		const keys = [
			key("a", "round_robin"),
			key("fallback"),
			key("b", "round_robin"),
		];
		const positions = providerKeySelectionPositions(keys);
		const displayed = providerKeySelectionOrder(keys);
		expect(displayed.map(({ id }) => id)).toEqual(["a", "b", "fallback"]);
		expect(displayed.map(({ id }) => positions.get(id))).toEqual([1, 1, 2]);
	});
	test("preserves ordered priority before the pool and order within it", () => {
		const keys = [
			key("primary"),
			key("a", "round_robin"),
			key("fallback"),
			key("b", "round_robin"),
			key("c", "round_robin"),
			key("last"),
		];
		expect(providerKeySelectionOrder(keys).map(({ id }) => id)).toEqual([
			"primary",
			"a",
			"b",
			"c",
			"fallback",
			"last",
		]);
	});
	test("does not combine pools from different providers, variants or regions", () => {
		const keys = [
			key("a", "round_robin"),
			key("other-provider", "round_robin", "default", null, "anthropic"),
			key("other-variant", "round_robin", "enterprise"),
			key("other-region", "round_robin", "default", "eu"),
			key("fallback"),
			key("b", "round_robin"),
		];
		expect(providerKeySelectionOrder(keys).map(({ id }) => id)).toEqual([
			"a",
			"b",
			"other-provider",
			"other-variant",
			"other-region",
			"fallback",
		]);
	});
	test("leaves ineligible round-robin keys outside the pool", () => {
		const keys = [
			key("inactive", "round_robin"),
			key("primary"),
			key("a", "round_robin"),
			key("capped", "round_robin"),
			key("fallback"),
			key("b", "round_robin"),
		];
		const eligible = (item: (typeof keys)[number]) =>
			!["inactive", "capped"].includes(item.id);
		expect(
			providerKeySelectionOrder(keys, eligible).map(({ id }) => id),
		).toEqual(["inactive", "primary", "a", "b", "capped", "fallback"]);
	});
	test("normalizes drag commits and allows the ordered fallback to become primary", () => {
		const keys = [
			key("a", "round_robin"),
			key("fallback"),
			key("b", "round_robin"),
		];
		expect(providerKeySelectionOrder(keys).map(({ id }) => id)).toEqual([
			"a",
			"b",
			"fallback",
		]);
		const reordered = providerKeySelectionOrder([keys[1]!, keys[0]!, keys[2]!]);
		expect(reordered.map(({ id }) => id)).toEqual(["fallback", "a", "b"]);
		expect(
			Array.from(providerKeySelectionPositions(reordered).values()),
		).toEqual([1, 2, 2]);
	});
	test("is stable, idempotent and does not mutate the original keys", () => {
		const keys = Object.freeze([
			Object.freeze(key("a", "round_robin")),
			Object.freeze(key("fallback")),
			Object.freeze(key("b", "round_robin")),
		]);
		const displayed = providerKeySelectionOrder(keys);
		expect(providerKeySelectionOrder(displayed)).toEqual(displayed);
		expect(keys.map(({ id }) => id)).toEqual(["a", "fallback", "b"]);
		expect(displayed[0]).toBe(keys[0]);
		expect(
			providerKeySelectionOrder([key("a"), key("b")]).map(({ id }) => id),
		).toEqual(["a", "b"]);
		expect(providerKeySelectionOrder([])).toEqual([]);
	});
}

describe("provider key selection display order", selectionOrderTests);
