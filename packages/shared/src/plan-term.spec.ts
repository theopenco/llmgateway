import { describe, expect, test } from "vitest";

import {
	addCalendarDays,
	extendTrialEnd,
	formatPlanTermBadge,
	formatPlanTermLabel,
	getOrganizationTerm,
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

describe("getOrganizationTerm", () => {
	const trial = {
		isTrialActive: true,
		trialStartDate: "2026-07-21T00:00:00Z",
		trialEndDate: "2026-08-20T00:00:00Z",
	};
	const contract = {
		planStartedAt: "2026-01-01T00:00:00Z",
		planExpiresAt: "2027-01-01T00:00:00Z",
	};

	test("returns null without a trial or a plan term", () => {
		expect(getOrganizationTerm({ now })).toBeNull();
		expect(
			getOrganizationTerm({ isTrialActive: true, trialEndDate: null, now }),
		).toBeNull();
	});

	test("ignores an expiry date that was never booked as a term", () => {
		// A legacy Pro renewal date written by Stripe, on an organization since
		// moved to enterprise: no start date, so no agreement, so no countdown.
		// Without this an untouched enterprise plan would announce that it had
		// expired months ago.
		expect(
			getOrganizationTerm({ planExpiresAt: "2026-03-01T00:00:00Z", now }),
		).toBeNull();
		expect(
			getOrganizationTerm({ planExpiresAt: "2027-03-01T00:00:00Z", now }),
		).toBeNull();
		// A start date on its own is not a term either.
		expect(
			getOrganizationTerm({ planStartedAt: "2026-01-01T00:00:00Z", now }),
		).toBeNull();
	});

	test("a trial is unaffected by the missing plan term", () => {
		const resolved = getOrganizationTerm({
			...trial,
			planExpiresAt: "2026-03-01T00:00:00Z",
			now,
		});

		expect(resolved?.kind).toBe("trial");
	});

	test("an active trial takes precedence over the contract term", () => {
		const resolved = getOrganizationTerm({ ...trial, ...contract, now });

		expect(resolved?.kind).toBe("trial");
		expect(resolved?.term.daysLeft).toBe(13);
		expect(resolved?.term.totalDays).toBe(30);
	});

	test("falls back to the contract term once the trial is over", () => {
		const resolved = getOrganizationTerm({
			...trial,
			...contract,
			isTrialActive: false,
			now,
		});

		expect(resolved?.kind).toBe("contract");
		expect(resolved?.term.expiresAt.toISOString()).toBe(
			"2027-01-01T00:00:00.000Z",
		);
	});

	test("a trial uses thresholds scaled to its 30-day window", () => {
		// 13 days into a 30-day trial is healthy, though it would be "expiring"
		// under the contract thresholds.
		expect(getOrganizationTerm({ ...trial, now })?.term.status).toBe("active");

		const endingSoon = getOrganizationTerm({
			isTrialActive: true,
			trialStartDate: "2026-07-14T00:00:00Z",
			trialEndDate: "2026-08-13T00:00:00Z",
			now,
		});
		expect(endingSoon?.term.daysLeft).toBe(6);
		expect(endingSoon?.term.status).toBe("expiring");

		const lastDays = getOrganizationTerm({
			isTrialActive: true,
			trialEndDate: "2026-08-09T00:00:00Z",
			now,
		});
		expect(lastDays?.term.daysLeft).toBe(2);
		expect(lastDays?.term.status).toBe("critical");
	});

	test("an expired trial still reports as the live term", () => {
		const resolved = getOrganizationTerm({
			isTrialActive: true,
			trialStartDate: "2026-06-01T00:00:00Z",
			trialEndDate: "2026-07-01T00:00:00Z",
			...contract,
			now,
		});

		expect(resolved?.kind).toBe("trial");
		expect(resolved?.term.status).toBe("expired");
	});
});

describe("addCalendarDays", () => {
	test("adds days across month and year boundaries", () => {
		expect(addCalendarDays("2026-08-07", 30)).toBe("2026-09-06");
		expect(addCalendarDays("2026-12-20", 14)).toBe("2027-01-03");
		expect(addCalendarDays("2028-02-28", 1)).toBe("2028-02-29");
		expect(addCalendarDays("2026-08-07", 0)).toBe("2026-08-07");
	});
});

describe("extendTrialEnd", () => {
	const today = "2026-08-07";

	test("extends a running trial from its own end date", () => {
		// 10 days left plus a 7-day extension leaves 17, not 7.
		expect(extendTrialEnd("2026-08-17", 7, today)).toBe("2026-08-24");
	});

	test("extends a lapsed trial from today", () => {
		// Extending from the old end date would land in the past and read as a
		// no-op, so a lapsed trial gets the full extension as runway.
		expect(extendTrialEnd("2026-07-01", 14, today)).toBe("2026-08-21");
	});

	test("extends a trial that ends today from today", () => {
		expect(extendTrialEnd(today, 7, today)).toBe("2026-08-14");
	});

	test("starts the window from today when there is no end date yet", () => {
		expect(extendTrialEnd(null, 30, today)).toBe("2026-09-06");
		expect(extendTrialEnd(undefined, 30, today)).toBe("2026-09-06");
	});
});
