import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { redisClient } from "@llmgateway/cache";
import { db, eq, tables } from "@llmgateway/db";
import { topUpVelocityKey } from "@llmgateway/shared";

// Exercises the top-up velocity gate end-to-end against the real database:
// seeded `credit_topup` transactions inside the rolling 24h window must make
// the initiation routes reject with 429 before any Stripe call. The org is
// seeded WITH a stripeCustomerId so `ensureStripeCustomer` short-circuits and
// the request reaches the gate without touching Stripe.
describe("top-up velocity limits", () => {
	let token: string;

	beforeEach(async () => {
		vi.stubEnv("GATEWAY_TOPUP_VELOCITY_ENABLED", "true");
		// Reservations live in Redis, which persists across test runs.
		await redisClient.del(topUpVelocityKey("test-org-id"));
		token = await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "admin@example.com",
			stripeCustomerId: "cus_velocity_test",
			// Brand-new org => Tier 0 => $100/24h top-up cap by default.
			createdAt: new Date(),
		});

		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
		});
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await deleteAll();
	});

	async function seedWindowTopUps(amount: string, createdAt = new Date()) {
		await db.insert(tables.transaction).values({
			organizationId: "test-org-id",
			type: "credit_topup",
			amount,
			creditAmount: amount,
			currency: "USD",
			status: "completed",
			createdAt,
		});
	}

	test("create-payment-intent returns 429 when the 24h cap is filled", async () => {
		await seedWindowTopUps("95");

		const res = await app.request("/payments/create-payment-intent", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 50, organizationId: "test-org-id" }),
		});

		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.message).toContain("Top-up limit reached");
		expect(body.message).toContain("$100 per 24 hours");
	});

	test("create-checkout-session returns 429 when the 24h cap is filled", async () => {
		await seedWindowTopUps("95");

		const res = await app.request("/payments/create-checkout-session", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 50, organizationId: "test-org-id" }),
		});

		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.message).toContain("Top-up limit reached");
	});

	test("old and failed transactions do not count against the window", async () => {
		// Outside the 24h window.
		const twentyFiveHoursMs = 25 * 60 * 60 * 1000;
		await seedWindowTopUps("500", new Date(Date.now() - twentyFiveHoursMs));
		// Failed attempt inside the window.
		await db.insert(tables.transaction).values({
			organizationId: "test-org-id",
			type: "credit_topup",
			amount: "500",
			creditAmount: "500",
			currency: "USD",
			status: "failed",
		});

		const res = await app.request("/payments/create-payment-intent", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 50, organizationId: "test-org-id" }),
		});

		// The gate passes; the request proceeds toward Stripe and fails there
		// instead (no key / mocked-out network in tests) — anything but 429
		// proves the velocity gate did not fire.
		expect(res.status).not.toBe(429);
	});

	test("enterprise orgs are exempt", async () => {
		await db
			.update(tables.organization)
			.set({ plan: "enterprise" })
			.where(eq(tables.organization.id, "test-org-id"));
		await db.insert(tables.transaction).values({
			organizationId: "test-org-id",
			type: "credit_topup",
			amount: "50000",
			creditAmount: "50000",
			currency: "USD",
			status: "completed",
		});

		const res = await app.request("/payments/create-payment-intent", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 50, organizationId: "test-org-id" }),
		});

		expect(res.status).not.toBe(429);
	});
});
