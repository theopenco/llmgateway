import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import {
	checkReferralAllowed,
	checkReferrerEligibility,
	clawBackReferralEarnings,
	normalizeEmailForComparison,
} from "./referral-eligibility.js";

const REFERRER_ORG = "ref-elig-referrer";
const REFERRED_ORG = "ref-elig-referred";
const MEMBER_ID = "ref-elig-member";
const NEW_USER_ID = "ref-elig-new-user";

async function seedReferrer(opts: {
	paid?: string;
	refunded?: string;
	status?: "active" | "inactive" | "deleted";
	riskFlagged?: boolean;
	memberEmail?: string;
	memberIp?: string;
}) {
	await db.insert(tables.organization).values({
		id: REFERRER_ORG,
		name: "Referrer",
		billingEmail: "owner@acme-referrer.test",
		status: opts.status ?? "active",
		riskFlagged: opts.riskFlagged ?? false,
	});
	await db.insert(tables.user).values({
		id: MEMBER_ID,
		email: opts.memberEmail ?? "owner@acme-referrer.test",
		name: "Owner",
	});
	await db.insert(tables.userOrganization).values({
		userId: MEMBER_ID,
		organizationId: REFERRER_ORG,
		role: "owner",
	});
	if (opts.memberIp) {
		await db.insert(tables.session).values({
			token: "ref-elig-session",
			userId: MEMBER_ID,
			ipAddress: opts.memberIp,
			expiresAt: new Date(Date.now() + 86_400_000),
		});
	}
	if (opts.paid) {
		await db.insert(tables.transaction).values({
			organizationId: REFERRER_ORG,
			type: "credit_topup",
			amount: opts.paid,
			creditAmount: opts.paid,
			currency: "USD",
			status: "completed",
		});
	}
	if (opts.refunded) {
		await db.insert(tables.transaction).values({
			organizationId: REFERRER_ORG,
			type: "credit_refund",
			amount: opts.refunded,
			creditAmount: `-${opts.refunded}`,
			currency: "USD",
			status: "completed",
		});
	}
}

const newUser = (email: string) => ({ id: NEW_USER_ID, email });

describe("normalizeEmailForComparison", () => {
	test("collapses gmail dots, plus tags and googlemail", () => {
		expect(normalizeEmailForComparison("Jo.Hn+abuse@GoogleMail.com")).toBe(
			"john@gmail.com",
		);
	});

	test("keeps dots for other domains but drops plus tags", () => {
		expect(normalizeEmailForComparison("jo.hn+x@acme.test")).toBe(
			"jo.hn@acme.test",
		);
	});
});

describe("referral eligibility", () => {
	beforeEach(async () => {
		await deleteAll();
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("refuses a referrer that never paid", async () => {
		await seedReferrer({});
		expect(await checkReferrerEligibility(REFERRER_ORG)).toEqual({
			eligible: false,
			reason: "referrer_not_eligible",
		});
	});

	test("accepts a referrer with $100 of paid top-ups", async () => {
		await seedReferrer({ paid: "100" });
		expect(await checkReferrerEligibility(REFERRER_ORG)).toEqual({
			eligible: true,
		});
	});

	test("subtracts refunds from paid top-ups", async () => {
		await seedReferrer({ paid: "150", refunded: "100" });
		expect(await checkReferrerEligibility(REFERRER_ORG)).toMatchObject({
			eligible: false,
		});
	});

	test("refuses blocked and risk-flagged referrers", async () => {
		await seedReferrer({ paid: "500", status: "deleted" });
		expect(await checkReferrerEligibility(REFERRER_ORG)).toMatchObject({
			reason: "referrer_inactive",
		});
		await deleteAll();
		await seedReferrer({ paid: "500", riskFlagged: true });
		expect(await checkReferrerEligibility(REFERRER_ORG)).toMatchObject({
			reason: "referrer_risk_flagged",
		});
	});

	test("refuses the same mailbox under an alias", async () => {
		await seedReferrer({ paid: "100", memberEmail: "jane.doe@gmail.com" });
		expect(
			await checkReferralAllowed({
				referrerOrganizationId: REFERRER_ORG,
				referredUser: newUser("janedoe+2@gmail.com"),
			}),
		).toEqual({ allowed: false, reason: "same_email" });
	});

	test("refuses a shared company domain but not a shared freemail domain", async () => {
		await seedReferrer({ paid: "100" });
		expect(
			await checkReferralAllowed({
				referrerOrganizationId: REFERRER_ORG,
				referredUser: newUser("someone@acme-referrer.test"),
			}),
		).toEqual({ allowed: false, reason: "same_email_domain" });

		await deleteAll();
		await seedReferrer({ paid: "100", memberEmail: "owner@gmail.com" });
		expect(
			await checkReferralAllowed({
				referrerOrganizationId: REFERRER_ORG,
				referredUser: newUser("friend@gmail.com"),
			}),
		).toEqual({ allowed: true });
	});

	test("refuses a signup from an IP a referrer member used", async () => {
		await seedReferrer({ paid: "100", memberIp: "203.0.113.7" });
		expect(
			await checkReferralAllowed({
				referrerOrganizationId: REFERRER_ORG,
				referredUser: newUser("friend@other.test"),
				ipAddress: "203.0.113.7",
			}),
		).toEqual({ allowed: false, reason: "same_ip" });
		expect(
			await checkReferralAllowed({
				referrerOrganizationId: REFERRER_ORG,
				referredUser: newUser("friend@other.test"),
				ipAddress: "198.51.100.9",
			}),
		).toEqual({ allowed: true });
	});

	test("claws back referral earnings after a refund, clamped to what was earned", async () => {
		await seedReferrer({ paid: "100" });
		await db
			.update(tables.organization)
			.set({ credits: "10", referralEarnings: "0.5" })
			.where(eq(tables.organization.id, REFERRER_ORG));
		await db.insert(tables.organization).values({
			id: REFERRED_ORG,
			name: "Referred",
			billingEmail: "friend@other.test",
		});
		await db.insert(tables.referral).values({
			referrerOrganizationId: REFERRER_ORG,
			referredOrganizationId: REFERRED_ORG,
		});

		await clawBackReferralEarnings(REFERRED_ORG, 20);
		let referrer = await db.query.organization.findFirst({
			where: { id: { eq: REFERRER_ORG } },
		});
		expect(Number(referrer?.credits)).toBeCloseTo(9.8);
		expect(Number(referrer?.referralEarnings)).toBeCloseTo(0.3);

		await clawBackReferralEarnings(REFERRED_ORG, 1000);
		referrer = await db.query.organization.findFirst({
			where: { id: { eq: REFERRER_ORG } },
		});
		expect(Number(referrer?.credits)).toBeCloseTo(9.5);
		expect(Number(referrer?.referralEarnings)).toBe(0);
	});
});
