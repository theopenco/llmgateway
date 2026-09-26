import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const ORG_A = "sdk-org-a";
const ORG_B = "sdk-org-b";

interface SdkTotals {
	grossPaid: number;
	grossPaidRefunded: number;
	platformFee: number;
	platformFeeRefunded: number;
	developerMargin: number;
	developerMarginRefunded: number;
	netCredited: number;
	netCreditedRefunded: number;
	bonusCredited: number;
	adjustmentsCredited: number;
	bonusFunded: number;
	usageSpent: number;
	walletBalance: number;
	marginOwed: number;
	marginPaidOut: number;
	topUps: number;
	refunds: number;
	wallets: number;
	liveWallets: number;
	testWallets: number;
	endCustomers: number;
	sdkProjects: number;
}

interface SdkResponse {
	totals: SdkTotals;
	organizations: (SdkTotals & {
		organizationId: string;
		organizationName: string;
		maxMarkupPercent: number;
		maxBonusPercent: number;
		stripeConnectOnboarded: boolean;
	})[];
	recentTopUps: {
		id: string;
		organizationId: string;
		mode: string;
		refunded: boolean;
	}[];
	days: number | null;
	mode: string;
}

async function getSdk(cookie: string, query = ""): Promise<SdkResponse> {
	const res = await app.request(`/admin/sdk${query}`, {
		headers: { Cookie: cookie },
	});
	expect(res.status).toBe(200);
	return (await res.json()) as SdkResponse;
}

