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
const threeDaysMs = 3 * 86_400_000;

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
			// 3-day-old org with $0 net spend => Tier 0 => $100/24h top-up cap.
			// Old enough to clear the T2 min-age floor once the spend tests give
			// it qualifying usage, but below every pure-age tier threshold.
			createdAt: new Date(Date.now() - threeDaysMs),
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

	test("reports fee-aware maxima from the remaining tier allowance", async () => {
		await seedWindowTopUps("20");

		const res = await app.request(
			"/payments/top-up-limit?organizationId=test-org-id",
			{ headers: { Cookie: token } },
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			remainingGrossAmount: 80,
			maxCardAmount: 75,
			maxCheckoutAmount: 76,
		});
	});

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

	test("a refunded top-up still consumes the 24h window", async () => {
		// $95 topped up and fully refunded: the refund must NOT free headroom,
		// or top-up → refund → top-up would cycle money through the window.
		await db.insert(tables.transaction).values({
			id: "refunded-topup",
			organizationId: "test-org-id",
			type: "credit_topup",
			amount: "95",
			creditAmount: "95",
			currency: "USD",
			status: "completed",
		});
		await db.insert(tables.transaction).values({
			organizationId: "test-org-id",
			type: "credit_refund",
			amount: "95",
			creditAmount: "-95",
			currency: "USD",
			status: "completed",
			relatedTransactionId: "refunded-topup",
		});

		const res = await app.request("/payments/create-payment-intent", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 50, organizationId: "test-org-id" }),
		});

		expect(res.status).toBe(429);
	});

	test("refunded usage spend does not raise the trust tier", async () => {
		// $150 of usage would qualify the org for Tier 2 ($2,500/24h allowance)
		// by spend, letting a $120 top-up through...
		await db.insert(tables.project).values({
			id: "velocity-refund-project",
			name: "Velocity Refund Project",
			organizationId: "test-org-id",
		});
		await db.insert(tables.projectHourlyStats).values({
			projectId: "velocity-refund-project",
			hourTimestamp: new Date(),
			cost: 150,
			creditsCost: 150,
		});

		const allowed = await app.request("/payments/create-payment-intent", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 120, organizationId: "test-org-id" }),
		});
		expect(allowed.status).not.toBe(429);
		await redisClient.del(topUpVelocityKey("test-org-id"));

		// ...but once that money is refunded the org is back to Tier 0 with a
		// $100 cap, and the same $120 attempt is blocked.
		await db.insert(tables.transaction).values({
			organizationId: "test-org-id",
			type: "credit_refund",
			amount: "150",
			creditAmount: "-150",
			currency: "USD",
			status: "completed",
		});

		const blocked = await app.request("/payments/create-payment-intent", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 120, organizationId: "test-org-id" }),
		});
		expect(blocked.status).toBe(429);
	});

	test("spend alone does not raise the tier for a day-one org", async () => {
		// A brand-new org with the same $150 of billed usage that promotes the
		// 3-day-old fixture must stay Tier 0: the min-age floor gates the spend
		// path, so day-one burn buys nothing.
		await db
			.update(tables.organization)
			.set({ createdAt: new Date() })
			.where(eq(tables.organization.id, "test-org-id"));
		await db.insert(tables.project).values({
			id: "velocity-dayone-project",
			name: "Velocity Day-One Project",
			organizationId: "test-org-id",
		});
		await db.insert(tables.projectHourlyStats).values({
			projectId: "velocity-dayone-project",
			hourTimestamp: new Date(),
			cost: 150,
			creditsCost: 150,
		});

		const res = await app.request("/payments/create-payment-intent", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 120, organizationId: "test-org-id" }),
		});

		expect(res.status).toBe(429);
	});

	test("BYOK usage does not raise the trust tier", async () => {
		// $150 of own-provider-key usage costs the org nothing here and is not
		// spend-capped — it must not buy the Tier 2 top-up allowance the same
		// spend in credits would.
		await db.insert(tables.project).values({
			id: "velocity-byok-project",
			name: "Velocity BYOK Project",
			organizationId: "test-org-id",
		});
		await db.insert(tables.projectHourlyStats).values({
			projectId: "velocity-byok-project",
			hourTimestamp: new Date(),
			cost: 150,
			apiKeysCost: 150,
			creditsCost: 0,
		});

		const res = await app.request("/payments/create-payment-intent", {
			method: "POST",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ amount: 120, organizationId: "test-org-id" }),
		});

		// Still Tier 0 => $100/24h cap => the $120 attempt is blocked.
		expect(res.status).toBe(429);
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
