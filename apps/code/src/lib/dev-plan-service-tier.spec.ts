import { describe, expect, it } from "vitest";

import { canConfigureDevPlanServiceTier } from "./dev-plan-service-tier";

describe("canConfigureDevPlanServiceTier", () => {
	it("allows users created before August 20, 2026", () => {
		expect(canConfigureDevPlanServiceTier("2026-08-19T23:59:59.999Z")).toBe(
			true,
		);
	});

	it("denies users created on or after August 20, 2026", () => {
		expect(canConfigureDevPlanServiceTier("2026-08-20T00:00:00.000Z")).toBe(
			false,
		);
		expect(canConfigureDevPlanServiceTier("2026-08-21T00:00:00.000Z")).toBe(
			false,
		);
	});
});
