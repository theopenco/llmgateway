import { describe, expect, test } from "vitest";

import { forwardedSafetyIdentifier } from "./safety-identifier.js";

describe("forwardedSafetyIdentifier", () => {
	test("forwards unless a managed credential turns it off", () => {
		expect(forwardedSafetyIdentifier(undefined, "key_a")).toBe("key_a");
		expect(
			forwardedSafetyIdentifier(
				{ managed: true, forwardSafetyIdentifier: true },
				"key_a",
			),
		).toBe("key_a");
		expect(
			forwardedSafetyIdentifier(
				{ managed: true, forwardSafetyIdentifier: false },
				"key_a",
			),
		).toBeUndefined();
	});

	test("ignores the setting on organization keys", () => {
		expect(
			forwardedSafetyIdentifier(
				{ managed: false, forwardSafetyIdentifier: false },
				"key_a",
			),
		).toBe("key_a");
	});
});
