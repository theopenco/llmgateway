import { setTimeout } from "node:timers/promises";

import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import { posthog } from "@/posthog.js";
import {
	handleSubscriptionCreated,
	handleSubscriptionUpdated,
	handleInvoicePaymentSucceeded,
} from "@/stripe.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type Stripe from "stripe";

const stripe = vi.hoisted(() => ({
	subscriptions: { retrieve: vi.fn(), update: vi.fn() },
	customers: { update: vi.fn() },
	checkout: {
		sessions: {
			create: vi.fn(),
			retrieve: vi.fn(),
			list: vi.fn(),
			expire: vi.fn(),
		},
	},
}));
vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripe;
	},
}));
vi.mock("@/posthog.js", () => ({
	posthog: { capture: vi.fn(), groupIdentify: vi.fn(), identify: vi.fn() },
}));
const orgId = "pro-subscription-test-org";
let cookie: string;
let quantity: number;
let activeUpdates: number;
let maxActiveUpdates: number;
let cancelled: boolean;
let checkoutSessions: Map<string, Stripe.Checkout.Session>;

async function update(seats: number) {
	return await app.request(
		`/subscriptions/update-pro-subscription?organizationId=${orgId}`,
		{
			method: "POST",
			headers: { Cookie: cookie, "Content-Type": "application/json" },
			body: JSON.stringify({ seats }),
		},
	);
}

