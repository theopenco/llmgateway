import { describe, expect, test } from "vitest";

import {
	isDeactivationScheduledSoon,
	isMappingDeactivated,
	shouldShowDeactivationNotice,
} from "./deactivation";

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

describe("isDeactivationScheduledSoon", () => {
	test("is false without a deactivation date", () => {
		expect(isDeactivationScheduledSoon({}, now)).toBe(false);
		expect(isDeactivationScheduledSoon({ deactivatedAt: null }, now)).toBe(
			false,
		);
	});

	test("is true inside the notice window", () => {
		expect(
			isDeactivationScheduledSoon({ deactivatedAt: "2026-07-28" }, now),
		).toBe(true);
		expect(
			isDeactivationScheduledSoon(
				{ deactivatedAt: new Date("2026-08-25T00:00:00.000Z") },
				now,
			),
		).toBe(true);
	});

	test("is false beyond the notice window", () => {
		expect(
			isDeactivationScheduledSoon(
				{ deactivatedAt: new Date("2026-08-26T00:00:00.001Z") },
				now,
			),
		).toBe(false);
		expect(
			isDeactivationScheduledSoon({ deactivatedAt: "2028-01-11" }, now),
		).toBe(false);
	});

	test("is false once the date has passed", () => {
		expect(
			isDeactivationScheduledSoon({ deactivatedAt: "2026-07-26" }, now),
		).toBe(false);
	});

	test("honours a custom window", () => {
		expect(
			isDeactivationScheduledSoon({ deactivatedAt: "2026-08-10" }, now, 7),
		).toBe(false);
		expect(
			isDeactivationScheduledSoon({ deactivatedAt: "2026-07-30" }, now, 7),
		).toBe(true);
	});
});

describe("shouldShowDeactivationNotice", () => {
	test("is true for past and near-future dates", () => {
		expect(
			shouldShowDeactivationNotice({ deactivatedAt: "2026-07-26" }, now),
		).toBe(true);
		expect(
			shouldShowDeactivationNotice({ deactivatedAt: "2026-10-25" }, now),
		).toBe(true);
	});

	test("is false for distant dates", () => {
		expect(
			shouldShowDeactivationNotice({ deactivatedAt: "2027-07-27" }, now),
		).toBe(false);
	});
});
