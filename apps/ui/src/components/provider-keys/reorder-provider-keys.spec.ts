import { describe, expect, it } from "vitest";

import { reorderProviderKeys } from "./reorder-provider-keys";

/**
 * This runs against the TanStack cache during a drag, so it must not disturb
 * anything the dragged group does not own — the cache holds every
 * organization's keys, including ones the view filters out.
 */
describe("reorderProviderKeys", () => {
	const data = {
		providerKeys: [
			{ id: "a", provider: "openai" },
			{ id: "x", provider: "anthropic" },
			{ id: "b", provider: "openai" },
			{ id: "c", provider: "openai" },
			{ id: "y", provider: "anthropic" },
		],
	};

	it("reslots the dragged provider's keys into their own positions", () => {
		const result = reorderProviderKeys(data, "openai", ["c", "a", "b"]);

		expect(result?.providerKeys.map((key) => key.id)).toEqual([
			"c",
			"x",
			"a",
			"b",
			"y",
		]);
	});

	it("leaves other providers exactly where they were", () => {
		const result = reorderProviderKeys(data, "openai", ["c", "b", "a"]);
		const anthropic = result?.providerKeys.filter(
			(key) => key.provider === "anthropic",
		);

		expect(anthropic?.map((key) => key.id)).toEqual(["x", "y"]);
		// And they keep their absolute slots, not just their relative order.
		expect(result?.providerKeys[1].id).toBe("x");
		expect(result?.providerKeys[4].id).toBe("y");
	});

	it("ignores ids that are not in the cache", () => {
		// A key deleted in another tab would otherwise shift everything by one.
		const result = reorderProviderKeys(data, "openai", ["c", "gone", "a", "b"]);

		expect(result?.providerKeys.map((key) => key.id)).toEqual([
			"c",
			"x",
			"a",
			"b",
			"y",
		]);
	});

	it("passes undefined through", () => {
		expect(reorderProviderKeys(undefined, "openai", ["a"])).toBeUndefined();
	});
});
