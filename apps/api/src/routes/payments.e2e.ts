import "dotenv/config";
import Stripe from "stripe";
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import { app } from "@/index.js";
import { deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";
import { CREDIT_TOP_UP_MIN_AMOUNT } from "@llmgateway/shared";
import { uniqueId } from "@llmgateway/shared/random";

// Reproduces the production credits top-up flow against real Stripe test
// mode, server-side: create-setup-intent -> confirm the SetupIntent with a
// test card (what the browser's confirmCardSetup does) -> immediately
// create-payment-intent with the resulting payment method. No webhook is
// delivered locally, which is exactly the losing side of the production race:
// if the SetupIntent is created without a customer, the payment method comes
// out of confirmation used-but-unattached and Stripe rejects the
// PaymentIntent ("The provided PaymentMethod cannot be attached...").

const stripeKey = process.env.STRIPE_SECRET_KEY;
// Opt-in only (STRIPE_TESTING=true): hits the real Stripe test-mode API, so
// it must not run as part of the default e2e suite. Never runs against a
// live key.
const stripeTestingEnabled =
	process.env.STRIPE_TESTING === "true" &&
	Boolean(stripeKey?.startsWith("sk_test_"));

function generateTestId(): string {
	return uniqueId("test");
}

describe.skipIf(!stripeTestingEnabled)(
	"e2e credits top-up payment flow",
	() => {
		const stripeCustomerIds: string[] = [];

		beforeAll(async () => {
			await deleteAll();
		});

		afterEach(() => {
			vi.unstubAllEnvs();
		});

		afterAll(async () => {
			// Remove the Stripe test-mode customers created by ensureStripeCustomer
			// so repeated runs don't accumulate clutter.
			const stripe = new Stripe(stripeKey!, { apiVersion: "2025-04-30.basil" });
			for (const customerId of stripeCustomerIds) {
				try {
					await stripe.customers.del(customerId);
				} catch {
					// best-effort cleanup only
				}
			}
			await deleteAll();
		});

		async function setupTestData() {
			const testId = generateTestId();
			const userId = `user-${testId}`;
			const orgId = `org-${testId}`;

			await db.insert(tables.user).values({
				id: userId,
				name: "Test User",
				email: `admin-${testId}@example.com`,
				emailVerified: true,
			});

			await db.insert(tables.account).values({
				id: `account-${testId}`,
				providerId: "credential",
				accountId: `account-${testId}`,
				userId,
				password:
					"c11ef27a7f9264be08db228ebb650888:a4d985a9c6bd98608237fd507534424950aa7fc255930d972242b81cbe78594f8568feb0d067e95ddf7be242ad3e9d013f695f4414fce68bfff091079f1dc460",
			});

			const auth = await app.request("/auth/sign-in/email", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					email: `admin-${testId}@example.com`,
					password: "admin@example.com1A",
				}),
			});

			if (auth.status !== 200) {
				throw new Error(`Failed to authenticate: ${auth.status}`);
			}

			const token = auth.headers.get("set-cookie")!;

			await db.insert(tables.organization).values({
				id: orgId,
				name: "Test Organization",
				billingEmail: `admin-${testId}@example.com`,
				plan: "pro",
			});

			await db.insert(tables.userOrganization).values({
				id: `user-org-${testId}`,
				userId,
				organizationId: orgId,
			});

			return { token, orgId };
		}

		test("new saved card is chargeable immediately after setup confirmation", async () => {
			const { token, orgId } = await setupTestData();
			const stripe = new Stripe(stripeKey!, { apiVersion: "2025-04-30.basil" });

			const setupRes = await app.request("/payments/create-setup-intent", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({ organizationId: orgId }),
			});
			expect(setupRes.status).toBe(200);
			const { clientSecret } = (await setupRes.json()) as {
				clientSecret: string;
			};
			expect(clientSecret).toContain("_secret");

			const organization = await db.query.organization.findFirst({
				where: { id: orgId },
			});
			expect(organization?.stripeCustomerId).toBeTruthy();
			stripeCustomerIds.push(organization!.stripeCustomerId!);

			// What stripe.confirmCardSetup(clientSecret, ...) does in the browser.
			const setupIntentId = clientSecret.split("_secret")[0];
			const confirmedSetup = await stripe.setupIntents.confirm(setupIntentId, {
				payment_method: "pm_card_visa",
				// Stripe.js supplies this implicitly in the browser; confirming
				// server-side requires it because redirect-based payment methods are
				// enabled on the account.
				return_url: "https://llmgateway.io/",
			});
			expect(confirmedSetup.status).toBe("succeeded");

			const paymentMethodId =
				typeof confirmedSetup.payment_method === "string"
					? confirmedSetup.payment_method
					: confirmedSetup.payment_method!.id;

			// Root-cause regression: confirmation must leave the payment method
			// attached to the org's Stripe customer. A customer-less SetupIntent
			// leaves it unattached here, and only the (async, absent in this test)
			// setup_intent.succeeded webhook would attach it.
			const paymentMethod =
				await stripe.paymentMethods.retrieve(paymentMethodId);
			const attachedCustomerId =
				typeof paymentMethod.customer === "string"
					? paymentMethod.customer
					: (paymentMethod.customer?.id ?? null);
			expect(attachedCustomerId).toBe(organization!.stripeCustomerId);

			// The client calls this immediately after confirmCardSetup — before any
			// webhook can possibly have run. On unfixed code Stripe rejects this
			// with 400 ("The provided PaymentMethod cannot be attached...") and the
			// API 500s.
			const intentRes = await app.request("/payments/create-payment-intent", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Cookie: token,
				},
				body: JSON.stringify({
					amount: CREDIT_TOP_UP_MIN_AMOUNT,
					stripePaymentMethodId: paymentMethodId,
					organizationId: orgId,
				}),
			});
			expect(intentRes.status).toBe(200);
			const intentJson = (await intentRes.json()) as { clientSecret: string };
			expect(intentJson.clientSecret).toContain("_secret");

			// The intent must be confirmable with the saved card, i.e. the payment
			// method is genuinely reusable (attached), not a consumed one-off.
			const paymentIntentId = intentJson.clientSecret.split("_secret")[0];
			const confirmedIntent = await stripe.paymentIntents.confirm(
				paymentIntentId,
				{
					payment_method: paymentMethodId,
					return_url: "https://llmgateway.io/",
				},
			);
			expect(confirmedIntent.status).toBe("succeeded");
		});

		// The point of forcing 3DS only at card-setup time: the add-card step
		// authenticates, and the off-session charge that later reuses that card
		// — the shape auto top-up runs on — still goes through untouched.
		// `pm_card_visa` supports 3DS without requiring it, so Stripe's SCA
		// engine lets it through frictionlessly unless we ask otherwise.
		test("forced 3DS authenticates the card setup but never the charge", async () => {
			const { token, orgId } = await setupTestData();
			const stripe = new Stripe(stripeKey!, { apiVersion: "2025-04-30.basil" });

			// Save a card with 3DS off so there is a usable saved card to charge.
			const setupRes = await app.request("/payments/create-setup-intent", {
				method: "POST",
				headers: { "Content-Type": "application/json", Cookie: token },
				body: JSON.stringify({ organizationId: orgId }),
			});
			expect(setupRes.status).toBe(200);
			const { clientSecret: setupSecret } = (await setupRes.json()) as {
				clientSecret: string;
			};

			const organization = await db.query.organization.findFirst({
				where: { id: orgId },
			});
			stripeCustomerIds.push(organization!.stripeCustomerId!);

			const confirmedSetup = await stripe.setupIntents.confirm(
				setupSecret.split("_secret")[0],
				{
					payment_method: "pm_card_visa",
					return_url: "https://llmgateway.io/",
				},
			);
			expect(confirmedSetup.status).toBe("succeeded");
			const stripePaymentMethodId =
				typeof confirmedSetup.payment_method === "string"
					? confirmedSetup.payment_method
					: confirmedSetup.payment_method!.id;

			const [savedCard] = await db
				.insert(tables.paymentMethod)
				.values({
					stripePaymentMethodId,
					organizationId: orgId,
					type: "card",
					isDefault: true,
				})
				.returning({ id: tables.paymentMethod.id });

			// Everything below runs with 3DS forced as hard as it goes.
			vi.stubEnv("STRIPE_FORCE_3DS", "challenge");

			// Adding a card authenticates: this is the one interactive moment,
			// and Stripe.js renders the challenge for it.
			const forcedSetupRes = await app.request(
				"/payments/create-setup-intent",
				{
					method: "POST",
					headers: { "Content-Type": "application/json", Cookie: token },
					body: JSON.stringify({ organizationId: orgId }),
				},
			);
			expect(forcedSetupRes.status).toBe(200);
			const { clientSecret: forcedSetupSecret } =
				(await forcedSetupRes.json()) as { clientSecret: string };
			const forcedSetup = await stripe.setupIntents.confirm(
				forcedSetupSecret.split("_secret")[0],
				{
					payment_method: "pm_card_visa",
					return_url: "https://llmgateway.io/",
				},
			);
			expect(forcedSetup.status).toBe("requires_action");
			expect(forcedSetup.next_action?.type).toBe("redirect_to_url");

			// The off-session charge on the saved card does not. This endpoint
			// creates the same `off_session: true, confirm: true` PaymentIntent
			// the auto top-up worker does, so a challenge here would surface as
			// a 402 `authentication_required` instead of a completed top-up.
			const chargeRes = await app.request(
				"/payments/top-up-with-saved-method",
				{
					method: "POST",
					headers: { "Content-Type": "application/json", Cookie: token },
					body: JSON.stringify({
						amount: CREDIT_TOP_UP_MIN_AMOUNT,
						paymentMethodId: savedCard.id,
						organizationId: orgId,
					}),
				},
			);
			expect(chargeRes.status).toBe(200);
			expect(await chargeRes.json()).toMatchObject({ success: true });

			const charges = await stripe.paymentIntents.list({
				customer: organization!.stripeCustomerId!,
				limit: 1,
			});
			expect(charges.data[0].status).toBe("succeeded");
			expect(
				charges.data[0].payment_method_options?.card?.request_three_d_secure,
			).not.toBe("challenge");
		});
	},
);
