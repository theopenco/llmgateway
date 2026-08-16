import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { repriceDraftRenewalInvoice } from "@/lib/pending-renewal.js";
import { getStripe } from "@/routes/payments.js";

import type Stripe from "stripe";

// Real-Stripe verification of the pre-renewal draft-invoice re-pricing fix.
//
// Reproduces the exact incident against a live Stripe sandbox using a Test
// Clock: subscribe to PRO, advance to the renewal boundary so Stripe drafts the
// `subscription_cycle` invoice, then downgrade to LITE mid-window. Without the
// fix the drafted invoice keeps billing PRO ($79) while the org flips to LITE
// credits; with the fix the draft is re-priced to LITE ($29) before it charges.
//
// Opt-in only — hits the network and consumes Stripe rate limit, so it is
// skipped unless STRIPE_TESTCLOCK_E2E is set (never in normal CI). Requires a
// test-mode STRIPE_SECRET_KEY and the three STRIPE_DEV_PLAN_*_PRICE_ID vars, the
// same env the API reads.
const ENABLED = !!process.env.STRIPE_TESTCLOCK_E2E;

const PRO_PRICE_ID = process.env.STRIPE_DEV_PLAN_PRO_PRICE_ID ?? "";
const LITE_PRICE_ID = process.env.STRIPE_DEV_PLAN_LITE_PRICE_ID ?? "";

const HOUR = 3600;

function amountDue(invoice: Stripe.Invoice) {
	return invoice.amount_due;
}

function repriceLineTotal(invoice: Stripe.Invoice) {
	return invoice.lines.data
		.filter((line) => line.metadata?.devPlanRenewalReprice === "true")
		.reduce((sum, line) => sum + line.amount, 0);
}

