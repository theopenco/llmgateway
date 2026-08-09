import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db, tables } from "@llmgateway/db";

import { stripeRoutes } from "./stripe.js";
import { deleteAll } from "./testing.js";

import type * as PaymentsModule from "./routes/payments.js";
import type * as EmailModule from "./utils/email.js";
import type Stripe from "stripe";

// discord.ts resolves DISCORD_NOTIFICATION_URL at module load, and the webhook
// route needs a live signing secret, so both have to be set before the module
// graph is imported.
const DISCORD_URL = vi.hoisted(() => {
	const url = "https://discord.test/webhook";
	process.env.DISCORD_NOTIFICATION_URL = url;
	process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";
	process.env.FIRST_TIME_CREDIT_BONUS_MULTIPLIER = "0";
	delete process.env.STRIPE_WEBHOOK_SECRET_TEST;
	return url;
});

const stripeMock = vi.hoisted(() => ({
	webhooks: { constructEvent: vi.fn() },
	refunds: { list: vi.fn() },
	invoices: { list: vi.fn() },
	invoicePayments: { list: vi.fn() },
	subscriptions: { retrieve: vi.fn(), cancel: vi.fn() },
	paymentIntents: { retrieve: vi.fn() },
	paymentMethods: { retrieve: vi.fn() },
}));

vi.mock("./routes/payments.js", async (importOriginal) => {
	const original = await importOriginal<typeof PaymentsModule>();
	return {
		...original,
		getStripe: () => stripeMock,
	};
});

vi.mock("./posthog.js", () => ({
	posthog: {
		capture: vi.fn(),
		groupIdentify: vi.fn(),
	},
}));

vi.mock("./utils/invoice.js", () => ({
	generateAndEmailInvoice: vi.fn(),
}));

vi.mock("./utils/email.js", async (importOriginal) => {
	const original = await importOriginal<typeof EmailModule>();
	return {
		...original,
		sendTransactionalEmail: vi.fn(),
	};
});

const ORG_ID = "org-topup-checkout";
const USER_ID = "user-topup-checkout";
const USER_EMAIL = "buyer@acme.test";
const CUSTOMER_ID = "cus_topup_checkout";
const PAYMENT_INTENT_ID = "pi_topup_checkout";

// $10 of credits plus the 3.5% platform fee the checkout page charges.
const BASE_AMOUNT = 10;
const TOTAL_AMOUNT = 10.35;

const checkoutMetadata: Record<string, string> = {
	organizationId: ORG_ID,
	type: "credit_topup",
	baseAmount: BASE_AMOUNT.toString(),
	platformFee: "0.35",
	internationalFee: "0",
	totalAmount: TOTAL_AMOUNT.toString(),
	userEmail: USER_EMAIL,
	userId: USER_ID,
};

const fetchMock = vi.fn(
	async (_url: string, _init?: { body?: string }) =>
		new Response("{}", { status: 200 }),
);

function checkoutSessionCompletedEvent(
	metadata: Record<string, string> = checkoutMetadata,
): Stripe.Event {
	return {
		id: "evt_checkout_completed",
		type: "checkout.session.completed",
		data: {
			object: {
				id: "cs_topup_checkout",
				mode: "payment",
				customer: CUSTOMER_ID,
				payment_status: "paid",
				payment_intent: PAYMENT_INTENT_ID,
				amount_total: Math.round(TOTAL_AMOUNT * 100),
				currency: "usd",
				subscription: null,
				metadata,
			},
		},
	} as unknown as Stripe.Event;
}

function paymentIntentEvent(
	type: "payment_intent.succeeded" | "payment_intent.payment_failed",
	metadata: Record<string, string>,
): Stripe.Event {
	return {
		id: `evt_${type}`,
		type,
		data: {
			object: {
				id: PAYMENT_INTENT_ID,
				customer: CUSTOMER_ID,
				amount: Math.round(TOTAL_AMOUNT * 100),
				currency: "usd",
				last_payment_error: { message: "Your card was declined." },
				metadata,
			},
		},
	} as unknown as Stripe.Event;
}

