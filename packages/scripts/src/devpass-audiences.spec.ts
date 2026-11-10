import { expect, test } from "vitest";

import {
	isDevPassAudience,
	selectDevPassAudience,
	type DevPassMembership,
} from "./devpass-audiences.js";

// Ways a campaign reaches the wrong people: a current subscriber is asked to
// come back, someone who never paid is, a cancelled plan still inside its paid
// period counts as gone, a healthy subscriber is told a payment failed, a
// person with two organizations gets the mail twice or for the wrong one, or
// addresses that differ only in case are treated as two people.

const now = new Date("2026-11-10T12:00:00Z");
const later = new Date("2026-11-20T00:00:00Z");
const earlier = new Date("2026-11-01T00:00:00Z");

function member(
	email: string,
	overrides: Partial<DevPassMembership> = {},
): DevPassMembership {
	return {
		email,
		name: null,
		devPlan: "pro",
		cancelled: false,
		expiresAt: later,
		hasSubscription: true,
		paymentStatus: "current",
		everPaid: true,
		...overrides,
	};
}

const gone = { devPlan: "none", hasSubscription: false, expiresAt: null };

const rows = [
	member("active@example.com"),
	member("cancelled-running@example.com", { cancelled: true }),
	member("cancelled-ended@example.com", { cancelled: true, expiresAt: earlier }),
	member("past-due@example.com", { paymentStatus: "past_due" }),
	member("left@example.com", gone),
	member("Left@Example.com", gone),
	member("never-paid@example.com", { ...gone, everPaid: false }),
	member("came-back@example.com", gone),
	member("came-back@example.com"),
	member("no-subscription@example.com", { hasSubscription: false }),
	member("stale-flag@example.com", { ...gone, paymentStatus: "past_due" }),
];

function emails(audience: "active" | "past" | "past-due"): string[] {
	return selectDevPassAudience(rows, audience, now).map((row) => row.email);
}

test("active is every plan that still runs, once per address", () => {
	expect(emails("active")).toEqual([
		"active@example.com",
		"came-back@example.com",
		"cancelled-running@example.com",
		"past-due@example.com",
	]);
});

test("past-due is only running plans whose renewal failed", () => {
	expect(emails("past-due")).toEqual(["past-due@example.com"]);
});

test("past is people who paid once and have no plan anywhere now", () => {
	expect(emails("past")).toEqual([
		"left@example.com",
		"stale-flag@example.com",
	]);
});

test("only the three audiences are accepted", () => {
	expect(["active", "past", "past-due"].every(isDevPassAudience)).toBe(true);
	expect(isDevPassAudience("everyone")).toBe(false);
});
