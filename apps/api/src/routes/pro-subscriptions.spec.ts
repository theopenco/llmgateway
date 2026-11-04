import { setTimeout } from "node:timers/promises";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "@/index.js";
import {
	handleSubscriptionCreated,
	handleSubscriptionUpdated,
} from "@/stripe.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, eq, tables } from "@llmgateway/db";

import type Stripe from "stripe";

const stripe = vi.hoisted(() => ({
	subscriptions: { retrieve: vi.fn(), update: vi.fn() },
}));
vi.mock("stripe", () => ({
	default: function MockStripe() {
		return stripe;
	},
}));
const orgId = "pro-subscription-test-org";
let cookie: string;
let quantity: number;
let activeUpdates: number;
let maxActiveUpdates: number;
let cancelled: boolean;

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
		});
		await db
			.insert(tables.userOrganization)
			.values({ organizationId: orgId, userId: "test-user-id", role: "owner" });
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
});
