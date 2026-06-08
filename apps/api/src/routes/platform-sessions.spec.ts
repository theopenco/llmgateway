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
});
