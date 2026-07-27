import { describe, expect, test } from "vitest";

import { isMappingDeactivated } from "./deactivation";

const now = new Date("2026-07-27T00:00:00.000Z");

describe("isMappingDeactivated", () => {
	test("is false without a deactivation date", () => {
		expect(isMappingDeactivated({}, now)).toBe(false);
		expect(isMappingDeactivated({ deactivatedAt: null }, now)).toBe(false);
	});

	test("is true once the date has passed", () => {
		expect(
			isMappingDeactivated({ deactivatedAt: new Date("2026-07-26") }, now),
		).toBe(true);
		expect(isMappingDeactivated({ deactivatedAt: "2026-01-01" }, now)).toBe(
			true,
		);
	});

	test("is false for a scheduled future deactivation", () => {
		expect(
			isMappingDeactivated({ deactivatedAt: new Date("2026-07-28") }, now),
		).toBe(false);
		expect(isMappingDeactivated({ deactivatedAt: "2026-12-31" }, now)).toBe(
			false,
		);
	});
});
