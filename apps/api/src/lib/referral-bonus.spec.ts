import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

import {
	computeReferralBonus,
	parseReferralBonusPercent,
} from "./referral-bonus.js";

const REFERRER_ID = "ref-bonus-referrer";
const REFERRED_ID = "ref-bonus-referred";

async function seed(opts: {
	referralBonusEnabled: boolean;
	referralBonusPercent?: string;
	withReferral?: boolean;
}) {
	await db.insert(tables.organization).values({
		id: REFERRER_ID,
		name: "Referrer Org",
		billingEmail: "referrer@test.example",
		referralBonusEnabled: opts.referralBonusEnabled,
		referralBonusPercent: opts.referralBonusPercent ?? "50",
	});
	await db.insert(tables.organization).values({
		id: REFERRED_ID,
		name: "Referred Org",
		billingEmail: "referred@test.example",
	});
	if (opts.withReferral ?? true) {
		await db.insert(tables.referral).values({
			referrerOrganizationId: REFERRER_ID,
			referredOrganizationId: REFERRED_ID,
		});
	}
}

describe("parseReferralBonusPercent", () => {
	test("parses valid values", () => {
		expect(parseReferralBonusPercent("50")).toBe(50);
		expect(parseReferralBonusPercent(25)).toBe(25);
		expect(parseReferralBonusPercent("0")).toBe(0);
	});

	test("falls back to default for malformed values", () => {
		expect(parseReferralBonusPercent("not-a-number")).toBe(50);
		expect(parseReferralBonusPercent(null)).toBe(50);
		expect(parseReferralBonusPercent(undefined)).toBe(50);
	});
});

describe("computeReferralBonus", () => {
	beforeEach(async () => {
		await deleteAll();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("applies the referrer's configured percent", async () => {
		await seed({ referralBonusEnabled: true, referralBonusPercent: "50" });
		expect(await computeReferralBonus(REFERRED_ID, 100)).toBe(50);
	});

	test("supports a custom percent", async () => {
		await seed({ referralBonusEnabled: true, referralBonusPercent: "20" });
		expect(await computeReferralBonus(REFERRED_ID, 100)).toBe(20);
	});

	test("returns 0 when the referrer has the bonus disabled", async () => {
		await seed({ referralBonusEnabled: false, referralBonusPercent: "50" });
		expect(await computeReferralBonus(REFERRED_ID, 100)).toBe(0);
	});

	test("returns 0 when the org was not referred", async () => {
		await seed({ referralBonusEnabled: true, withReferral: false });
		expect(await computeReferralBonus(REFERRED_ID, 100)).toBe(0);
	});

	test("returns 0 for a malformed (non-positive) percent", async () => {
		await seed({ referralBonusEnabled: true, referralBonusPercent: "0" });
		expect(await computeReferralBonus(REFERRED_ID, 100)).toBe(0);
	});
});
