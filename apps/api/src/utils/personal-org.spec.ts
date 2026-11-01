import { Decimal } from "decimal.js";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { app } from "@/index.js";
import { createTestUser, deleteAll } from "@/testing.js";

import { db, tables } from "@llmgateway/db";

describe("getOrCreateChatOrg", () => {
	let cookie: string;

	beforeEach(async () => {
		cookie = await createTestUser();
		await db.insert(tables.organization).values({
			id: "personal-org-devpass",
			name: "DevPass",
			kind: "devpass",
			billingEmail: "admin@example.com",
			credits: "250",
		});
		await db.insert(tables.userOrganization).values({
			userId: "test-user-id",
			organizationId: "personal-org-devpass",
			role: "owner",
		});
	});

	afterEach(deleteAll);

	test("concurrent first calls migrate the balance into one chat org", async () => {
		const responses = await Promise.all(
			Array.from({ length: 8 }, () =>
				app.request("/playground/chat-org", { headers: { Cookie: cookie } }),
			),
		);
		expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));

		const memberships = await db.query.userOrganization.findMany({
			where: { userId: "test-user-id" },
			with: { organization: true },
		});
		const chatOrgs = memberships.filter((m) => m.organization?.kind === "chat");
		expect(chatOrgs).toHaveLength(1);
		expect(new Decimal(chatOrgs[0].organization!.credits).toString()).toBe(
			"250",
		);

		const total = memberships.reduce(
			(sum, m) => sum.plus(m.organization?.credits ?? 0),
			new Decimal(0),
		);
		expect(total.toString()).toBe("250");

		const gifts = await db.query.transaction.findMany({
			where: { type: { eq: "credit_gift" } },
		});
		expect(gifts).toHaveLength(2);
	});
});
