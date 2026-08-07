import { describe, expect, test } from "vitest";

import {
	formatPlanTermBadge,
	formatPlanTermLabel,
	getPlanTerm,
} from "./plan-term.js";

const now = new Date("2026-08-07T12:00:00Z");

describe("getPlanTerm", () => {
	test("returns null without an expiry date", () => {
		expect(getPlanTerm({ expiresAt: null, now })).toBeNull();
		expect(getPlanTerm({ expiresAt: undefined, now })).toBeNull();
		expect(getPlanTerm({ expiresAt: "not-a-date", now })).toBeNull();
	});

	test("counts whole calendar days regardless of time of day", () => {
		// Earlier in the day than `now`, but still tomorrow: 1 day left, not 0.
		const term = getPlanTerm({ expiresAt: "2026-08-08T01:00:00Z", now });
		expect(term?.daysLeft).toBe(1);
		expect(term?.status).toBe("critical");
	});

	test("classifies each status band", () => {
		const statusOn = (expiresAt: string) =>
			getPlanTerm({ expiresAt, now })?.status;

		expect(statusOn("2026-12-31T00:00:00Z")).toBe("active");
		expect(statusOn("2026-09-06T00:00:00Z")).toBe("expiring"); // 30 days
		expect(statusOn("2026-08-14T00:00:00Z")).toBe("critical"); // 7 days
		expect(statusOn("2026-08-07T00:00:00Z")).toBe("critical"); // expires today
		expect(statusOn("2026-08-06T00:00:00Z")).toBe("expired");
	});

	test("reports elapsed progress across the term", () => {
		const term = getPlanTerm({
			expiresAt: "2026-12-07T12:00:00Z",
			startedAt: "2025-12-07T12:00:00Z",
			now,
		});

		expect(term?.totalDays).toBe(365);
		expect(term?.elapsedFraction).toBeCloseTo(0.666, 2);
	});

	test("clamps elapsed progress once the term is over", () => {
		const term = getPlanTerm({
			expiresAt: "2026-01-01T00:00:00Z",
			startedAt: "2025-01-01T00:00:00Z",
			now,
		});

		expect(term?.elapsedFraction).toBe(1);
		expect(term?.status).toBe("expired");
	});

	test("omits progress when the start date is missing or invalid", () => {
		expect(
			getPlanTerm({ expiresAt: "2026-12-31T00:00:00Z", now })?.elapsedFraction,
		).toBeNull();

		// A start after the expiry is nonsense, so no fraction is inferred.
		expect(
			getPlanTerm({
				expiresAt: "2026-12-31T00:00:00Z",
				startedAt: "2027-01-31T00:00:00Z",
				now,
			})?.elapsedFraction,
		).toBeNull();
	});
});

describe("formatPlanTermLabel", () => {
	const labelFor = (expiresAt: string) =>
		formatPlanTermLabel(getPlanTerm({ expiresAt, now })!);

	test("formats remaining and elapsed terms", () => {
		expect(labelFor("2026-09-06T00:00:00Z")).toBe("30 days left");
		expect(labelFor("2026-08-08T00:00:00Z")).toBe("1 day left");
		expect(labelFor("2026-08-07T00:00:00Z")).toBe("Expires today");
		expect(labelFor("2026-08-06T00:00:00Z")).toBe("Expired yesterday");
		expect(labelFor("2026-08-04T00:00:00Z")).toBe("Expired 3 days ago");
	});
});

describe("formatPlanTermBadge", () => {
	const badgeFor = (expiresAt: string) =>
		formatPlanTermBadge(getPlanTerm({ expiresAt, now })!);

	test("formats compactly", () => {
		expect(badgeFor("2026-09-06T00:00:00Z")).toBe("30d left");
		expect(badgeFor("2026-08-07T00:00:00Z")).toBe("Last day");
		expect(badgeFor("2026-08-06T00:00:00Z")).toBe("Expired");
	});
});