async function deliver(event: Stripe.Event) {
	stripeMock.webhooks.constructEvent.mockReturnValue(event);
	const res = await stripeRoutes.request("/webhook", {
		method: "POST",
		headers: { "stripe-signature": "sig" },
		body: JSON.stringify(event),
	});
	expect(res.status).toBe(200);
}

function discordNotification() {
	const call = fetchMock.mock.calls.find(([url]) => url === DISCORD_URL);
	if (!call) {
		return null;
	}
	const payload = JSON.parse(String(call[1]?.body)) as {
		embeds: { title: string; fields: { name: string; value: string }[] }[];
	};
	return {
		title: payload.embeds[0].title,
		fields: Object.fromEntries(
			payload.embeds[0].fields.map((field) => [field.name, field.value]),
		),
	};
}

describe("credit top-up via Stripe Checkout", () => {
	beforeEach(async () => {
		await deleteAll();
		fetchMock.mockClear();
		vi.stubGlobal("fetch", fetchMock);
		stripeMock.webhooks.constructEvent.mockReset();

		await db.insert(tables.user).values({
			id: USER_ID,
			name: "Buyer Example",
			email: USER_EMAIL,
			emailVerified: true,
		});
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Acme Co",
			billingEmail: "billing@acme.test",
			stripeCustomerId: CUSTOMER_ID,
			credits: "0",
		});
	});

	afterEach(async () => {
		vi.unstubAllGlobals();
		await db.delete(tables.transaction);
		await deleteAll();
	});

	test("credits the organization and reports the top-up to Discord", async () => {
		await deliver(checkoutSessionCompletedEvent());

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(Number(org?.credits)).toBe(BASE_AMOUNT);

		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(1);
		expect(transactions[0].type).toBe("credit_topup");
		expect(transactions[0].status).toBe("completed");
		expect(transactions[0].stripePaymentIntentId).toBe(PAYMENT_INTENT_ID);

		const notification = discordNotification();
		expect(notification?.title).toBe("Credits Purchased");
		expect(notification?.fields).toMatchObject({
			Email: USER_EMAIL,
			Name: "Buyer Example",
			Credits: "$10.00",
			Gross: "$10.35",
			Fee: "$0.35",
			Source: "Stripe Checkout",
			Organization: `Acme Co (${ORG_ID})`,
		});
	});

	test("reports the top-up even when the session carries no user email", async () => {
		const { userEmail: _userEmail, ...metadata } = checkoutMetadata;

		await deliver(checkoutSessionCompletedEvent(metadata));

		const notification = discordNotification();
		expect(notification?.title).toBe("Credits Purchased");
		expect(notification?.fields.Email).toBe("billing@acme.test");
	});

	test("does not credit twice when the payment intent also succeeds", async () => {
		await deliver(checkoutSessionCompletedEvent());
		fetchMock.mockClear();

		await deliver(
			paymentIntentEvent("payment_intent.succeeded", {
				...checkoutMetadata,
				source: "stripe_checkout",
			}),
		);

		const org = await db.query.organization.findFirst({
			where: { id: { eq: ORG_ID } },
		});
		expect(Number(org?.credits)).toBe(BASE_AMOUNT);

		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(1);
		expect(discordNotification()).toBeNull();
	});

	test("does not record a failed transaction for a declined checkout attempt", async () => {
		await deliver(
			paymentIntentEvent("payment_intent.payment_failed", {
				...checkoutMetadata,
				source: "stripe_checkout",
			}),
		);

		const transactions = await db.query.transaction.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(transactions).toHaveLength(0);

		// The decline itself is still tracked for the admin dashboard.
		const failures = await db.query.paymentFailure.findMany({
			where: { organizationId: { eq: ORG_ID } },
		});
		expect(failures).toHaveLength(1);
	});
});
