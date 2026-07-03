import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { db, eq, tables } from "@llmgateway/db";

import {
	handleEndUserTopUpRefunded,
	handleEndUserTopUpSucceeded,
} from "./stripe.js";
import { deleteAll } from "./testing.js";

import type Stripe from "stripe";

const ORG_ID = "bonus-org-id";
const PROJECT_ID = "bonus-project-id";

interface TopUpMetadata {
	walletId: string;
	netCredited: string;
	developerMargin?: string;
	platformFee?: string;
	bonusCredited?: string;
}

function makeTopUpIntent(
	id: string,
	amount: number,
	metadata: TopUpMetadata,
): Stripe.PaymentIntent {
	return {
		id,
		amount,
		metadata: {
			kind: "end_user_topup",
			...metadata,
		},
	} as unknown as Stripe.PaymentIntent;
}

async function seedWallet(opts: {
	walletId: string;
	customerId: string;
	externalId: string;
	mode: "live" | "test";
}) {
	await db.insert(tables.endCustomer).values({
		id: opts.customerId,
		organizationId: ORG_ID,
		projectId: PROJECT_ID,
		externalId: opts.externalId,
		mode: opts.mode,
	});

	await db.insert(tables.wallet).values({
		id: opts.walletId,
		endCustomerId: opts.customerId,
		projectId: PROJECT_ID,
		organizationId: ORG_ID,
		mode: opts.mode,
		balance: "0",
	});
}

async function getOrgCredits(): Promise<number> {
	const org = await db.query.organization.findFirst({
		where: { id: { eq: ORG_ID } },
	});
	return Number(org?.credits ?? "0");
}

async function getWalletBalance(walletId: string): Promise<number> {
	const wallet = await db.query.wallet.findFirst({
		where: { id: { eq: walletId } },
	});
	return Number(wallet?.balance ?? "0");
}

describe("end-user top-up bonus", () => {
	beforeEach(async () => {
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Bonus Org",
			billingEmail: "bonus@example.com",
			credits: "100",
		});

		await db.insert(tables.project).values({
			id: PROJECT_ID,
			name: "Bonus Project",
			organizationId: ORG_ID,
			endUserEnabled: true,
			endUserTopUpBonusPercent: "50",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("credits the bonus and debits the developer org credits (live wallet)", async () => {
		await seedWallet({
			walletId: "wallet-live",
			customerId: "cust-live",
			externalId: "ext-live",
			mode: "live",
		});

		await handleEndUserTopUpSucceeded(
			makeTopUpIntent("pi_bonus_live", 1000, {
				walletId: "wallet-live",
				netCredited: "10",
				bonusCredited: "5",
			}),
		);

		// $10 paid + $5 bonus of spend power.
		expect(await getWalletBalance("wallet-live")).toBe(15);
		// The $5 bonus is funded from the org's credit balance.
		expect(await getOrgCredits()).toBe(95);

		const ledger = await db.query.walletLedger.findMany({
			where: { walletId: { eq: "wallet-live" } },
		});
		const topup = ledger.find((r) => r.type === "topup");
		const bonus = ledger.find((r) => r.type === "bonus");
		expect(Number(topup?.amount)).toBe(10);
		expect(Number(bonus?.amount)).toBe(5);

		const bonusTxn = await db.query.transaction.findFirst({
			where: {
				organizationId: { eq: ORG_ID },
				type: { eq: "end_user_bonus" },
			},
		});
		expect(Number(bonusTxn?.creditAmount)).toBe(-5);
	});

	test("caps the bonus at the org's available credits", async () => {
		await db
			.update(tables.organization)
			.set({ credits: "3" })
			.where(eq(tables.organization.id, ORG_ID));

		await seedWallet({
			walletId: "wallet-cap",
			customerId: "cust-cap",
			externalId: "ext-cap",
			mode: "live",
		});

		await handleEndUserTopUpSucceeded(
			makeTopUpIntent("pi_bonus_cap", 1000, {
				walletId: "wallet-cap",
				netCredited: "10",
				bonusCredited: "5",
			}),
		);

		// Only $3 of bonus could be funded, so the wallet gets $10 + $3.
		expect(await getWalletBalance("wallet-cap")).toBe(13);
		expect(await getOrgCredits()).toBe(0);
	});

	test("never applies a bonus to a test-mode wallet", async () => {
		await seedWallet({
			walletId: "wallet-test",
			customerId: "cust-test",
			externalId: "ext-test",
			mode: "test",
		});

		await handleEndUserTopUpSucceeded(
			makeTopUpIntent("pi_bonus_test", 1000, {
				walletId: "wallet-test",
				netCredited: "10",
				bonusCredited: "5",
			}),
		);

		expect(await getWalletBalance("wallet-test")).toBe(10);
		// Org credits are untouched for sandbox top-ups.
		expect(await getOrgCredits()).toBe(100);

		const bonus = await db.query.walletLedger.findFirst({
			where: { walletId: { eq: "wallet-test" }, type: { eq: "bonus" } },
		});
		expect(bonus).toBeUndefined();
	});

	test("claws back the bonus and restores org credits on refund", async () => {
		await seedWallet({
			walletId: "wallet-refund",
			customerId: "cust-refund",
			externalId: "ext-refund",
			mode: "live",
		});

		await handleEndUserTopUpSucceeded(
			makeTopUpIntent("pi_bonus_refund", 1000, {
				walletId: "wallet-refund",
				netCredited: "10",
				bonusCredited: "5",
			}),
		);
		expect(await getWalletBalance("wallet-refund")).toBe(15);
		expect(await getOrgCredits()).toBe(95);

		const topUpRow = await db.query.walletLedger.findFirst({
			where: {
				stripePaymentIntentId: { eq: "pi_bonus_refund" },
				type: { eq: "topup" },
			},
		});
		expect(topUpRow).toBeDefined();

		await handleEndUserTopUpRefunded(topUpRow!);

		// Both the paid top-up and the developer-funded bonus are pulled back.
		expect(await getWalletBalance("wallet-refund")).toBe(0);
		// The $5 bonus is returned to the org's credit balance.
		expect(await getOrgCredits()).toBe(100);
	});
});
