import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { handleChargeRefunded, handleEndUserTopUpSucceeded } from "@/stripe.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

// Real Stripe test-mode round trip: create + confirm a PaymentIntent and issue a
// refund through Stripe, driving the actual webhook handlers and the admin
// /metrics revenue query. Requires a Stripe *test* secret key; skipped otherwise
// so the hermetic unit suite (and CI without the key) stays green.
const stripeKey = process.env.STRIPE_SECRET_KEY;
const hasStripeTestKey = !!stripeKey && stripeKey.startsWith("sk_test_");

const ORG_ID = "sdk-poc-org-id";
const PROJECT_ID = "sdk-poc-project-id";
const PLATFORM_SECRET = "sk_pocbonus_live_secret";

interface SessionResponse {
	sessionToken: string;
	walletId: string;
	endCustomerId: string;
}

interface TopUpResponse {
	clientSecret: string;
	totalAmount: number;
	netCredited: number;
	bonusCredited: number;
}

interface AdminMetrics {
	totalRevenue: number;
	totalToppedUp: number;
	totalGiftedCredits: number;
	totalBonusCredits: number;
}

describe.skipIf(!hasStripeTestKey)(
	"end-user bonus full flow (real Stripe)",
	() => {
		const stripe = hasStripeTestKey
			? new Stripe(stripeKey!)
			: (undefined as unknown as Stripe);
		let adminCookie: string;

		beforeEach(async () => {
			process.env.ADMIN_EMAILS = "admin@example.com";
			// Seeds admin@example.com + returns an admin session cookie (also wipes DB).
			adminCookie = await createTestUser();

			await db.insert(tables.organization).values({
				id: ORG_ID,
				name: "Payments SDK POC",
				billingEmail: "admin@example.com",
				credits: "100",
			});

			await db.insert(tables.project).values({
				id: PROJECT_ID,
				name: "Payments SDK POC",
				organizationId: ORG_ID,
				mode: "credits",
				paymentsSdkEnabled: true,
				endUserEnabled: true,
				endUserTopUpBonusPercent: "50",
			});

			await db.insert(tables.apiKey).values({
				id: "sdk-poc-platform-secret-id",
				token: PLATFORM_SECRET,
				projectId: PROJECT_ID,
				description: "Payments SDK POC platform secret",
				keyType: "platform_secret",
				createdBy: "test-user-id",
			});

			// A normal org credit purchase so admin revenue is non-zero and we can show
			// the end-user SDK flow never moves it.
			await db.insert(tables.transaction).values({
				organizationId: ORG_ID,
				type: "credit_topup",
				amount: "21",
				creditAmount: "20",
				status: "completed",
			});
		});

		afterEach(async () => {
			await deleteAll();
		});

		async function getMetrics(): Promise<AdminMetrics> {
			const res = await app.request("/admin/metrics", {
				headers: { Cookie: adminCookie },
			});
			expect(res.status).toBe(200);
			return (await res.json()) as AdminMetrics;
		}

		async function orgCredits(): Promise<number> {
			const org = await db.query.organization.findFirst({
				where: { id: { eq: ORG_ID } },
			});
			return Number(org?.credits ?? "0");
		}

		async function walletBalance(walletId: string): Promise<number> {
			const wallet = await db.query.wallet.findFirst({
				where: { id: { eq: walletId } },
			});
			return Number(wallet?.balance ?? "0");
		}

		test("purchase gets +50% bonus; top-up is revenue; refund reverses both", async () => {
			// Baseline: one real org purchase → $20 revenue, no bonus yet.
			const baseline = await getMetrics();
			expect(baseline.totalRevenue).toBe(20);
			expect(baseline.totalBonusCredits).toBe(0);

			// 1. Mint an end-user session with the platform secret key.
			const sessionRes = await app.request("/v1/sessions", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${PLATFORM_SECRET}`,
				},
				body: JSON.stringify({ customer: "poc-end-user-1" }),
			});
			expect(sessionRes.status).toBe(201);
			const session = (await sessionRes.json()) as SessionResponse;

			// 2. Create a $10 top-up. The quote should already reflect the +50% bonus.
			const topRes = await app.request("/v1/wallet/top-up", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${session.sessionToken}`,
				},
				body: JSON.stringify({ amount: 10 }),
			});
			expect(topRes.status).toBe(200);
			const top = (await topRes.json()) as TopUpResponse;
			expect(top.netCredited).toBe(10);
			expect(top.bonusCredited).toBe(5);

			// 3. Confirm the PaymentIntent as the end-user would (Stripe test card).
			const piId = top.clientSecret.split("_secret_")[0];
			await stripe.paymentIntents.confirm(piId, {
				payment_method: "pm_card_visa",
				return_url: "https://example.com/return",
			});
			const pi = await stripe.paymentIntents.retrieve(piId);
			expect(pi.status).toBe("succeeded");

			// 4. Deliver the payment_intent.succeeded webhook.
			await handleEndUserTopUpSucceeded(pi);

			// Wallet credited $10 paid + $5 bonus; org funded the $5 bonus.
			expect(await walletBalance(session.walletId)).toBe(15);
			expect(await orgCredits()).toBe(95);

			const ledgerAfterTopUp = await db.query.walletLedger.findMany({
				where: { walletId: { eq: session.walletId } },
			});
			expect(
				Number(ledgerAfterTopUp.find((r) => r.type === "topup")?.amount),
			).toBe(10);
			expect(
				Number(ledgerAfterTopUp.find((r) => r.type === "bonus")?.amount),
			).toBe(5);

			const grantTxn = await db.query.transaction.findFirst({
				where: {
					organizationId: { eq: ORG_ID },
					type: { eq: "end_user_bonus" },
				},
			});
			expect(Number(grantTxn?.creditAmount)).toBe(-5);

			// Admin dashboard: the $10 end-user top-up counts as revenue ($20 base +
			// $10 = $30); the $5 bonus does NOT (it's a cost) and is tracked
			// separately. Topped-up (org credit economy) stays $20.
			const afterTopUp = await getMetrics();
			expect(afterTopUp.totalRevenue).toBe(30);
			expect(afterTopUp.totalToppedUp).toBe(20);
			expect(afterTopUp.totalBonusCredits).toBe(5);

			// 5. Refund the payment through Stripe, then deliver charge.refunded.
			await stripe.refunds.create({ payment_intent: piId });
			const charge = await stripe.charges.retrieve(pi.latest_charge as string);
			await handleChargeRefunded({
				data: { object: charge },
			} as unknown as Stripe.ChargeRefundedEvent);

			// Wallet emptied (paid + bonus reversed); org credits restored.
			expect(await walletBalance(session.walletId)).toBe(0);
			expect(await orgCredits()).toBe(100);

			// The reversal ledger row pulled back the full $15 (paid + bonus).
			const reversal = await db.query.walletLedger.findFirst({
				where: {
					walletId: { eq: session.walletId },
					type: { eq: "reversal" },
				},
			});
			expect(Number(reversal?.amount)).toBe(-15);

			// The bonus grant (-5) and its claw-back (+5) net to zero.
			const bonusTxns = await db.query.transaction.findMany({
				where: {
					organizationId: { eq: ORG_ID },
					type: { eq: "end_user_bonus" },
				},
			});
			const bonusNet = bonusTxns.reduce(
				(sum, t) => sum + Number(t.creditAmount),
				0,
			);
			expect(bonusNet).toBe(0);

			// Admin dashboard after the full round trip: the top-up revenue is
			// reversed, so net revenue is back to the $20 baseline, and bonus credits
			// are back to $0.
			const afterRefund = await getMetrics();
			expect(afterRefund.totalRevenue).toBe(20);
			expect(afterRefund.totalToppedUp).toBe(20);
			expect(afterRefund.totalBonusCredits).toBe(0);
		});
	},
);
