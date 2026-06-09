import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

const PLATFORM_SECRET = "sk_test_platform";

interface SessionResponse {
	sessionToken: string;
	publishableKey: string | null;
	walletId: string;
	endCustomerId: string;
	expiresAt: string;
}

async function mintSession(customer: string): Promise<SessionResponse> {
	const res = await app.request("/v1/sessions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${PLATFORM_SECRET}`,
		},
		body: JSON.stringify({ customer }),
	});

	expect(res.status).toBe(201);
	return (await res.json()) as SessionResponse;
}

describe("platform sessions", () => {
	beforeEach(async () => {
		await createTestUser();

		await db.insert(tables.organization).values({
			id: "test-org-id",
			name: "Test Organization",
			billingEmail: "test@example.com",
		});

		await db.insert(tables.userOrganization).values({
			id: "test-user-org-id",
			userId: "test-user-id",
			organizationId: "test-org-id",
			role: "owner",
		});

		await db.insert(tables.project).values({
			id: "test-project-id",
			name: "Test Project",
			organizationId: "test-org-id",
			endUserEnabled: true,
		});

		await db.insert(tables.apiKey).values({
			id: "test-platform-secret-key-id",
			token: PLATFORM_SECRET,
			projectId: "test-project-id",
			description: "Platform secret",
			keyType: "platform_secret",
			createdBy: "test-user-id",
		});
	});

	afterEach(async () => {
		await deleteAll();
	});

	test("reuses one hidden aggregate API key per end customer", async () => {
		const firstSession = await mintSession("customer-a");
		const secondSession = await mintSession("customer-a");

		expect(secondSession.walletId).toBe(firstSession.walletId);
		expect(secondSession.endCustomerId).toBe(firstSession.endCustomerId);

		const aggregateKeys = await db.query.apiKey.findMany({
			where: {
				projectId: { eq: "test-project-id" },
				keyType: { eq: "end_user_customer" },
			},
		});
		expect(aggregateKeys).toHaveLength(1);
		expect(aggregateKeys[0].description).toBe("Embedded end-user: customer-a");
		expect(aggregateKeys[0].endCustomerWalletId).toBe(firstSession.walletId);
		expect(aggregateKeys[0].token.startsWith("euck_")).toBe(true);

		const sessions = await db.query.endUserSession.findMany({
			where: {
				endCustomerId: { eq: firstSession.endCustomerId },
			},
		});
		expect(sessions).toHaveLength(2);
	});

	test("creates distinct hidden aggregate API keys for different end customers", async () => {
		const firstSession = await mintSession("customer-a");
		const secondSession = await mintSession("customer-b");

		expect(secondSession.walletId).not.toBe(firstSession.walletId);
		expect(secondSession.endCustomerId).not.toBe(firstSession.endCustomerId);

		const aggregateKeys = await db.query.apiKey.findMany({
			where: {
				projectId: { eq: "test-project-id" },
				keyType: { eq: "end_user_customer" },
			},
		});

		expect(aggregateKeys).toHaveLength(2);
		expect(aggregateKeys.map((key) => key.endCustomerWalletId).sort()).toEqual(
			[firstSession.walletId, secondSession.walletId].sort(),
		);
		expect(aggregateKeys.map((key) => key.description).sort()).toEqual([
			"Embedded end-user: customer-a",
			"Embedded end-user: customer-b",
		]);
	});

	test("test-mode secret keys mint test-mode sessions and wallets", async () => {
		const session = await mintSession("customer-a");

		expect(session.sessionToken.startsWith("es_test_")).toBe(true);

		const wallet = await db.query.wallet.findFirst({
			where: { id: { eq: session.walletId } },
		});
		expect(wallet?.mode).toBe("test");

		const endCustomer = await db.query.endCustomer.findFirst({
			where: { id: { eq: session.endCustomerId } },
		});
		expect(endCustomer?.mode).toBe("test");
	});

	test("live and test keys give the same externalId independent wallets", async () => {
		await db.insert(tables.apiKey).values({
			id: "test-live-platform-key-id",
			token: "sk_live_platform",
			projectId: "test-project-id",
			description: "Live platform secret",
			keyType: "platform_secret",
			createdBy: "test-user-id",
		});

		const testSession = await mintSession("shared-customer");

		const liveRes = await app.request("/v1/sessions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer sk_live_platform",
			},
			body: JSON.stringify({ customer: "shared-customer" }),
		});
		expect(liveRes.status).toBe(201);
		const liveSession = (await liveRes.json()) as SessionResponse;

		expect(liveSession.sessionToken.startsWith("es_test_")).toBe(false);
		expect(liveSession.walletId).not.toBe(testSession.walletId);
		expect(liveSession.endCustomerId).not.toBe(testSession.endCustomerId);

		const liveWallet = await db.query.wallet.findFirst({
			where: { id: { eq: liveSession.walletId } },
		});
		expect(liveWallet?.mode).toBe("live");
	});

	async function createLiveKey() {
		await db.insert(tables.apiKey).values({
			id: "test-live-platform-key-id",
			token: "sk_live_platform",
			projectId: "test-project-id",
			description: "Live platform secret",
			keyType: "platform_secret",
			createdBy: "test-user-id",
		});
	}

	test("a test key cannot read or credit a live wallet (cross-mode)", async () => {
		await createLiveKey();

		const liveRes = await app.request("/v1/sessions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer sk_live_platform",
			},
			body: JSON.stringify({ customer: "live-customer" }),
		});
		expect(liveRes.status).toBe(201);
		const liveSession = (await liveRes.json()) as SessionResponse;

		// PLATFORM_SECRET is a test key; the wallet belongs to a live customer.
		const retrieve = await app.request(`/v1/wallets/${liveSession.walletId}`, {
			headers: { Authorization: `Bearer ${PLATFORM_SECRET}` },
		});
		expect(retrieve.status).toBe(404);

		const credit = await app.request(
			`/v1/wallets/${liveSession.walletId}/credit`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${PLATFORM_SECRET}`,
				},
				body: JSON.stringify({ amount: 5 }),
			},
		);
		expect(credit.status).toBe(404);

		const liveWallet = await db.query.wallet.findFirst({
			where: { id: { eq: liveSession.walletId } },
		});
		expect(liveWallet?.balance).toBe("0");
	});

	test("test keys are rejected from Connect routes", async () => {
		const res = await app.request("/v1/connect/status", {
			headers: { Authorization: `Bearer ${PLATFORM_SECRET}` },
		});
		expect(res.status).toBe(403);
	});

	test("test keys are rejected from webhook-endpoint management", async () => {
		const res = await app.request("/v1/webhooks", {
			headers: { Authorization: `Bearer ${PLATFORM_SECRET}` },
		});
		expect(res.status).toBe(403);
	});
});