describe("Pro subscription changes", () => {
	beforeEach(async () => {
		vi.stubEnv("STRIPE_SECRET_KEY", ["sk", "test", "mock"].join("_"));
		cookie = await createTestUser();
		for (const component of [
			"SEAT",
			"EXTRA_API_KEY",
			"EXTRA_PROJECT",
			"SSO",
			"SCIM",
		]) {
			vi.stubEnv(`STRIPE_PRO_${component}_PRICE_ID`, `price_${component}`);
		}
		quantity = 5;
		cancelled = false;
		activeUpdates = 0;
		maxActiveUpdates = 0;
		await db.insert(tables.organization).values({
			id: orgId,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			plan: "pro",
			proSeats: 5,
			stripeSubscriptionId: "sub_test_pro",
			stripeCustomerId: "cus_test_pro",
		});
		await db
			.insert(tables.userOrganization)
			.values({ organizationId: orgId, userId: "test-user-id", role: "owner" });
		checkoutSessions = new Map();
		stripe.customers.update.mockResolvedValue({ id: "cus_test_pro" });
		stripe.checkout.sessions.create.mockImplementation(
			async (params: Stripe.Checkout.SessionCreateParams) => {
				const id = `cs_test_${checkoutSessions.size + 1}`;
				const session = {
					id,
					status: "open",
					mode: "subscription",
					url: `http://localhost/checkout/${id}`,
					metadata: params.metadata,
					subscription: null,
				} as unknown as Stripe.Checkout.Session;
				checkoutSessions.set(id, session);
				return session;
			},
		);
		stripe.checkout.sessions.retrieve.mockImplementation(async (id: string) => {
			const value = checkoutSessions.get(id);
			if (!value) {
				throw new Error("Unknown test checkout");
			}
			return value;
		});
		stripe.checkout.sessions.list.mockImplementation(async () => ({
			data: [...checkoutSessions.values()].filter(
				(value) => value.status === "open",
			),
			has_more: false,
		}));
		stripe.checkout.sessions.expire.mockImplementation(async (id: string) => {
			const value = checkoutSessions.get(id);
			if (!value || value.status !== "open") {
				throw new Error("Test checkout already completed");
			}
			value.status = "expired";
			return value;
		});
		stripe.subscriptions.retrieve.mockImplementation(async () => ({
			id: "sub_test_pro",
			status: "active",
			cancel_at_period_end: cancelled,
			items: {
				data: [{ id: "si_test_seat", price: { id: "price_SEAT" }, quantity }],
			},
		}));
		stripe.subscriptions.update.mockImplementation(
			async (_id: string, params: Stripe.SubscriptionUpdateParams) => {
				activeUpdates++;
				maxActiveUpdates = Math.max(maxActiveUpdates, activeUpdates);
				if (params.items?.length) {
					quantity = params.items[0].quantity!;
				}
				if (params.cancel_at_period_end !== undefined) {
					cancelled = params.cancel_at_period_end;
				}
				await setTimeout(50);
				activeUpdates--;
				return await stripe.subscriptions.retrieve();
			},
		);
	});
	afterEach(async () => {
		vi.unstubAllEnvs();
		vi.clearAllMocks();
		await deleteAll();
	});
	it("serializes concurrent Stripe changes and local entitlements", async () => {
		const responses = await Promise.all([update(6), update(7)]);
		expect(responses.map((r) => r.status)).toEqual([200, 200]);
		expect(maxActiveUpdates).toBe(1);
		const org = await db.query.organization.findFirst({
			where: { id: { eq: orgId } },
		});
		expect(org?.proSeats).toBe(quantity);
	});
	it("does not grant quantities after Stripe rejects a change", async () => {
		stripe.subscriptions.update.mockRejectedValueOnce(
			new Error("Test Stripe failure"),
		);
		expect((await update(6)).status).toBe(500);
		const org = await db.query.organization.findFirst({
			where: { id: { eq: orgId } },
		});
		expect(org?.proSeats).toBe(5);
	});
	it("rejects changes by admins and other organizations", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "admin" })
			.where(eq(tables.userOrganization.organizationId, orgId));
		expect((await update(6)).status).toBe(403);
		expect(stripe.subscriptions.update).not.toHaveBeenCalled();
	});
	it("ignores stale created-event quantities after a plan change", async () => {
		quantity = 7;
		await handleSubscriptionCreated({
			data: {
				object: {
					id: "sub_test_pro",
					customer: "cus_test_pro",
					status: "active",
					metadata: { organizationId: orgId },
					items: { data: [{ price: { id: "price_SEAT" }, quantity: 3 }] },
				},
			},
		} as unknown as Stripe.CustomerSubscriptionCreatedEvent);
		expect(
			(await db.query.organization.findFirst({ where: { id: { eq: orgId } } }))
				?.proSeats,
		).toBe(7);
	});
	it("uses current cancellation and quantities for an old update event", async () => {
		quantity = 7;
		await handleSubscriptionUpdated({
			data: {
				object: {
					id: "sub_test_pro",
					customer: "cus_test_pro",
					status: "active",
					cancel_at_period_end: true,
					metadata: { organizationId: orgId },
					items: {
						data: [
							{
								price: { id: "price_SEAT" },
								quantity: 3,
								current_period_end: 1900000000,
							},
						],
					},
				},
			},
		} as unknown as Stripe.CustomerSubscriptionUpdatedEvent);
		const org = await db.query.organization.findFirst({
			where: { id: { eq: orgId } },
		});
		expect(org?.proSeats).toBe(7);
		expect(org?.subscriptionCancelled).toBe(false);
	});
	it("persists confirmed cancellation and resumption without waiting for a webhook", async () => {
		const call = async (action: string) =>
			await app.request(
				`/subscriptions/${action}-pro-subscription?organizationId=${orgId}`,
				{
					method: "POST",
					headers: { Cookie: cookie, "Content-Type": "application/json" },
					body: "{}",
				},
			);
		expect((await call("cancel")).status).toBe(200);
		expect(
			(await db.query.organization.findFirst({ where: { id: { eq: orgId } } }))
				?.subscriptionCancelled,
		).toBe(true);
		expect((await call("resume")).status).toBe(200);
		expect(
			(await db.query.organization.findFirst({ where: { id: { eq: orgId } } }))
				?.subscriptionCancelled,
		).toBe(false);
	});
	it("records initial payment failure without granting unpaid purchased add-ons", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "free", stripeSubscriptionId: null, proSeats: null })
			.where(eq(tables.organization.id, orgId));
		const current = {
			id: "sub_test_pro",
			customer: "cus_test_pro",
			status: "incomplete",
			cancel_at_period_end: false,
			metadata: { organizationId: orgId },
			items: {
				data: [
					{ price: { id: "price_SEAT" }, quantity: 10 },
					{ price: { id: "price_SSO" }, quantity: 1 },
					{ price: { id: "price_SCIM" }, quantity: 1 },
				],
			},
		};
		stripe.subscriptions.retrieve.mockResolvedValue(current);
		await handleSubscriptionCreated({
			data: { object: current },
		} as unknown as Stripe.CustomerSubscriptionCreatedEvent);
		const organization = await db.query.organization.findFirst({
			where: { id: { eq: orgId } },
		});
		expect(organization).toMatchObject({
			plan: "pro",
			subscriptionPaymentStatus: "past_due",
			stripeSubscriptionId: "sub_test_pro",
			proSeats: null,
			proSsoEnabled: false,
			proScimEnabled: false,
		});
	});
	it("keeps last-paid quantities during dunning instead of granting unpaid portal increases", async () => {
		const current = {
			id: "sub_test_pro",
			customer: "cus_test_pro",
			status: "past_due",
			cancel_at_period_end: false,
			metadata: { organizationId: orgId },
			items: {
				data: [
					{ price: { id: "price_SEAT" }, quantity: 10 },
					{ price: { id: "price_SSO" }, quantity: 1 },
					{ price: { id: "price_SCIM" }, quantity: 1 },
				],
			},
		};
		stripe.subscriptions.retrieve.mockResolvedValue(current);
		await handleSubscriptionUpdated({
			data: { object: current },
		} as unknown as Stripe.CustomerSubscriptionUpdatedEvent);
		const organization = await db.query.organization.findFirst({
			where: { id: { eq: orgId } },
		});
		expect(organization).toMatchObject({
			proSeats: 5,
			proSsoEnabled: false,
			proScimEnabled: false,
			subscriptionPaymentStatus: "past_due",
		});
	});
	it("records dashboard cancellation once and emits dashboard reactivation after commit", async () => {
		const call = (action: string) =>
			app.request(
				`/subscriptions/${action}-pro-subscription?organizationId=${orgId}`,
				{
					method: "POST",
					headers: { Cookie: cookie, "Content-Type": "application/json" },
					body: "{}",
				},
			);
		expect((await call("cancel")).status).toBe(200);
		expect(
			await db.query.transaction.findMany({
				where: {
					organizationId: { eq: orgId },
					type: { eq: "subscription_cancel" },
				},
			}),
		).toHaveLength(1);
		expect((await call("cancel")).status).toBe(200);
		expect(
			await db.query.transaction.findMany({
				where: {
					organizationId: { eq: orgId },
					type: { eq: "subscription_cancel" },
				},
			}),
		).toHaveLength(1);
		expect((await call("resume")).status).toBe(200);
		expect(posthog.capture).toHaveBeenCalledWith(
			expect.objectContaining({ event: "subscription_reactivated" }),
		);
	});
	it("retries a renewal after a current-subscription lookup fails without losing entitlement updates", async () => {
		await db
			.update(tables.organization)
			.set({ subscriptionPaymentStatus: "past_due" })
			.where(eq(tables.organization.id, orgId));
		const current = {
			id: "sub_test_pro",
			status: "active",
			cancel_at_period_end: false,
			metadata: {},
			items: { data: [{ price: { id: "price_SEAT" }, quantity: 6 }] },
		};
		stripe.subscriptions.retrieve
			.mockResolvedValueOnce(current)
			.mockRejectedValueOnce(new Error("Test transient Stripe lookup"))
			.mockResolvedValue(current);
		const event = {
			data: {
				object: {
					id: "in_test_retry",
					customer: "cus_test_pro",
					subscription: "sub_test_pro",
					metadata: { organizationId: orgId },
					billing_reason: "subscription_cycle",
					amount_paid: 9000,
					currency: "usd",
					lines: {
						data: [
							{
								amount: 9000,
								pricing: { price_details: { price: "price_SEAT" } },
								period: { start: 1800000000, end: 1900000000 },
							},
						],
					},
				},
			},
		} as unknown as Stripe.InvoicePaymentSucceededEvent;
		await expect(handleInvoicePaymentSucceeded(event)).rejects.toThrow();
		await handleInvoicePaymentSucceeded(event);
		expect(
			await db.query.transaction.findMany({
				where: { stripeInvoiceId: { eq: "in_test_retry" } },
			}),
		).toHaveLength(1);
		expect(
			await db.query.organization.findFirst({ where: { id: { eq: orgId } } }),
		).toMatchObject({
			subscriptionPaymentStatus: "current",
			proSeats: 6,
			planExpiresAt: new Date(1900000000 * 1000),
		});
	});
	it("does not block ordinary credit writes during a slow Stripe operation", async () => {
		let entered!: () => void;
		let release!: () => void;
		const started = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		stripe.subscriptions.update.mockImplementationOnce(async () => {
			quantity = 6;
			entered();
			await gate;
			return await stripe.subscriptions.retrieve();
		});
		const mutation = update(6);
		await started;
		const creditWrite = db
			.update(tables.organization)
			.set({ credits: "1" })
			.where(eq(tables.organization.id, orgId))
			.returning();
		let progressed: boolean;
		try {
			progressed = await Promise.race([
				creditWrite.then(() => true),
				setTimeout(1500).then(() => false),
			]);
		} finally {
			release();
			await Promise.all([mutation, creditWrite]);
		}
		expect(progressed).toBe(true);
		expect(
			new Decimal(
				(await db.query.organization.findFirst({
					where: { id: { eq: orgId } },
				}))!.credits,
			).eq("1"),
		).toBe(true);
	});
	it("reuses one checkout for concurrent duplicate requests and expires obsolete carts", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "free", proSeats: null, stripeSubscriptionId: null })
			.where(eq(tables.organization.id, orgId));
		const checkout = (seats: number) =>
			app.request(
				`/subscriptions/create-pro-subscription?organizationId=${orgId}`,
				{
					method: "POST",
					headers: { Cookie: cookie, "Content-Type": "application/json" },
					body: JSON.stringify({ seats }),
				},
			);
		const first = await Promise.all([checkout(3), checkout(3)]);
		expect(first.map((response) => response.status)).toEqual([200, 200]);
		expect(await first[0].json()).toEqual(await first[1].json());
		expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);
		expect((await checkout(4)).status).toBe(200);
		expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
		expect(checkoutSessions.get("cs_test_1")?.status).toBe("expired");
		const completed = checkoutSessions.get("cs_test_2")!;
		completed.status = "complete";
		completed.subscription = "sub_test_pro";
		expect((await checkout(4)).status).toBe(409);
		expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(2);
	});
	it("does not revive an ended plan when an old created event arrives late", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "free", stripeSubscriptionId: null, proSeats: null })
			.where(eq(tables.organization.id, orgId));
		const current = {
			id: "sub_test_pro",
			status: "canceled",
			cancel_at_period_end: false,
			metadata: { organizationId: orgId },
			items: { data: [{ price: { id: "price_SEAT" }, quantity: 5 }] },
		};
		stripe.subscriptions.retrieve.mockResolvedValue(current);
		await handleSubscriptionCreated({
			data: { object: { ...current, status: "incomplete" } },
		} as unknown as Stripe.CustomerSubscriptionCreatedEvent);
		expect(
			await db.query.organization.findFirst({ where: { id: { eq: orgId } } }),
		).toMatchObject({
			plan: "free",
			stripeSubscriptionId: null,
			proSeats: null,
			proSsoEnabled: false,
		});
	});
});
