import { describe, expect, test } from "vitest";

import {
	getMappingStatus,
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

describe("getMappingStatus", () => {
	test("is active without any dates", () => {
		expect(getMappingStatus({}, now)).toBe("active");
		expect(
			getMappingStatus({ deactivatedAt: null, deprecatedAt: null }, now),
		).toBe("active");
	});

	test("is deactivated once the date has passed", () => {
		expect(getMappingStatus({ deactivatedAt: "2026-07-26" }, now)).toBe(
			"deactivated",
		);
		expect(
			getMappingStatus({ deactivatedAt: new Date(now.getTime() - 1) }, now),
		).toBe("deactivated");
	});

	test("is deactivated at the exact boundary (deactivatedAt === now)", () => {
		expect(getMappingStatus({ deactivatedAt: now }, now)).toBe("deactivated");
	});

	test("is scheduled one second into the future", () => {
		expect(
			getMappingStatus({ deactivatedAt: new Date(now.getTime() + 1000) }, now),
		).toBe("scheduled");
	});

	test("is scheduled at exactly 90 days and active one millisecond past it", () => {
		const at90Days = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
		expect(getMappingStatus({ deactivatedAt: at90Days }, now)).toBe(
			"scheduled",
		);
		const past90Days = new Date(at90Days.getTime() + 1);
		expect(getMappingStatus({ deactivatedAt: past90Days }, now)).toBe("active");
	});

	test("is deprecated whenever a deprecation date exists without deactivation", () => {
		expect(getMappingStatus({ deprecatedAt: "2026-07-26" }, now)).toBe(
			"deprecated",
		);
		expect(getMappingStatus({ deprecatedAt: "2028-01-01" }, now)).toBe(
			"deprecated",
		);
	});

	test("scheduled wins over deprecated (urgency precedence)", () => {
		expect(
			getMappingStatus(
				{ deprecatedAt: "2026-07-26", deactivatedAt: "2026-09-01" },
				now,
			),
		).toBe("scheduled");
	});

	test("deactivated wins over both deprecated and scheduled", () => {
		expect(
			getMappingStatus(
				{
					deprecatedAt: "2026-07-26",
					deactivatedAt: "2026-07-26",
				},
				now,
			),
		).toBe("deactivated");
	});

	test("accepts string and Date inputs identically", () => {
		expect(getMappingStatus({ deactivatedAt: "2026-09-01" }, now)).toBe(
			"scheduled",
		);
		expect(
			getMappingStatus({ deactivatedAt: new Date("2026-09-01") }, now),
		).toBe("scheduled");
	});
});
