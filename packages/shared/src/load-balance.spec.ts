import { describe, expect, it } from "vitest";

import { selectLoadBalancedItem } from "./load-balance.js";

describe("selectLoadBalancedItem", () => {
	it("returns undefined for an empty list", () => {
		expect(selectLoadBalancedItem([], "request-1")).toBeUndefined();
	});

	it("returns the first item when no selection key is provided", () => {
		expect(selectLoadBalancedItem(["a", "b", "c"])).toBe("a");
	});

	it("returns the same item for the same key", () => {
		const items = ["a", "b", "c"];

		expect(selectLoadBalancedItem(items, "request-1")).toBe(
			selectLoadBalancedItem(items, "request-1"),
		);
	});

	it("distributes across multiple items for different keys", () => {
		const items = ["a", "b", "c"];
		const selectedItems = new Set(
			Array.from({ length: 32 }, (_, index) =>
				selectLoadBalancedItem(items, `request-${index}`),
			),
		);

		expect(selectedItems.size).toBeGreaterThan(1);
	});
});
