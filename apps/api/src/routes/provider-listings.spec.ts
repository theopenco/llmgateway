import { beforeEach, afterEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { and, db, eq, isNull, tables } from "@llmgateway/db";

const ORG_ID = "test-org-id";

const listingBody = {
	organizationId: ORG_ID,
	providerName: "Acme Inference",
	url: "https://acme-inference.test",
	termsUrl: "https://acme-inference.test/terms",
	privacyUrl: "https://acme-inference.test/privacy",
	country: "Germany",
	dataRetentionDays: 0,
	trainsOnData: false,
	baseUrl: "https://api.acme-inference.test",
	testApiKey: "sk-acme-test-key-123456",
	claimedModels: [{ modelId: "gpt-5-mini", externalId: "acme-gpt-5-mini" }],
	discountPercent: 0.2,
};

async function createListing(token: string, body: object = listingBody) {
	return await app.request("/provider-listings", {
		method: "POST",
		headers: { "Content-Type": "application/json", Cookie: token },
		body: JSON.stringify(body),
	});
}

describe("provider listings routes", () => {
	let token: string;

	beforeEach(async () => {
		token = await createTestUser();
		await db.insert(tables.organization).values({
			id: ORG_ID,
			name: "Test Organization",
			billingEmail: "admin@example.com",
			plan: "pro",
		});
		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: ORG_ID,
		});
	});

	afterEach(async () => {
		await db.delete(tables.routingScoreMultiplier);
		await deleteAll();
	});

	test("creates a listing and never exposes the test key", async () => {
		const res = await createListing(token);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.listing.state).toBe("awaiting_payment");
		expect(json.listing.providerSlug).toBe("acme-inference");
		expect(json.listing.testKeyMasked).toBeTruthy();
		expect(json.listing.testKeyMasked).not.toContain("test-key-123456");
		expect(JSON.stringify(json)).not.toContain(listingBody.testApiKey);
		// No Stripe price configured in tests, so checkout degrades gracefully.
		expect(json.checkoutUrl).toBeNull();

		const row = await db.query.providerListingRequest.findFirst({
			where: { id: json.listing.id },
		});
		expect(row?.organizationId).toBe(ORG_ID);
		expect(row?.testKeyCiphertext).toContain("llmgw:");
		expect(row?.discountPercent).toBe("0.2");
	});

	test("rejects a name colliding with an existing catalogue provider", async () => {
		const res = await createListing(token, {
			...listingBody,
			providerName: "OpenAI",
		});
		expect(res.status).toBe(400);
	});

	test("rejects unknown claimed models", async () => {
		const res = await createListing(token, {
			...listingBody,
			claimedModels: [{ modelId: "not-a-model", externalId: "x" }],
		});
		expect(res.status).toBe(400);
	});

	test("rejects members without the admin role", async () => {
		await db
			.update(tables.userOrganization)
			.set({ role: "developer" })
			.where(eq(tables.userOrganization.id, "test-user-org-id"));
		const res = await createListing(token);
		expect(res.status).toBe(403);
	});

	test("requires payment before validation can be queued", async () => {
		const created = await (await createListing(token)).json();

		const unpaid = await app.request(
			`/provider-listings/${created.listing.id}/validate`,
			{ method: "POST", headers: { Cookie: token } },
		);
		expect(unpaid.status).toBe(402);

		await db
			.update(tables.providerListingRequest)
			.set({ paymentStatus: "paid", paidAt: new Date() })
			.where(eq(tables.providerListingRequest.id, created.listing.id));

		const queued = await app.request(
			`/provider-listings/${created.listing.id}/validate`,
			{ method: "POST", headers: { Cookie: token } },
		);
		expect(queued.status).toBe(200);
		const { run } = await queued.json();
		expect(run.status).toBe("queued");

		// A second run cannot be queued while one is pending.
		const duplicate = await app.request(
			`/provider-listings/${created.listing.id}/validate`,
			{ method: "POST", headers: { Cookie: token } },
		);
		expect(duplicate.status).toBe(409);
	});

	test("activation requires passed validation, then provisions the routing boost", async () => {
		const created = await (await createListing(token)).json();
		const id = created.listing.id;

		const premature = await app.request(`/provider-listings/${id}/activate`, {
			method: "POST",
			headers: { Cookie: token },
		});
		expect(premature.status).toBe(402);

		await db
			.update(tables.providerListingRequest)
			.set({
				paymentStatus: "paid",
				paidAt: new Date(),
				validationStatus: "passed",
			})
			.where(eq(tables.providerListingRequest.id, id));

		const activated = await app.request(`/provider-listings/${id}/activate`, {
			method: "POST",
			headers: { Cookie: token },
		});
		expect(activated.status).toBe(200);
		const { listing } = await activated.json();
		expect(listing.state).toBe("live");
		expect(listing.listedAt).toBeTruthy();

		const boost = await db.query.routingScoreMultiplier.findFirst({
			where: { provider: "acme-inference", model: { isNull: true } },
		});
		expect(boost?.scoreMultiplier).toBe("-0.2");
		expect(boost?.reason).toContain(id);
	});

	test("changing the discount while live re-prices the routing boost", async () => {
		const created = await (await createListing(token)).json();
		const id = created.listing.id;
		await db
			.update(tables.providerListingRequest)
			.set({
				paymentStatus: "paid",
				validationStatus: "passed",
			})
			.where(eq(tables.providerListingRequest.id, id));
		await app.request(`/provider-listings/${id}/activate`, {
			method: "POST",
			headers: { Cookie: token },
		});

		const res = await app.request(`/provider-listings/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ discountPercent: 0.35 }),
		});
		expect(res.status).toBe(200);

		const boost = await db.query.routingScoreMultiplier.findFirst({
			where: { provider: "acme-inference", model: { isNull: true } },
		});
		expect(boost?.scoreMultiplier).toBe("-0.35");
	});

	test("endpoint changes are blocked while live but reset validation before", async () => {
		const created = await (await createListing(token)).json();
		const id = created.listing.id;
		await db
			.update(tables.providerListingRequest)
			.set({ paymentStatus: "paid", validationStatus: "passed" })
			.where(eq(tables.providerListingRequest.id, id));

		const beforeLive = await app.request(`/provider-listings/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ baseUrl: "https://api2.acme-inference.test" }),
		});
		expect(beforeLive.status).toBe(200);
		const patched = await beforeLive.json();
		expect(patched.listing.validationStatus).toBe("not_started");

		await db
			.update(tables.providerListingRequest)
			.set({ validationStatus: "passed" })
			.where(eq(tables.providerListingRequest.id, id));
		await app.request(`/provider-listings/${id}/activate`, {
			method: "POST",
			headers: { Cookie: token },
		});

		const whileLive = await app.request(`/provider-listings/${id}`, {
			method: "PATCH",
			headers: { "Content-Type": "application/json", Cookie: token },
			body: JSON.stringify({ baseUrl: "https://api3.acme-inference.test" }),
		});
		expect(whileLive.status).toBe(400);
	});

	test("archiving a live listing removes the routing boost", async () => {
		const created = await (await createListing(token)).json();
		const id = created.listing.id;
		await db
			.update(tables.providerListingRequest)
			.set({ paymentStatus: "paid", validationStatus: "passed" })
			.where(eq(tables.providerListingRequest.id, id));
		await app.request(`/provider-listings/${id}/activate`, {
			method: "POST",
			headers: { Cookie: token },
		});

		const res = await app.request(`/provider-listings/${id}`, {
			method: "DELETE",
			headers: { Cookie: token },
		});
		expect(res.status).toBe(200);
		const { listing } = await res.json();
		expect(listing.state).toBe("archived");

		const boost = await db
			.select()
			.from(tables.routingScoreMultiplier)
			.where(
				and(
					eq(tables.routingScoreMultiplier.provider, "acme-inference"),
					isNull(tables.routingScoreMultiplier.model),
				),
			);
		expect(boost).toHaveLength(0);
	});

	test("lists listings with the latest run attached", async () => {
		const created = await (await createListing(token)).json();
		await db.insert(tables.providerListingTestRun).values({
			listingRequestId: created.listing.id,
			status: "failed",
			error: "endpoint unreachable",
		});

		const res = await app.request(
			`/provider-listings?organizationId=${ORG_ID}`,
			{ headers: { Cookie: token } },
		);
		expect(res.status).toBe(200);
		const { listings } = await res.json();
		expect(listings).toHaveLength(1);
		expect(listings[0].latestRun?.status).toBe("failed");
	});

	test("rejects unauthenticated access", async () => {
		const res = await app.request(
			`/provider-listings?organizationId=${ORG_ID}`,
		);
		expect(res.status).toBe(401);
	});
});