describe("admin /sdk", () => {
	let cookie: string;

	beforeEach(async () => {
		process.env.ADMIN_EMAILS = "admin@example.com";
		cookie = await createTestUser();

		await db.insert(tables.organization).values([
			{
				id: ORG_A,
				name: "SDK Org A",
				billingEmail: "a@sdk.test",
				credits: "100",
				endUserMarginBalance: "4",
				stripeConnectOnboarded: true,
			},
			{
				id: ORG_B,
				name: "SDK Org B",
				billingEmail: "b@sdk.test",
				credits: "50",
				endUserMarginBalance: "0",
			},
		]);

		await db.insert(tables.project).values([
			{
				id: "sdk-project-a",
				name: "SDK Project A",
				organizationId: ORG_A,
				endUserEnabled: true,
				paymentsSdkEnabled: true,
				endUserMarkupPercent: "25",
				endUserTopUpBonusPercent: "10",
			},
			{
				id: "sdk-project-b",
				name: "SDK Project B",
				organizationId: ORG_B,
				endUserEnabled: true,
				endUserMarkupPercent: "0",
			},
		]);

		await db.insert(tables.endCustomer).values([
			{
				id: "sdk-customer-a",
				organizationId: ORG_A,
				projectId: "sdk-project-a",
				externalId: "user-a",
				mode: "live",
			},
			{
				id: "sdk-customer-a-test",
				organizationId: ORG_A,
				projectId: "sdk-project-a",
				externalId: "user-a",
				mode: "test",
			},
			{
				id: "sdk-customer-b",
				organizationId: ORG_B,
				projectId: "sdk-project-b",
				externalId: "user-b",
				mode: "live",
			},
		]);

		await db.insert(tables.wallet).values([
			{
				id: "sdk-wallet-a",
				endCustomerId: "sdk-customer-a",
				projectId: "sdk-project-a",
				organizationId: ORG_A,
				mode: "live",
				balance: "12",
			},
			{
				id: "sdk-wallet-a-test",
				endCustomerId: "sdk-customer-a-test",
				projectId: "sdk-project-a",
				organizationId: ORG_A,
				mode: "test",
				balance: "5",
			},
			{
				id: "sdk-wallet-b",
				endCustomerId: "sdk-customer-b",
				projectId: "sdk-project-b",
				organizationId: ORG_B,
				mode: "live",
				balance: "3",
			},
		]);

		await db.insert(tables.walletLedger).values([
			// Org A: a $25 top-up at 25% markup — $26.25 paid, $1.25 platform fee,
			// $5 developer margin, $20 credited. Kept.
			{
				walletId: "sdk-wallet-a",
				endCustomerId: "sdk-customer-a",
				organizationId: ORG_A,
				type: "topup",
				amount: "20",
				balanceAfter: "20",
				grossPaid: "26.25",
				platformFee: "1.25",
				developerMargin: "5",
				netCredited: "20",
				stripePaymentIntentId: "pi_sdk_a_kept",
			},
			// Org A: an identical top-up that was refunded.
			{
				walletId: "sdk-wallet-a",
				endCustomerId: "sdk-customer-a",
				organizationId: ORG_A,
				type: "topup",
				amount: "20",
				balanceAfter: "40",
				grossPaid: "26.25",
				platformFee: "1.25",
				developerMargin: "5",
				netCredited: "20",
				stripePaymentIntentId: "pi_sdk_a_refunded",
			},
			{
				walletId: "sdk-wallet-a",
				endCustomerId: "sdk-customer-a",
				organizationId: ORG_A,
				type: "reversal",
				amount: "-20",
				balanceAfter: "20",
				stripePaymentIntentId: "pi_sdk_a_refunded",
			},
			{
				walletId: "sdk-wallet-a",
				endCustomerId: "sdk-customer-a",
				organizationId: ORG_A,
				type: "bonus",
				amount: "2",
				balanceAfter: "22",
				stripePaymentIntentId: "pi_sdk_a_kept",
			},
			{
				walletId: "sdk-wallet-a",
				endCustomerId: "sdk-customer-a",
				organizationId: ORG_A,
				type: "usage_debit",
				amount: "-10",
				balanceAfter: "12",
			},
			// Test-mode wallet: sandbox money, no margin.
			{
				walletId: "sdk-wallet-a-test",
				endCustomerId: "sdk-customer-a-test",
				organizationId: ORG_A,
				type: "topup",
				amount: "5",
				balanceAfter: "5",
				grossPaid: "5.25",
				platformFee: "0.25",
				developerMargin: "0",
				netCredited: "5",
				stripePaymentIntentId: "pi_sdk_a_test",
			},
			// Org B: a free server-side grant, no payment behind it.
			{
				walletId: "sdk-wallet-b",
				endCustomerId: "sdk-customer-b",
				organizationId: ORG_B,
				type: "adjustment",
				amount: "3",
				balanceAfter: "3",
			},
		]);

		await db.insert(tables.transaction).values([
			{
				organizationId: ORG_A,
				type: "end_user_bonus",
				amount: "2",
				creditAmount: "-2",
				status: "completed",
			},
			{
				organizationId: ORG_A,
				type: "end_user_margin_payout",
				amount: "6",
				creditAmount: "6",
				status: "completed",
			},
			// Unrelated org credit purchase — must not leak into SDK numbers.
			{
				organizationId: ORG_A,
				type: "credit_topup",
				amount: "105",
				creditAmount: "100",
				status: "completed",
			},
		]);
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("rejects unauthenticated requests", async () => {
		expect((await app.request("/admin/sdk")).status).toBe(401);
	});

	test("splits top-up economics and separates refunded amounts", async () => {
		const body = await getSdk(cookie);

		expect(body.totals.grossPaid).toBeCloseTo(57.75, 2);
		expect(body.totals.grossPaidRefunded).toBeCloseTo(26.25, 2);
		expect(body.totals.platformFee).toBeCloseTo(2.75, 2);
		expect(body.totals.platformFeeRefunded).toBeCloseTo(1.25, 2);
		expect(body.totals.developerMargin).toBeCloseTo(10, 2);
		expect(body.totals.developerMarginRefunded).toBeCloseTo(5, 2);
		expect(body.totals.netCredited).toBeCloseTo(45, 2);
		expect(body.totals.topUps).toBe(3);
		expect(body.totals.refunds).toBe(1);
	});

	test("reports wallet flows, balances and developer liabilities", async () => {
		const body = await getSdk(cookie);

		expect(body.totals.bonusCredited).toBeCloseTo(2, 2);
		expect(body.totals.bonusFunded).toBeCloseTo(2, 2);
		expect(body.totals.adjustmentsCredited).toBeCloseTo(3, 2);
		expect(body.totals.usageSpent).toBeCloseTo(10, 2);
		expect(body.totals.walletBalance).toBeCloseTo(20, 2);
		expect(body.totals.marginOwed).toBeCloseTo(4, 2);
		expect(body.totals.marginPaidOut).toBeCloseTo(6, 2);
		expect(body.totals.wallets).toBe(3);
		expect(body.totals.liveWallets).toBe(2);
		expect(body.totals.testWallets).toBe(1);
		expect(body.totals.endCustomers).toBe(3);
		expect(body.totals.sdkProjects).toBe(2);
	});

	test("breaks the economics down per organization", async () => {
		const body = await getSdk(cookie);

		expect(body.organizations.map((o) => o.organizationId)).toEqual([
			ORG_A,
			ORG_B,
		]);

		const [orgA, orgB] = body.organizations;
		expect(orgA.platformFee).toBeCloseTo(2.75, 2);
		expect(orgA.marginOwed).toBeCloseTo(4, 2);
		expect(orgA.bonusFunded).toBeCloseTo(2, 2);
		expect(orgA.maxMarkupPercent).toBe(25);
		expect(orgA.maxBonusPercent).toBe(10);
		expect(orgA.stripeConnectOnboarded).toBe(true);

		// Org B never took a payment — only a free grant.
		expect(orgB.grossPaid).toBe(0);
		expect(orgB.adjustmentsCredited).toBeCloseTo(3, 2);
		expect(orgB.walletBalance).toBeCloseTo(3, 2);
		expect(orgB.stripeConnectOnboarded).toBe(false);
	});

	test("filters sandbox money out of the live view", async () => {
		const body = await getSdk(cookie, "?mode=live");

		expect(body.totals.grossPaid).toBeCloseTo(52.5, 2);
		expect(body.totals.platformFee).toBeCloseTo(2.5, 2);
		expect(body.totals.topUps).toBe(2);
		expect(body.totals.wallets).toBe(2);
		expect(body.totals.testWallets).toBe(0);
		expect(body.totals.endCustomers).toBe(2);
		expect(body.recentTopUps.every((t) => t.mode === "live")).toBe(true);
	});

	test("sorts organizations by the requested column", async () => {
		const body = await getSdk(cookie, "?sortBy=walletBalance");
		expect(body.organizations[0].organizationId).toBe(ORG_A);

		const byAdjustment = await getSdk(cookie, "?sortBy=usageSpent");
		expect(byAdjustment.organizations[0].organizationId).toBe(ORG_A);
	});

	test("marks refunded top-ups in the recent activity feed", async () => {
		const body = await getSdk(cookie);

		expect(body.recentTopUps).toHaveLength(3);
		expect(body.recentTopUps.filter((t) => t.refunded)).toHaveLength(1);
	});
});
