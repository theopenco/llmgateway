/* eslint-disable no-console */
/**
 * POC: exercise the embeddable Payments SDK end-user top-up **bonus** flow
 * end-to-end against your local dev stack, then print the resulting economics so
 * you can eyeball that the bonus and its refund claw-back land correctly.
 *
 * It uses the pre-seeded "Payments SDK POC" project (see packages/db/src/seed.ts):
 * a live-mode platform secret key, a 50% end-user top-up bonus, and an org with
 * $100 of credits to fund the bonus.
 *
 * What it does:
 *   1. Mints an end-user session with the platform secret key.
 *   2. Creates a $10 top-up and prints the quote (should show +$5 bonus).
 *   3. Confirms the Stripe PaymentIntent with a test card (as the end-user would).
 *   4. Polls the wallet balance until the webhook credits it ($15).
 *   5. Prints the wallet ledger, org credits, and transaction rows.
 *   6. (unless --no-refund) refunds via Stripe and re-prints, showing the paid +
 *      bonus reversed and the org credits restored.
 *
 * Prerequisites:
 *   - Dev stack running (API on :4002) built from THIS branch.
 *   - Database seeded: `pnpm --filter db seed` (creates the POC project).
 *   - Stripe test key in ../../.env (STRIPE_SECRET_KEY=sk_test_…).
 *   - Stripe webhooks forwarded to the API so top-ups actually credit:
 *       stripe listen --forward-to localhost:4002/stripe/webhook
 *     and set STRIPE_WEBHOOK_SECRET in .env to the secret it prints.
 *
 * Usage:
 *   pnpm --filter @llmgateway/scripts poc-end-user-bonus
 *   pnpm --filter @llmgateway/scripts poc-end-user-bonus --no-refund
 *
 * Environment:
 *   API_URL          - API base URL (default http://localhost:4002)
 *   PLATFORM_SECRET  - platform secret key (default the seeded POC key)
 *   STRIPE_SECRET_KEY- Stripe test secret key (required)
 *   TOPUP_AMOUNT     - top-up amount in USD (default 10)
 */

import Stripe from "stripe";

import { db, tables } from "@llmgateway/db";

const API_URL = process.env.API_URL ?? "http://localhost:4002";
const PLATFORM_SECRET =
	process.env.PLATFORM_SECRET ?? "sk_pocbonus_live_secret";
const AMOUNT = Number(process.env.TOPUP_AMOUNT ?? "10");
const REFUND = !process.argv.includes("--no-refund");

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
	throw new Error("STRIPE_SECRET_KEY is required (use --env-file=../../.env).");
}
const stripe = new Stripe(stripeKey);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
	const res = await fetch(`${API_URL}${path}`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(`POST ${path} -> ${res.status}: ${await res.text()}`);
	}
	return (await res.json()) as T;
}

async function printState(walletId: string, organizationId: string) {
	const wallet = await db.query.wallet.findFirst({
		where: { id: { eq: walletId } },
	});
	const org = await db.query.organization.findFirst({
		where: { id: { eq: organizationId } },
	});
	const ledger = await db.query.walletLedger.findMany({
		where: { walletId: { eq: walletId } },
		orderBy: { createdAt: "asc" },
	});
	const txns = await db.query.transaction.findMany({
		where: { organizationId: { eq: organizationId } },
		orderBy: { createdAt: "asc" },
	});

	console.log(`  wallet balance : $${wallet?.balance}`);
	console.log(`  org credits    : $${org?.credits}`);
	console.log("  wallet ledger  :");
	for (const r of ledger) {
		console.log(
			`    ${r.type.padEnd(9)} amount=${String(r.amount).padStart(6)} balanceAfter=${r.balanceAfter}`,
		);
	}
	console.log("  org transactions:");
	for (const t of txns) {
		console.log(
			`    ${t.type.padEnd(22)} amount=${t.amount} creditAmount=${t.creditAmount}`,
		);
	}
}

async function waitForLedger(
	walletId: string,
	type: string,
	timeoutMs = 30000,
): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		const row = await db.query.walletLedger.findFirst({
			where: { walletId: { eq: walletId }, type: { eq: type } },
		});
		if (row) {
			return true;
		}
		await sleep(1000);
	}
	return false;
}

async function main() {
	console.log(`\n== Payments SDK end-user bonus POC (${API_URL}) ==\n`);

	// 1. Mint an end-user session.
	const session = await post<{ sessionToken: string; walletId: string }>(
		"/v1/sessions",
		PLATFORM_SECRET,
		{ customer: `poc-${Date.now()}` },
	);
	console.log(`1. Session minted → wallet ${session.walletId}`);

	const wallet = await db.query.wallet.findFirst({
		where: { id: { eq: session.walletId } },
	});
	if (!wallet) {
		throw new Error("Wallet not found — is the DB seeded?");
	}
	const organizationId = wallet.organizationId;

	// 2. Create the top-up and show the bonus quote.
	const top = await post<{
		clientSecret: string;
		totalAmount: number;
		netCredited: number;
		bonusCredited: number;
	}>("/v1/wallet/top-up", session.sessionToken, { amount: AMOUNT });
	console.log(
		`2. Top-up quote: pay $${top.totalAmount}, credited $${top.netCredited} + $${top.bonusCredited} bonus = $${top.netCredited + top.bonusCredited}`,
	);

	// 3. Confirm the PaymentIntent as the end-user.
	const piId = top.clientSecret.split("_secret_")[0];
	await stripe.paymentIntents.confirm(piId, {
		payment_method: "pm_card_visa",
		return_url: "https://example.com/return",
	});
	const pi = await stripe.paymentIntents.retrieve(piId);
	console.log(`3. PaymentIntent ${piId} → ${pi.status}`);

	// 4. Wait for the webhook to credit the wallet.
	console.log("4. Waiting for the top-up webhook to credit the wallet…");
	if (!(await waitForLedger(session.walletId, "bonus"))) {
		console.log(
			"   ⚠️  No bonus ledger row yet. Is `stripe listen --forward-to localhost:4002/stripe/webhook` running with STRIPE_WEBHOOK_SECRET set?",
		);
	}

	console.log("\nState after top-up:");
	await printState(session.walletId, organizationId);

	if (!REFUND) {
		console.log("\n(--no-refund) Done.");
		return;
	}

	// 5. Refund through Stripe and wait for the reversal.
	console.log("\n5. Refunding the payment through Stripe…");
	await stripe.refunds.create({ payment_intent: piId });
	if (!(await waitForLedger(session.walletId, "reversal"))) {
		console.log("   ⚠️  No reversal ledger row yet (webhook not delivered?).");
	}

	console.log("\nState after refund:");
	await printState(session.walletId, organizationId);
	console.log(
		"\nExpected: wallet $0, org credits restored, one reversal row for the paid+bonus total, the end_user_topup revenue booked then reversed (nets to zero), and the end_user_bonus grant (-) + claw-back (+) netting to zero. In the admin dashboard the top-up counts as revenue while live, and nets back out after the refund.\n",
	);
}

main()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error(err);
		process.exit(1);
	});