describe.skipIf(!ENABLED)(
	"dev plan renewal re-price (real Stripe test clock)",
	() => {
		// Resolved in beforeAll — the describe body runs even when skipped, so
		// getStripe() (which throws without STRIPE_SECRET_KEY) must not run at
		// registration time in a keyless CI.
		let stripe: Stripe;
		let clockId: string;
		let customerId: string;
		let subscriptionId: string;
		let subscriptionItemId: string;
		let renewalStart: number;
		let proUnit: number;
		let liteUnit: number;

		async function waitForClock(id: string) {
			for (let i = 0; i < 60; i++) {
				const clock = await stripe.testHelpers.testClocks.retrieve(id);
				if (clock.status === "ready") {
					return clock;
				}
				if (clock.status === "internal_failure") {
					throw new Error(`Test clock ${id} entered internal_failure`);
				}
				await new Promise((r) => setTimeout(r, 2000));
			}
			throw new Error(`Test clock ${id} did not become ready in time`);
		}

		async function advanceTo(seconds: number) {
			await stripe.testHelpers.testClocks.advance(clockId, {
				frozen_time: seconds,
			});
			await waitForClock(clockId);
		}

		async function getDraftRenewal() {
			const invoices = await stripe.invoices.list({
				subscription: subscriptionId,
				status: "draft",
				limit: 10,
			});
			return invoices.data.find(
				(inv) => inv.billing_reason === "subscription_cycle",
			);
		}

		beforeAll(async () => {
			if (!ENABLED) {
				return;
			}
			stripe = getStripe();
			expect(PRO_PRICE_ID, "STRIPE_DEV_PLAN_PRO_PRICE_ID must be set").not.toBe(
				"",
			);
			expect(
				LITE_PRICE_ID,
				"STRIPE_DEV_PLAN_LITE_PRICE_ID must be set",
			).not.toBe("");

			proUnit = (await stripe.prices.retrieve(PRO_PRICE_ID)).unit_amount ?? 0;
			liteUnit = (await stripe.prices.retrieve(LITE_PRICE_ID)).unit_amount ?? 0;
			expect(proUnit).toBeGreaterThan(liteUnit);

			const now = Math.floor(Date.now() / 1000);
			const clock = await stripe.testHelpers.testClocks.create({
				frozen_time: now,
				name: "devpass-reprice-e2e",
			});
			clockId = clock.id;

			const customer = await stripe.customers.create({
				name: "DevPass reprice e2e",
				test_clock: clockId,
			});
			customerId = customer.id;

			const pm = await stripe.paymentMethods.attach("pm_card_visa", {
				customer: customerId,
			});
			await stripe.customers.update(customerId, {
				invoice_settings: { default_payment_method: pm.id },
			});

			const subscription = await stripe.subscriptions.create({
				customer: customerId,
				items: [{ price: PRO_PRICE_ID }],
				default_payment_method: pm.id,
				collection_method: "charge_automatically",
				metadata: { subscriptionType: "dev_plan", devPlan: "pro" },
				expand: ["latest_invoice"],
			});
			subscriptionId = subscription.id;
			subscriptionItemId = subscription.items.data[0].id;
			renewalStart = subscription.items.data[0].current_period_end;
		}, 120000);

		afterAll(async () => {
			if (!ENABLED || !clockId) {
				return;
			}
			// Deleting the test clock tears down the customer, subscription and all
			// invoices created against it — nothing lingers in the sandbox.
			await stripe.testHelpers.testClocks.del(clockId).catch(() => undefined);
		}, 60000);

		it("the initial PRO subscription invoice is paid at PRO price", async () => {
			const invoices = await stripe.invoices.list({
				subscription: subscriptionId,
				limit: 5,
			});
			const paid = invoices.data.find((inv) => inv.status === "paid");
			expect(paid, "initial invoice should be paid").toBeTruthy();
			expect(amountDue(paid!)).toBe(proUnit);
		}, 120000);

		it("Stripe drafts the renewal invoice at PRO price before finalizing (root cause)", async () => {
			// Land 30 minutes into the new period — inside Stripe's ~1h draft window
			// before the renewal invoice auto-finalizes and charges.
			await advanceTo(renewalStart + Math.round(HOUR * 0.5));

			const draft = await getDraftRenewal();
			expect(
				draft,
				"a draft subscription_cycle invoice should exist",
			).toBeTruthy();
			expect(draft!.status).toBe("draft");
			// It bills the OUTGOING (pro) tier: this is the state the incident hit.
			expect(amountDue(draft!)).toBe(proUnit);
		}, 120000);

		it("a mid-window downgrade leaves the draft billing PRO until we re-price it", async () => {
			// Swap the subscription price to LITE exactly as change-tier does.
			await stripe.subscriptions.update(subscriptionId, {
				items: [{ id: subscriptionItemId, price: LITE_PRICE_ID }],
				proration_behavior: "none",
				payment_behavior: "allow_incomplete",
			});

			// Proves root cause: the price swap does NOT touch the existing draft.
			const beforeFix = await getDraftRenewal();
			expect(amountDue(beforeFix!)).toBe(proUnit);

			// Run the actual production helper against the real draft.
			await repriceDraftRenewalInvoice({
				subscriptionId,
				customer: customerId,
				newPriceId: LITE_PRICE_ID,
				newTier: "lite",
			});

			const afterFix = await getDraftRenewal();
			expect(amountDue(afterFix!)).toBe(liteUnit);
			expect(repriceLineTotal(afterFix!)).toBe(liteUnit - proUnit);
		}, 120000);

		it("re-pricing is idempotent — a second run adds no further adjustment", async () => {
			await repriceDraftRenewalInvoice({
				subscriptionId,
				customer: customerId,
				newPriceId: LITE_PRICE_ID,
				newTier: "lite",
			});
			const draft = await getDraftRenewal();
			expect(amountDue(draft!)).toBe(liteUnit);
			expect(repriceLineTotal(draft!)).toBe(liteUnit - proUnit);
		}, 120000);

		it("cancel-downgrade re-prices the draft back to the PRO price", async () => {
			// Reverting the swap the way cancel-downgrade does.
			await stripe.subscriptions.update(subscriptionId, {
				items: [{ id: subscriptionItemId, price: PRO_PRICE_ID }],
				proration_behavior: "none",
				payment_behavior: "allow_incomplete",
			});

			await repriceDraftRenewalInvoice({
				subscriptionId,
				customer: customerId,
				newPriceId: PRO_PRICE_ID,
				newTier: "pro",
			});

			const draft = await getDraftRenewal();
			expect(amountDue(draft!)).toBe(proUnit);
			// The earlier -delta and this +delta net out to zero.
			expect(repriceLineTotal(draft!)).toBe(0);
		}, 120000);

		it("the finalized renewal charges the re-priced LITE amount end-to-end", async () => {
			// Re-apply the downgrade + re-price, then let the clock finalize it.
			await stripe.subscriptions.update(subscriptionId, {
				items: [{ id: subscriptionItemId, price: LITE_PRICE_ID }],
				proration_behavior: "none",
				payment_behavior: "allow_incomplete",
			});
			await repriceDraftRenewalInvoice({
				subscriptionId,
				customer: customerId,
				newPriceId: LITE_PRICE_ID,
				newTier: "lite",
			});

			const draft = await getDraftRenewal();
			const draftId = draft!.id!;

			// Advance just past Stripe's own scheduled auto-finalization time so it
			// finalizes and charges the draft the same way a real renewal would.
			const finalizeAt =
				draft!.automatically_finalizes_at ?? renewalStart + HOUR;
			await advanceTo(finalizeAt + 60);

			let finalized = await stripe.invoices.retrieve(draftId);
			// Charging can lag finalization slightly under the test clock; poll.
			for (let i = 0; i < 30 && finalized.status !== "paid"; i++) {
				await new Promise((r) => setTimeout(r, 2000));
				finalized = await stripe.invoices.retrieve(draftId);
			}
			expect(finalized.status).toBe("paid");
			// Without the fix this would have charged proUnit ($79) for a LITE cycle.
			expect(finalized.amount_paid).toBe(liteUnit);
		}, 120000);
	},
);
